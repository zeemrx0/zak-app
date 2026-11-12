---
name: zak desktop
description: A macOS source-list utility for the zak agent kit, where installed state leads and every write passes through a plan sheet.
colors:
  accent: "#0071e3"
  accent-text: "#0062c4"
  on-accent: "#ffffff"
  ring: "rgba(0, 113, 227, 0.45)"
  row-selected: "rgba(0, 113, 227, 0.12)"
  green: "#1f7a3a"
  amber: "#8f5b00"
  red: "#c4271c"
  red-fill: "#d13228"
  red-wash: "rgba(196, 39, 28, 0.08)"
  window: "#f5f5f7"
  sidebar: "#e9e9ee"
  group: "#ffffff"
  group-head: "#f5f5f7"
  sheet: "#f6f6f8"
  text: "#1d1d1f"
  text-secondary: "#5f5f66"
  hairline: "rgba(0, 0, 0, 0.1)"
  hairline-strong: "rgba(0, 0, 0, 0.2)"
  control: "#ffffff"
  control-hover: "#f0f0f3"
  seg-track: "rgba(0, 0, 0, 0.07)"
  seg-on: "#ffffff"
  hover: "rgba(0, 0, 0, 0.05)"
  accent-dark: "#0a6cdc"
  accent-text-dark: "#5aaeff"
  ring-dark: "rgba(90, 174, 255, 0.55)"
  row-selected-dark: "rgba(10, 132, 255, 0.24)"
  green-dark: "#4cc26e"
  amber-dark: "#e3a935"
  red-dark: "#ff7a70"
  red-wash-dark: "rgba(255, 122, 112, 0.1)"
  window-dark: "#1e1e21"
  sidebar-dark: "#2a2a2e"
  group-dark: "#26262a"
  group-head-dark: "#2d2d31"
  sheet-dark: "#2c2c30"
  text-dark: "#f2f2f4"
  text-secondary-dark: "#a5a5ad"
  hairline-dark: "rgba(255, 255, 255, 0.11)"
  hairline-strong-dark: "rgba(255, 255, 255, 0.2)"
  control-dark: "#3a3a3f"
  control-hover-dark: "#45454b"
  seg-track-dark: "rgba(255, 255, 255, 0.09)"
  seg-on-dark: "#55555b"
  hover-dark: "rgba(255, 255, 255, 0.07)"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Helvetica Neue\", sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "20px"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Helvetica Neue\", sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Helvetica Neue\", sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  body-small:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Helvetica Neue\", sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Helvetica Neue\", sans-serif"
    fontSize: "11.5px"
    fontWeight: 500
    lineHeight: 1.4
  nav-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Helvetica Neue\", sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.4
  mono:
    fontFamily: "ui-monospace, \"SF Mono\", Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  inner: "5px"
  control: "6px"
  seg-track: "7px"
  group: "8px"
  sheet: "12px"
spacing:
  xxs: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
components:
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "28px"
  nav-item-hover:
    backgroundColor: "{colors.hover}"
  nav-item-current:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
  button:
    backgroundColor: "{colors.control}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "24px"
  button-hover:
    backgroundColor: "{colors.control-hover}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "24px"
  button-primary-danger:
    backgroundColor: "{colors.red-fill}"
    textColor: "{colors.on-accent}"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.inner}"
    size: "22px"
  field:
    backgroundColor: "{colors.control}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "24px"
  segmented-track:
    backgroundColor: "{colors.seg-track}"
    rounded: "{rounded.seg-track}"
    padding: "2px"
  segmented-option-on:
    backgroundColor: "{colors.seg-on}"
    textColor: "{colors.text}"
    rounded: "{rounded.inner}"
    padding: "0 10px"
    height: "20px"
  inset-group:
    backgroundColor: "{colors.group}"
    rounded: "{rounded.group}"
  table-header:
    backgroundColor: "{colors.group-head}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.label}"
    padding: "0 12px"
    height: "24px"
  table-row:
    typography: "{typography.body}"
    padding: "0 12px"
    height: "28px"
  table-row-selected:
    backgroundColor: "{colors.row-selected}"
  menu:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.group}"
    padding: "4px"
    width: "190px"
  menu-item-highlight:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.inner}"
    height: "24px"
  banner:
    backgroundColor: "{colors.group-head}"
    textColor: "{colors.text}"
    rounded: "{rounded.group}"
    padding: "8px 12px"
  banner-error:
    backgroundColor: "{colors.red-wash}"
  sheet:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.text}"
    rounded: "{rounded.sheet}"
    width: "640px"
  inspector:
    backgroundColor: "{colors.window}"
    padding: "14px 16px"
    width: "280px"
---

# Design System: zak desktop

## Overview

**Creative North Star: "The Settings Pane"**

The app plays the macOS System Settings grammar straight. A solid tinted source list sits on the left. Graphite or near-white content sits on the right. Flat inset groups hold hairline-ruled tables, and a single system blue marks selection and the one primary action. The tokens live on `:root` in `ui/style.css` (lines 2–61) and flip with `prefers-color-scheme`, so light and dark follow macOS with no toggle.

Density is native-utility density: 13px base text, 28px rows, 24px controls, 52px title bar. Nothing on screen is decorative. Depth comes from tonal steps between window, sidebar, group and sheet, and shadow is reserved for surfaces that float: the sheet, the menu and the popover. Every change goes through a sheet that drops from the toolbar edge and names the exact count of operations on its commit button.

The web origin stays hidden. Text is not selectable by default (`body { user-select: none; cursor: default }`). Only inputs, paths, mono text and CLI output opt back in.

**Key Characteristics:**
- Solid tinted 220px sidebar and a flat content pane, divided by one hairline.
- Grouped inset tables: 8px radius, 1px hairline border, 24px header band, 28px rows.
- One accent (system blue) for the current nav item, the selected row, the primary button, the menu highlight, focus rings and progress.
- Status colors green, amber and red as 8px dots and colored counts, never as fills (except the destructive button).
- SF system text everywhere, with SF Mono for paths, model ids and file lists.
- A toolbar-anchored sheet for every confirmation and plan.

## Colors

A neutral graphite and paper palette with one system-blue accent and three status hues. Each token has a light value and a `-dark` sibling in the frontmatter.

### Primary
- **System Blue** (`accent`, `accent-dark`): Current sidebar item fill, primary button fill, menu-item highlight, checkbox `accent-color`, text caret, the progress run and the changed-row mark in Agent Models. Dark mode uses a deeper blue than Apple's `#0a84ff` so white labels on it stay legible.
- **Blue Ink** (`accent-text`, `accent-text-dark`): Tint for sidebar icons (`.nav-item .icon`). Light and dark use different lightness so the icon reads on both sidebar tones.
- **Focus Halo** (`ring`, `ring-dark`): The 3px focus ring and `::selection`.
- **Selected Row Wash** (`row-selected`, `row-selected-dark`): Background of the selected agent row.

### Secondary
- **In-Sync Green** (`green`, `green-dark`): Sync dots, `ok` counts and the `ok` banner border.
- **Drift Amber** (`amber`, `amber-dark`): Drift dots, the `warn` banner border, `warn` sheet status and the "keep" plan group label.
- **Failure Red** (`red`, `red-dark`): Failure dots, error text, `danger` menu items, "remove" plan groups and the error banner border.
- **Destructive Fill** (`red-fill`, same in both modes): The filled destructive primary button and the `danger` menu-item highlight.
- **Error Wash** (`red-wash`, `red-wash-dark`): Background of the error banner.

### Neutral
- **Window** (`window`): App background, toolbar and inspector.
- **Source List** (`sidebar`): Sidebar fill. It is one solid tone, not vibrancy.
- **Group** (`group`): Inset table and form group body.
- **Group Head** (`group-head`): Table header band, group footer, neutral banner.
- **Sheet** (`sheet`): Sheet, menu and popover body.
- **Ink** (`text`) and **Secondary Ink** (`text-secondary`): Primary text and all secondary text (labels, subtitles, help, counts, inactive dots).
- **Hairline** (`hairline`) and **Strong Hairline** (`hairline-strong`): Separators, group borders, and control, menu and sheet borders.
- **Control** (`control`, `control-hover`): Button and field fill.
- **Segment** (`seg-track`, `seg-on`): Segmented track and selected segment. `seg-track` is also the progress-bar track.
- **Hover** (`hover`): Hover wash for nav items, rows, icon buttons and plan folders.

### Named Rules
**The One Blue Rule.** System blue marks the current place, the selected thing or the one primary action. A screen has at most one filled blue button.

**The Status-Only Hue Rule.** Green, amber and red mean in sync, drift or pending change, and failure or removal. They appear as dots, borders and colored text. They are not used for decoration or category coding.

## Typography

**Body Font:** the macOS system face (`-apple-system, BlinkMacSystemFont, "SF Pro Text"`, falling back to Helvetica Neue)
**Label/Mono Font:** `ui-monospace, "SF Mono", Menlo`

**Character:** One family at small sizes, with hierarchy from weight (400/500/600) rather than scale. The ramp spans 11px to 15px. SF is this world's own material, as in System Settings.

### Hierarchy
- **Title** (600, 15px, 20px line): Toolbar location name, sheet title, inspector title, empty-state heading.
- **Headline** (600, 13px): In-page section titles ("Tiers") and plan host headings.
- **Body** (400, 13px, 1.4): Table cells, nav items, buttons, fields. Row headers and host names use 500.
- **Body Small** (400, 12px): Help text (max 65ch), notes, sheet status, field errors, plan detail, inspector subheads (600).
- **Label** (500, 11.5px): Table header text in Secondary Ink. The toolbar subtitle and file lists use 11.5px at 400.
- **Nav Title** (600, 11px): Sidebar group titles ("Installs", "Configuration") in Secondary Ink, sentence case.
- **Mono** (400, 12px): Paths, model ids and file lists. It steps down to 11px in the tool popover and 11.5px in plan file lists.

### Named Rules
**The Mono-Is-Data Rule.** Monospace appears only on machine strings: paths, model ids, folder names and file lists. Labels and prose stay in the system face.

**The Tabular Count Rule.** Counts, versions and status text use `font-variant-numeric: tabular-nums` (`.num`, `.count`, `.status-text`, `.more`).

## Layout

The window is a two-column grid: a 220px sidebar and a flexible content pane (`.app`, `ui/style.css:101`). The sidebar head and the toolbar are both 52px tall and share one top line. The sidebar head insets 78px on the left to clear the overlay traffic lights.

The content pane stacks a toolbar (title and subtitle on the left, actions on the right, 8px 20px padding, hairline bottom) over a scrolling body. The page body has 20px padding, a 12px vertical gap and an 880px max width. Agent Models replaces the body with a two-column split: the main table (12px 16px 16px 20px padding) and a 280px inspector with a hairline left edge.

Spacing runs on a 4px base. The common steps are 4, 8, 12, 16 and 20, with 2, 6, 10 and 14 used inside dense controls. Rows are 28px, controls 24px, and segmented options 20px.

One breakpoint exists at 920px. Below it, the inspector narrows to 240px, the models table hides its 2nd and 3rd columns (Source and Inherit), and the search field narrows from 170px to 130px.

## Elevation & Depth

Surfaces in the window are flat and separated by tone and 1px hairlines. Shadow belongs only to floating surfaces. The sheet's backdrop (`rgba(0,0,0,0.2)`) starts at 52px, so the toolbar stays visible and undimmed above the sheet.

### Shadow Vocabulary
- **Float** (`--shadow`, light: `0 16px 48px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.12)`; dark: `0 16px 48px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)`): Sheet, menu and popover.
- **Segment Lift** (`0 1px 2px rgba(0,0,0,0.18)`): The selected segment only.
- **Focus Halo** (`0 0 0 3px var(--ring)`; rows use `inset 0 0 0 2px`): Keyboard focus. It replaces the outline.

### Named Rules
**The Flat Window Rule.** Nothing inside the window casts a shadow. Groups, tables, banners and the inspector use tone and hairlines only. A shadow means the surface floats above the window.

## Shapes

Corners are small and nest by size. Inner controls (menu items, segmented options, icon buttons, plan folder rows) use 5px. Buttons, fields, nav items and the model chain use 6px. The segmented track uses 7px. Groups, banners, menus and popovers use 8px. The sheet rounds only its bottom corners (12px) because its top edge attaches to the toolbar. Dots are full circles (8px for status, 6px for the changed mark).

Borders are 1px hairlines throughout. Controls and floating surfaces use the strong hairline. Containers and separators use the normal hairline. Icons are 16px stroked SVG on a 16×16 grid (1.4 stroke, round caps and joins, `ui/lib.js:11`). They shrink to 12px inside buttons, menu checks and search.

## Components

### Sidebar (source list)
Native source list. Group titles use Nav Title. Items are 28px tall with 8px padding, an 8px gap and 6px corners. Each item has a blue-ink 16px icon, a label that truncates with an ellipsis, and an optional status dot pushed right. Hover shows the hover wash. The current item (`aria-current="page"`) fills with System Blue, its text and icon turn white, and its dot gains a 1.5px white ring. "Add Project…" uses Secondary Ink for both text and icon. The foot holds a tool-status button (12px, Secondary Ink, tabular numbers) above a hairline. It opens an upward popover of labeled mono rows. Source: `ui/style.css:102–123`, `ui/app.js`.

### Toolbar
A 52px minimum header with a hairline bottom. The left side holds the Title and an 11.5px Secondary Ink subtitle that truncates. On install pages the subtitle is the mono path list. The right side holds actions with an 8px gap: secondary buttons, a "More" menu button with a chevron, and one primary button whose label ends in an ellipsis when it opens a sheet ("Update…"). Source: `ui/style.css:126–130`, `ui/installs.js:586`.

### Buttons and fields
- **Shape:** 24px tall, 6px corners, 0 10px padding, 1px strong hairline.
- **Default:** Control fill and Ink. Hover goes to Control Hover. Disabled drops to 45% opacity.
- **Primary:** System Blue fill, white 500-weight text, no border. Hover brightens by 1.08.
- **Destructive primary:** Destructive Fill. Used when a plan removes files ("Remove 97 files").
- **Icon button:** 22px square, 5px corners, transparent with Secondary Ink. Hover shows the wash and Ink.
- **Field:** 24px, 6px corners, Control fill and strong hairline. Focus turns the border blue and adds the 3px halo. Read-only fields drop the fill. The search field adds a 12px search icon at 7px and 24px left padding.
- **Checkbox:** Native, 14px, tinted with System Blue.

### Segmented control
A track with Segment fill, 2px padding, a 2px gap and 7px corners. Options are 20px tall with 0 10px padding and 5px corners. The checked option gets `seg-on`, Segment Lift and weight 500. Markup is `role="radiogroup"` with `role="radio"` buttons. It is used for the Kit Source choice and the Agent Models filter. Source: `ui/style.css:167–170`, `ui/source.js:97`, `ui/models.js:561`.

### Inset table (grouped)
The core container. An 8px Group with a hairline border clips a full-width collapsed table. The header band is 24px with Group Head fill, Label type and a hairline bottom. Rows are 28px with 0 12px padding, separated by hairlines between rows. Cells truncate with an ellipsis. Row headers are 500 weight. The state cell shows a status dot with 8px spacing before the status text, and failures color the text red. An optional footer (Group Head fill, hairline top, 8px 10px padding) holds an inline field (max 220px) and a button. Form rows inside a group are at least 40px tall, with a 110px Secondary Ink label column. Source: `ui/style.css:193–210`.

### Tier matrix
An inset table with one row per tier and one centered 110px checkbox column per host. The tier name is the row header. The footer holds "Add tier…" and an "Add" button. Secondary help text (12px, 65ch) sits between the "Tiers" headline and the matrix. Source: `ui/installs.js:505–556`.

### Agent Models table and inspector
A fixed-layout inset table with four percentage-width columns: Agent 22%, Source 12%, Inherit 14%, Model 52%. The Model column lists each chain entry as `n. provider/id · effort`, with a text "active" badge on the active entry, and fades an inherited chain. Rows are focusable (`tabindex="0"`). Hover shows the wash, and the selected row (`aria-selected`) shows the Selected Row Wash. A focused row shows an inset 2px halo. A 6px blue mark before the agent name flags unsaved changes. The inspector sits on the Window tone with a hairline left edge. It shows a Title, a small muted source line, 12px/600 subheads, and the model chain: a 6px-radius hairline list where each row has two lines: the full model id (mono, wraps, never ellipsized) above a compact effort select on the left and up, down and remove icon buttons on the right. Effort belongs to each model, so there is no separate Effort section. A hairline-topped foot holds "Clear alias". The toolbar holds search, the filter segment, Revert, and a primary "Save N Changes…". Source: `ui/style.css:223–252`, `ui/models.js`.

### Plan sheet (signature)
A native-style sheet that drops from the toolbar edge. It is fixed at `top: 52px`, `min(640px, 100vw − 48px)` wide, bottom-rounded 12px, on the Sheet tone, with Float shadow. It opens with a 220ms `cubic-bezier(0.16, 1, 0.3, 1)` clip-path unroll from the top, which is disabled under reduced motion. Its parts:
- **Head:** Title and a 12px subtitle, which is mono when it shows a path.
- **Body:** Scrolls. The plan renders here.
- **Foot:** A hairline top, a 3px indeterminate progress bar (blue run on the Segment track), a polite status line (red for error and danger, amber for warn), and right-aligned Cancel and confirm buttons.
- **Plan content:** Grouped by host first. Each host has a hairline-ruled heading with a colored tabular count. Inside each host, the plan groups by action ("remove" in red, "keep" in amber) and then by collapsible folder rows: 24px summaries with a rotating CSS chevron and a mono folder name, over 11.5px mono file lists capped at 220px.
- **Diff rows:** A four-column grid (field, before, arrow, after) for model changes.
- **Confirm label:** Always names the exact count and verb ("Remove 97 files", "Update 12 files, remove 3"). The button turns destructive when anything is removed.

Source: `ui/style.css:255–304`, `ui/lib.js` (`zak.sheet`), `ui/installs.js:233–349`.

### Menu and popover
Both float on the Sheet tone, with a strong hairline border, 8px corners, Float shadow and 4px padding. Menus open 4px below their button, right-aligned, at a 190px minimum width. Items are 24px tall with 5px corners and a 16px check column (12px check icon). Hover or focus fills the item with System Blue and white text, like a native menu. Danger items use red text, and their highlight uses Destructive Fill. Separators are 1px hairlines with 4px 6px margins. Items use `menuitem` or `menuitemradio` roles. Source: `ui/style.css:176–190`, `ui/lib.js:115–126`.

### Banners
An 8px rounded strip with Group Head fill, a hairline border, 8px 12px padding, and an optional trailing action. Variants change the border only (`ok` green, `warn` amber), except `error`, which adds the Error Wash and a red border while keeping Ink text. Errors use `role="alert"`, and the rest use `role="status"`. Banner text is selectable. Source: `ui/style.css:213–220`, `ui/lib.js:73`.

### States
- **Status dot:** 8px circle. Its idle state is Secondary Ink at 55% opacity. Green, amber and red dots use full opacity. The busy state is a 1.5px ring with an open top, spinning at 0.8s linear.
- **Loading:** One Secondary Ink line ending in an ellipsis ("Reading lock files…").
- **Empty:** A left-aligned block centered in its pane (44ch max, 24px padding) with a Title heading, body text and an optional action.
- **Table empty:** A centered Secondary Ink line with 16px padding.
- **Disabled:** 45% opacity for buttons and segments, 35% for icon buttons, 40% for menu items.

## Do's and Don'ts

### Do:
- **Do** take every color from the `:root` custom properties in `ui/style.css`, and give any new token both a light and a dark value.
- **Do** build lists and settings as inset groups: 8px radius, hairline border, 24px header band, 28px rows, hairlines between rows.
- **Do** route every write through `zak.sheet`, and name the exact verb and count on its confirm button.
- **Do** end a button label with "…" when it opens a sheet or picker, and leave the ellipsis off when it commits.
- **Do** keep mono for paths, model ids, folder names and file lists, and use tabular numbers for counts and versions.
- **Do** use the 16×16 stroked SVG icon set in `ui/lib.js` and add new icons in the same stroke style.

### Don't:
- **Don't** add a second accent hue or a second filled blue button to one screen.
- **Don't** use green, amber or red for anything except sync state, drift or pending change, and failure or removal.
- **Don't** put shadows on surfaces inside the window. Shadows are for the sheet, the menu and the popover.
- **Don't** stack inputs in free-standing cards or use free-text fields where a tier list or segmented choice exists.
- **Don't** make chrome text selectable. Only inputs, paths, mono text and CLI output opt in.
