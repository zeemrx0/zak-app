# zAgentKit

A Tauri 2 desktop app for the zak agent kit, built as a macOS source-list utility. It is a thin shell: it calls the
installed `zak` CLI and the installed `z-delegate` helper and holds no kit or validation logic of its own.

## What it does

The sidebar lists installs (This Mac and each project you add), then configuration pages. A status line at the foot
shows the `zak` and `node` versions. Click it for the tool paths and whether the agents config file exists.

- **This Mac and project pages.** One card per agent (Claude Code, Codex), stacked vertically, so a new agent adds a
  card below. The card head shows the agent, the kit version from its `zak-lock.json` and a state: Not checked,
  Checking…, In sync, N changes, Lock update (no file changes, but the lock file needs an update), Items changed
  (staged edits differ from the lock), Install staged, Not installed or Check failed. Check runs once per location
  when you first open it, and again from the Check button. Once a location has been checked, its sidebar item shows
  a green, amber or red dot.
  Below the head is a tree: tier, then kind (Rules, Skills, Agents), then item. Each row has a disclosure button and
  a checkbox. Tier and kind rows are tri-state and show "N of M". The catalog comes from `zak kit inventory`, which
  reads the local kit folder, so it needs a kit source (the page offers "Open Kit Source" when none is set). Only
  checked items install. `general` is a normal tier, and nothing adds it for you. When you check an item, the app
  also checks the items it requires. Those rows read "required by X" and stay locked while X is checked.
  The tree starts at what the lock records and only stages changes: a blue mark flags each staged item, and the
  card foot names them ("Install 3 items. Remove 1 item.") next to Revert and "Apply N Changes…", which opens the
  plan sheet for that agent only. An agent with a lock is updated with its new item list. An agent without one is
  installed. Apply stays disabled when an installed agent would have no checked item. Use Uninstall… under More to
  remove the kit. With nothing staged, the foot offers Update…, which keeps the saved item list.
  A "Same as <other agent>" switch makes an agent follow the other one. The follower's tree becomes a read-only line
  ("Follows Claude Code. 14 of 22 items."), and the link is saved as `follows` in the follower's lock. The switch is
  disabled until the other agent is installed, and on a source that another agent follows. Switching it off stages
  an unlink, and the agent keeps its current items. An Apply or Update on a source also updates its followers.
  Check never changes the link. Every kit operation runs once per host, because hosts can carry different items.
- **Plan sheet.** Update…, and Install… and Uninstall… under More, first run a dry run and open a sheet that lists the
  planned operations per host, grouped by action (removals first, in red, always expanded) and by folder (two
  path segments, for example `skills/<name>/`), with counts. Global paths are shown relative to the host root.
  Each host header also shows the item change against its lock, for example "Items: −z-foo, +z-bar", and a line for a link change. When the kit changes after the page loaded, the sheet stops with "The kit changed after this page loaded. Review the tree, then apply again." The commit
  button names the counts, for example "Update 12 files", "Remove 97 files" or "Update 23 files, remove 97".
  A plan with no file changes but a lock change reads "Update lock file". The button stays disabled when the plan
  is empty, when a command fails, or when the plan reports conflicts or issues. Only the commit button runs the
  real operation. For Uninstall, edited files that the kit keeps are listed as "Kept (edited)" and do not block.
  An uninstall that ends with kept files (exit code 2) is reported as "Finished with N files kept", not as a
  failure. If a host fails after another host ran, the button becomes "Plan Again", the sheet shows which hosts
  are done or failed, and a new dry run is required before anything else runs. After a commit the app compares
  the applied operations with the plan and warns when they differ (the release may have changed in between),
  then refreshes the lock data and checks again. The same sheet type confirms every other change in the app.
- **Projects.** "Add Project…" opens the folder picker. Projects persist between runs. "Remove from List…" under
  More forgets a project and does not uninstall anything.
- **Agent Models.** A table of every known agent with Source, Inherit and Model. Each model in the chain carries its own effort, shown as `provider/id · effort`.
  Select a row to edit its model chain (order, add, remove, and an effort for each model) and inherit in the inspector. A model with no stored effort shows the effort inherited from a legacy alias-level setting, else medium, and every save writes an explicit effort for each model. The page refreshes when the window regains focus: it reloads the state when there are no unsaved edits, and only re-runs the preview when there are. The Active model picker
  pins which entry of the chain the router tries first, and the rest of the chain is the fallback (then the
  entries before it); "Automatic" leaves it unset, and it is not inherited. Edits stay local
  until "Save N changes". The save sends only changed aliases with the loaded file hash. A 422 shows the
  validator's errors, and a 409 reports that `agents.json` changed on disk and offers Reload. Save opens the plan
  sheet, which lists each changed agent as before → after (model chain with each model's effort, active, inherit; removals in red). The
  validator's 409 and 422 answers appear inside that sheet. If Node.js or the `z-delegate` helper is missing,
  the page says what to install.
- **Templates.** Edits the six `z-unity-setup` templates (gitignore, git exclude, the two gitattributes blocks,
  `default-layout.json`, `fork-settings.json`) through the kit's `templates.cjs`. The left list shows each template
  with an "Edited" badge when you have an override. Select one to edit it in a monospace editor. Edits stay local
  until "Save…", which opens the plan sheet with the target path and a before → after line diff. A 422 shows the
  validator's errors in the sheet. A 409 reports that the template changed on disk and offers Reload. "Reset to
  Default…" (only for an edited template) confirms in the same sheet and deletes the override. Switching templates
  with unsaved edits asks before it discards them. Overrides live in `~/.zak/templates` (or `Z_TEMPLATES_DIR`).
  If Node.js or `templates.cjs` is missing, the page says to install the kit's `unity` tier for Claude Code or Codex.
- **Kit Source.** Shows the current local kit folder (or "Not set") and sets another folder, with a confirm sheet
  before the change. If the CLI rejects the folder, the sheet shows its message.

## Install

Apple Silicon Macs only. The app is ad-hoc signed and not notarized.

### Homebrew

```sh
brew install --cask zeemrx0/tap/zak-desktop
```

Homebrew installs the app into Applications and clears the download quarantine flag, so macOS shows no
"unidentified developer" prompt. The cask tracks stable releases only. The app has no auto-updater, so run
`brew upgrade --cask zak-desktop` to update.

### Manual download

1. Download `zak-desktop-<version>-arm64.dmg` (or the `.zip`) from the
   [releases page](https://github.com/zeemrx0/zak-app/releases).
2. Drag zAgentKit into Applications. Do not run it from the mounted DMG.
3. Open it. macOS blocks the first launch because the app is not notarized.
4. On macOS 15 and later, open System Settings > Privacy & Security and choose Open Anyway.
   On macOS 14 and earlier, right-click the app and choose Open.

The app needs macOS 13 or newer.

## Installing the zak CLI from the app

If the app cannot find `zak`, the sidebar status reads "zak not installed". The Install pages then show
"The zak CLI is not installed" with an "Install zak CLI…" button. The same button is in the tool-status popover.

The sheet lets you choose the Stable or Beta channel. When you confirm, the app:

1. reads the release metadata of `zeemrx0/zak-app` (stable: the latest release, beta: the newest beta prerelease),
2. downloads `install.sh` from that release,
3. checks its SHA-256 against the release asset digest and refuses to run it on a mismatch,
4. runs it, which installs `zak` to `~/.local/bin/zak`.

The installer needs `curl`, `tar` and Node 26.11.1 or newer. The app never installs Node. If Node is missing or
too old, the button is disabled and the page says so. After a successful install the app shows the installed
version and refreshes its tool status and installs without a restart. If the install fails, the sheet shows the
exit code and the installer output, and you can retry.

To test the install against the real network, run
`ZAK_DESKTOP_NET_TESTS=1 cargo test --test cli_install_net` in `desktop/src-tauri`. It installs into a
temporary HOME.

## Prerequisites

- Rust 1.77 or newer (`rustup`), and the Xcode command line tools on macOS.
- `zak` installed (for example `~/.local/bin/zak`) and Node.js on the login-shell PATH.
- For Agent Models: the kit installed with the `z-delegation` skill, so `z-delegate.cjs` exists in
  `~/.claude/skills/z-delegation/scripts/` or `${CODEX_HOME:-~/.codex}/skills/z-delegation/scripts/`.
- For Templates: the kit's `unity` tier, so `templates.cjs` exists in `~/.claude/skills/z-unity-setup/scripts/` or
  `${CODEX_HOME:-~/.codex}/skills/z-unity-setup/scripts/`.

A GUI app on macOS does not get the shell environment. The app runs `$SHELL -lc` once and reads `PATH`,
`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `Z_AGENTS_CONFIG` and `Z_TEMPLATES_DIR` from it. It uses the PATH for `zak`, `node` and every
child process. It passes the other three to child processes and uses them to find lock files and `z-delegate.cjs`
when its own environment lacks them (a variable in the app's own environment wins). It falls back to
`~/.local/bin` for PATH. The `z-delegate settings` commands run with your home directory as its working directory.

## Build and run

The frontend is static files in `ui/` with no build step, so plain cargo is enough:

```sh
cd desktop/src-tauri
cargo run                       # debug build and launch
cargo build --release           # binary in target/release/zak-desktop
```

`cargo tauri dev` also works when `tauri-cli` is installed, but is not required. `cargo build --release` does not
create a `.app` bundle or an installer. To build the bundle and DMG locally, install the CLI once
(`cargo install tauri-cli --version "^2" --locked`) and run:

```sh
cd desktop/src-tauri
cargo tauri build --bundles app,dmg   # output in target/release/bundle/{macos,dmg}
```

The bundle is ad-hoc signed (`signingIdentity: "-"`). The app version comes from `tauri.conf.json`
(`0.1.0`). Release builds override it with the CLI version from `cli/package.json` through `--config`.

## Test

```sh
cd desktop/src-tauri
cargo test
cargo clippy --all-targets -- -D warnings
for f in ../ui/*.js; do node --check "$f" || echo "FAIL $f"; done   # syntax check of the frontend scripts
node --test ../tests/install-tree.test.cjs   # tree logic
```

The integration test runs the real `z-delegate settings` commands against a temporary config (through `Z_AGENTS_CONFIG`)
and checks that a save returns 200, a stale hash returns 409 and an invalid result returns 422. It skips itself
when `node` or `z-delegate.cjs` is missing. It never touches your real config.

## What the app runs

| Command | Used for |
| --- | --- |
| `zak kit <check\|install\|update\|uninstall> --target <t> (--global \| <project>) [--tier <list>] [--no-tier <list>] [--select <ids>] [--follow <host> \| --no-follow] [--dry-run] --json` (`--no-tier` for projects only, `--select` and the follow flags for install and update) | Install pages and plan sheet. stdin is closed, so it never waits for a prompt. |
| `zak kit inventory --target claude,codex (--global \| <project>) --json` | Item catalog and per-host state for the tree. Read-only. |
| `zak kit source` and `zak kit source <path>` | Show and set the local kit folder. |
| `zak --version`, `node --version` | Tool status. |
| `node z-delegate.cjs settings state`, `settings preview` and `settings save` (JSON on stdin, one JSON object on stdout) | Agent Models. One process per request; nothing keeps running. |
| `node templates.cjs list`, `get`, `save` and `reset` (JSON on stdin, one JSON object on stdout) | Templates. One process per request. |

The app also reads `zak-lock.json` files for display: `${CLAUDE_CONFIG_DIR:-~/.claude}` and `${CODEX_HOME:-~/.codex}`
(from the app's environment or your login shell) for This Mac, and `<project>/.claude` and `<project>/.codex` for projects. It never writes them. Only `zak kit ...`
changes kit files.

The guard variables `Z_DELEGATE_DEPTH`, `CLAUDECODE` and `CODEX_THREAD_ID` are removed from child processes,
because `z-delegate settings` refuses to run when they are set. Set `Z_AGENTS_CONFIG` in your login-shell profile (or the
app's environment) to change the active config path. It is shared with the kit.

The project list is stored in the app data directory as `projects.json`, written through a temp file and a rename.
If that file cannot be read, the sidebar shows the error under Installs and This Mac keeps working.

## Security notes

- Only the `main` window gets IPC, and only to this app's commands and the core defaults
  (`src-tauri/capabilities/default.json`).
- The main window has a strict CSP: local scripts, styles and fonts only, no CDN, no remote fonts, no inline code.
- `agents.json` is never written from Rust or JavaScript. Saves go through the helper's validator, so its stale-file and validation guards apply.
- Dynamic text (agent names, paths, CLI output) is always rendered with `textContent`.
- No settings process outlives a request, so quitting the app leaves nothing running.

## Release

The desktop app ships inside every zak-app release (the CLI and the app share one tag and version). There is no separate tag.

1. Bump `version` in `cli/package.json` and `cli/package-lock.json` and push a tag `v<version>` (for example `v0.3.1` or `v0.3.1-beta.1`).
2. `.github/workflows/release.yml` runs these jobs:
   - `release` tests the CLI (in `cli/`), builds it and uploads the CLI assets to a **draft** release.
   - `desktop` (macOS 15, after `release`) runs `cargo test` and `cargo clippy`, builds with
     `cargo tauri build --bundles app,dmg --config '{"version":"<version>"}'`, ad-hoc signs, zips with
     `ditto -c -k --keepParent`, runs `desktop/scripts/ci/verify-desktop-bundle.sh` (arm64, version, `codesign --verify`) and
     uploads `zak-desktop-<version>-arm64.dmg` and `.zip` to the draft. It reads both files back and compares them.
   - `publish` (after both) turns the draft into the public release. Stable tags become "latest". Tags with
     `-beta.` are prereleases.
   - `homebrew` (stable tags only, after `publish`) renders `desktop/packaging/homebrew/zak-desktop.rb` and pushes
     `Casks/zak-desktop.rb` to `ZeeMRx0/homebrew-tap` with `desktop/scripts/ci/bump-homebrew-cask.sh`.
3. Beta versions such as `0.3.1-beta.1` build and sign normally. The bundle version is the full beta string.
   Beta releases never touch the tap.

One release holds both parts, so the release stays a draft until both succeed. A failed desktop build therefore keeps
the CLI release in draft too. Fix the cause and rerun the failed jobs. `zak self-update` ignores the extra assets.

The tap update needs the `HOMEBREW_TAP_TOKEN` repository secret in `zeemrx0/zak-app`: a fine-grained token with
Contents read and write access to `ZeeMRx0/homebrew-tap`. Without it the `homebrew` job fails after the release is
already public. Rerun that job after you add the secret.

`.github/workflows/desktop-ci.yml` runs the tests, clippy and the frontend syntax check on pull requests and pushes
that touch `desktop/`.

To test the tap update without pushing, set `HOMEBREW_TAP_REMOTE` to a local bare repository and run
`bash desktop/scripts/ci/bump-homebrew-cask.sh <version> <zip>`.

## Layout

```
zak-app/
  cli/           the zak CLI (Node package "zak-cli": src/, tests/, scripts/)
  desktop/
    src-tauri/   Rust backend
    ui/          index.html, style.css, lib.js (helpers, sheet, menu), installs.js, models.js, source.js, app.js (shell)
    scripts/ci/  release-time desktop checks and the Homebrew cask bump
    packaging/   Homebrew cask template
```

`desktop/` is outside the npm `files` allowlist of `cli/package.json`, so it is not part of the published `zak` package.
