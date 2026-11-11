---
version: 1
slug: "ui-index-html"
primary_target: "ui/index.html"
related_targets: []
---

# zak desktop main window

Scope: the whole app window (`desktop/ui/`). Visitor mode: Operate.
Audience and job: kit maintainers checking install drift, updating safely, tuning agent models, switching kit source.
Constraints: static HTML/CSS/JS, no build step, strict CSP (self only), Tauri IPC only, light and dark follow macOS.

## Direction contract

THESIS: A macOS source-list utility where the installed truth leads and every write passes through a plan sheet. It refuses the web-form layout of the old app (stacked cards of inputs, free-text tiers, an iframe editor).

OWN-WORLD: System Settings grammar. Solid tinted sidebar, white/graphite content, SF system text, SF Mono only for paths, model ids and file lists. One accent (system blue) for selection and the primary button; green, amber and red only for in sync, drift and failure. Hairline separators, grouped inset tables, 13px base, 28px rows.

STORY: Open the app, see each host's version, tiers and sync state for this Mac and each project. Pick a row, preview, read the plan, commit. Edit agent models in a table with an inspector; save shows the validator's verdict.

FIRST VIEWPORT: Overlay title bar. 220px sidebar: Installs (This Mac, projects, Add Project...), Configuration (Agent Models, Kit Source), tool status at the foot. Content: header with location name, path, Check and Update... buttons top right; an inset table with one row per host.

FORM: Pinned by the user (native macOS utility, the category standard played straight). Signature move: the plan sheet, dropped from the toolbar, lists the CLI's planned operations grouped by action and folder, and its commit button names the exact count ("Remove 97 files").
seed: none (roll skipped: the user pinned the direction on 2026-11-11)
