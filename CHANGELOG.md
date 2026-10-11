# Changelog

All notable changes to glm-hud are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/). Each version also gets a git tag `vX.Y.Z` and a
GitHub Release.

## [Unreleased]

Nothing yet.

## [1.1.1] - 2026-10-11

### Added

- Quota countdowns carry seconds within the final hour (`剩41m07s`), so idle
  redraws are visible when `statusLine.refreshInterval` is set; FAQ documents
  the idle-refresh behavior.

### Fixed

- `GLM_HUD_HIDE=fiveHour` never matched the 5-hour segment (the hide key was
  never compared, so the segment could not be hidden).
- Generated `preview/` HTML pages no longer embed personal absolute paths.

## [1.1.0] - 2026-10-10

### Added

- Plugin distribution for Claude Code: `.claude-plugin` marketplace and plugin
  manifests — install with `/plugin marketplace add chen2151643/glm-hud` then
  `/plugin install glm-hud`.
- `/glm-hud:setup` command — wires the `statusLine` block with a timestamped
  settings backup, third-party statusline detection, a sample-input self-test
  and rollback on failure. Installs a stable-path launcher
  (`scripts/launcher.mjs`) so plugin updates never need setup again.
- `/glm-hud:configure` command — interactive editor for `GLM_HUD_THEME` /
  `GLM_HUD_HIDE` with an `old → new` preview; touches only those two keys.
- `install.sh` / `uninstall.sh` for git-clone installs: the same `statusLine`
  block (including `refreshInterval: 60`), timestamped backup, and a prompt
  before replacing a third-party statusline (`--force` for non-interactive
  shells).
- English README (`README.en.md`); Chinese README expanded with install flows,
  configuration reference and FAQ.

## [1.0.0] - 2026-10-10

### Added

- Initial public release: a claude-hud-style two-line statusline for Claude
  Code users on the GLM Coding Plan — 5-hour / weekly / MCP quota bars with
  reset countdowns, context usage, model & effort badge, directory and git
  branch.
- Dark and light themes with WCAG-contrast-checked 256-color palettes;
  `GLM_HUD_THEME` / `GLM_HUD_HIDE` environment configuration; fixed-priority
  degradation for narrow terminals.
- Quota fetching from the Z.ai / BigModel usage endpoint with a 0600 disk
  cache (90 s TTL), atomic writes and last-good-snapshot fallback; the
  renderer always exits 0 and never breaks the prompt.
- Test suite covering parsing, rendering, degradation, themes and the e2e
  pipe, plus the `preview/` scene gallery (screenshots + ANSI).

[Unreleased]: https://github.com/chen2151643/glm-hud/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/chen2151643/glm-hud/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/chen2151643/glm-hud/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/chen2151643/glm-hud/releases/tag/v1.0.0
