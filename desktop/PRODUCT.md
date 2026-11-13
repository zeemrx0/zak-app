# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The UI is static HTML, CSS and JavaScript inside a Tauri 2 webview on macOS. It should feel like a native macOS
utility, but it is built with web components, not native controls.

## Stack

Tauri 2 (Rust backend) with a static `ui/` folder and no frontend build step. The backend calls the installed `zak`
CLI and the installed `z-delegate` helper; it does not port kit logic or the config validator.

## Users

The kit maintainer and other people who build the zak agent kit. They work on a Mac with Claude Code and Codex
installed, test local kit sources before publishing, and tune per-agent models often. They know the `zak` CLI.

## Product Purpose

One window to see and change the state of the zak agent kit on this machine:

1. Kit health and updates: installed version, tiers and drift for each host (`claude`, `codex`), global and per
   project, with a preview before any change.
2. Agent models: edit `~/.zak/agents.json` (model chain, effort, inherit) for every known agent.
3. Templates: edit the `z-unity-setup` git and layout templates the kit writes into projects.
4. Kit source: public, private or a local folder.
5. Project installs: install, check, update or remove the kit in chosen project folders.

Success: a maintainer sees what is installed and whether it is in sync within seconds, and never changes files
without seeing the planned operations first.

## Positioning

It is a front end for the same commands the maintainer already trusts. Every change runs `zak ... --json` or the
`z-delegate` save endpoint, so the app shows exactly what the CLI would do and adds no second source of truth.

## Operating Context

- Used next to a terminal, Claude Code, Codex and the Orca app, often while testing a local kit folder.
- Global installs keep a lock file at `~/.claude/zak-lock.json` and `${CODEX_HOME:-~/.codex}/zak-lock.json`;
  project installs at `<project>/.claude/zak-lock.json` and `<project>/.codex/zak-lock.json`. The lock records
  `kitVersion` and `tiers`.
- `zak kit update|check` with a tier list that differs from the installed tiers plans to remove the missing tiers.

## Capabilities and Constraints

- Hosts: `claude` and `codex` only.
- Saves to `agents.json` go only through `z-delegate settings save` with the base hash, so its
  409 (stale) and 422 (invalid) guards apply.
- Uninstall and every non-dry-run install or update need an explicit confirmation that shows the planned operations.
- macOS GUI apps lack the shell PATH; tools are found through the login shell.
- Child servers the app starts stop when the app quits.
- Out of scope: CLI self-update or self-uninstall, auto-update, signing, release packaging, the legacy
  `~/.config/zak/agents.json` merge (dropped 2026-11-11).

## Product Principles

1. Show state before actions: the installed truth (lock file) is the default for every form.
2. Preview, then commit: every write shows its planned operations first.
3. One source of truth: the CLI and the kit's validator decide; the app only presents.
4. Quiet by default: no alerts unless something is out of sync, missing or failed.
