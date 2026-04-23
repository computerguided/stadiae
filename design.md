# Stadiæ — Detailed Design

This document describes the design and internal architecture of **Stadiæ**, a single-file HTML/CSS/JavaScript state diagram editor that renders via PlantUML. It is intended for developers maintaining or extending the tool. For a user-facing guide, see the in-app **Help → User Manual**. For a project-level overview, see the `README.md`.

---

## 1. Design goals and context

Stadiæ is a graphical front-end for authoring PlantUML state diagrams of functional components. The user works with familiar domain vocabulary — *states*, *choice-points*, *interfaces*, *messages*, *transitions* — while the tool emits clean, version-controllable PlantUML source.

Three top-level goals shaped the design:

**Single-file deployment.** The entire application is one HTML file, no build step, no dependencies beyond a modern browser and network access to the public PlantUML server. This rules out bundlers, frameworks, and module systems; it also rules out anything that requires a backend. The trade-off is self-imposed: it makes hosting and distribution trivial, at the cost of keeping everything hand-written.

**Separation of model and presentation.** The editor maintains an in-memory model of the diagram. Any operation that mutates the model re-emits a PlantUML source string from scratch, sends it to the public PlantUML server, and displays the returned PNG. The PlantUML source is a pure function of the model (plus a selection highlight overlay). This keeps the rendering pipeline simple and predictable.

**Graphical selection on a server-rendered bitmap.** The editor doesn't render the diagram itself; a remote server does, and the client only receives a PNG. The user nevertheless needs to click on states, choice-points, and transitions directly in the rendered image. This is solved with a secondary "selection mask" rendering — see §7.

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

### 3.1 `Model` and `Component`

The domain data — what the file contains. This is the single source of truth for the PlantUML output, the lists on the right, the transition table, and saved files.

A Stadiæ file holds one or more **components** (independent state machines) plus **system-wide** interfaces and messages that every component shares:

```js
Model = {
  // System-wide (shared across components)
  interfaces: [ {name, isDefault, description} ],
  messages:   [ {interface, name, isDefault, description} ],
  // Components
  components: [
    {
      name: String,           // identifier-safe, unique. "Node", "Session_A"
      displayName: String,    // optional free text (may include `\n`)
      description: String,    // optional free-text developer documentation
      arrowFontSize: Number,  // default 9
      stateFontSize: Number,  // default 12
      states:       [ {name, displayName, description} ],
      choicePoints: [ {name, question, description} ],   // name excludes "CP_" prefix
      transitions:  [ {source, target, messages, connector, length} ]
    },
    ...
  ],
  activeComponentIndex: Number,
  // System-level component diagram — see §14. Each entry wires one
  // component to one non-default interface. Connector direction/length
  // use the same vocabulary as transitions but without arrowheads.
  connections: [
    { component: String, interface: String,
      connector: "Right"|"Left"|"Up"|"Down", length: Number }
  ],
  // Handlers — system-level entities parallel to Components but with no
  // state machine. Represent asynchronous edges to the outside world
  // (sockets, queues, DB drivers). Render as 3D-brick `node` shapes on
  // the system diagram. Name is identifier-safe and unique across
  // Components ∪ Handlers. Functions are the handler's callable API
  // — documentation-only, never reach PlantUML. Each function has
  // identifier-safe name (unique within its handler), optional
  // description, and a list of parameters with the same shape as
  // message parameters.
  handlers: [
    { name: String, displayName: String, description: String,
      functions: [
        { name: String, description: String,
          parameters: [ {name, type} ] }
      ]
    }
  ],
  // Handler ↔ Interface wiring. Same connector/length shape as
  // `connections`; a Handler on an interface is implicitly a sender.
  // When a Handler is wired to an interface, any Component connections
  // to the same interface automatically render with an arrowhead at the
  // Component's end (direction is derived, not stored).
  handlerConnections: [
    { handler: String, interface: String,
      connector: "Right"|"Left"|"Up"|"Down", length: Number }
  ],
  // Component ⇢ Handler function-call dependencies. Rendered as a
  // dashed arrow pointing at the Handler (calls flow Component→Handler).
  // No interface is involved.
  handlerCalls: [
    { component: String, handler: String,
      connector: "Right"|"Left"|"Up"|"Down", length: Number }
  ],
  // System-level settings. The system diagram nests everything inside
  // an outer `component SystemName { ... }` wrapper so it carries a
  // visible boundary labelled with the system's name. Name + displayName
  // follow the same convention as components. The two font sizes apply
  // only to the system diagram; per-component font sizes
  // (arrowFontSize, stateFontSize) apply only to the state-machine view.
  systemName: String,            // identifier-safe, default "System"
  systemDisplayName: String,     // optional free text (may include `\n`)
  systemComponentFontSize: Number, // Component + Handler labels, default 12
  systemInterfaceFontSize: Number, // Interface lollipop labels, default 11
  // Free-text system specification. A developer-facing document that
  // describes the system as a whole. Lives on Model (one per file),
  // persisted in JSON, never written to PlantUML. Edited via the
  // System Specification panel below the canvas.
  systemSpecification: String,
  // Which view the canvas is rendering: "component" shows the active
  // component's state machine, "system" shows the component diagram.
  activeView: "component"|"system",
  // Save metadata
  dirty: Boolean,             // unsaved edits?
  savedFilename: String|null
}
```

The `Component` proxy. Because most code that manipulates the diagram works on exactly one component at a time, a convenience object named `Component` is defined with getter/setter pairs that route to the active component:

```js
const Component = {
  get states()  { return Model.components[Model.activeComponentIndex].states; },
  set states(v) { Model.components[Model.activeComponentIndex].states = v; },
  // … and the same for name, arrowFontSize, stateFontSize,
  //                 choicePoints, transitions
};
```

Reading `Component.states` is exactly the same as reading `Model.components[Model.activeComponentIndex].states`. This keeps per-component code short and readable while making the active-component dispatch explicit where it matters.

The `messages` array inside each transition holds `{interface, name, action?}` objects. The optional `action` field is a free-text description documenting what the component does when that specific (source, target, message) transition fires — see §10 on the Action panel.

Some subtleties worth noting:

- **Default interfaces and messages are explicit in the list.** `Timer`, `Logical`, `Timeout`, `Yes`, `No` all appear as entries with `isDefault: true`. This keeps list-building and message-lookup code uniform (no special cases) and makes it easy to render them in italics/grey in the UI. The PlantUML emitter filters them out when writing the `Interfaces` / `Messages` sections, because defaults are hard-coded in the PlantUML output.

- **Interfaces and messages are system-wide.** They live on `Model` rather than in each component. Every component references the same interfaces and messages by name. Rename/delete of an interface or message cascades to every component's transitions — see the cascade-handling in `openInterfaceDialog`, `openMessageDialog` and `actionDelete`. This models the real-world semantic: an interface like `RTx` is a contract between components, not a per-component detail.

- **States, choice-points, and transitions are component-local.** A transition cannot reference a state in another component — transitions always stay within the component that owns them.

- **Components have `name` plus optional `displayName`.** Same convention as states. `name` is identifier-safe and stable (it's what `Model.connections[*].component` refers to, what mask-id keys are built from, what `Selection.components` stores). `displayName` is free text shown on the rendered diagram (system-view component box, state-machine outer wrapper) and may contain `\n` markers that PlantUML interprets as line breaks. The Components list shows the display label with `\n` collapsed to spaces, so the entry stays single-line. When `displayName` is empty, the canvas falls back to `name`. Files saved before this split stored free text directly in `name`; the loader migrates them by slugging the original into a valid `name` and promoting the original text to `displayName`. Connections referring to the old name are re-keyed via a rename map built during the migration. See §4.3.

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

The non-obvious choice is **`transitions` holds per-message rows**, not whole arrows. A grouped arrow with two messages appears as two rows in the transition table and can be selected one row at a time. A helper `isTransitionFullySelected(t)` returns true when every row of a transition is selected. See §9.

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

## 4. Components

A Stadiæ file may contain multiple components. This section describes how that multi-component model is presented and manipulated — the data-level split was covered in §3.1.

### 4.1 Active component and selection semantics

Only one component is *active* at a time. The canvas, the States and Choice-points lists, the transitions table, and the Action panel all reflect the active component. The **Components list** in the top-right system catalogue selects which component is active — clicking a row calls `switchToComponent(idx)` and a small chevron `▸` marks the active row. Two floating buttons on the canvas handle the view-switch: a `◇ System` button at the top-left switches to the system view, and (in system view) a `Component ▸` button at the top-right enters the currently selected component's state machine. In system view no row is marked active because the canvas is showing the system diagram, not any single component's state machine.

`Selection` is intentionally *not* partitioned per component. It's a single global set of selected elements. When the user switches components (`switchToComponent`), `Selection.clearAll()` is called, so the new active component always starts with nothing selected. This sidesteps all the edge cases that "per-component selection" would produce — stale references to a hidden component's elements, different toolbar-enablement states, canvas highlighting inconsistencies.

The `Component` proxy introduced in §3.1 makes every piece of code that worked on "the one component" continue to work without change. References like `Component.states`, `Component.transitions`, `Component.name` automatically follow the active component.

### 4.2 Shared vocabulary

Interfaces and messages live on `Model` directly (not inside `Model.components[i]`). This is a deliberate modelling choice: interfaces are contracts *between* components and only make sense when they're the same everywhere they appear.

Two practical consequences flow from this:

- **Cascading renames and deletes.** When an interface or message is renamed or deleted, the cascade walks `Model.components[*].transitions` — every component's transitions get updated, not just the active one. See `openInterfaceDialog`, `openMessageDialog`, and `actionDelete` in the source.

- **Cross-component uniqueness rules.** Interface names are globally unique; message names are unique within their interface; those rules are enforced once against the shared vocabulary, not per component.

By contrast, state and choice-point names are unique only *within* their component — two different components can both have a state called `Initialising`.

### 4.3 Component lifecycle

Four operations manipulate the components array. All flow through a single dialog `openComponentDialog(existing)` for the create/edit cases — same shape as `openStateDialog`, with a Name field validated by `isValidIdentifier` + `isUniqueComponentName`, and an optional Display name field for free-text labelling on the canvas.

- **Add** (`addComponent` → `openComponentDialog(null)`): prompts for name + display name, validates, appends via `makeEmptyComponent`, switches to it, pushes history. New components get a unique identifier `name`; the optional `displayName` is rendered on the canvas via `componentDisplayLabel(c)`.
- **Rename** (`renameComponent(idx)` → `openComponentDialog(existing)`): the same dialog with both fields pre-filled. On OK with a changed `name`, the cascade helper `onComponentRenamed` updates every entry in `Model.connections` whose `component` field referenced the old name. Selection keys keyed by component name (`Selection.components`, `Selection.connections`) are also re-keyed in place so a rename doesn't drop the user's selection. The `Component → Change name…` menu action opens the same dialog for the active component.
- **Delete** (`deleteComponent`): triggered by selecting a component row and clicking Delete (or via the toolbar Delete keyboard shortcut, with the same single-component-selection check). Confirmation dialog quotes the display label, not the identifier (more readable). Removes the component, adjusts `activeComponentIndex` so the UI stays on a valid component, and calls `onComponentDeleted` to prune any matching connections. Deletion is blocked when only one component remains — the file must always have at least one. The toolbar `actionDelete` short-circuits to this flow when the selection contains exactly one component and nothing else, since deleting a whole state machine warrants its own confirm-first handling distinct from the bulk-delete path used for states and transitions.
- **Switch** (`switchToComponent`): sets `activeComponentIndex`, sets `Model.activeView` to `"component"`, clears selection, triggers a refresh.

All four push a history snapshot before mutating so undo correctly restores component order, names, display names, and the active-component pointer. Component-name uniqueness is essential because mask-id keys (`"comp:" + name`) and connection-cascade lookups all assume it; the validator at every entry point keeps the invariant holding.

**Migration of pre-displayName files.** Earlier v3 saves (from before the Name/Display-name split) stored arbitrary text (including `\n` markers and spaces) in `name`. The loader (`loadModel`) walks `data.components` and, for any entry whose `name` isn't a valid identifier, slugs the original via `slugifyComponentName` (replace non-identifier chars with `_`, prepend `C_` if it doesn't start with a letter), promotes the original text to `displayName` if no displayName was already supplied, and disambiguates slug collisions with `_2`, `_3`, etc. A `renameMap` tracks any `oldName → newName` rewrites; `data.connections` is rewritten through that map before being loaded. The result is byte-identical visible output (the canvas renders displayName) with a clean, reference-stable `name` underneath.

### 4.4 Exports operate per-active-component

PlantUML, PNG, and Markdown exports use whatever the active component is at the time. To export every component, the user switches the active component (one click in the Components list) and exports each one. The file-level save operation (`.json`) is the only one that covers the full file (all components, the shared vocabulary, and the system diagram).

---

## 5. The refresh pipeline

Any change to the model or selection calls `refresh()`, which rebuilds the UI. Conceptually:

```
refresh()
  ├── document.body.classList toggle  — view-system / view-component
  ├── buildComponentList()     — one row per component, chevron on active
  ├── buildStateList()         — repopulate <ul> for States (+ START, H, *)
  ├── buildCPList()            — repopulate <ul> for Choice-points
  ├── buildInterfaceList()     — repopulate <ul> for Interfaces (system-wide)
  ├── buildMessageList()       — show messages of currently selected iface(s)
  ├── buildTransitionTable()   — one <tr> per (transition × message)
  ├── buildActionPanel()       — show/hide the action textarea based on selection
  ├── updateToolbar()          — compute enablement of every button
  └── (re-render if the visual fingerprint changed)
```

`scheduleRender` uses a 150ms debounce so rapid list-click selection doesn't trigger a server round-trip per keystroke. A canvas re-render is the only step that involves network I/O — so to save round-trips, `refresh` computes a "visual fingerprint" (a string covering everything that affects what's painted: full model, the active view, the active component index, every selection set) and only calls `scheduleRender` when that fingerprint changed.

---

## 6. PlantUML generation

`generatePlantUML(opts)` is a pure function from `Model` + `Selection` + options to a PlantUML source string. It supports two modes controlled by `opts.mode`:

- `"visible"` (default): the user-facing diagram, with red styling for selected elements if `opts.withSelection` is true. Includes the `<style>` block that makes choice-points render as white rectangles.
- `"mask"`: the selection-mask diagram, covered in §7. Selection highlighting is not applied; instead every element gets a unique fill color generated by `opts.idAssigner`.

A third option `opts.includeSalt` (default `true`) controls whether a per-render salt comment is written near the top of the source. Rendering calls leave it on to guarantee server-cache uniqueness (see §7.8); export calls turn it off to keep downloaded `.puml` files clean.

The generator emits sections in this order, matching the reference PlantUML conventions:

```
@startuml
' mode: visible render: …       (per-render salt, rendering only)
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

### 6.1 Selection highlighting in the visible diagram

When `withSelection` is true, selected elements are decorated directly in the PlantUML:

| Element     | How it's marked                                                                 |
| ----------- | ------------------------------------------------------------------------------- |
| START dot   | `#FF0000` instead of `#000000`                                                  |
| State       | appended `#line:FF0000;line.bold`                                               |
| Choice-point| appended `#line:FF0000;line.bold`                                               |
| Transition (fully selected) | the arrow becomes `-[#FF0000,bold]-> …` instead of `->` etc.     |
| Single message on a grouped arrow | wrapped in `<color:#FF0000>…</color>` inline in the label          |

The last row is worth calling out: when only some messages of a grouped arrow are selected, the **arrow itself** keeps its default styling but the **individual message labels** are coloured red via inline PlantUML text colour directives. This preserves the grouping while still showing the user precisely which row is selected.

### 6.2 ANY pseudostate: synthetic declarations

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

### 6.3 History target: the `[H]` syntax

Transitions to `target === "[H]"` are emitted literally as `SourceState --> [H] : Message`. PlantUML recognises `[H]` and draws an "H" pseudostate without any declaration. Multiple such transitions produce multiple H icons, matching the user's expectation.

---

## 7. The selection mask

The most architecturally interesting piece of the app. It exists because the canvas is a server-rendered PNG — the client has no structural knowledge of it — yet the user expects to select states, choice-points, and transitions by clicking them directly.

### 7.1 Concept

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

### 7.2 Differences between visible and mask PlantUML

The mask source is not just the visible source with different colours — several small tweaks work together:

| Mask directive                     | Purpose                                                           |
| ---------------------------------- | ----------------------------------------------------------------- |
| `skinparam Arrow { FontColor #00000000 }` | Hide transition labels — text would otherwise overpaint the coloured arrow lines with black pixels. |
| `skinparam State { FontColor #00000000 }` | Same, for state/choice-point labels.                              |
| Per-element `#color;line:color`    | Each state/CP/ANY gets a unique fill **and** matching line colour, so clicking the border is still a hit. |
| `-[#color,thickness=8]->` on arrows | Thick stroke for a comfortable click hitbox on transitions.       |
| `<style>` block **omitted**         | Otherwise the choice-point rule `BackgroundColor #ffffff` would wipe out their unique fill colour. |
| No selection highlighting          | Mask output is independent of current selection state.            |

### 7.3 Colour assignment

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

### 7.4 Click resolution

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

### 7.5 Transition clicks toggle all rows together

Per-message selection is a model-layer concept — the mask only has one identifier per arrow. When a user clicks a transition arrow:

```js
toggleSelection({kind: "transition", key: "trans:src|tgt"})
  ├── find the transition t matching src|tgt
  ├── allRows = transRowKeys(t)
  ├── if all rows are selected → delete all
  └── else → add all
```

This matches the user's mental model: the arrow is the thing they see and click, so clicking it toggles the whole arrow. Finer granularity — picking a single message from a grouped arrow — is available through the transition table. This division keeps the canvas simple for casual clicking while retaining full control when needed.

### 7.6 Failure modes

Two things can go wrong:

1. **CORS blocks pixel reads.** If the PlantUML server doesn't send `Access-Control-Allow-Origin: *` on the PNG, `getImageData` throws a SecurityError because the canvas is "tainted". The mask code catches this, sets `maskState.ready = false`, and silently falls back. Clicks on the canvas become no-ops. The rest of the editor still works.

2. **Mask image load fails (network, 5xx, etc.).** Same fallback. The visible image can load independently, so the user still sees the diagram.

In both failure cases, selection via the side lists and transition table continues to work unchanged.

### 7.7 Hover cursor

The mask is also useful for hover affordance. An `onDiagramMouseMove` handler, throttled with `requestAnimationFrame` (so at most one lookup per frame), reuses `lookupMaskAt` on every mouse movement and sets the image cursor to `pointer` when the hovered pixel maps to a clickable element, or `default` otherwise. This makes it immediately obvious which parts of the diagram are interactive. A `mouseleave` handler resets the cursor.

Because hover and click share the exact same lookup path, the cursor and the click behaviour can never disagree: if the cursor changes to a pointer, clicking there will definitely select something.

### 7.8 Render discipline: staleness guard and per-render salt

Two defensive mechanisms protect the rendering pipeline from producing the wrong output:

**Render sequence number.** A module-level `renderSeq` counter increments at the start of every `renderDiagram` call. Each call captures its own sequence number in a closure; the `onload`/`onerror` callbacks on both the visible and mask `<Image>` objects check this sequence before doing anything. Late-arriving images from a superseded render are silently dropped. Without this guard, a slow network response from a previous render could overwrite the panel's current content with stale pixels.

**Per-render salt.** Every call to `generatePlantUML` (in rendering mode, not export) appends a comment line like `' mode: visible render: abc123-7` where the integer is a monotonically-increasing counter and the prefix is a random-per-page-load string. This guarantees three distinctness properties:

- No two renders within a session share a source (and therefore a URL).
- No two sessions share a source, even if they happen to edit the same model.
- Visible and mask sources always differ within one render, even before considering the `mode:` tag.

Why it matters: the public PlantUML server caches rendered PNGs by encoded source. Observed behaviour showed occasional cache-entry aliasing where one render's PNG was served in response to a different render's request, producing diagrams with missing labels (it turned out to be the selection-mask PNG, which hides text, leaking into the visible diagram response). Making every request unique forces a fresh render server-side and sidesteps the issue entirely. The cost is one uncached render per edit, which is fast enough to be imperceptible.

The salt is **omitted** from exports (`includeSalt: false` in the options), so downloaded `.puml` files stay clean and reproducible.

---

## 8. Selection model and toolbar enablement

The rules for when each toolbar button is enabled are dense but mechanical. They live in `updateToolbar()` and a few predicate helpers (`canAddTransition`, `canEdit`, `sourceAlreadyHandlesAnyOf`).

### 8.1 Add Transition

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

### 8.2 Edit

Enabled when exactly one editable thing is selected:

- one state (not START),
- one choice-point,
- one non-default interface,
- one non-default message,
- or every row of exactly one transition (and no rows of any other).

The last case is subtle: if a user selects individual message rows from two different transitions, or one row from a transition plus a state, Edit is disabled because the selection doesn't uniquely identify one transition to edit. Transition editing mutates connector type/length, which is a property of the whole arrow — not of individual messages.

### 8.3 Redirect

Redirect moves one or more transition rows to a new target. Enabled when the selection is exactly ≥1 transition row plus exactly one valid target node (state, CP, or `H`) — no interfaces, messages, START, or ANY.

The action is handled in `actionRedirectTransitions`. The selected rows can come from any sources and any original targets; each is redirected independently. Behaviour details worth spelling out:

- **Action notes survive.** Moving a row carries its `action` field along to the destination.
- **Connector inheritance when moving all rows of an arrow.** If every row of an arrow is redirected, the destination arrow is created (or already exists); when created, it inherits the source arrow's `connector` and `length`. When only some rows move, the source arrow keeps its original connector for the rows that remain; the destination gets defaults.
- **Empty arrows are dropped.** A transition whose rows all get moved out is removed from the component.
- **Pre-flight conflict check.** Before mutating anything, the action walks the proposed redirects and collects two classes of problem: a no-op (the row is already targeting the chosen node) and a duplicate (the destination source-node already handles that exact message via a different transition). If any conflicts exist, the action aborts and shows a list — no partial redirects.
- **Selection replacement.** After a successful redirect, the selection becomes the set of redirected rows, so the user immediately sees what moved.
- **History.** One snapshot covers the entire batch, so a redirect of ten rows is one undo step.

### 8.4 Delete

Permitted as long as the selection does not include any immutable element (START, default interfaces, default messages). Deletion cascades:

- Deleting a state or CP drops every transition touching it (source or target).
- Deleting an interface drops its messages, and strips them from any transitions they appear in; transitions left empty are dropped (except the initial transition, which is intentionally message-less).
- Deleting a single message **row** strips that message from its arrow without affecting the others.

### 8.5 Save

A single, simple predicate: enabled only when the file has been saved at least once (`Model.savedFilename !== null`) **and** there are unsaved edits (`Model.dirty === true`). Save As is always available.

### 8.6 Keyboard-driven editing

Global shortcuts (Ctrl+N/O/S/Z/Y, Delete/Backspace) are wired in one document-level `keydown` handler that first checks `e.target.tagName` and bails on `INPUT`, `SELECT`, or `TEXTAREA` so typing in dialogs and the Action panel never triggers a shortcut.

**Arrow keys change transition direction.** When exactly one transition is fully selected and nothing else is selected, the four arrow keys change its `connector` to `Left`/`Right`/`Up`/`Down`. For `Up` and `Down`, repeatedly pressing the same key extends the arrow's `length` by one dash per press — a fast way to spread two arrows apart when PlantUML's auto-layout overlaps them, without opening the Edit dialog.

Self-transitions are fixed at `->` per the design spec, so arrow keys are ignored on them.

**Undo coalescing.** A module-level `arrowKeySession = {key, direction}` tracks whether the last arrow press was for the same transition and same direction. If so, no new history snapshot is taken — the whole "Up Up Up" sequence collapses into a single undo step. Changing direction, switching transitions, or pressing any non-arrow key ends the session. `refresh()` also ends the session when the selection changes, to keep the undo history clean.

---

## 9. Per-message transition selection and usage highlighting

### 9.1 Per-message selection

The transition model has per-message selection keys — `source|target|interface|name` — rather than per-arrow keys. Several places care about this distinction:

- **Visible diagram rendering** colours individual message labels red when exactly those messages are selected, and only colours the arrow itself red when **all** of the arrow's messages are selected.
- **Canvas click** toggles all rows of the clicked arrow together, because the mask only knows about arrows (§7.5).
- **Transition table rows** toggle exactly one row at a time, because each row represents a single message.
- **Edit** requires all rows of a single transition to be selected (§8.2).
- **Delete** removes only the selected rows; if that empties an arrow, the arrow is dropped.

Together these behaviours let grouped arrows behave like a unit when convenient (clicking the arrow, showing group-level highlighting) while still letting the user edit the group down to a single message when needed.

### 9.2 Usage highlighting for interfaces and messages

Selecting an interface or message gives a quick visual index of *where it is used* — matching cells in the transitions table bold, and matching labels on the rendered diagram are wrapped in `<b>...</b>`. The rule is captured in a single helper:

```js
function isUsageMatch(iface, name) {
  if (!iface) return false;
  if (Selection.messages.has(iface + ":" + name)) return true;
  if (Selection.interfaces.has(iface) && !interfaceHasAnySelectedMessage(iface)) return true;
  return false;
}
```

The second clause is the subtle one. When *only* an interface is selected, all its messages match — bold every row carrying that interface. When any of the interface's messages are individually selected, the interface co-selection is ignored for highlighting purposes; only the specifically selected messages count. This respects the user's specificity: clicking RTx bolds all RTx usages, but then drilling into `RTx:ConnectedInd` contracts the bolding to just that row.

Both the transition table and the PlantUML emitter use the same helper, so the canvas and the table stay consistent. The emitter applies the bold inside transition labels:

```js
if (selected) text = `<color:#FF0000>${text}</color>`;
if (matched)  text = `<b>${text}</b>`;
```

which means a row that's both row-selected and usage-matched renders red *and* bold — composed styling via nested PlantUML directives.

Because highlighting depends on interface and message selections, those selections must be part of the visual fingerprint that gates diagram re-rendering; otherwise the diagram would remain stale when the user clicks an interface.

---

## 10. The Action panel

The Action panel is a free-text editor below the transitions table that lets developers document what the component does when a specific transition fires. Actions are stored per transition message row — one per `(source, target, interface, name)` tuple — and are persisted only in the saved JSON; they are intentionally **not** written into the generated PlantUML so the diagram itself stays uncluttered.

### 10.1 Storage

The optional `action` string lives on each message object inside a transition's `messages` array:

```js
t.messages = [
  { interface: "RTx", name: "ConnectReq", action: "Start the whitelist lookup." },
  { interface: "RTx", name: "ConnectedInd" }     // no action
];
```

Because message objects are compared by `interface` + `name` everywhere in the codebase, adding this optional field is fully backward-compatible — equality checks, delete cascades, transition lookups, and undo snapshots all continue to work unchanged.

### 10.2 Visibility and editing

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

### 10.3 Indicator dot

The transitions table has a narrow first column that is otherwise empty. A row whose message has a non-empty `action` shows a small accent-coloured dot there, styled via a CSS `::before` pseudo-element on a `.action-dot.has-action` cell. This gives a cheap at-a-glance overview of which transitions are documented without cluttering the table with an extra visible column.

### 10.4 Layout

The panel has a fixed default height of 140 px and lives at the bottom of the right-panel flex column. A second resize handle (`#resize-handle-action`) sits between the transitions table and the Action panel, mirroring the existing lists/table handle. Dragging changes the Action panel's height; the transitions table consumes the remaining space via its existing `flex: 1 1 auto`. Double-click resets to 140 px.

### 10.5 The Description panel (sibling pattern)

Components have a free-text `description` field that the user edits via a **Description panel**. Architecturally identical to the Action panel: a textarea wired with live-save and per-session history coalescing; one undo step per typing run per component; the field is persisted in the saved JSON but never written to the generated PlantUML.

Three things make it distinct from the Action panel:

- **Always visible.** Unlike the Action panel — which appears empty/placeholder unless exactly one transition row is selected — the Description panel always has a bound component because there is always an active component. There is no placeholder mode.
- **Binding rule.** `resolveDescriptionTarget()` picks the component whose description the panel reflects. In component view, always the active component. In system view, the selected component if `Selection.components.size === 1`, otherwise the active component. The header carries an italic suffix showing the bound component's display label so the user always knows what they are documenting.
- **Layout.** The panel sits *between* the system catalogue (top of the right panel) and the `.component-panel` (everything else). Default height 100 px. In system view, where `.component-panel` is hidden by CSS, the description panel grows to fill via `flex: 1 1 auto`; the resize handle below it is also hidden, since there is nothing below to resize against.

The Components list shows a small accent-coloured dot at the right of any row whose component has a non-empty description — same visual weight and convention as the action-dot in the transitions table, so users learn one pattern and recognise it everywhere.

The component-rename cascade re-keys the textarea's `dataset.compName` on the next refresh — the input handler reads the bound name from the dataset rather than capturing it in a closure, so a rename mid-typing-session correctly continues writing to the renamed component (the rename is a model mutation, not a re-binding).

### 10.6 The System Specification panel

A third textarea-based panel — the **System Specification panel** — lives below the canvas in a column flex wrapper (`#canvas-column`) that holds the canvas, a horizontal resize handle, and the panel. The panel is *always visible in both views*: it documents the system as a whole, independent of which component or diagram is on screen, so it earns a persistent slot rather than floating in the view-scoped right column.

The binding is the simplest of the three panels: one `Model.systemSpecification` string, no selection logic, no placeholder mode, no has-description dot. `initSystemSpecPanel()` wires the textarea's `input` handler to live-save into `Model.systemSpecification` with a per-session history coalescer (`sysSpecEditSession.pushed` tracks whether the first keystroke of the current session has already pushed history); `blur` resets the session. `renderSystemSpecPanel()` — called from every `refresh()` — syncs the textarea's `.value` from the model, guarded against re-writing the same value to avoid disrupting cursor position when a refresh happens mid-type.

The panel is a sibling of `#canvas-panel` under `#canvas-column`, with a draggable `#resize-handle-sysspec` between them. The handle's drag math is inverted from a "pull handle down" gesture because the handle is at the *top* of the panel — dragging up grows the panel (by subtracting `e.clientY - startY` from `startH`); min/max clamps leave a ~200 px floor for the canvas. The existing horizontal main-split slider (`#resize-handle-main`) now operates on `#canvas-column` rather than on `#canvas-panel` directly, so resizing the split changes the width of the whole column (canvas + spec panel together).

Persisted via `buildSerializedModel()` only when non-empty; loaded with a string-type fallback defaulting to `""`. Round-trips through `snapshot()`/`restore()` like every other field on `Model`, so undo/redo over a typing session behaves exactly like undo/redo on Description or Action text.

---

## 11. Dialogs and validation

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

## 12. File operations

### 12.1 Save/Open — JSON

Files are saved as JSON with a top-level `format: "stadiae-v3"` tag. `buildSerializedModel()` emits the full file — every component, every handler, every shared interface/message, all wiring (Component-Interface connections, Handler-Interface connections, Component→Handler call dependencies), every description and action note, and the system-level settings (system name and font sizes). Defaults like `Timer:Timeout` on the messages list are re-synthesised on load, so only user-defined entries go to disk. Optional fields (displayName, description, handlers[], handlerConnections[], handlerCalls[], systemName, systemDisplayName, systemComponentFontSize, systemInterfaceFontSize) are written only when they diverge from their defaults — files that don't use a feature stay byte-minimal.

**Format tolerance.** The loader rejects anything other than `format: "stadiae-v3"` with a clear error. Within v3, every post-initial field is optional: a file without a `handlers` array loads with `Model.handlers = []`; a file without `systemName` loads with the default `"System"`. This schema tolerance is *forward*-compat — a v3 file from any point in v3's history loads cleanly — not backward-compat across format versions. The pre-v3 formats (`stadiae-v1`, the old single-component format, and `stadiae-v2`, the first multi-component format) are no longer supported; files saved under those tags must be loaded in an older build of Stadiæ and re-saved.

Save/Save-As uses a `showPrompt` for filenames rather than the native `<input type="file">` save dialog (which browsers don't expose to JS). The file is generated as a `Blob` and downloaded via a programmatic `<a>` click. Open uses a hidden `<input type="file">` triggered by the menu item; the user's selection is read with `FileReader` and parsed.

The "unsaved edits" dialog gates both New and Open — if `Model.dirty`, the user is asked to confirm discarding.

### 12.2 Export — PlantUML and PNG

Export as `.puml` writes the clean (unselected) PlantUML source of whatever is currently showing on the canvas to a text file — suitable for committing to source control or pasting into any PlantUML renderer. Actions, the per-render salt comment, and selection styling are all absent; the file contains only the reproducible diagram structure.

Export as `.png` re-renders the clean source via the public server, fetches the resulting image as a blob, and downloads it. Both exports always run with `withSelection: false, includeSalt: false` so the user's on-screen red highlighting and the per-render salt comment are never baked into the output.

The exporter dispatches on `Model.activeView`: in component view it calls `generatePlantUML` (the state-machine generator, scoped to the active component); in system view it calls `generateComponentDiagramPlantUML` (the system-level generator, covering the whole component/handler/interface topology). Default filename is derived from the active component's name or — in system view — the system's display name. To export every component of a multi-component file, switch the active component (one click in the Components list) and export each one; to export the system diagram, switch to system view and export.

### 12.3 Export — Transitions as Markdown

Under *Component → Copy transitions as Markdown table…*, `buildTransitionsMarkdown()` walks `Component.transitions` (the active component), flattens each transition into one row per message (initial transitions produce a single message-less row), sorts by the on-screen display labels, and emits a markdown table with columns **Source**, **Target**, **Interface**, **Message**, **Action**.

Source and target cells use `nodeLabel` for consistency with the transition table — state display names, choice-point questions, and the pseudostate symbols `●` / `H` / `∗` — not the raw identifiers. Escaping rules keep the output well-formed: pipes `|` become `\|`, and both literal `\n` sequences and actual newlines inside display names or actions become `<br>` so each cell stays on one markdown row.

The markdown text is shown in a read-only textarea inside a modal dialog. A **Copy to clipboard** button uses `navigator.clipboard.writeText` where available, falling back to `document.execCommand("copy")` on the already-selected textarea for contexts where the modern API is blocked (e.g. non-HTTPS).

---

## 13. UI layout and styling

The layout is a standard CSS flex/grid arrangement; no layout framework is used. Structure:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Menu bar (dark chrome)                                               │
├──────────────────────────────────────────────────────────────────────┤
│ Toolbar (dark chrome)                                                │
├────────────────────────────────┬─────────────────────────────────────┤
│ ┌──────────┐    ┌─────────────┐│ ┌── System catalogue (5 cols) ─────┐│
│ │ ◇ System │    │ Component ▸ ││ │Comps+│Hdlrs+│Fns+│Ifaces+│ Msgs+ ││
│ └──────────┘    └─────────────┘│ │▸CompA│Rad   │    │ RTx   │       ││
│   (system-view only ─ top-right│ │ CompB│      │    │Storage│       ││
│    when a component selected)  │ │      │      ├────┤       ├───────┤│
│                                │ │      │      │Prms│       │ Prms  ││
│                                │ │      │      │+   │       │   +   ││
│                                │ │      │      │    │       │       ││
│                                │ └──────────────────────────────────┘│
│                                │ ──── resize handle ────             │
│ Canvas panel                   │ ┌── Description (active component)─┐│
│ (rendered PlantUML PNG of      │ │ [ free-text textarea ]           ││
│  the active component, or      │ └──────────────────────────────────┘│
│  the system diagram)           │ ──── resize handle ────             │
│                                │ ┌── Component panel (active) ────┐  │
│  ──── resize handle ────       │ │ States +  │  Choice-points +   │  │
│ ┌── System specification ────┐ │ ├────────────────────────────────┤  │
│ │ [ free-text textarea ]    │ │ │ ──── resize handle ────        │  │
│ │                           │ │ │ Transitions table              │  │
│ └───────────────────────────┘ │ │ • │ Source │ Target │ Iface │… │  │
│                                │ │ ──── resize handle ────        │  │
│                                │ │ Action panel                   │  │
│                                │ │ [ free-text textarea ]         │  │
│                                │ └────────────────────────────────┘  │
└────────────────────────────────┴─────────────────────────────────────┘
            ↑                                   ↑
            canvas-column                       right-panel
     (canvas + System spec, stacked)     (catalogue, description, component stack)
     ← horizontal drag slider between the two columns →
```

The canvas panel hosts the rendered diagram plus a small amount of floating chrome — the `◇ System` button at its top-left (always visible, switches views), the `Component ▸` button at its top-right (visible in system view, enters the selected component), and occasionally a restored-draft banner along the top. Both buttons are absolutely positioned so they persist across the image-replacement cycle that happens on every render. Below the canvas and always visible in both views sits the **System Specification panel** — a free-text textarea bound to `Model.systemSpecification`, separated from the canvas by a vertical-drag resize handle.

The right panel is vertically subdivided into three regions:

- **System catalogue** at the top holds the file's shared vocabulary as five side-by-side lists: Components, Handlers, Functions, Interfaces, Messages. Each list's header has a `+` button to add an entry. A small chevron `▸` on the active row of the Components list shows which component's state machine is currently displayed below. The Functions column is filtered by the single selected Handler (empty otherwise); the Messages column is filtered by the selected Interfaces. Each of those two columns additionally nests a Parameters panel below its list, visible when exactly one function (respectively message) is selected.
- **Description panel** sits beneath the catalogue and is always visible. It binds to the active component in component view, or to the selected component in system view (falling back to active when no component or many are selected). Live-saves to `Component.description` per keystroke; never reaches PlantUML.
- **Component panel** at the bottom shows the active component's States + Choice-points (each with `+` in its header), the Transitions table, and the Action panel. Hidden in system view, where the description panel grows to fill the available space.

There are four user-draggable resize handles in this stack: between the system catalogue and the description panel, between the description panel and the component panel, between the States/Choice-points grid and the transitions table, and between the transitions table and the Action panel. Each handle double-clicks to reset.

Design decisions worth noting:

- **Dark chrome, light workspace.** The menu bar and toolbar sit on a deep slate background (`--chrome: #1e2230`), contrasting with the white workspace beneath. This pattern (used by Linear, Figma, VS Code) anchors the canvas visually.
- **One accent colour.** The Computerguided Systems indigo (`#2b2a8f`) from the logo is the only accent, used for primary buttons, hover states, selection highlights, the active component chevron, the System button's "view active" fill, and the logo in the About dialog.
- **Section headers with subtle fills.** The right-panel list headers and the transition-table header use small-caps uppercase labels on a light grey fill — restrained, but enough to read as "sections". The `+` buttons sit in those same headers, flush right, visually integrated.
- **Active component is one chevron, not selection.** The active row uses a chevron marker rather than the selection-style background fill, so "active" and "selected" can coexist visually without conflict in system view (where a component can be selected for the Add Connection workflow without being the active state-machine subject).
- **Inter font.** Loaded from Google Fonts. All typography uses Inter in various weights, which reads cleaner than the default system fonts at small sizes.

The CSS uses custom properties extensively (`--bg`, `--surface`, `--accent`, etc.), which makes future re-theming straightforward.

---

## 14. System diagram (FCM component view)

The system-level component diagram is a second "view" layered on top of the same `Model`. Where the per-component view renders a state machine on the canvas, the system view renders the components as boxes and the interfaces they are wired to as "lollipop" circles, with lines joining each component to each interface it uses. This corresponds to the top-level component diagram of the **FCM methodology** (Functional Components Method): components expose and connect to explicit interfaces, and their state machines handle messages arriving on those interfaces.

The two views share data: the same interfaces, the same messages, the same components. The wiring between them — which component connects to which interface — lives in `Model.connections` and is editable only in the system view.

### 14.1 `Model.connections` and `Model.activeView`

Two fields on `Model` carry the new state:

- `Model.connections: [ {component, interface, connector, length} ]` — flat list of wirings. `component` and `interface` are string references into `Model.components[*].name` and `Model.interfaces[*].name`. `connector` and `length` reuse the same vocabulary as state-machine transitions (see §3.1). Default interfaces (`Timer`, `Logical`) are deliberately never listed — they represent internal service concepts, not inter-component wiring.
- `Model.activeView: "component" | "system"` — controls canvas rendering and UI visibility. Defaults to `"component"`.

Cascade helpers (`onComponentRenamed`, `onComponentDeleted`, `onInterfaceRenamed`, `onInterfaceDeleted`) keep `Model.connections` consistent when the names they reference change or the referenced element is deleted. These are invoked from the same rename/delete paths that handle the existing cascades into `Component.transitions[*].messages[*]`, so one user action updates both "levels" atomically and the undo snapshot captures the combined state.

### 14.2 Save format: `stadiae-v3`

The save format's top-level tag is `stadiae-v3`. The file carries the full state: components, handlers, interfaces, messages, Component-Interface connections, Handler-Interface connections, Component→Handler call dependencies, and the system-level settings (system name and font sizes). Optional fields (`displayName`, `description`, the three Handler-related arrays, the four system-level fields) are emitted only when they diverge from their defaults, so files that don't use a given feature stay byte-minimal.

The loader rejects anything other than `stadiae-v3` with a clear error. Within v3, missing fields default cleanly — a file saved before `handlers` existed loads with `Model.handlers = []`, and the same applies to every other post-initial-v3 addition. This is forward-compat (an older v3 file loads in a newer build) rather than backward-compat across format versions: the pre-v3 formats (`stadiae-v1` single-component, `stadiae-v2` multi-component without connections) are not supported.

`loadModel()` populates every `Model.*` array from the file, dropping any wiring entry whose endpoints no longer exist — a hand-edited file with a dangling reference doesn't crash the loader. `resetModel()` and the loader both finish with `Model.activeView = "component"` so switching between files never leaks view state across loads.

### 14.3 Generator dispatch

A second PlantUML emitter, `generateComponentDiagramPlantUML(opts)`, mirrors the signature of `generatePlantUML(opts)` — the same `{ withSelection, mode, idAssigner, includeSalt, salt }` contract — but emits component-diagram source instead of a state machine. Element naming uses the entities' own identifier-safe names directly as PlantUML element ids, with one exception: Interface ids are prefixed `if_` (e.g. `if_RTx`) to keep them in their own namespace. PlantUML treats all element ids as one flat namespace regardless of shape, so without the prefix a Handler named `Test` would collide with an Interface named `Test`. Interfaces therefore always carry a label clause (`() if_RTx as "RTx"`) so the `if_` prefix never reaches the rendered picture. Parallel to the `CP_` prefix that choice-points use for the same reason. For Components and Handlers, an `as "<displayName>"` clause is appended only when a displayName is set and differs from the name — unambiguous cases (displayName absent or equal to name) emit just `component Node`, keeping the output concise and diff-friendly for committed `.puml` files.

`renderDiagram()` dispatches to one of the two emitters based on `Model.activeView`. The visible and mask PlantUML sources are both produced by the same emitter in one render pass, so the mask's element ids align with the visible diagram's geometry. This is the same §7 mechanism that enables canvas-click selection; it required no change to the mask-reading code, only new `kind` values (`"comp"`, `"iface"`, `"connection"`) flowing through `idAssigner` and `toggleSelection`.

Connection direction/length uses the same vocabulary as transitions, but without arrowheads (a wiring is undirected). The generator produces:

- `Right` → `-`
- `Left` → `-left-`
- `Up` → `-up` + N dashes (N = length)
- `Down` → `-` + N dashes

For mask and selection modes, the decoration is injected between the leading `-` and the rest of the connector using a `String.replace(/^-/, …)` — the same pattern that works for state-machine arrows.

Orphan interfaces (declared in the catalogue but not wired to anything) are omitted from the component-diagram render to keep it uncluttered. They remain visible in the Interfaces list on the right.

### 14.4 Components list and the floating System button

The Components list lives in the top-right system catalogue alongside the Interfaces and Messages lists. `buildComponentList()` emits one row per component; a small chevron `▸` marker on the row whose `idx === Model.activeComponentIndex` and `Model.activeView === "component"` shows which component is "showing its body" on the canvas. The marker space is reserved on every row (zero opacity for non-active rows) so the list doesn't reflow as the active component changes.

A floating `◇ System` button (`#btn-system`) lives at the top-left of the diagram canvas. It is absolutely positioned over `#canvas-panel` with `z-index: 20`, sitting above the rendered PNG. Clicking it calls `switchToSystem()`, which flips `Model.activeView` to `"system"`, clears the selection, and refreshes. CSS gives the button an accent fill while `body.view-system` is set, so its state is unambiguously visible (`background: var(--accent); color: white;`).

The button isn't part of `#canvas-content` — that's the inner wrapper `renderDiagram` rebuilds on every render. The button needs to persist across renders without being torn out, so it's a sibling of `#canvas-content` inside `#canvas-panel`. The same arrangement holds the `restored-banner` (autosave restoration prompt) and would hold any future canvas-floating chrome.

Why the canvas, not the right panel: controlling-what-is-shown belongs spatially close to the thing being controlled. The button replaced an earlier pill in the Components list header that competed with the `Components` label and the `+` button for narrow header space. Moving it to the canvas freed the header for symmetric `[label] [+]` styling matching Interfaces and Messages, and put the toggle where the user's attention already is when they decide to switch views.

The component-row click handler dispatches on the active view: in component view it calls `switchToComponent(idx)` (flips view back to `"component"` and sets `activeComponentIndex`); in system view it adds/removes the component from `Selection.components`, the same semantic as clicking the component box on the system canvas — this lets users build connections without having to locate the canvas box.

The `activeView` and `activeComponentIndex` are both included in the visual fingerprint used by `refresh()` to decide when to re-render, so view and component changes correctly invalidate the cached PNG.

This layout was a refactor from an earlier tab-bar UI. Tabs broke down at scale: more than ~5–8 components forced horizontal scroll or label truncation. A vertical list scrolls cleanly to any size, sits naturally next to the other system-wide lists, and integrates the Edit/Delete toolbar workflow that already exists for every other entity kind. The System button replaced what was previously a pinned `◇ System` tab, then briefly lived in the Components list header before moving to the canvas.

### 14.5 View-scoped UI

`refresh()` sets either `body.view-system` or `body.view-component` on the document body. CSS rules keyed off these classes:

- Hide `.component-panel` (States, Choice-points, Transitions table, Action panel) in system view. These concepts don't apply to the component diagram.
- Hide the state-machine toolbar buttons (Add Transition, Redirect) in system view and the component-diagram button (Add Connection) in component view.

`updateToolbar()` additionally disables Add State and Add Choice-point in system view, belt-and-braces in case a button gets clicked via keyboard focus. Add Interface / Add Message remain live in both views, because interfaces and messages are system-wide vocabulary.

The canvas click handler uses the view to pick the selection context: `"canvas"` (clears states, choice-points, transitions, START/H/ANY) or `"sysCanvas"` (clears components, interfaces, connections, messages). Both contexts feed the same `selectClick()` rules — the context is only used for the plain-click-replaces-in-same-panel behaviour.

### 14.6 Entering a component

Entering a component's state machine from the system diagram goes through a floating `Component ▸` button at the top-right of the canvas. The button mirrors the `◇ System` button's position (top-left) and visual weight — spatial symmetry that reads as "navigate up / navigate down" through the hierarchy. Only visible in system view (hidden via `body.view-component .canvas-enter-btn { display: none; }`). Enabled iff `canEnterComponent()` returns true: exactly one Component selected, no handlers/interfaces/messages/connections/handlerConnections/handlerCalls co-selected. On click, `enterSelectedComponent()` resolves the single selected name to a component index and calls `switchToComponent(idx)`.

The button replaced an earlier double-click-to-enter gesture on the canvas and on Components-list rows. That gesture was undiscoverable — nothing in the UI advertised that the boxes or rows were double-clickable, and single-click was already load-bearing (it mutated selection). The button makes the action visible: a user who selects a component sees the button light up and immediately understands what it does.

Unlike the System button, the Component button is never accent-filled. The System button is a toggle that doubles as a state indicator ("you are in system view"); the Component button is a pure action ("take me into this component"). Symmetric position, asymmetric semantics.

Also removed when the button was added: the script-level double-click detector (`lastCanvasClick` state plus `DBLCLICK_WINDOW_MS` / `DBLCLICK_SLOP_PX` constants) that worked around the browser's native `dblclick` being unreliable on Stadiæ's canvas. That detector's complexity is no longer justified — canvas clicks are pure single-click-to-select now.

### 14.7 Warning-badge system

Because a component's state machine uses interfaces for its transition messages, the system diagram's wiring should agree with what the state machines actually use. Stadiæ surfaces the mismatch advisory-only:

- **Interfaces list, in component view.** Non-default interfaces are dimmed when not wired to the active component (`.unwired` class) — a hint that they are out of scope. When an unwired interface is actually used by one of the active component's transitions, the entry switches to a warning style (`.unwired-warning` class) with a circular amber `!` badge. Tooltip text explains the inconsistency.
- **Transitions table, in component view.** Rows whose interface is non-default and not wired to the active component render with an extra `!` marker in the first indicator column (via a `::after` pseudo-element on the existing `.action-dot` cell). Both the action-dot and the warning `!` can coexist for rows that have an action AND use an unwired interface; the column was widened from 18px to 28px to accommodate.

The warnings are *advisory*, not prescriptive — users can continue to work and save regardless. The design alternative ("dim unwired interfaces, allow use with a warning badge") was chosen explicitly during the Phase A design conversation; the stronger alternative ("block unwired usage") was rejected as too rigid for the "sketch, then formalise" workflow this tool supports.

Warnings are not shown in system view — the concept of "wired to the active component" doesn't apply when the active thing is the system diagram itself.

### 14.8 Editing connections

- `actionAddConnection()` is a pattern dispatcher: it looks at the current selection in system view and routes to one of three outcomes — Component+Interface wires a `Model.connections` entry; Handler+Interface wires a `Model.handlerConnections` entry; Component+Handler wires a `Model.handlerCalls` entry. `detectConnectionPattern()` returns the detected pattern (or `null`), `canAddConnection()` is a thin wrapper. Anything else in the selection (a second component, a random message, a pre-existing connection) makes the detector return `null` — the button stays disabled and the keyboard shortcut no-ops.
- `openConnectionDialog(existing)` is shared across all three wiring records. It duck-types the record — `{component, interface}` vs. `{handler, interface}` vs. `{component, handler}` — and relabels the read-only fields accordingly. Connector type and length inputs work the same way in all three.
- `changeTransitionDirectionByKey(direction)` was generalised via an `adjustDirection(obj, sessionKey, direction)` helper, shared between transitions and connections. Arrow keys adjust a sole selected transition or a sole selected connection; repeated ↑/↓ extends the length with session coalescing for undo.
- `actionDelete()` handles `Selection.connections`, `Selection.handlerConnections`, and `Selection.handlerCalls` in a bulk pass. Single-selection-of-one-Component or one-Handler short-circuits to a confirm-first path (both entities own a description and wiring worth pausing for).

### 14.9 Handlers

A **Handler** is a system-level entity parallel to a Component but without a state machine. Handlers represent asynchronous edges to the outside world — socket listeners, queue subscribers, database drivers. They render on the system diagram using PlantUML's `node` shape (3D brick), distinguishing them visually from the flat-rectangle Component shape.

The data model is three arrays plus a nested structure:

- `Model.handlers` — the Handlers themselves, each carrying `{name, displayName, description, functions}`. Names are identifier-safe and unique across `Model.components` ∪ `Model.handlers` (enforced by `isUniqueSystemEntityName`). The `functions` array is empty-by-default and contains the handler's callable API.
- `Model.handlerConnections` — Handler ↔ Interface wiring. Same shape as `Model.connections` but with `handler` instead of `component`. A Handler on an interface is implicitly a sender; there is no send/receive flag on the record.
- `Model.handlerCalls` — Component ⇢ Handler function-call dependencies. No interface involved. Rendered as a dashed arrow pointing at the Handler.

**Handler functions** are the handler's exposed API: a list of `{name, description, parameters}` records where `parameters` has the same shape as `message.parameters` (`[{name, type}]`). Names are identifier-safe and unique within their parent handler (cross-handler duplicates are fine — two different handlers can each expose a `connect`). Descriptions are free-text single-line developer notes. All three fields are documentation only: they never reach PlantUML and don't affect diagram rendering. Functions exist so that when a developer writes a transition's action, they can reference a concrete API with real parameter names.

**Arrow direction on Component-Interface connections is derived, not stored.** When `Model.handlerConnections` contains any entry for a given interface, the generator renders every `Model.connections` entry touching that interface as a directed edge pointing at the Component (the Component is a receiver because there's a sender on the same interface). Without a Handler on the interface, the same Component-Interface line is plain. `interfaceHasHandler(name)` is the oracle the generator calls per connection. This keeps the connection record clean — the user never manually marks direction; it falls out of the wiring topology.

**Cascades.** Renaming or deleting a Handler rewrites `handlerConnections` and `handlerCalls` via `onHandlerRenamed` / `onHandlerDeleted`. Renaming or deleting a Component extends to `handlerCalls`. Renaming or deleting an Interface extends to `handlerConnections`. Rename paths also re-key the corresponding Selection sets (`Selection.handlers`, `Selection.handlerConnections`, `Selection.handlerCalls`) in place, matching the pattern used for Component and State renames. Function renames re-key `Selection.functions` and `Selection.functionParameters` in place for the same reason.

**Mask kinds.** `handler`, `hconn`, `hcall`. Wired through `toggleSelection` and `isRefSelected` so clicks on Handler boxes, Handler-Interface lines, or Component→Handler dashed arrows select the correct record. Functions and function parameters are not on the diagram, so they have no mask entries — they're selected via their list rows.

**Warning-badge system.** Handlers don't participate. Handlers have no transitions, so there's nothing to cross-check. The existing warning system for Component-Interface-vs-transition-usage is untouched.

**Catalogue layout.** The system catalogue is a five-column grid: Components, Handlers, **Functions**, Interfaces, Messages. The Functions column sits between Handlers and Interfaces — its content is filtered by the single selected Handler (parallel to how Messages is filtered by selected Interfaces). The Functions column is structurally like the Messages column: a `.fns-column` flex wrapper holding a `.list-box`, a resize handle (`#resize-handle-fnparams`), and a `.params-panel` (`#fnparams-panel`). The parameters panel is visible only when exactly one function is selected; hiding is via the same `.hidden` class and display-none CSS that the message-parameter panel uses. Both columns share the `.msgs-column, .fns-column` CSS rule — one place to tune column layout.

**Selection architecture for the handler→function→fn-parameter chain.** Three sets: `Selection.handlers`, `Selection.functions` (keys `"Handler:FunctionName"`), `Selection.functionParameters` (keys `"Handler:Function:ParamName"`). The chain is enforced at resolution time: `resolveBoundFunction` requires the parent handler to still be in `Selection.handlers`, so stale function keys left by the "plain-click-deselect an already-selected row" path (which bypasses `clearSelectionForContext`) don't leak. `buildFunctionList` performs analogous orphan-cleanup when no single handler is bound, and prefix-prunes within a bound handler when the user switches handlers. Same defensive patterns the message-parameter chain uses, generalized to three levels instead of two.

**Shared parameter-panel renderer.** Both message and function parameter panels go through `renderParamsPanel(panelId, handleId, placeholderId, tableId, tbodyId, addBtnId, owner, selectionSet, clickContext, keyPrefix)`. This is the entire renderer — `buildParamsPanel` and `buildFunctionParamsPanel` are two-line wrappers that resolve their owner and call it. Similarly `openParameterDialog(owner, existing, kind, ownerContext?)` dispatches on `kind === "message" | "function"` for label text and selection key construction; both add / edit flows share the same dialog. CRUD functions are still split per kind (`addParameter` / `addFnParameter`, `editSelected*`, `deleteSelected*`) — the dispatching is thin at the entry points and the shared code lives in the dialog and the renderer.

**Description panel binding.** `resolveDescriptionTarget()` returns a `{kind, entity, label}` triple. In system view, if exactly one Handler is selected with no Component, the Handler wins; if exactly one Component is selected with no Handler, the Component wins. Functions are *not* bound to the Description panel — their descriptions live inline in the Functions list row (em-dash style), consistent with states, interfaces, and messages. A full Description panel for functions would be over-scoped for single-line developer notes.

### 14.10 System wrapper and font model

The system diagram wraps its contents in an outer PlantUML `component SystemName { ... }` block so the whole diagram carries a visible boundary labelled with the system's name. The wrapper is emitted by `generateComponentDiagramPlantUML` right after the `skinparam` block, closed just before `@enduml`. Inside the wrapper sit the Interfaces, Components, Handlers, Component-Interface connections, Handler-Interface connections, and Component→Handler dependencies — i.e. everything that was previously emitted at top level is now one nesting level deeper. PlantUML allows this nesting across all the shape kinds Stadiæ uses (`component`, `node`, `()`, plain edges, dashed edges).

The wrapper's name uses the same Name + optional displayName convention as components: `Model.systemName` is the identifier-safe PlantUML id (defaults to `"System"`), `Model.systemDisplayName` is free text that may contain `\n` line breaks. When both are set and differ, the emission is `component <systemName> as "<displayName>" { ... }`; when displayName is empty, a plain `component <systemName> { ... }` is emitted. The distinction matters for the PlantUML output's readability when committed to source control.

The wrapper does not participate in the selection-mask render. No `idAssigner` call is made for it, so a click anywhere inside the wrapper's bounds passes through to whichever interior element's mask pixel the click landed on. This is deliberate — the wrapper is a *boundary*, not a selectable entity; it exists to be seen, not interacted with. The system name is edited through the menu, never by clicking the canvas.

Two font sizes are stored on `Model` and emitted as `skinparam`:

- `Model.systemComponentFontSize` (default 12) governs both Component and Handler labels. A single setting, because Components and Handlers are both "boxes" on the same diagram and divergent font sizes would create visual noise.
- `Model.systemInterfaceFontSize` (default 11) governs Interface lollipop labels.

These are intentionally separate from `component.arrowFontSize` and `component.stateFontSize`, which are per-component and apply to the state-machine view only. Changing a system font size doesn't alter any state-machine rendering; changing a per-component font size doesn't alter the system diagram. Keeping the two font domains independent means users can tune each view's typography without bleeding side-effects.

**Menu dispatch.** The menu bar has both a Component menu and a System menu. CSS rules `body.view-component .menu[data-menu="system"] { display: none; }` and its mirror hide one or the other depending on the active view, so exactly one is visible at any time. The Component menu's items (Change name, transition font, state font, Copy transitions…) all act on the active component; the System menu's items (Change name, component/handler font, interface font) all act on the Model-level system settings. Action keys are prefixed (`sys-change-name`, `sys-change-cfont`, `sys-change-ifont`) to keep the dispatch switch unambiguous. The system-rename dialog is `openSystemDialog()`, structurally identical to `openComponentDialog` but writing to `Model.systemName` / `Model.systemDisplayName` instead of a per-component record.

**Save format.** The four fields are emitted only when they differ from their defaults, keeping files that don't customise them byte-identical to before the feature was added. The loader applies the defaults when any field is missing or out of range; the format string stays `stadiae-v3` (the schema gained new optional fields, nothing became incompatible).

---

## 15. Known limitations

- **Public PlantUML server dependency.** Rendering requires the server at `plantuml.com` to be reachable. The export-as-`.puml` path works fully offline.
- **Canvas selection depends on CORS.** If the PlantUML server ever stops sending `Access-Control-Allow-Origin: *`, the mask pixel read becomes impossible in the browser and canvas-click selection silently fails (list-based selection continues to work).
- **No composite/nested states.** The model is intentionally flat; PlantUML supports composite states but Stadiæ doesn't currently expose them.
- **No multi-select on the canvas.** Clicks are single-toggle only; multi-select is only available through the side lists and transition table.
- **Server-side layout.** The user can influence arrow direction and length per transition, but the overall layout is decided by PlantUML. Manual drag-positioning of nodes is not supported.

---

## 16. Pointers for extension

If you want to:

- **Add a new element type** (e.g. an "end" pseudostate): add a flag to `Selection`, a row to the States list in `buildStateList`, emission logic in `generatePlantUML` (both modes — visible with styling, mask with id assignment), a case in `canAddTransition` if it participates in transitions, and a manual section.

- **Add a new per-transition-row field** (like the `action` field): extend the message objects in `Component.transitions[*].messages`, add UI for viewing/editing it below the transitions table (following the Action panel pattern — live save with per-session history via `pushHistory`, suppressed diagram re-renders since it doesn't affect PlantUML), and surface presence in the table via an indicator column or cell.

- **Change visual theming**: edit the CSS custom properties block at the top of `<style>`. The accent colour threads through toolbar hover, selection, primary buttons, the active component chevron, the System button's view-active fill, and the logo — one variable.

- **Add a new menu item**: add `<div class="item" data-action="...">` under the right `<div class="menu">`, then a `case` in the menu click-dispatch switch.

- **Persist across sessions**: the model serialises cleanly via `snapshot()`. Writing that string to `localStorage` on every `pushHistory` and restoring on startup would add autosave without touching the rest of the code.

- **Support offline rendering**: replace `plantUMLImageURL(source)` with a call to a local PlantUML instance (e.g. served via `plantuml -picoweb`), keeping everything else the same. The selection-mask technique works identically as long as the local server sends CORS headers.

---

*This document reflects the design as of the current build. Last updated alongside the multi-component refactor.*
