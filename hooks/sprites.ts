// Animated pixel icons drawn with GPT Image (a looping sprite sheet), cut into
// 4-frame strips of 32x32 and kept here as small PNGs. A strip is embedded once
// per drawing as a <symbol> and shown through a 32x32 window that steps across
// its frames, so many workers doing the same thing cost one copy.
import { charDefs } from './characters'
import { SPRITE_PNG } from './sprite-data'

export type SpriteName =
  | 'think' | 'read' | 'write' | 'run' | 'web' | 'plan' | 'send' | 'wait' | 'done' | 'fail' | 'squeeze'

const used = new Set<SpriteName>()

export function hasSprite(name: SpriteName): boolean {
  return Boolean(SPRITE_PNG[name])
}

/**
 * The icon at (x, y), `size` units square. `animated` false shows its first
 * frame only. `delay` (seconds, ≤ 0) staggers icons so they do not move in step.
 */
export function sprite(name: SpriteName, x: number, y: number, size: number, animated = true, delay = 0, loops?: number): string {
  if (!SPRITE_PNG[name]) return ''
  used.add(name)
  const r = (v: number) => Math.round(v * 10) / 10
  // `loops` plays the strip that many times (an event, `delay` = minus its age) and then rests on the first frame
  const motion = !animated ? '' : loops ? ` style="animation:sp4 .9s ${r(delay)}s steps(4) ${loops}"` : ` style="animation:sp4 .9s ${r(delay)}s steps(4) infinite"`

  return `<svg x="${r(x)}" y="${r(y)}" width="${r(size)}" height="${r(size)}" viewBox="0 0 32 32" overflow="hidden"><use href="#sp-${name}"${motion}/></svg>`
}

/**
 * What the drawing needs in its defs: first the characters (characters.ts charDefs: every
 * kind's idle strip, the boss first, then its other states; a state that does not fit falls
 * back to idle, so no figure ever goes missing), then the icon strips drawn since the last
 * call (in the office only the shredder's 'squeeze' and the ticker's newest line), as defs;
 * clears both lists.
 * `budget` caps the characters they may add: an icon strip that does not fit is left
 * out and its icons simply do not show, so the drawing stays under the surface's limit.
 */
export function spriteDefs(budget = Infinity): string {
  let out = charDefs(budget)
  for (const name of used) {
    if (out.length + (SPRITE_PNG[name]?.length ?? 0) + 240 > budget) continue
    out += `<symbol id="sp-${name}" viewBox="0 0 128 32" width="128" height="32"><image href="data:image/png;base64,${SPRITE_PNG[name]}" width="128" height="32" style="image-rendering:pixelated"/></symbol>`
  }
  used.clear()

  return out
}
