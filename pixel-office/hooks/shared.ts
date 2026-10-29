// Auto compact, shared by two mods that both offer it (kota-bandi and piksel-ofis):
// one setting per chat in a folder both read and write, and one runner. With both
// installed the chat compacts once, set from either; with either alone it still works.
// The folder holds small files only: `<chat>.json` (the setting) and `<mod>.alive`
// (when that mod last looked in), so two writers never edit the same file at once.
import type { EngineInterface } from 'claude-code'

export type SharedAuto = { isOn: boolean; at: number; t: number }

/** A runner that has not looked in for this long is gone (uninstalled, disabled). */
const ALIVE_MS = 20_000
const FOLDER = 'claude-auto-compact'

let base: string | undefined

async function folder($: EngineInterface): Promise<string | undefined> {
  if (base) return base
  try {
    base = await locate($)
  } catch {
    base = undefined
  }

  return base
}

async function locate($: EngineInterface): Promise<string | undefined> {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home ? `${home}/.claude` : undefined)
  base = config ? `${config.replace(/\\/g, '/')}/plugins/data/${FOLDER}` : undefined

  return base
}

const safe = (chat: string) => chat.replace(/[^\w.-]/g, '_').slice(0, 80)

export async function readShared($: EngineInterface, chat: string): Promise<SharedAuto | undefined> {
  const dir = await folder($)
  if (!dir) return undefined
  try {
    const v = JSON.parse(String(await $.fs.read(`${dir}/${safe(chat)}.json`))) as Partial<SharedAuto>
    if (typeof v.isOn !== 'boolean' || typeof v.at !== 'number') return undefined

    return { isOn: v.isOn, at: v.at, t: typeof v.t === 'number' ? v.t : 0 }
  } catch {
    return undefined
  }
}

export async function writeShared($: EngineInterface, chat: string, value: SharedAuto): Promise<void> {
  const dir = await folder($)
  if (!dir) return
  try {
    await $.fs.write(`${dir}/${safe(chat)}.json`, JSON.stringify(value))
  } catch {
    // this chat still has it
  }
}

/** Says this mod is here and running auto compact. */
export async function beat($: EngineInterface, mod: string, now: number): Promise<void> {
  const dir = await folder($)
  if (!dir) return
  try {
    await $.fs.write(`${dir}/${mod}.alive`, String(now))
  } catch {
    // the next beat tries again
  }
}

/** Whether another mod has looked in lately: that one runs auto compact. */
export async function isAlive($: EngineInterface, mod: string, now: number): Promise<boolean> {
  const dir = await folder($)
  if (!dir) return false
  try {
    return now - Number(await $.fs.read(`${dir}/${mod}.alive`)) < ALIVE_MS
  } catch {
    return false
  }
}
