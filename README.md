# zak

Monorepo for the zak agent guidance kit tooling.

- [`cli/`](cli/README.md): the `zak` command-line tool. It installs, updates, checks and removes agent guidance kits.
- [`desktop/`](desktop/README.md): zAgentKit, a macOS (Apple Silicon) desktop app that runs the `zak` CLI for you.

The CLI and the desktop app share one release tag and version. Releases are published at
[zeemrx0/zak-app](https://github.com/zeemrx0/zak-app/releases).

## Install the CLI

Requires Node **26.11.1+**, macOS/Linux, `curl` and `tar`.

```sh
set -o pipefail
curl -fsSL https://github.com/zeemrx0/zak-app/releases/latest/download/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
zak --version
```

See [cli/README.md](cli/README.md) for usage, kit sources, beta channel and removal.

## Install the desktop app

```sh
brew install --cask zeemrx0/tap/zak-desktop
```

Or download the DMG from the release page. See [desktop/README.md](desktop/README.md) for details.
