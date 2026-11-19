# AGENTS.md

Notes for agents and people contributing to Pixel Office (`piksel-ofis`), a Claude Code mod.

## Layout

| Path | What it holds |
|---|---|
| `.claude-plugin/plugin.json` | Mod manifest (name, version, options) |
| `.claude-plugin/marketplace.json` | Marketplace entry for `/plugin install` |
| `hooks/hooks.json` | Lists the hooks module (`register.tsx`) |
| `hooks/register.tsx` | Event wiring, state, the pane and its UI |
| `hooks/logic.ts` | Pure helpers: tool reading, model labels, efforts, outside CLI parsing |
| `hooks/layout.ts` | Layout engine: grid, desks, routes |
| `hooks/scene.ts` | Draws the office SVG and keeps it under the size budget |
| `hooks/props.ts` | Office objects, badges, cards, ticker |
| `hooks/hud.ts` | Scales the scene to the pane's pixels |
| `hooks/events.ts` | Short scenes between desks: paper planes, calls, deliveries, walks |
| `hooks/activities.ts` | Picks an activity or error animation for each worker |
| `hooks/activity-data.ts` | Activity table, prop strips (PNG/SVG), keyframes, keyword triggers |
| `hooks/char-data.ts` | The three characters, drawn in code as pixel grids |
| `hooks/pixel-png.ts` | Tiny paletted PNG encoder used by `char-data.ts` |
| `hooks/characters.ts` | Draws characters from their strips, size budget fallbacks |
| `hooks/sprites.ts`, `hooks/sprite-data.ts` | Small animated icons |
| `hooks/cetvel.ts` | Reader for the optional Burette (Cetvel) agent snapshot |
| `hooks/shared.ts` | Auto-compaction setting shared with the usage band mod |
| `types/index.d.ts` | State types |
| `tests/ofis.test.tsx` | Test suite |

## Test

From the repository root:

```
claude plugin validate .
claude plugin test .
```

Both must pass before a change is done. Do not delete tests; when behaviour changes on purpose, update the assertions so they keep their meaning.

## Rules

- `hooks/shared.ts` must stay byte-identical with the copy in the usage band mod. Do not edit it here alone.
- Interface text is Turkish. Comments and docs may be English or Turkish.
- Art must be original. Do not add another product's mascot, logo or look-alike (for example a starburst, a cloud mark or a four-pointed star). Brand names may appear only as platform labels.
- Characters are drawn in code (`hooks/char-data.ts`). Keep the 24 x 24 frame, the foot anchor and the state names (`idle`, `walk`, `wave`, `work`, `think`, `read`, `wait`, `done`, `fail`, `run`): activity anchors in `activity-data.ts` depend on them.
- Character kinds are `turuncu` (Claude Code), `yesil` (Codex) and `mavi` (Antigravity, Gemini CLI). A new kind needs an `ao` offset in every `ACTS` entry.
- Keep the drawing under the surface's size limit; `scene.ts` budgets the SVG and tests check it.
- Privacy: never store or draw raw commands, prompts, error text or full paths. Keep only derived facts such as the CLI name, model id, effort and a file's base name.
- No network requests and no child processes.
