# zak CLI

Install the CLI once. Use `zak` to install, update, check, and remove agent guidance kits.

## 1. Install the CLI

Requires Node **26.11.1+**, macOS/Linux, `curl` and `tar`.

```sh
set -o pipefail
curl -fsSL https://github.com/zeemrx0/zak-app/releases/latest/download/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
zak --version
```

The installation command does not install Node or change shell profiles.
It verifies the downloaded archive, but you must trust the initial installation script.
Edited files, foreign files, and symlinked installation paths are protected.

For a published beta CLI, use `sh -s -- --channel beta` instead of `sh`.
If no beta release is available, installation stops instead of using a stable release.

## 2. Manage a kit

```sh
zak kit install --target claude,codex --tier general
zak update --target claude,codex --tier general
zak kit check --target claude,codex --tier general
zak kit uninstall --target claude,codex
```

`zak update` is an alias for `zak kit update`. Both commands accept the same
options and update only the kit, not the CLI.

Supported targets are `claude` and `codex`.
Omit `--target` to use the interactive picker.

Kits come from a local `z-agent-kit` folder. Clone `z-agent-kit` yourself and set its path
with `zak kit source <path>` (see section 3). `zak kit install` and `zak kit update` fail with
`set a local kit path: zak kit source <path>` until you set a path.

Append `--global` (or `-g`) for user-level guidance. Otherwise, commands apply to the current
project or a supplied project path. Do not combine `--global` with a project path.
Global installations require explicit tier selection.

Add `--dry-run` to preview changes without applying them.

### Choose items and link hosts

```sh
zak kit inventory --target claude,codex --json
zak kit install --target claude --select general/skills/z-ste
zak kit install --target codex --follow claude
zak kit update --target claude --select general/skills/z-ste,unity/rules/z-unity-core
zak kit update --target codex --no-follow
```

- `--select <ids>` installs only the listed items and the items they require. An ID is `tier/kind/name`.
- `--follow <host>` makes one `--target` host copy the saved selection of the other host. The link is stored in the follower's lock.
- `--no-follow` removes the link and keeps the installed files.
- `zak kit update` and `zak kit check` on a source host also run every host whose lock follows it.
  The followers run after the source with the same selection. Install and uninstall never expand.
- An explicit `--select` or `--tier` on a follower, without its source in the same run, breaks the link.
- `zak kit inventory` is read-only. It prints the items, their dependencies and the saved selection of each host as JSON.
  It reads the local kit folder and writes no pin.

These flags need a kit folder that declares item selection. An older kit folder fails with
`kit source <tag> does not support item selection; update the kit folder`.

The kit channel follows the version of the local kit folder: a `-beta.N` version is beta, any other release version is stable.
Kit and CLI channels are independent.

Updates overwrite local edits to kit-managed files. Uninstall removes kit-managed files even when edited.
Unrelated files, path safety checks, and ownership checks remain protected. Use `--dry-run` to preview either operation.
Do not manually delete installation records or active-operation guards.
For installations made with an older installer, remove the kit with its original
installer, review any retained files, then install it with `zak`.

## 3. Choose the kit source

```sh
zak kit source ./z-agent-kit      # set the local kit folder
zak kit source                    # in a terminal: prompt for the folder; otherwise print it
```

The folder must be a `z-agent-kit` checkout. `zak kit source` with no argument and no terminal prints
`Kit source: <path>` or `Kit source: not set`.

The path applies to new installs and to `zak update` of installed kits.
`zak` packs the folder with `npm pack` and installs it like a release, so you can test kit changes before you publish them.
`zak kit check` and `zak kit uninstall` use the kit snapshot pinned when the kit was installed.
An installation that was pinned to a public or private remote kit by an earlier release keeps working for `check` and `uninstall`.
Set a local path to update it, which pins it to the local folder.

## 4. Update or remove the CLI

```sh
zak self-update
zak self-update --channel beta
zak self-uninstall
```

These commands do not change or remove installed guidance.
To remove both the kit and CLI, run `zak kit uninstall` before `zak self-uninstall`.

If CLI removal is interrupted, rerun the installation command with
`sh -s -- --uninstall` instead of `sh`.
Edited or foreign files remain protected. If an installation record cannot be verified,
inspect it before retrying. Do not delete a guard while its process is running.

## 5. Desktop app (optional)

Every release also carries zAgentKit, a macOS (Apple Silicon) app that runs the `zak` CLI for you.
Install it with `brew install --cask zeemrx0/tap/zak-desktop` or download the DMG from the release page.
See [desktop/README.md](../desktop/README.md) for the manual steps, the release flow and the build instructions.
