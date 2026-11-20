# Pixel Office for Claude Code

English | [Türkçe](README.tr.md)

Pixel Office (`piksel-ofis`) is a Claude Code mod that shows your session as a small, live pixel-art office in a side pane. The main model sits at the boss's desk, subagents take desks of their own, and outside CLI agents you start from the shell (Codex, Antigravity, Gemini CLI) join them. Every desk shows what its worker is doing right now, with a small animation for the kind of work and for anything that goes wrong.

It is for anyone who runs long or parallel Claude Code sessions and wants to see at a glance who is busy, who is stuck and how much usage is left. The mod never calls a model and adds nothing to the system prompt, so it costs no tokens.

**The interface text is Turkish** (tabs, buttons, speech bubbles). This README and the code comments are in English.

```
/plugin install piksel-ofis --marketplace yigityildiz0/claude-pixel-office
```

## Features

- **A pane-filling office.** The layout adapts to any pane size and team size; there are no side panels. Data lives in office objects:
  - the **water cooler** shows context use and the auto-compaction threshold,
  - the **battery**, **wall clock** and **calendar** show the 5-hour and weekly usage limits with a pace forecast,
  - the **LED scoreboard** shows cost today and in this chat, turns, agents, tools and time,
  - a **news ticker** runs the live event feed.
- **One figure per platform.** Three original pixel characters: orange for Claude Code loops, green for Codex, blue for Antigravity and the Gemini CLI. The boss is the orange figure with a crown. The platform picks the figure; the model and effort are written on the desk's panel.
- **Desks that move.** New workers walk in and sit at the first free desk; when someone leaves, the others walk forward to close the gap. Nested subagents sit under the desk that started them, and orders, messages and reports fly between desks as paper planes.
- **Activity animations.** Recent tools, the task and the worker's state turn into a prop at the desk: painting, typing, reading code, running tests, searching the web, planning, git work, deploying and many more.
- **Error and wait animations.** Rate limits, timeouts, permission waits, lost connections, context overflow, failing builds and tests, quota locks and others each have their own short animation. Raw error text, file paths and commands are never drawn.
- **Usage gauge and auto-compaction.** The pane's settings turn auto-compaction on or off and move its threshold (default: on, 75%). When the companion [usage band mod](https://github.com/yigityildiz0/claude-usage-band) (`kota-bandi`) is installed, the two share one setting and only one of them compacts.
- **Outside agents from Burette (optional).** If the [Burette](https://github.com/yigityildiz0/burette) desktop app (Turkish name: Cetvel) is installed, the agents it sees in other terminals and apps, and their subagents, sit in the office too.
- **Fatigue.** As the usage limit runs low the office gets tired: slower walks, yawns and sweat.

## Installation

Requires Claude Code 2.1.275 or later.

1. Run the install line above in Claude Code.
2. Run `/reload-plugins` in chats that are already open.

In the Claude desktop app and in VS Code the pane opens by itself when a session starts. To turn that off, set the plugin option `otomatikAc` ("open automatically") to `false`. In the terminal, open the pane with `/ofis`.

## Usage

- `/ofis` opens the pane again.
- The pane has tabs for the office (**Genel**), the team (**Ekip**) and the context breakdown (**Bağlam**), plus a folding **Ayarlar** (settings) section: auto-compaction on/off, threshold −5/+5, compact now, motion on/off and hints on/off.
- Clicking a worker in the team tab opens that agent's conversation.

## Update and uninstall

- Update from the `/plugin` menu, or run `/plugin marketplace update claude-pixel-office` and then `/reload-plugins`.
- Uninstall with `/plugin uninstall piksel-ofis`. The shared setting folder `~/.claude/plugins/data/claude-auto-compact/` stays; delete it by hand if the usage band mod is not installed either.

## Troubleshooting

- **The pane does not open by itself.** Automatic opening works only in the Claude desktop app and VS Code. Elsewhere, run `/ofis`.
- **`/ofis` is not found.** The command is registered when a session starts. Run `/reload-plugins` or start a new chat.
- **The office stands still.** Open **Ayarlar** and check that **Hareket** (motion) is on.
- **Outside agents are missing.** Agents started from the shell are picked up from the command that starts them. Agents in other terminals and apps need Burette (Cetvel) installed and running, because the office reads its snapshot file.
- **Compaction runs twice or never.** Only one of this mod and the usage band mod compacts; both show the same setting. Check it in either place.

## Privacy

- Everything runs locally. The mod makes no network requests and starts no processes.
- From shell commands it keeps only derived facts: which CLI was started, its model, effort and sandbox mode. Command text, prompts and full file paths are never stored or shown.
- Files it reads when they exist: `~/.codex/config.toml` and Codex profile files (model and effort only), the Claude desktop app's settings file (theme only), Burette's agent snapshot `%LOCALAPPDATA%\Cetvel\ajanlar.json` (agent hashes, short names, model, status and counters only) and a workflow's script (model names only).
- Files it writes: the shared auto-compaction setting, one small JSON file per chat plus a small "alive" marker file under `~/.claude/plugins/data/claude-auto-compact/`.

## Development

Notes for contributors are in [AGENTS.md](AGENTS.md). From the repository root, `claude plugin validate .` and `claude plugin test .` must both pass.

## Related projects

- [Burette](https://github.com/yigityildiz0/burette): the desktop app (Cetvel in Turkish) whose agent snapshot this mod can show.
- [Usage band](https://github.com/yigityildiz0/claude-usage-band): the usage-quota band above the prompt box; it shares the auto-compaction setting.
- More from the author: [github.com/yigityildiz0](https://github.com/yigityildiz0).

## License

[MIT](LICENSE) © Yiğit Yıldız

The characters, icons and props are original pixel art made for this project. Claude, Codex, Antigravity and Gemini are named only as platform labels; this project is not affiliated with or endorsed by their owners.
