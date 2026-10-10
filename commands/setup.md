---
description: Wire glm-hud into your Claude Code status line
allowed-tools: Bash, Read, AskUserQuestion
---

Set up glm-hud as the Claude Code status line. `${CLAUDE_PLUGIN_ROOT}` is this plugin's install directory. Placeholders in `{BRACES}` are values you fill in from earlier steps.

glm-hud works on macOS and Linux (WSL counts as Linux). Native Windows is not supported: the status line command it installs relies on POSIX paths. If `Platform:` is `win32`, stop and tell the user to install WSL, then run `/glm-hud:setup` from a Claude Code session inside WSL.

## Step 1: Find the runtime

```bash
command -v node 2>/dev/null
```

The result is `{RUNTIME}`. Then check the major version:

```bash
"{RUNTIME}" -p 'process.versions.node.split(".")[0]'
```

glm-hud needs **Node.js ≥ 20** (built-in `fetch`). If nothing is found or the major version is below 20, stop: tell the user the current shell can't find a new enough Node.js even though Claude Code itself runs, point them to the Node.js LTS installer from https://nodejs.org, and ask them to restart their shell and run `/glm-hud:setup` again. (Re-running after fixing the environment is safe — setup is idempotent.)

## Step 2: Inspect the current settings

```bash
"{RUNTIME}" "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" inspect
```

The helper prints JSON with:

- `settingsPath`
- `command`: the statusLine command it will install
- `existing`: `none`, `glm-hud`, or `other`, for the current statusLine
- `existingPreview`: a redacted preview of the current command

If it fails (for example, settings.json is not valid JSON), show the error and stop. Don't edit settings.json by hand.

If `existing` is `other`, ask with AskUserQuestion:

- header: "Existing statusline"
- question: "You already have a status line: `{existingPreview}`. Replace it with glm-hud? settings.json is backed up first, and the old command is saved."
- options: "Replace it" / "Keep my current status line"

On "Keep", stop without changing anything. Only ever show `existingPreview`, never the raw command, because it may contain secrets.

## Step 3: Install

```bash
"{RUNTIME}" "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" install --launcher "${CLAUDE_PLUGIN_ROOT}/scripts/launcher.mjs"
```

Append ` --force` if (and only if) the user chose "Replace it" in Step 2.

This does the following:

- Copies the launcher to `<config dir>/plugins/glm-hud/statusline.mjs`. settings.json points at that stable path — never at this plugin's versioned cache directory. The launcher runs the newest installed glm-hud at each render, so plugin updates never need setup again.
- Backs up settings.json to the reported `backupPath`.
- Saves the replaced command to `previous-statusline.txt` (mode 0600) when it differed.
- Writes `statusLine` (`type: command`, `refreshInterval: 60` — keeps the quota countdowns ticking while idle) and keeps every other setting.

The config dir is `$CLAUDE_CONFIG_DIR` (tilde allowed) or `~/.claude`.

## Step 4: Test

```bash
echo '{"model":{"id":"glm-5.3[1M]","display_name":"GLM-5.3"},"workspace":{"current_dir":"'"$PWD"'"},"context_window":{"context_window_size":200000,"total_input_tokens":45000}}' | {COMMAND}
```

`{COMMAND}` is the `command` from the install report. Within a few seconds it should print at least one line, optionally two:

- Line 1 (model / directory / git / Context) always renders.
- Line 2 (⚡5h / 周 / MCP quotas) renders only when a GLM token is configured; a gray `⚡5h --` placeholder means a token was found but the quota check failed (wrong token or no network — it retries after 90 s). Neither case is a setup failure.

If the command exits non-zero, prints a stack trace, or prints nothing:

1. Show the output.
2. Restore the backup: copy `backupPath` over `settingsPath`.
3. Stop.

## Step 5: Finish

Claude Code re-reads settings.json on its own, so the HUD should appear below the input field after the user's next message (if it doesn't, restarting Claude Code is the fallback). Ask with AskUserQuestion:

- header: "glm-hud"
- question: "Setup complete! The HUD should show up below your input after your next message. Is it working?"
- options:
  - "Yes, and star the repo ⭐": run `gh repo star chen2151643/glm-hud`. If `gh` is missing or lacks that subcommand, run `gh api -X PUT /user/starred/chen2151643/glm-hud`, or give them https://github.com/chen2151643/glm-hud.
  - "Yes, it's working"
  - "Yes, but only one line": tell the user this means no GLM token was picked up, not a broken install. glm-hud uses `ANTHROPIC_AUTH_TOKEN` only when `ANTHROPIC_BASE_URL` points at a GLM domain (`bigmodel.cn` or `api.z.ai`); with a proxy/relay base URL, set `ZAI_API_KEY` or `GLM_API_KEY` instead. It can also be set in the `env` block of settings.json — offer to do that.
  - "No, something's wrong"

**If working**, tell the user in one line that theme and visible segments can be changed anytime with `/glm-hud:configure` or just by asking (for example "switch glm-hud to the light theme").

**If not**, check in order:

1. Re-run the Step 4 test and show its output.
2. If the test prints nothing, check a plugin install exists: `ls "<config dir>/plugins/cache/"*/glm-hud/*/statusline.mjs`. The launcher prints nothing when it finds no install. If missing, reinstall with `/plugin install glm-hud` and re-run setup.
3. If the runtime moved (nvm, mise, and asdf upgrades change the node path), re-run `/glm-hud:setup` — it rewrites the command with the current node.
4. To go back to the previous status line, copy `backupPath` over `settingsPath` (or restore the command saved in `previous-statusline.txt`).
