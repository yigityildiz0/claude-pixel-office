// Piksel Ofis karakterleri: üç özgün piksel çalışan (turuncu, yeşil, mavi). Hiçbir markanın maskotu
// değildir. Her figür 24 x 24'lük bir karede, dolgu dikdörtgenleriyle (parça parça: bacak, gövde, kol,
// baş, saç) çizilir; dış çizgi otomatik eklenir, sonra simgeler (düşünce noktaları, kum saati, onay, X)
// konur. Her durum 4 karelik yatay bir şerittir; şeritler modül yüklenirken paletli PNG'ye çevrilir
// (pixel-png.ts). (ax, ay) ayak tabanı orta noktası, fig idle kare 0'ın opak sınırları (right ve bottom
// hariç), scale önerilen ölçek (bir kaynak pikseli = 2 prop pikseli).
import { pngBase64 } from './pixel-png'

export type CharKind = 'turuncu' | 'yesil' | 'mavi'
export type CharState = 'idle' | 'walk' | 'wave' | 'work' | 'think' | 'read' | 'wait' | 'done' | 'fail' | 'run'
export type CharStrip = { n: number; fps: number; b64: string }
export type CharSheet = {
  w: number; h: number; scale: number; ax: number; ay: number
  fig: { top: number; bottom: number; left: number; right: number }
  states: Partial<Record<CharState, CharStrip>>
}

const W = 24
const H = 24

// palette indices (0 transparent)
const O = 1 // outline, eyes
const SK = 2 // skin
const SKS = 3 // skin shade
const HR = 4 // hair / cap
const HRH = 5 // hair light / cap band
const SH = 6 // shirt
const SHS = 7 // shirt shade
const PA = 8 // trousers
const PAS = 9 // trousers shade
const SO = 10 // shoes
const WH = 11 // white
const RD = 12 // red
const GR = 13 // green
const YL = 14 // yellow
const BK = 15 // book cover, hourglass frame
const SKY = 16 // light blue
const PG = 17 // page lines

type Look = { shirt: string; shade: string; hair: string; hairLight: string; style: 'kisa' | 'bere' | 'kakul' }

const LOOKS: Readonly<Record<CharKind, Look>> = {
  turuncu: { shirt: '#E8833A', shade: '#B9612A', hair: '#5B3A24', hairLight: '#7A5236', style: 'kisa' },
  yesil: { shirt: '#3FA66B', shade: '#2C7A4E', hair: '#23573A', hairLight: '#9ED9B4', style: 'bere' },
  mavi: { shirt: '#3B82C4', shade: '#2A5F93', hair: '#E8C15A', hairLight: '#F5D97F', style: 'kakul' },
}

const paletteOf = (l: Look): string[] => [
  '#000000', '#1E1B24', '#F1C39C', '#D49A72', l.hair, l.hairLight, l.shirt, l.shade,
  '#384057', '#2A3044', '#26272F', '#F8F5EE', '#E5484D', '#3DBA6A', '#F5C542', '#8A5A3C', '#9BD8FF', '#B9BFCC',
]

type Arms = 'down' | 'swingL' | 'swingR' | 'runL' | 'runR' | 'up' | 'wave1' | 'wave2' | 'type1' | 'type2' | 'chin' | 'book' | 'bookFlip'
type Legs = 'stand' | 'liftL' | 'liftR'
type Eyes = 'open' | 'blink' | 'up' | 'down' | 'sad' | 'happy'
type Mark = 'dots1' | 'dots2' | 'dots3' | 'sand0' | 'sand1' | 'sand2' | 'check' | 'check2' | 'x' | 'drop0' | 'drop1'
type Pose = { arms?: Arms; legs?: Legs; eyes?: Eyes; lift?: number; droop?: number; marks?: readonly Mark[] }

class Grid {
  readonly a = new Uint8Array(W * H)
  dy = 0
  fill(x: number, y: number, w: number, h: number, c: number): void {
    for (let yy = y + this.dy; yy < y + this.dy + h; yy++) {
      if (yy < 0 || yy >= H) continue
      for (let xx = x; xx < x + w; xx++) if (xx >= 0 && xx < W) this.a[yy * W + xx] = c
    }
  }
  /** a pattern of rows ('#' = c, anything else = leave), its top-left at (x, y) */
  draw(x: number, y: number, rows: readonly string[], c: number): void {
    rows.forEach((row, yy) => {
      for (let xx = 0; xx < row.length; xx++) if (row[xx] === '#') this.fill(x + xx, y + yy, 1, 1, c)
    })
  }
  /** every empty pixel next to a drawn one (4-neighbours) becomes outline */
  outline(): void {
    const src = this.a.slice()
    const on = (x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H && src[y * W + x] !== 0
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!src[y * W + x] && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1))) this.a[y * W + x] = O
      }
    }
  }
}

/** A small mark drawn on a layer of its own and outlined there, then laid over the figure. */
function overlay(g: Grid, draw: (m: Grid) => void): void {
  const m = new Grid()
  draw(m)
  m.outline()
  m.a.forEach((c, i) => {
    if (c) g.a[i] = c
  })
}

function legs(g: Grid, l: Legs): void {
  g.fill(9, 18, 6, 1, PA)
  const leg = (x: number, lifted: boolean) => {
    g.fill(x, 19, 2, lifted ? 2 : 3, PA)
    g.fill(x === 9 ? 8 : 13, lifted ? 21 : 22, 3, 1, SO)
  }
  leg(9, l === 'liftL')
  leg(13, l === 'liftR')
  g.fill(14, 19, 1, l === 'liftR' ? 2 : 3, PAS)
}

function torso(g: Grid, kind: CharKind): void {
  g.fill(8, 12, 8, 6, SH)
  g.fill(15, 12, 1, 6, SHS)
  g.fill(8, 17, 8, 1, SHS)
  g.fill(11, 12, 2, 1, SK)
  if (kind === 'yesil') {
    // hoodie strings
    g.fill(10, 13, 1, 2, WH)
    g.fill(13, 13, 1, 2, WH)
  } else if (kind === 'mavi') {
    // shirt pocket
    g.fill(9, 14, 2, 1, SHS)
  } else {
    // buttons
    g.fill(12, 14, 1, 1, SHS)
    g.fill(12, 16, 1, 1, SHS)
  }
}

function arms(g: Grid, a: Arms): void {
  const down = (x: number, rise: number, c: number) => {
    g.fill(x, 13 - rise, 2, 4, c)
    g.fill(x, 17 - rise, 2, 1, SK)
  }
  const raised = (x: number, top: number) => {
    g.fill(x, top + 1, 2, 12 - top, SH)
    g.fill(x, top, 2, 1, SK)
  }
  switch (a) {
    case 'down':
      down(5, 0, SH)
      down(17, 0, SHS)
      return
    case 'swingL':
      down(5, 1, SH)
      down(17, 0, SHS)
      return
    case 'swingR':
      down(5, 0, SH)
      down(17, 1, SHS)
      return
    case 'runL':
      g.fill(5, 12, 2, 2, SH)
      g.fill(5, 14, 2, 1, SK)
      down(17, 0, SHS)
      return
    case 'runR':
      down(5, 0, SH)
      g.fill(17, 12, 2, 2, SHS)
      g.fill(17, 14, 2, 1, SK)
      return
    case 'up':
      raised(5, 6)
      raised(17, 6)
      return
    case 'wave1':
      down(5, 0, SH)
      raised(17, 6)
      return
    case 'wave2':
      down(5, 0, SH)
      g.fill(17, 10, 2, 3, SH)
      g.fill(18, 7, 2, 3, SH)
      g.fill(18, 6, 2, 1, SK)
      return
    case 'type1':
    case 'type2': {
      // forearms over the chest, hands tapping in turn
      g.fill(5, 13, 2, 3, SH)
      g.fill(17, 13, 2, 3, SHS)
      g.fill(7, 15, 2, 1, SHS)
      g.fill(15, 15, 2, 1, SHS)
      g.fill(9, a === 'type1' ? 15 : 16, 2, 1, SK)
      g.fill(13, a === 'type1' ? 16 : 15, 2, 1, SK)
      return
    }
    case 'chin':
      down(5, 0, SH)
      g.fill(17, 13, 2, 2, SHS)
      g.fill(15, 12, 2, 2, SHS)
      return
    case 'book':
    case 'bookFlip':
      down(5, 0, SH)
      down(17, 0, SHS)
      return
  }
}

function head(g: Grid, kind: CharKind, eyes: Eyes): void {
  g.fill(8, 4, 8, 8, SK)
  g.fill(15, 8, 1, 4, SKS)
  g.fill(9, 11, 6, 1, SKS)
  const style = LOOKS[kind].style
  if (style === 'bere') {
    // a knitted cap with a light band
    g.fill(8, 4, 8, 2, HR)
    g.fill(8, 6, 8, 1, HRH)
  } else if (style === 'kakul') {
    // light hair with a ragged fringe
    g.fill(8, 4, 8, 2, HR)
    g.draw(8, 6, ['##.#.###'], HR)
    g.fill(8, 7, 1, 1, HR)
    g.fill(12, 4, 2, 1, HRH)
  } else {
    // short hair parted on the left
    g.fill(8, 4, 8, 2, HR)
    g.fill(8, 6, 1, 2, HR)
    g.fill(13, 6, 3, 1, HR)
    g.fill(15, 7, 1, 1, HR)
    g.fill(10, 4, 2, 1, HRH)
  }
  const eye = (y: number, h: number) => {
    g.fill(10, y, 1, h, O)
    g.fill(13, y, 1, h, O)
  }
  switch (eyes) {
    case 'open':
      eye(8, 2)
      break
    case 'blink':
      eye(9, 1)
      break
    case 'up':
      eye(7, 2)
      break
    case 'down':
      eye(9, 2)
      break
    case 'sad':
      eye(9, 1)
      g.fill(9, 8, 1, 1, O)
      g.fill(14, 8, 1, 1, O)
      break
    case 'happy':
      g.draw(9, 8, ['.#..#.', '#.##.#'], O)
      break
  }
  if (eyes === 'happy') g.fill(11, 10, 2, 1, RD)
  else if (eyes === 'sad') g.draw(10, 10, ['.##.', '#..#'], SKS)
  else g.fill(11, 10, 2, 1, SKS)
}

function book(g: Grid, flip: boolean): void {
  g.fill(7, 13, 10, 5, BK)
  g.fill(8, 13, 3, 4, WH)
  g.fill(13, 13, 3, 4, WH)
  g.fill(11, 13, 2, 4, PG)
  g.fill(8, 14, 3, 1, PG)
  g.fill(13, 14, 3, 1, PG)
  g.fill(8, 16, 2, 1, PG)
  g.fill(13, 16, 2, 1, PG)
  if (flip) {
    // a page turning over
    g.fill(12, 11, 3, 3, WH)
    g.fill(12, 12, 3, 1, PG)
  }
  // thumbs on the cover
  g.fill(7, 15, 1, 1, SK)
  g.fill(16, 15, 1, 1, SK)
}

function mark(g: Grid, m: Mark): void {
  switch (m) {
    case 'dots1':
    case 'dots2':
    case 'dots3':
      overlay(g, d => {
        d.fill(18, 7, 1, 1, WH)
        if (m !== 'dots1') d.fill(19, 4, 2, 2, WH)
        if (m === 'dots3') d.fill(20, 0, 3, 3, WH)
      })
      return
    case 'sand0':
    case 'sand1':
    case 'sand2':
      overlay(g, d => {
        // an hourglass beside the head, its sand running down
        d.fill(19, 3, 4, 1, BK)
        d.fill(19, 10, 4, 1, BK)
        d.fill(20, 4, 2, 6, SKY)
        const top = m === 'sand0' ? 3 : m === 'sand1' ? 2 : 0
        if (top) d.fill(20, 7 - top, 2, top, YL)
        d.fill(20, 10 - (3 - top), 2, 3 - top, YL)
      })
      return
    case 'check':
    case 'check2':
      overlay(g, d => {
        d.draw(18, 0, ['.....#', '....##', '#..##.', '####..', '.##...'], GR)
        if (m === 'check2') {
          d.fill(16, 1, 1, 1, YL)
          d.fill(23, 5, 1, 1, YL)
        }
      })
      return
    case 'x':
      overlay(g, d => d.draw(19, 1, ['#..#', '.##.', '.##.', '#..#'], RD))
      return
    case 'drop0':
    case 'drop1':
      overlay(g, d => {
        // a drop of sweat at the temple
        const y = m === 'drop0' ? 5 : 7
        d.fill(5, y, 1, 1, SKY)
        d.fill(4, y + 1, 3, 2, SKY)
      })
      return
  }
}

function paint(kind: CharKind, p: Pose): Uint8Array {
  const g = new Grid()
  const body = -(p.lift ?? 0)
  const a = p.arms ?? 'down'
  g.dy = body
  legs(g, p.legs ?? 'stand')
  torso(g, kind)
  arms(g, a)
  g.dy = body + (p.droop ?? 0)
  head(g, kind, p.eyes ?? 'open')
  g.dy = body
  // a hand on the chin
  if (a === 'chin') g.fill(13, 11, 2, 2, SK)
  if (a === 'book' || a === 'bookFlip') book(g, a === 'bookFlip')
  g.outline()
  g.dy = 0
  for (const m of p.marks ?? []) mark(g, m)

  return g.a
}

const POSES: Readonly<Record<CharState, { fps: number; frames: readonly Pose[] }>> = {
  idle: { fps: 4, frames: [{}, {}, { eyes: 'blink' }, {}] },
  walk: { fps: 8, frames: [{ legs: 'liftL', arms: 'swingR' }, {}, { legs: 'liftR', arms: 'swingL' }, {}] },
  run: { fps: 12, frames: [{ legs: 'liftL', arms: 'runR', lift: 1 }, { arms: 'swingL' }, { legs: 'liftR', arms: 'runL', lift: 1 }, { arms: 'swingR' }] },
  wave: { fps: 6, frames: [{ arms: 'wave1', eyes: 'happy' }, { arms: 'wave2', eyes: 'happy' }, { arms: 'wave1', eyes: 'happy' }, { arms: 'wave2', eyes: 'happy' }] },
  work: { fps: 6, frames: [{ arms: 'type1', eyes: 'down' }, { arms: 'type2', eyes: 'down' }, { arms: 'type1', eyes: 'down' }, { arms: 'type2', eyes: 'blink' }] },
  think: { fps: 4, frames: [{ arms: 'chin', eyes: 'up', marks: ['dots1'] }, { arms: 'chin', eyes: 'up', marks: ['dots2'] }, { arms: 'chin', eyes: 'up', marks: ['dots3'] }, { arms: 'chin', eyes: 'blink', marks: ['dots3'] }] },
  read: { fps: 4, frames: [{ arms: 'book', eyes: 'down' }, { arms: 'book', eyes: 'down' }, { arms: 'bookFlip', eyes: 'down' }, { arms: 'book', eyes: 'blink' }] },
  wait: { fps: 4, frames: [{ marks: ['sand0'] }, { marks: ['sand1'] }, { eyes: 'blink', marks: ['sand2'] }, { legs: 'liftR', marks: ['sand2'] }] },
  done: { fps: 8, frames: [{ arms: 'up', eyes: 'happy', marks: ['check'] }, { arms: 'up', eyes: 'happy', lift: 1, marks: ['check2'] }, { arms: 'up', eyes: 'happy', marks: ['check'] }, { arms: 'up', eyes: 'happy', lift: 1, marks: ['check2'] }] },
  fail: { fps: 4, frames: [{ eyes: 'sad', droop: 1, marks: ['x', 'drop0'] }, { eyes: 'sad', droop: 1, marks: ['x', 'drop1'] }, { eyes: 'sad', droop: 1, marks: ['drop1'] }, { eyes: 'sad', droop: 1, marks: ['x', 'drop0'] }] },
}

/** The opaque bounds of a frame (right and bottom exclusive). */
function bounds(px: Uint8Array): CharSheet['fig'] {
  let top = H
  let bottom = 0
  let left = W
  let right = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!px[y * W + x]) continue
      top = Math.min(top, y)
      bottom = Math.max(bottom, y + 1)
      left = Math.min(left, x)
      right = Math.max(right, x + 1)
    }
  }

  return { top, bottom, left, right }
}

function sheetOf(kind: CharKind): CharSheet {
  const states: Partial<Record<CharState, CharStrip>> = {}
  let fig: CharSheet['fig'] = { top: 3, bottom: H, left: 4, right: 20 }
  for (const state of Object.keys(POSES) as CharState[]) {
    const def = POSES[state]
    const n = def.frames.length
    const img = new Uint8Array(W * n * H)
    def.frames.forEach((pose, f) => {
      const px = paint(kind, pose)
      if (f === 0 && state === 'idle') fig = bounds(px)
      for (let y = 0; y < H; y++) img.set(px.subarray(y * W, y * W + W), y * W * n + f * W)
    })
    states[state] = { n, fps: def.fps, b64: pngBase64(img, W * n, H, paletteOf(LOOKS[kind])) }
  }

  return { w: W, h: H, scale: 2, ax: 12, ay: H, fig, states }
}

export const CHAR_SET: Readonly<Record<CharKind, CharSheet>> = {
  turuncu: sheetOf('turuncu'),
  yesil: sheetOf('yesil'),
  mavi: sheetOf('mavi'),
}
