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

Requires **Node.js ≥ 20** (built-in `fetch`). Optional: `git` (the branch segment silently hides without it).

```bash
git clone https://github.com/chen2151643/glm-hud.git ~/.claude/glm-hud
sh ~/.claude/glm-hud/install.sh     # wires statusLine into ~/.claude/settings.json (idempotent)
```

`install.sh` merges the `statusLine` block into your `~/.claude/settings.json` and never touches other keys; `uninstall.sh` removes exactly that block. Prefer manual? Point Claude Code at it yourself:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node $HOME/.claude/glm-hud/statusline.mjs",
    "refreshInterval": 60
  }
}
```

Works the same on **macOS and Linux** (`$HOME` is expanded by the shell). Restart Claude Code to see it.

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

`refreshInterval` (seconds, max 60) is a Claude Code statusline option — it forces periodic redraws so countdowns keep ticking while idle. Quota numbers themselves are cached on disk for 90 s, so a redraw costs no network call unless the cache is stale.

### Let your agent configure it

Paste either of these into Claude Code — each is a one-line change:

> Switch my glm-hud statusline to the light theme.

> Hide the MCP segment from my glm-hud statusline.

## Narrow terminals

Segments drop in a fixed priority order rather than overflowing:

- **Line 1**: env note → ctx absolute numbers → whole Context segment → (only then) dir/git
- **Line 2**: MCP details → MCP segment → weekly → 5-hour (the most critical window survives longest)
- **< 60 columns**: everything folds into one compact line: `badge | dir | C ████ 22% | ⚡5h ... | 周 ...`
- Past all that, a `...` truncation guard keeps output inside the terminal width, always.

## How it works

- `statusline.mjs` reads the statusline JSON payload on stdin and renders ≤ 2 lines to stdout, always exiting 0 — a broken payload, missing git, or a dead network never breaks the prompt.
- `quota.mjs` fetches `GET {base}/api/monitor/usage/quota/limit` (BigModel CN or Z.ai international) with the token in the `Authorization` header, caching parsed windows in `cache/quota.json` (mode 0600, TTL 90 s, atomic writes). Failures fall back to the last good snapshot.
- `parse.mjs` / `render.mjs` are pure functions: window classification (`unit=3×5` → 5h, `unit=6×1` → weekly, with an earlier-reset fallback), theme palettes, width math (CJK counts 2 columns), and degradation.
- `tools/` holds the preview generator (`gen-scenes.mjs` + `ansi2html.mjs`) behind the screenshots and WCAG checks in `preview/`.

## Development

```bash
node --test        # 99 tests: parsing, rendering, degradation, themes, e2e pipe
```

The palette tests compute WCAG contrast ratios against both backgrounds and fail if a color regresses below 4.5:1 (3:1 for bold/bars).

## Why not a plugin?

Claude Code has two extension lines: **plugins/mods** (`.claude-plugin/` packages — commands, agents, hooks; rendered UI sits *above* the prompt as bands/panes with single-line plain-text status entries) and the **statusLine command** (a script under the input box, multiple lines, full ANSI color). The below-the-input, two-line, colored HUD you see in claude-hud and ccstatusline is only possible through the statusline command — so glm-hud is a standalone script directory that `settings.json` points at, the same distribution shape as those projects. There is no plugin directory involved.

## License

[MIT](LICENSE)
