English | [中文](README.md)

# glm-hud

A [claude-hud](https://github.com/jarrodwatts/claude-hud)-style two-line statusline for [Claude Code](https://code.claude.com), showing **GLM Coding Plan quotas** (5-hour / weekly / MCP), **context usage**, and session info — powered by the GLM usage API.

```
[GLM-5.3·1M·high] │ my-project git:(main*) │ Context █████░░░░░ 45% 450k/1M │ env默认:flash
⚡5h ███░░░░░░░ 24% 剩41m │ 周 ██░░░░░░░░ 19% 剩2d8h │ MCP ███░░░░░░░ 294/1000 剩3h12m
```

Two lines, always. Line 1 is *where you are* (model, project, git branch, context fill). Line 2 is *what's left* (GLM quota windows with live countdowns). Quota segments turn orange at 75% and red with a ⚠ at 90%.

## Features

- **GLM quotas from the server** — 5-hour window, weekly window, and monthly MCP calls, with reset countdowns (`剩41m` = 41m left). Data comes from the Z.ai / BigModel quota endpoint, not client-side guessing.
- **Context usage** — percentage + absolute tokens against the real context window, from the statusline payload with a transcript-tail fallback.
- **Model & effort badge** — `[GLM-5.3·1M·high]`; merges the `[1M]` suffix into the badge when `display_name` lacks it. A dim `env默认:xxx` note appears when `ANTHROPIC_MODEL` would give *new* sessions a different default model (informational, not a warning).
- **Two themes** — `dark` (default, tuned for dark terminals) and `light`, each with WCAG-checked 256-color palettes and regression tests.
- **Per-segment toggles** — hide any segment via `GLM_HUD_HIDE`.
- **Narrow-terminal degradation** — segments drop in a fixed priority order; below 60 columns everything folds into one compact line. Output never exceeds the terminal width.
- **Zero dependencies** — plain Node ≥ 20 ESM, no npm install. ~40 ms warm render.

## Install

Inside a Claude Code session — three commands, no manual file editing:

```
/plugin marketplace add chen2151643/glm-hud
/plugin install glm-hud
/glm-hud:setup
```

`/glm-hud:setup` does the wiring: it writes the `statusLine` block into your `~/.claude/settings.json` (backing it up first; if you already use a different status line it asks before replacing), tests the render with sample input, and rolls back on failure. Claude Code reloads settings on its own, so the HUD appears below your input after your next message; if it doesn't, restart Claude Code once. If `/glm-hud:setup` doesn't show up, run `/reload-plugins` first.

Requires **Node.js ≥ 20** (built-in `fetch`), on **macOS or Linux**; `git` is optional (the branch segment silently hides without it). Native Windows is not supported — use WSL.

### Prefer the terminal?

```bash
git clone https://github.com/chen2151643/glm-hud.git ~/.claude/glm-hud
sh ~/.claude/glm-hud/install.sh     # equivalent to /glm-hud:setup; wires statusLine into ~/.claude/settings.json
```

`install.sh` writes the same `statusLine` block (including `refreshInterval: 60`), keeps a timestamped backup, and asks before replacing a third-party status line (pass `--force` in non-interactive shells).

**Upgrading**: with a git clone, `git pull` is all — settings.json points at the path, not a copy, so no need to re-run install.sh (only after moving/renaming the directory). With a plugin install, update from `/plugin`: the status line points at a stable launcher path that automatically runs the newest installed copy — **setup never needs to run again**.

### Quota API access

The HUD reads your GLM token from the process environment — the same `ANTHROPIC_AUTH_TOKEN` (or `ZAI_API_KEY` / `GLM_API_KEY`) your GLM-backed Claude Code already uses. It is only sent to the matching quota endpoint (`open.bigmodel.cn` or `api.z.ai`, picked from `ANTHROPIC_BASE_URL`), never logged, never cached to disk, never hardcoded. No token set → quota segments are omitted and the rest still renders.

## Configuration

All configuration is environment-based — set it in your shell profile or in the `env` block of `~/.claude/settings.json`.

| Variable | Values | Default | Effect |
|---|---|---|---|
| `GLM_HUD_THEME` | `dark` \| `light` | `dark` | Color palette (illegal values fall back to `dark`) |
| `GLM_HUD_HIDE` | comma-separated segment list | *(none)* | Hide segments |

Segments for `GLM_HUD_HIDE` (unknown names are ignored):

`badge` `effort` `dir` `branch` `ctx` `ctxabs` `env` `fiveHour` `week` `mcp`

- `ctx` hides the whole Context segment; `ctxabs` hides only the absolute numbers (`450k/1M`), keeping the bar and percentage.
- Hiding all three quota segments removes line 2; hiding literally everything renders a single `[hud]` sentinel.

`refreshInterval` (seconds, max 60) is a Claude Code statusline option — it forces periodic redraws so countdowns keep ticking while idle. The installers write `refreshInterval: 60`. Quota numbers themselves are cached on disk for 90 s, so a redraw costs no network call unless the cache is stale.

For the status line, a settings.json `env` value wins over the same variable in your shell profile (Claude Code applies its env block over the inherited environment). Both take effect in a **new** Claude Code session.

### Let your agent configure it

```
/glm-hud:configure
```

Or just paste either of these into Claude Code — each is a one-line change:

> Switch my glm-hud statusline to the light theme.

> Hide the MCP segment from my glm-hud statusline.

`/glm-hud:configure` asks with your current values, previews `old → new` before saving, and touches only `GLM_HUD_THEME` / `GLM_HUD_HIDE`.

## Narrow terminals

Segments drop in a fixed priority order rather than overflowing:

- **Line 1**: env note → ctx absolute numbers → whole Context segment → (only then) dir/git
- **Line 2**: MCP details → MCP segment → weekly → 5-hour (the most critical window survives longest)
- **< 60 columns**: everything folds into one compact line: `badge | dir | C ████ 22% | ⚡5h ... | 周 ...`
- Past all that, a `...` truncation guard keeps output inside the terminal width, always.

## Troubleshooting

- **Only one line, no ⚡5h/周/MCP** — no GLM token was picked up (not an install failure). `ANTHROPIC_AUTH_TOKEN` is used only when `ANTHROPIC_BASE_URL` points at a GLM domain (`bigmodel.cn` or `api.z.ai`); with a proxy/relay base URL, set `ZAI_API_KEY` or `GLM_API_KEY` instead.
- **Gray `⚡5h -- 周 -- MCP --` placeholders** — the token or network check failed (wrong token, or offline); it retries after 90 s.
- **Nothing renders at all** — smoke-test outside Claude Code: `echo '{}' | node ~/.claude/glm-hud/statusline.mjs` (plugin installs: `node ~/.claude/plugins/glm-hud/statusline.mjs`). At least one line and a clean exit means the script is fine and the problem is the wiring — re-run `/glm-hud:setup`.

## Does it update while idle?

Yes. Claude Code only redraws the statusline after messages and a few events (idle periods are static by default — same for claude-hud/ccstatusline). Both `install.sh` and `/glm-hud:setup` write `statusLine.refreshInterval: 60` (the official engine knob, max 60s). Countdowns carry seconds within the last hour (`剩41m07s`) so idle redraws are visible; quota percentages come from the server and naturally hold still while no tokens are consumed.

## How it works

- `statusline.mjs` reads the statusline JSON payload on stdin and renders ≤ 2 lines to stdout, always exiting 0 — a broken payload, missing git, or a dead network never breaks the prompt.
- `quota.mjs` fetches `GET {base}/api/monitor/usage/quota/limit` (BigModel CN or Z.ai international) with the token in the `Authorization` header, caching parsed windows in `cache/quota.json` (mode 0600, TTL 90 s, atomic writes). Failures fall back to the last good snapshot.
- `parse.mjs` / `render.mjs` are pure functions: window classification (`unit=3×5` → 5h, `unit=6×1` → weekly, with an earlier-reset fallback), theme palettes, width math (CJK counts 2 columns), and degradation.
- `scripts/launcher.mjs` is the stable-path forwarder the plugin setup installs: at each render it scans the plugin cache and runs the newest installed glm-hud, so plugin updates never need setup again.
- `tools/` holds the preview generator (`gen-scenes.mjs` + `ansi2html.mjs`) behind the screenshots and WCAG checks in `preview/`.

## Development

```bash
node --test        # 101 tests: parsing, rendering, degradation, themes, e2e pipe
```

The palette tests compute WCAG contrast ratios against both backgrounds and fail if a color regresses below 4.5:1 (3:1 for bold/bars).

## Why a statusline, not a plugin band?

Claude Code's plugin UI (bands/panes) renders *above* the prompt and only accepts a single line of plain text; a multi-line, ANSI-colored area *below* the input is only possible through the statusLine command. So glm-hud uses the plugin form for distribution (one-command marketplace install plus the `/glm-hud:setup` and `/glm-hud:configure` commands) while the renderer itself is a statusLine script — the same architecture as claude-hud.

## License

[MIT](LICENSE)
