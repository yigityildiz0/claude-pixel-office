// Küçük, bağımlılıksız PNG yazıcı: paletli (8 bit) piksel ızgarasını base64 PNG'ye çevirir.
// Sıkıştırma: sabit Huffman kodlu deflate (RFC 1951 §3.2.6) ve kısa bir LZ77 araması. Karakter
// şeritleri bununla modül yüklenirken üretilir; kaynakta gömülü görsel tutulmaz.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }

  return t
})()

function crc32(bytes: readonly number[], from: number, to: number): number {
  let c = 0xffffffff
  for (let i = from; i < to; i++) c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 255] as number) ^ (c >>> 8)

  return (c ^ 0xffffffff) >>> 0
}

function adler32(data: Uint8Array): number {
  let a = 1
  let b = 0
  for (const x of data) {
    a = (a + x) % 65521
    b = (b + a) % 65521
  }

  return ((b << 16) | a) >>> 0
}

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]

/** Raw deflate, one final block with the fixed Huffman codes. */
function deflate(data: Uint8Array): number[] {
  const out: number[] = []
  let acc = 0
  let nb = 0
  const put = (v: number, len: number): void => {
    acc |= v << nb
    nb += len
    while (nb >= 8) {
      out.push(acc & 255)
      acc >>>= 8
      nb -= 8
    }
  }
  // Huffman codes go most significant bit first
  const code = (c: number, len: number): void => {
    let r = 0
    for (let i = 0; i < len; i++) r = (r << 1) | ((c >> i) & 1)
    put(r, len)
  }
  const lit = (c: number): void => {
    if (c < 144) code(0x30 + c, 8)
    else if (c < 256) code(0x190 + c - 144, 9)
    else if (c < 280) code(c - 256, 7)
    else code(0xc0 + c - 280, 8)
  }

  put(1, 1)
  put(1, 2)
  const n = data.length
  const chains = new Map<number, number[]>()
  const keyAt = (i: number): number => (data[i] as number) | ((data[i + 1] as number) << 8) | ((data[i + 2] as number) << 16)
  const note = (i: number): void => {
    if (i + 2 >= n) return
    const k = keyAt(i)
    let list = chains.get(k)
    if (!list) chains.set(k, (list = []))
    list.push(i)
    if (list.length > 64) list.shift()
  }
  let i = 0
  while (i < n) {
    let bestLen = 0
    let bestDist = 0
    if (i + 2 < n) {
      const list = chains.get(keyAt(i))
      if (list) {
        for (let j = list.length - 1; j >= 0; j--) {
          const p = list[j] as number
          const d = i - p
          if (d > 32768) break
          let l = 0
          while (l < 258 && i + l < n && data[p + l] === data[i + l]) l++
          if (l > bestLen) {
            bestLen = l
            bestDist = d
            if (l === 258) break
          }
        }
      }
    }
    if (bestLen >= 3) {
      let li = 0
      while (li < 28 && (LBASE[li + 1] as number) <= bestLen) li++
      lit(257 + li)
      put(bestLen - (LBASE[li] as number), LEXT[li] as number)
      let di = 0
      while (di < 29 && (DBASE[di + 1] as number) <= bestDist) di++
      code(di, 5)
      put(bestDist - (DBASE[di] as number), DEXT[di] as number)
      for (let k = 0; k < bestLen; k++) note(i + k)
      i += bestLen
    } else {
      lit(data[i] as number)
      note(i)
      i++
    }
  }
  lit(256)
  if (nb > 0) out.push(acc & 255)

  return out
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64(bytes: readonly number[]): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const v = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    s += B64[(v >> 18) & 63]
    s += B64[(v >> 12) & 63]
    s += b === undefined ? '=' : B64[(v >> 6) & 63]
    s += c === undefined ? '=' : B64[v & 63]
  }

  return s
}

const be32 = (v: number): number[] => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]

function chunk(out: number[], type: string, body: readonly number[]): void {
  out.push(...be32(body.length))
  const start = out.length
  for (let i = 0; i < 4; i++) out.push(type.charCodeAt(i))
  for (const b of body) out.push(b)
  out.push(...be32(crc32(out, start, out.length)))
}

/**
 * A paletted PNG, base64: `pixels` holds w × h palette indices row by row; `palette` lists '#RRGGBB'
 * colors, index 0 is transparent whatever it says.
 */
export function pngBase64(pixels: Uint8Array, w: number, h: number, palette: readonly string[]): string {
  const raw = new Uint8Array(h * (w + 1))
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0
    raw.set(pixels.subarray(y * w, y * w + w), y * (w + 1) + 1)
  }
  const z = [0x78, 0x01, ...deflate(raw), ...be32(adler32(raw))]
  const plte: number[] = []
  const trns: number[] = []
  palette.forEach((c, i) => {
    const v = parseInt(c.slice(1), 16) || 0
    plte.push((v >> 16) & 255, (v >> 8) & 255, v & 255)
    trns.push(i === 0 ? 0 : 255)
  })
  const out: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  chunk(out, 'IHDR', [...be32(w), ...be32(h), 8, 3, 0, 0, 0])
  chunk(out, 'PLTE', plte)
  chunk(out, 'tRNS', trns)
  chunk(out, 'IDAT', z)
  chunk(out, 'IEND', [])

  return base64(out)
}
