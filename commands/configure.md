---
description: Configure the glm-hud status line (theme and visible segments)
allowed-tools: Read, Edit, AskUserQuestion
---

Configure glm-hud conversationally. glm-hud reads two environment variables at render time:

- `GLM_HUD_THEME`: `dark` (default) | `light` — invalid values fall back to `dark`
- `GLM_HUD_HIDE`: comma-separated segment keys — unknown keys are silently ignored

This command writes those two keys into the `env` block of the user's settings.json (`$CLAUDE_CONFIG_DIR/settings.json`, tilde allowed, else `~/.claude/settings.json`) and touches nothing else. Never edit the user's shell profile from here; if they prefer shell-profile config, show them the lines to paste instead.

## Step 1: Read the current state

Read settings.json and note:

- `env.GLM_HUD_THEME` and `env.GLM_HUD_HIDE` (either may be absent — absent means the defaults: `dark`, nothing hidden)
- whether an `env` block exists at all

Also Read `~/.zshrc`, `~/.bashrc`, `~/.profile`, and `~/.bash_profile` if they exist (missing files are fine) and look for `GLM_HUD_` lines — the Read tool is enough, no shell needed. If any is found, mention it in Step 3: for the status line, settings.json `env` wins because Claude Code applies its env block over the inherited shell environment.

Segment keys for `GLM_HUD_HIDE`, with their on-screen labels:

| Screen label | Key | Line |
|---|---|---|
| `[GLM-5.3·1M·high]` model badge | `badge` | 1 |
| `·high` effort note (inside the badge) | `effort` | 1 |
| project directory | `dir` | 1 |
| `git:(main*)` | `branch` | 1 |
| `Context ███ 45% 450k/1M` (whole segment) | `ctx` | 1 |
| only the `450k/1M` absolute numbers | `ctxabs` | 1 |
| `env默认:flash` default-model note | `env` | 1 |
| `⚡5h` five-hour quota window | `fiveHour` | 2 |
| `周` weekly quota window | `week` | 2 |
| `MCP` monthly MCP calls | `mcp` | 2 |

Semantics to keep in mind: `ctx` hides the whole Context segment (then `ctxabs` is moot); hiding all three quota segments removes line 2 entirely; hiding everything renders a single `[hud]` sentinel.

## Step 2: Ask

One AskUserQuestion call with up to four questions, each question text carrying the current value:

1. Theme — options: "Keep {current}" / "dark" / "light"
2. "Hide which line-2 quota segments?" (multiSelect) — "fiveHour (⚡5h)" / "week (周)" / "mcp" / "Hide nothing"
3. "Hide which line-1 identity segments?" (multiSelect) — "badge" / "effort" / "dir" / "branch" / "Hide nothing"
4. "Hide which context segments?" (multiSelect) — "ctx (whole Context segment)" / "ctxabs (numbers only)" / "env (default-model note)" / "Hide nothing"

If the user selects `ctx`, drop `ctxabs` from the result. Any cancelled question stops the whole command with zero changes.

## Step 3: Preview

If nothing would change, say "No changes needed — config unchanged." and stop. Otherwise show the diff and confirm with AskUserQuestion ("Apply" / "Cancel"):

```
env.GLM_HUD_THEME: dark → light
env.GLM_HUD_HIDE: (unset) → "week,mcp"
```

## Step 4: Apply

Edit settings.json:

- Create the `env` block if absent.
- Update only `GLM_HUD_THEME` and `GLM_HUD_HIDE`; keep every other key of settings.json and of the `env` block exactly as they were.
- `GLM_HUD_HIDE` is one comma-separated string, e.g. `"week,mcp"`. Remove the key entirely if the selection is empty.
- Write only valid values (`dark`/`light`; keys from the table) — the HUD tolerates junk, but never write junk.

## Step 5: Report

Tell the user:

- "Configuration saved."
- It takes effect in a **new Claude Code session** (the status line inherits Claude Code's environment, which is fixed at startup). If it doesn't show up, restart Claude Code.
- If the same variable is also set in a shell profile, settings.json `env` wins for the status line; remove the shell-profile line if they'd rather manage it here.
- Point to the README's configuration section for the full segment table and `refreshInterval`.
