# fulgurlab classic UI — design handoff

This folder is the handoff for restyling the fulgurlab editor (`web/src/editor/`) in a Simulink-style "classic desktop" language. It is a visual and interaction restyle. **The netlist, the API, the server and the embed protocol do not change.**

## What's in here

| File | What it is |
|---|---|
| `Main.dc.html` | The whole editor screen: menu bar, toolbar, model tabs, path bar, tool strip, Library Browser, canvas, Block Parameters panel, docked scope, status bar |
| `Scope.dc.html` | The popped-out scope window: black plot, crosshair readout, legend, status bar |
| `Blocks.dc.html` | Icons for all 19 blocks. **This is the source of truth for `BlockGlyph.tsx`** |
| `Language.dc.html` | Tokens (colour, scope colours, type), block anatomy, control states |
| `canvas.json` | Where each artboard sits on the design canvas (reference only) |

Open any `.dc.html` in a browser to read the markup. The CSS is inline, and the SVG coordinates can be copied as they are. These files are design sources, not code to ship: rebuild them in the existing React components, and don't import them.

Live canvas: https://claude.ai/code/artifact/beec3f04-df0f-42e6-b83e-90e259a7b5b6

## Principles

1. **Grey frames the tool, white holds the model, black holds the data.** The chrome is `#F0F0F0`, the canvas is white, and the scope is the only dark surface.
2. **Dense and flat.** Text is 12 px nearly everywhere, corners are square or 2 px, and nothing has a shadow. Panels and rules carry the hierarchy, not large type.
3. **Symbols fill their blocks.** A block's symbol takes up 60–75% of the block's height. Maths is set in STIX Two Text, with italic variables.
4. **Every control maps to something that already exists.** Don't add menu items or buttons that do nothing.

## Tokens: replace the variables in `styles.css`

| Variable | New value | Notes |
|---|---|---|
| `--panel` (chrome) | `#F0F0F0` | toolbars, panels, status bar |
| `--paper` (canvas) | `#FFFFFF` | remove the dot grid |
| `--block` | `#FFFFFF` | |
| `--ink` | `#000000` | block outlines, wires |
| `--ink-2` | `#444444` | secondary text |
| `--ink-3` | `#6B6B6B` | muted text (4.9:1 on chrome) |
| `--rule` | `#D9D9D9` | light separators |
| new `--frame` | `#ABABAB` | panel borders, tab and status bar edges |
| `--accent` → `--select` | `#0A64C8` | selection, focus, drafting wire |
| new `--hover` / `--hover-border` | `#E5F1FB` / `#7EB4EA` | icon button and list hover |
| new `--pressed` | `#CCE4F7` | toggled icon button |
| new `--run` / `--run-border` | `#1E8F3A` / `#136B2A` | the round Run button |
| `--danger` / `--danger-weak` | `#C42B1C` / `#FDE7E9` | |
| field border | `#7A7A7A`, focus `#0078D7` | 22 px tall inputs |
| dialog button | bg `#E1E1E1`, border `#ADADAD`; default button has a `#0078D7` 2 px ring | |

**Scope:** plot `#000000`, surround `#1A1A1A`, grid `#3A3A3A`, tick labels `#D4D4D4`. Trace colours by input order: `#FFE600 #40C4FF #FF6EC7 #7CFC6A #FF9A3C #B39DFF #FFFFFF #FF5252`. Traces are 1.5 px. These replace `--series-1..8` inside the scope only.

**Type:** IBM Plex Sans 12/400 for UI and 12/600 for panel headers. Block and signal labels are 11 px. IBM Plex Mono for every number (fields, ticks, status bar). STIX Two Text (Google Fonts, `ital@0;1`) for maths inside blocks.

**Dark mode:** the design is light only. Remove the dark overrides from `.fulgur`, but keep the scope black in every theme.

## Component by component

### `FulgurEditor.tsx`: chrome

From top to bottom (see `Main.dc.html`):

1. **Menu bar** (white, 1 px `#D9D9D9` below it): the brand mark and "fulgurlab", then File · Edit · View · Diagram · Simulation · Examples · Help, with the model name on the right (append `*` when there are unsaved changes since the last load or save). Each menu is a real dropdown (`<button aria-haspopup="menu">` plus a `role="menu"` list) and contains only existing actions:
   - File: New, Open…, Save
   - Edit: Undo, Redo, Duplicate (Ctrl+D), Delete
   - View: Zoom in, Zoom out, Fit, Show/hide Library, Dock/pop out Scope
   - Simulation: Run (Ctrl+Enter), Stop, Model settings…
   - Examples: the `examples` prop
   - Help: keyboard shortcuts
2. **Toolbar** (`role="toolbar"`, 28 px icon buttons, 1 px vertical separators):
   - New, Open, Save | Undo, Redo | Library, Model settings
   - then the round green **Run** button (30 px circle), Step forward, and **Stop**, which aborts the in-flight request through the existing `abort` ref
   - then the Stop time and Step inputs (bound to `settings.tf` and `settings.dt`, mono, right-aligned), a Solver select (show "LSODAR (auto)" disabled until the server supports a choice), Open scope, Export CSV
   - "Step back" is drawn disabled; leave it out until it exists.
3. **Model tab strip**: one tab per open model. Today that is a single tab showing `net.name`.
4. **Path bar**: a field-like box showing the model name. This is where subsystem breadcrumbs go later.
5. **Status bar** (22 px, at the bottom): `Ready` / `Simulating…` / the error summary on the left, then cells separated by 1 px rules: `Simulated in 0.24 s`, zoom `%`, `T=<tf>`, solver.

**Compact mode** (`compact`, used for embeds): hide the menu bar, tab strip and path bar. Keep the toolbar without the file buttons, and keep the status bar.

### `Palette.tsx`: Library Browser

- 216 px wide, white, with a grey header labelled "Library Browser" and a search field.
- Categories form a collapsible tree: `▾ Sources  5`, the triangle toggles, `aria-expanded` is set, and the count sits on the right.
- Each row is a 44×33 icon from `Blocks.dc.html` (the same SVG, scaled with `viewBox 0 0 64 48`) followed by the label. Hovering a row gives it `--hover`. Rows stay draggable buttons, as they are now.

### `Canvas.tsx`: diagram

- Plain white background with no dot grid.
- Wires are 1 px black, orthogonal, with a filled arrowhead where they enter a connected input. Branch points get a solid 5 px junction dot. The signal name sits 4 px above the wire in 11 px text (use the source block's name, or leave it out).
- Unconnected ports are open chevrons, drawn as `M0,-4 L5,0 L0,4`, 1.4 px wide.
- Selection: a dashed 1 px `--select` box 4 px outside the block, plus four 6 px square handles. A selected wire turns `--select` and 2 px wide.
- Error: a 2 px `--danger` outline, a `--danger-weak` fill and a red label.
- Drafting wire: dashed `--select`, ending in a ringed target port.
- Block labels go **below** the block, centred, 11 px.
- The canvas tools (zoom, fit) move to a vertical 34 px tool strip on the left edge of the canvas.

### `BlockGlyph.tsx`: icons

Copy each icon from `Blocks.dc.html`. They are drawn in a 64×48 box: body `rect x=8.5 y=4.5 w=47 h=39`, input chevron at x 2–7, output chevron at x 57–62. Scale them to each block's real `blockSize`, keeping the stroke widths in screen pixels (`vector-effect: non-scaling-stroke`):

- Curves 1.6–1.8 px over a 0.8 px `#9A9A9A` axis.
- Fractions (Integrator, Derivative, Transfer Fcn, Unit Delay, Discrete TF): STIX at about 0.35× the block height, with a 1 px rule. Transfer Fcn and Discrete TF get wider as their polynomials get longer, using `polyText`.
- Gain is a triangle showing its K value; Sum is a circle with a sign beside each input; Product draws one chevron per input and a "×" (or "÷") symbol.
- PID shows `PID(s)` only. The gains move to the Block Parameters panel; remove the "Kp Ki Kd" sub-line.
- Scope is a screen inset with a stand, with one chevron per input, stacked.

### `Inspector.tsx`: Block Parameters

- Grey panel headed `Block Parameters: <name>`.
- An etched `<fieldset>` with the block type as its legend holds the description. A **Parameters** fieldset holds Name and every parameter: label on the left, a 96 px mono right-aligned input on the right. A **Ports** fieldset gives a one-line summary of the connections.
- The footer has dialog buttons **OK · Cancel · Help · Apply**:
  - Fields keep their drafts, as they do now.
  - Apply commits every valid draft as one undo step.
  - OK applies and then deselects.
  - Cancel throws away the drafts.
  - Help opens the block's entry in `docs/blocks.md`.
  - Enter is OK and Escape is Cancel.
- When nothing is selected, the same panel shows `Model Configuration` (name, stop time, sample step).

### `ScopeChart.tsx` and the results section: scope

- **Docked** (the default): a strip below the workspace, with a title row holding the scope icon, "Scope", and icon buttons for Zoom, Autoscale, Cursor, Export CSV and Pop out. Then the inline legend, and the cursor readout on the right. The plot is 190 px tall on `#1A1A1A`, the plot area is black, and the ticks are mono 10 px `#D4D4D4`. With several Scope blocks, put one tab per scope in the title row.
- **Popped out** (`Scope.dc.html`): the same plot in a movable window inside the app with title, menu, toolbar and a status bar (`Sample based · T=10.000`). An in-app window is fine; a real `window.open` is not needed.
- **Cursor**: a dashed `#B0B0B0` vertical line, a square marker on each trace, and a light readout box listing `t` and each trace's value.
- **Stale result**: keep the existing message, shown in the status bar.

## Keep working

- The keyboard shortcuts in `FulgurEditor.tsx`, the undo/redo semantics, autosave, and the `postMessage` embed protocol.
- Accessibility: every icon button has an `aria-label`, menus are operable from the keyboard, and the focus ring is a 1 px dotted black outline. Text contrast must be at least 4.5:1.
- Below 900 px, the Library and Block Parameters panels stack under the canvas, and the toolbar wraps.

## Done when

- [ ] At 1440×900, the PID example looks like `Main.dc.html` (block positions come from the example file).
- [ ] All 19 blocks render as in `Blocks.dc.html`, both in the Library and on the canvas.
- [ ] Run, Stop, the stop time field and the solver display all work from the toolbar; the status bar shows the run time.
- [ ] The scope docks and pops out, and the cursor readout works.
- [ ] `npm run typecheck` and `npm test` pass; the embed (`?embed=1`) still loads in compact mode.

## Prompt for Claude Code

> Read `docs/design/classic-ui/HANDOFF.md` and the `.dc.html` files next to it. Restyle the editor in `web/src/editor/` to match, working component by component in the order the handoff lists. Keep the netlist, the API and the embed protocol unchanged. Start with the tokens in `styles.css` and the icons in `BlockGlyph.tsx`, then the chrome, the Inspector and the scope. Run `npm run typecheck` after each step, and work on a new branch.
