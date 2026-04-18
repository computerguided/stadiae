# Stadiæ — Detailed Design

This document describes the design and internal architecture of **Stadiæ**, a single-file HTML/CSS/JavaScript state diagram editor that renders via PlantUML. It is intended for developers maintaining or extending the tool. For a user-facing guide, see the in-app **Help → User Manual**. For a project-level overview, see the `README.md`.

---

## 1. Design goals and context

Stadiæ is a graphical front-end for authoring PlantUML state diagrams of functional components. The user works with familiar domain vocabulary — *states*, *choice-points*, *interfaces*, *messages*, *transitions* — while the tool emits clean, version-controllable PlantUML source.

Three top-level goals shaped the design:

**Single-file deployment.** The entire application is one HTML file, no build step, no dependencies beyond a modern browser and network access to the public PlantUML server. This rules out bundlers, frameworks, and module systems; it also rules out anything that requires a backend. The trade-off is self-imposed: it makes hosting and distribution trivial, at the cost of keeping everything hand-written.

**Separation of model and presentation.** The editor maintains an in-memory model of the diagram. Any operation that mutates the model re-emits a PlantUML source string from scratch, sends it to the public PlantUML server, and displays the returned PNG. The PlantUML source is a pure function of the model (plus a selection highlight overlay). This keeps the rendering pipeline simple and predictable.

**Graphical selection on a server-rendered bitmap.** The editor doesn't render the diagram itself; a remote server does, and the client only receives a PNG. The user nevertheless needs to click on states, choice-points, and transitions directly in the rendered image. This is solved with a secondary "selection mask" rendering — see §6.

---

## 2. Code organisation

The single HTML file is organised as three logical layers:

```
┌─────────────────────────────────────────────────────────────┐
│ <style> ... </style>            — Presentation (CSS)        │
├─────────────────────────────────────────────────────────────┤
│ <body>                          — Structure (HTML)          │
│   menubar / toolbar / main / modal-overlay / code-panel     │
├─────────────────────────────────────────────────────────────┤
│ <script>                        — Behaviour (JavaScript)    │
│   Model ── History ── Selection                             │
│     │         │            │                                │
│     └── generatePlantUML ──┼── renderDiagram                │
│                            │       │                        │
│                            │       └── mask + click lookup  │
│                            └── refresh (lists + table)      │
│   Dialogs, file I/O, menu/toolbar wiring                    │
│ </script>                                                   │
└─────────────────────────────────────────────────────────────┘
```

All JavaScript shares one global scope. The script is organised by section comments (`// ---------- Model ----------`, etc.) rather than modules.

---

## 3. Data model

The editor's state lives in three module-level singletons.

### 3.1 `Model`

The domain data — what the diagram contains. This is the single source of truth for the PlantUML output, the lists on the right, the transition table, and saved files.

```js
Model = {
  componentName: String,      // "Node", "Component Name", …
  arrowFontSize: Number,      // default 9
  stateFontSize: Number,      // default 12
  interfaces: [ {name, isDefault} ],
  messages:   [ {interface, name, isDefault} ],
  states:     [ {name, displayName} ],
  choicePoints: [ {name, question} ],   // name excludes the "CP_" PlantUML prefix
  transitions:  [ {source, target, messages, connector, length} ],
  dirty: Boolean,             // unsaved edits?
  savedFilename: String|null
}
```

The `messages` array inside each transition holds `{interface, name, action?}` objects. The optional `action` field is a free-text description documenting what the component does when that specific (source, target, message) transition fires — see §9 on the Action panel.

Some subtleties worth noting:

- **Default interfaces and messages are explicit in the list.** `Timer`, `Logical`, `Timeout`, `Yes`, `No` all appear as entries with `isDefault: true`. This keeps list-building and message-lookup code uniform (no special cases) and makes it easy to render them in italics/grey in the UI. The PlantUML emitter filters them out when writing the `Interfaces` / `Messages` sections, because defaults are hard-coded in the PlantUML output.

- **Choice-point names don't include `CP_`.** Users enter `Whitelisted`, the model stores `Whitelisted`, but every appearance in PlantUML is rewritten as `CP_Whitelisted`. Inside transitions, however, the prefix is already baked in — `t.source === "CP_Whitelisted"`. This asymmetry is intentional: it keeps the user-visible names clean while mapping unambiguously to PlantUML tokens.

- **Transitions are "arrows", not "messages".** Multiple messages on the same source→target pair are grouped into a single transition with a `messages` array. This matches how PlantUML renders them (one arrow with stacked labels) and how the user thinks about them.

- **Special transition endpoints.** `source === "START"` means the initial transition. `target === "[H]"` means a history-target transition. `source === "*"` means an ANY (wildcard) source. These sentinels are recognised throughout the emitter and the delete/cleanup code.

### 3.2 `Selection`

Everything the user has currently marked. It drives the canvas highlighting, the right-panel list highlights, the transition-table row highlights, and all toolbar-button enablement rules.

```js
Selection = {
  states:        Set<name>,
  choicePoints:  Set<name>,
  interfaces:    Set<name>,
  messages:      Set<"iface:name">,
  transitions:   Set<"src|tgt|iface|msg">,  // per-message granularity
  start:   Boolean,   // START dot selected
  history: Boolean,   // H pseudostate selected
  any:     Boolean,   // * pseudostate selected
  clearAll()
}
```

The non-obvious choice is **`transitions` holds per-message rows**, not whole arrows. A grouped arrow with two messages appears as two rows in the transition table and can be selected one row at a time. A helper `isTransitionFullySelected(t)` returns true when every row of a transition is selected — that's the condition for rendering the arrow itself red on the canvas, and for enabling the Edit button on a transition. See §8.

### 3.3 `History`

Undo/redo stacks holding JSON snapshots of the `Model`.

```js
History = {
  past:   [String],    // snapshots before each mutation
  future: [String]     // snapshots cleared on every new mutation
}
```

Every mutating operation follows the pattern:

```js
pushHistory();   // push current snapshot onto History.past, clear History.future
<...mutate Model...>
refresh();
```

`pushHistory` also sets `Model.dirty = true`. Undo pushes the current state to `future` and restores the top of `past`. Selection is cleared on undo/redo because restoring a model state that no longer contains a selected element would produce dangling references.

---

## 4. The refresh pipeline

Any change to the model or selection calls `refresh()`, which rebuilds the UI. Conceptually:

```
refresh()
  ├── buildStateList()         — repopulate <ul> for States (+ START, H, *)
  ├── buildCPList()            — repopulate <ul> for Choice-points
  ├── buildInterfaceList()     — repopulate <ul> for Interfaces
  ├── buildMessageList()       — show messages of currently selected iface(s)
  ├── buildTransitionTable()   — one <tr> per (transition × message)
  ├── buildActionPanel()       — show/hide the action textarea based on selection
  ├── updateToolbar()          — compute enablement of every button
  └── scheduleRender()         — debounced call to renderDiagram()
```

`scheduleRender` uses a 150ms debounce so rapid list-click selection doesn't trigger a server round-trip per keystroke. A canvas re-render is the only step that involves network I/O.

---

## 5. PlantUML generation

`generatePlantUML(opts)` is a pure function from `Model` + `Selection` + options to a PlantUML source string. It supports two modes controlled by `opts.mode`:

- `"visible"` (default): the user-facing diagram, with red styling for selected elements if `opts.withSelection` is true. Includes the `<style>` block that makes choice-points render as white rectangles.
- `"mask"`: the selection-mask diagram, covered in §6. Selection highlighting is not applied; instead every element gets a unique fill color generated by `opts.idAssigner`.

The generator emits sections in this order, matching the reference PlantUML conventions:

```
@startuml
'== Formatting ==          hide empty description, font sizes, <style> (visible only)
'== Default interfaces ==  Timer, Logical
'== Default messages ==    Timeout, Yes, No
'== Interfaces ==          user-defined
'== Messages ==            user-defined
'== Component ==
state component as "<name>" {
  state START <<start>> <color>
  '== States ==           user-defined states, plus synthetic ANY_N states
  '== Choice-points ==    with <<choicepoint>> stereotype in visible mode
  '== Transitions ==
}
@enduml
```

### 5.1 Selection highlighting in the visible diagram

When `withSelection` is true, selected elements are decorated directly in the PlantUML:

| Element     | How it's marked                                                                 |
| ----------- | ------------------------------------------------------------------------------- |
| START dot   | `#FF0000` instead of `#000000`                                                  |
| State       | appended `#line:FF0000;line.bold`                                               |
| Choice-point| appended `#line:FF0000;line.bold`                                               |
| Transition (fully selected) | the arrow becomes `-[#FF0000,bold]-> …` instead of `->` etc.     |
| Single message on a grouped arrow | wrapped in `<color:#FF0000>…</color>` inline in the label          |

The last row is worth calling out: when only some messages of a grouped arrow are selected, the **arrow itself** keeps its default styling but the **individual message labels** are coloured red via inline PlantUML text colour directives. This preserves the grouping while still showing the user precisely which row is selected.

### 5.2 ANY pseudostate: synthetic declarations

The ANY wildcard has no concrete declaration in the model — transitions simply have `source === "*"`. In the emitter, each such transition is given a synthetic state declaration:

```plantuml
'== States ==
state ANY_1 as "*"
state ANY_2 as "*"
...
'== Transitions ==
ANY_1 -> TargetA : $Iface_MsgA
ANY_2 -> TargetB : $Iface_MsgB
```

This guarantees that every ANY-source transition renders as its own distinct `*` node in the diagram, avoiding all wildcard arrows converging on a single point. The synthetic names live only inside the generated PlantUML; the model remains clean.

### 5.3 History target: the `[H]` syntax

Transitions to `target === "[H]"` are emitted literally as `SourceState --> [H] : Message`. PlantUML recognises `[H]` and draws an "H" pseudostate without any declaration. Multiple such transitions produce multiple H icons, matching the user's expectation.

---

## 6. The selection mask

The most architecturally interesting piece of the app. It exists because the canvas is a server-rendered PNG — the client has no structural knowledge of it — yet the user expects to select states, choice-points, and transitions by clicking them directly.

### 6.1 Concept

On every render, the generator produces **two** PlantUML sources in parallel:

1. **The visible diagram** — normal styling, selection highlights baked in.
2. **The selection mask** — the same structural diagram but with every element rendered in a **unique fill/line colour**, text made transparent, and arrow strokes thickened to create generous click hitboxes.

Both PNGs are fetched from the PlantUML server in parallel. The visible PNG is displayed in the canvas. The mask PNG is drawn to an **off-screen `<canvas>`** at its natural resolution and kept in memory.

When the user clicks the visible image, the handler converts the click coordinates to the natural coordinate space and samples the pixel colour from the off-screen mask canvas via `getImageData(x, y, 1, 1)`. The colour identifies which model element was clicked.

```
              visible.png  ──▶  <img>  (what the user sees)
                                   │
  user click ──────────────────────┤
                                   ▼
                            coordinate mapping
                                   │
               mask.png  ──▶  hidden <canvas>  ──▶  pixel colour
                                                         │
                                                         ▼
                                                   id → element
```

### 6.2 Differences between visible and mask PlantUML

The mask source is not just the visible source with different colours — several small tweaks work together:

| Mask directive                     | Purpose                                                           |
| ---------------------------------- | ----------------------------------------------------------------- |
| `skinparam Arrow { FontColor #00000000 }` | Hide transition labels — text would otherwise overpaint the coloured arrow lines with black pixels. |
| `skinparam State { FontColor #00000000 }` | Same, for state/choice-point labels.                              |
| Per-element `#color;line:color`    | Each state/CP/ANY gets a unique fill **and** matching line colour, so clicking the border is still a hit. |
| `-[#color,thickness=8]->` on arrows | Thick stroke for a comfortable click hitbox on transitions.       |
| `<style>` block **omitted**         | Otherwise the choice-point rule `BackgroundColor #ffffff` would wipe out their unique fill colour. |
| No selection highlighting          | Mask output is independent of current selection state.            |

### 6.3 Colour assignment

The obvious scheme — sequential IDs as `#000001`, `#000002`, `#000003`, … — was tried first and failed. PlantUML's renderer collapses near-black fills visually indistinguishable pixels. The returned PNG contained only vaguely-dark pixels that couldn't be distinguished after PNG quantisation.

The working scheme spreads IDs across the entire RGB cube using prime-multiplier hashes:

```js
const n = nextId;
const r = 40 + ((n * 137) % 180);   // 40..219
const g = 40 + ((n * 73)  % 180);
const b = 40 + ((n * 211) % 180);
```

Each channel is held in `[40..219]` to stay away from pure white (the diagram background, `#ffffff`) and from black (where PlantUML paints borders and chrome). Distinct primes per channel ensure consecutive IDs produce wildly different colours, so anti-aliasing between two neighbouring elements never accidentally matches a third.

The emitter's `idAssigner` is a closure that also records the reverse mapping `colour → {kind, key}` in the `idToRef` map, which is stashed on the global `maskState` when the mask image finishes loading.

### 6.4 Click resolution

Pixel sampling has to account for two realities:

- PlantUML applies a subtle gradient or shading to state fills, so even the centre pixel of a state body is not the exact colour we specified — each channel can be off by one or two units.
- Anti-aliasing blends element colours into the white background at borders, producing interpolated colours that aren't in the ID map at all.

The lookup therefore does not compare for equality. Instead it picks the **nearest known colour** by Euclidean RGB distance, with an acceptance threshold:

```js
let bestDist = Infinity, bestHex = null;
for (const [hex] of maskState.idToRef) {
  const c = parseHexColor(hex);
  const dr = c.r - p.r, dg = c.g - p.g, db = c.b - p.b;
  const dist = dr*dr + dg*dg + db*db;
  if (dist < bestDist) { bestDist = dist; bestHex = hex; }
}
if (bestHex && bestDist <= 3000) {      // ~55-unit total RGB distance
  return { ref: maskState.idToRef.get(bestHex), background: false };
}
```

Since the ID colours are widely spread (minimum pairwise channel differences of 60+ units), a sampled pixel that is "close to something" is confidently "that element". Pixels outside this tolerance are treated as unmapped — usually anti-aliased edges far from any element. The click is then **silently ignored**, rather than clearing selection, because blowing away selection on near-miss clicks is jarring. Selection is cleared only on pixels that are confirmed pure-white background (`r,g,b ≥ 240`).

### 6.5 Transition clicks toggle all rows together

Per-message selection is a model-layer concept — the mask only has one identifier per arrow. When a user clicks a transition arrow:

```js
toggleSelection({kind: "transition", key: "trans:src|tgt"})
  ├── find the transition t matching src|tgt
  ├── allRows = transRowKeys(t)
  ├── if all rows are selected → delete all
  └── else → add all
```

This matches the user's mental model: the arrow is the thing they see and click, so clicking it toggles the whole arrow. Finer granularity — picking a single message from a grouped arrow — is available through the transition table. This division keeps the canvas simple for casual clicking while retaining full control when needed.

### 6.6 Failure modes

Two things can go wrong:

1. **CORS blocks pixel reads.** If the PlantUML server doesn't send `Access-Control-Allow-Origin: *` on the PNG, `getImageData` throws a SecurityError because the canvas is "tainted". The mask code catches this, sets `maskState.ready = false`, and silently falls back. Clicks on the canvas become no-ops. The rest of the editor still works.

2. **Mask image load fails (network, 5xx, etc.).** Same fallback. The visible image can load independently, so the user still sees the diagram.

In both failure cases, selection via the side lists and transition table continues to work unchanged.

---

## 7. Selection model and toolbar enablement

The rules for when each toolbar button is enabled are dense but mechanical. They live in `updateToolbar()` and a few predicate helpers (`canAddTransition`, `canEdit`, `sourceAlreadyHandlesAnyOf`).

### 7.1 Add Transition

The most complex predicate. Given the current selection, it asks: does this selection describe a valid transition-to-be?

| Selection pattern                         | Produces                     |
| ----------------------------------------- | ---------------------------- |
| `START` + 1 state, no message             | Initial transition           |
| 1 state + 1+ non-Yes/No messages          | Self-transition              |
| 2 nodes (states/CPs), non-Yes/No messages | State-to-state or state-to-CP|
| 1 CP + 1 other node + Yes/No messages     | Choice-point outgoing branch |
| `H` + 1 state or CP + 1+ messages         | History-target transition    |
| `*` + 1 state or CP + non-Yes/No messages | Wildcard (ANY) transition    |

Independent of the pattern, two cross-cutting constraints are enforced:

- **Yes/No messages are only valid on transitions out of a choice-point.** Everywhere else they are rejected.
- **Each source handles each message at most once.** If any existing transition from the candidate source already carries the chosen message, the button is disabled. For the "2 nodes" case where either node could be the source, the button is enabled if *either* node is a valid source; the source-picker dialog then validates the user's pick.

### 7.2 Edit

Enabled when exactly one editable thing is selected:

- one state (not START),
- one choice-point,
- one non-default interface,
- one non-default message,
- or every row of exactly one transition (and no rows of any other).

The last case is subtle: if a user selects individual message rows from two different transitions, or one row from a transition plus a state, Edit is disabled because the selection doesn't uniquely identify one transition to edit. Transition editing mutates connector type/length, which is a property of the whole arrow — not of individual messages.

### 7.3 Delete

Permitted as long as the selection does not include any immutable element (START, default interfaces, default messages). Deletion cascades:

- Deleting a state or CP drops every transition touching it (source or target).
- Deleting an interface drops its messages, and strips them from any transitions they appear in; transitions left empty are dropped (except the initial transition, which is intentionally message-less).
- Deleting a single message **row** strips that message from its arrow without affecting the others.

### 7.4 Save

A single, simple predicate: enabled only when the file has been saved at least once (`Model.savedFilename !== null`) **and** there are unsaved edits (`Model.dirty === true`). Save As is always available.

---

## 8. Per-message transition selection

The transition model has per-message selection keys — `source|target|interface|name` — rather than per-arrow keys. Several places care about this distinction:

- **Visible diagram rendering** colours individual message labels red when exactly those messages are selected, and only colours the arrow itself red when **all** of the arrow's messages are selected.
- **Canvas click** toggles all rows of the clicked arrow together, because the mask only knows about arrows (§6.5).
- **Transition table rows** toggle exactly one row at a time, because each row represents a single message.
- **Edit** requires all rows of a single transition to be selected (§7.2).
- **Delete** removes only the selected rows; if that empties an arrow, the arrow is dropped.

Together these behaviours let grouped arrows behave like a unit when convenient (clicking the arrow, showing group-level highlighting) while still letting the user edit the group down to a single message when needed.

---

## 9. The Action panel

The Action panel is a free-text editor below the transitions table that lets developers document what the component does when a specific transition fires. Actions are stored per transition message row — one per `(source, target, interface, name)` tuple — and are persisted only in the saved JSON; they are intentionally **not** written into the generated PlantUML so the diagram itself stays uncluttered.

### 9.1 Storage

The optional `action` string lives on each message object inside a transition's `messages` array:

```js
t.messages = [
  { interface: "RTx", name: "ConnectReq", action: "Start the whitelist lookup." },
  { interface: "RTx", name: "ConnectedInd" }     // no action
];
```

Because message objects are compared by `interface` + `name` everywhere in the codebase, adding this optional field is fully backward-compatible — equality checks, delete cascades, transition lookups, and undo snapshots all continue to work unchanged.

### 9.2 Visibility and editing

The Action panel has three display states, driven by the current selection:

| Selection                              | Panel shows                                  |
| -------------------------------------- | -------------------------------------------- |
| Exactly one transition row, nothing else | Editable textarea with the row's action     |
| Exactly one row, but it's the initial transition (no message) | Placeholder explaining that initial transitions have no action |
| Anything else (multiple rows, zero rows, a row plus other elements) | Placeholder prompting for a single-row selection |

Editing rules mirror the rest of the editor:

- **Live save.** Every keystroke writes `textarea.value` into the model directly (`msg.action = newVal`). There is no explicit "commit" — the transition table is rebuilt on each input event so the "has action" indicator dot appears and disappears as the user types.
- **One history entry per edit session.** A module-level `actionEditSession` tracks whether `pushHistory()` has already been called for the current (row key, focus period). The first `input` event in a session pushes history; subsequent events just mutate. The session ends on `blur` or when the selection changes to a different row. Undo therefore reverts a whole typing session rather than a single keystroke.
- **No diagram re-render.** Actions don't change the PlantUML output, so the input handler calls `buildTransitionTable()` + `updateToolbar()` but *not* `scheduleRender()`, avoiding a network round-trip per keystroke.
- **Keyboard shortcuts suspended.** The global shortcut handler checks `e.target.tagName === "TEXTAREA"` alongside `INPUT` and `SELECT` and bails out, so Ctrl+S / Ctrl+Z while typing don't trigger Save or Undo.

### 9.3 Indicator dot

The transitions table has a narrow first column that is otherwise empty. A row whose message has a non-empty `action` shows a small accent-coloured dot there, styled via a CSS `::before` pseudo-element on a `.action-dot.has-action` cell. This gives a cheap at-a-glance overview of which transitions are documented without cluttering the table with an extra visible column.

### 9.4 Layout

The panel has a fixed default height of 140 px and lives at the bottom of the right-panel flex column. A second resize handle (`#resize-handle-action`) sits between the transitions table and the Action panel, mirroring the existing lists/table handle. Dragging changes the Action panel's height; the transitions table consumes the remaining space via its existing `flex: 1 1 auto`. Double-click resets to 140 px.

---

## 10. Dialogs and validation

The dialog system is a minimal home-grown modal built on one overlay `<div>` that gets populated with HTML templates by helper functions:

- `showAlert(title, message)` — information modal.
- `showConfirm(title, message, onYes, onNo)` — yes/no.
- `showPrompt(title, label, initial, validate, onOk)` — single-line text input.
- `openStateDialog`, `openCPDialog`, `openInterfaceDialog`, `openMessageDialog`, `openTransitionDialog` — per-element property editors. Each accepts an optional `existing` parameter; if present, the dialog edits it in place, otherwise it creates a new element.

Every dialog follows the same pattern:

1. Build HTML into `modalContainer.innerHTML`
2. Wire up input change handlers to enable/disable the OK button based on client-side validity
3. On OK click, run final validation (uniqueness in particular), show an error alert if invalid and keep the dialog open, otherwise `pushHistory()`, mutate the model, and call `refresh()`

Name uniqueness is enforced for states (globally, including against choice-points), choice-points (globally, including against states), interfaces (globally), and messages (within their interface). `isValidIdentifier` enforces the single-word letters/digits/underscore rule.

---

## 11. File operations

### 11.1 Save/Open — JSON

Files are saved as JSON with a top-level `format: "stadiae-v1"` tag. The emitter writes a clean subset — user-defined interfaces and messages only, no defaults — so files are smaller and human-readable. The loader restores the model from this subset and re-synthesises the default interfaces and messages.

Save/Save-As uses a `showPrompt` for filenames rather than the native `<input type="file">` save dialog (which browsers don't expose to JS). The file is generated as a `Blob` and downloaded via a programmatic `<a>` click. Open uses a hidden `<input type="file">` triggered by the menu item; the user's selection is read with `FileReader` and parsed.

The "unsaved edits" dialog gates both New and Open — if `Model.dirty`, the user is asked to confirm discarding.

### 11.2 Export — PlantUML and PNG

Export as `.puml` writes the clean (unselected) PlantUML source to a text file — suitable for committing to source control or pasting into any PlantUML renderer.

Export as `.png` re-renders the clean PlantUML source via the public server, fetches the resulting image as a blob, and downloads it. Crucially, exports always call `generatePlantUML({ withSelection: false })` so the user's on-screen red highlighting is never baked into the output.

---

## 12. UI layout and styling

The layout is a standard CSS flex/grid arrangement; no layout framework is used. Structure:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Menu bar (dark chrome)                                               │
├──────────────────────────────────────────────────────────────────────┤
│ Toolbar (dark chrome)                                                │
├────────────────────────────────┬─────────────────────────────────────┤
│                                │ ┌── Lists (2x2 grid) ─────────────┐ │
│                                │ │ States       │  Choice-points   │ │
│                                │ ├──────────────┼──────────────────┤ │
│                                │ │ Interfaces   │  Messages        │ │
│                                │ └──────────────┴──────────────────┘ │
│                                │ ──── resize handle ────             │
│ Canvas panel                   │ ┌── Transitions table ────────────┐ │
│ (rendered PlantUML PNG)        │ │ • │ Source │ Target │ Iface │…  │ │
│                                │ │   ...                           │ │
│                                │ └─────────────────────────────────┘ │
│                                │ ──── resize handle ────             │
│                                │ ┌── Action panel ─────────────────┐ │
│                                │ │ [ free-text textarea ]          │ │
│                                │ └─────────────────────────────────┘ │
└────────────────────────────────┴─────────────────────────────────────┘
```

Design decisions worth noting:

- **Dark chrome, light workspace.** The menu bar and toolbar sit on a deep slate background (`--chrome: #1e2230`), contrasting with the white workspace beneath. This pattern (used by Linear, Figma, VS Code) anchors the canvas visually.
- **One accent colour.** The Computerguided Systems indigo (`#2b2a8f`) from the logo is the only accent, used for primary buttons, hover states, selection highlights, and the logo in the About dialog.
- **Section headers with subtle fills.** The four right-panel list headers and the transition-table header use small-caps uppercase labels on a light grey fill — restrained, but enough to read as "sections".
- **User-adjustable split.** The horizontal bar between the four lists and the transition table is draggable, as is the bar between the transition table and the Action panel. Double-clicking either resets to the default height.
- **Inter font.** Loaded from Google Fonts. All typography uses Inter in various weights, which reads cleaner than the default system fonts at small sizes.

The CSS uses custom properties extensively (`--bg`, `--surface`, `--accent`, etc.), which makes future re-theming straightforward.

---

## 13. Known limitations

- **Public PlantUML server dependency.** Rendering requires the server at `plantuml.com` to be reachable. The export-as-`.puml` path works fully offline.
- **Canvas selection depends on CORS.** If the PlantUML server ever stops sending `Access-Control-Allow-Origin: *`, the mask pixel read becomes impossible in the browser and canvas-click selection silently fails (list-based selection continues to work).
- **No composite/nested states.** The model is intentionally flat; PlantUML supports composite states but Stadiæ doesn't currently expose them.
- **No multi-select on the canvas.** Clicks are single-toggle only; multi-select is only available through the side lists and transition table.
- **Server-side layout.** The user can influence arrow direction and length per transition, but the overall layout is decided by PlantUML. Manual drag-positioning of nodes is not supported.

---

## 14. Pointers for extension

If you want to:

- **Add a new element type** (e.g. an "end" pseudostate): add a flag to `Selection`, a row to the States list in `buildStateList`, emission logic in `generatePlantUML` (both modes — visible with styling, mask with id assignment), a case in `canAddTransition` if it participates in transitions, and a manual section.

- **Add a new per-transition-row field** (like the `action` field): extend the message objects in `Model.transitions[*].messages`, add UI for viewing/editing it below the transitions table (following the Action panel pattern — live save with per-session history via `pushHistory`, suppressed diagram re-renders since it doesn't affect PlantUML), and surface presence in the table via an indicator column or cell.

- **Change visual theming**: edit the CSS custom properties block at the top of `<style>`. The accent colour threads through toolbar hover, selection, primary buttons, and the logo — one variable.

- **Add a new menu item**: add `<div class="item" data-action="...">` under the right `<div class="menu">`, then a `case` in the menu click-dispatch switch.

- **Persist across sessions**: the model serialises cleanly via `snapshot()`. Writing that string to `localStorage` on every `pushHistory` and restoring on startup would add autosave without touching the rest of the code.

- **Support offline rendering**: replace `plantUMLImageURL(source)` with a call to a local PlantUML instance (e.g. served via `plantuml -picoweb`), keeping everything else the same. The selection-mask technique works identically as long as the local server sends CORS headers.

---

*This document reflects the design as of the current build. Last updated alongside the selection-mask feature.*
