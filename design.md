# Stadiæ — Detailed Design

This document describes the design and internal architecture of **Stadiæ**, a single-file HTML/CSS/JavaScript state diagram editor that renders via PlantUML. It is intended for developers maintaining or extending the tool. For a user-facing guide, see the in-app **Help → User Manual**. For a project-level overview, see the `README.md`.

---

## 1. Design goals and context

Stadiæ is a graphical front-end for authoring PlantUML state diagrams of functional components. The user works with familiar domain vocabulary — *states*, *choice-points*, *interfaces*, *messages*, *transitions* — while the tool emits clean, version-controllable PlantUML source.

Three top-level goals shaped the design:

**Single-file deployment.** The entire application is one HTML file, no build step, no dependencies beyond a modern browser and network access to a PlantUML server. This rules out bundlers, frameworks, and module systems; it also rules out anything that requires a backend. The trade-off is self-imposed: it makes hosting and distribution trivial, at the cost of keeping everything hand-written. One narrow exception exists: the specification exporter lazy-loads the `docx` library from unpkg.com on first use — still no build step, still no runtime backend, but users who export need network access to unpkg as well as to the PlantUML server.

**Separation of model and presentation.** The editor maintains an in-memory model of the diagram. Any operation that mutates the model re-emits a PlantUML source string from scratch, sends it to a PlantUML server, and displays the returned PNG. The PlantUML source is a pure function of the model (plus a selection highlight overlay). This keeps the rendering pipeline simple and predictable.

**Graphical selection on a server-rendered bitmap.** The editor doesn't render the diagram itself; a remote server does, and the client only receives a PNG. The user nevertheless needs to click on states, choice-points, and transitions directly in the rendered image. This is solved with a secondary "selection mask" rendering — see §7.

---

## 2. Code organisation

The single HTML file is organised as three logical layers:

```
┌─────────────────────────────────────────────────────────────┐
│ <style> ... </style>            — Presentation (CSS)        │
├─────────────────────────────────────────────────────────────┤
│ <body>                          — Structure (HTML)          │
│   menubar / toolbar / main / modal-overlay                  │
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

A Stadiæ file holds one or more **components** (independent state machines) plus **device-wide** interfaces and messages that every component shares:

```js
Model = {
  // Device-wide (shared across components)
  interfaces: [ {name, isDefault, description} ],
  // Messages carry a list of parameters — free-text records that are
  // documentation-only (never reach PlantUML) but appear in the spec
  // export's message table. Each parameter has a name (single-word
  // identifier, unique within the message), optional type, and
  // optional description.
  messages:   [ {interface, name, isDefault, description,
                 parameters: [ {name, type, description} ]} ],
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
      // Per-component state variables — documentation-only records
      // that round-trip in the save file and appear in the spec
      // export, but never reach PlantUML. Name is a single-word
      // identifier unique within the component. Type and description
      // are free-text and may be empty.
      stateVariables: [ {name, type, description} ],
      // Per-component constants — named values referenced by name in
      // action text (e.g. "Start the timer with the ADVERTISEMENT
      // interval"). Free-text `value` field — no type discipline so
      // the user can put whatever notation fits the domain.
      // Documentation-only; never reach PlantUML.
      constants: [ {name, value, description} ],
      // Per-component local functions — reusable action snippets
      // referenced by name from transition action text. Take no
      // parameters; access the component's state variables by
      // closure. Documentation-only: never reach PlantUML, round-trip
      // in the save file, appear as a table in the spec export.
      // Two independent free-text fields:
      //   - description: short one-line summary of the function's
      //     purpose (the same role as a state variable's description).
      //   - steps: multi-line body describing the actual steps in
      //     execution order. Edited live in the Steps panel below
      //     the Local functions list. Newlines preserved end-to-end
      //     (dialog input → JSON save → spec export cell).
      localFunctions: [ {name, description, steps} ],
      // Optional multiplicity marker. Free-text — typical values are
      // short symbols like `N`, `NUM`, `i`. When non-empty, the
      // device-view PlantUML wraps this component's `component …`
      // declaration in a `rectangle <name>xN as "<value>" { … }` so
      // the device diagram visually flags that several instances of
      // the component exist at runtime. Empty (the default) = no
      // wrapping. Documentation-only beyond that visual: state
      // machines, connections, handler calls, the spec export's
      // tables — none of them change. Handlers don't have this
      // field; multiplicity is a property of the components that own
      // a state machine.
      multiplication: String,
      transitions:  [ {source, target, messages, connector, length} ]
    },
    ...
  ],
  activeComponentIndex: Number,
  // Device-level component diagram — see §14. Each entry wires one
  // component to one non-default interface. Connector direction/length
  // use the same vocabulary as transitions but without arrowheads.
  connections: [
    { component: String, interface: String,
      connector: "Right"|"Left"|"Up"|"Down", length: Number }
  ],
  // Handlers — device-level entities parallel to Components but with no
  // state machine. Represent asynchronous edges to the outside world
  // (sockets, queues, DB drivers). Render as 3D-brick `node` shapes on
  // the device diagram. Name is identifier-safe and unique across
  // Components ∪ Handlers. Functions are the handler's callable API
  // — documentation-only, never reach PlantUML. Each function has
  // identifier-safe name (unique within its handler), optional
  // description, and a list of parameters with the same shape as
  // message parameters.
  handlers: [
    { name: String, displayName: String, description: String,
      functions: [
        { name: String, description: String,
          parameters: [ {name, type, description} ] }
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
  // Device-level settings. The device diagram nests everything inside
  // an outer `component DeviceName { ... }` wrapper so it carries a
  // visible boundary labelled with the device's name. Name + displayName
  // follow the same convention as components. The two font sizes apply
  // only to the device diagram; per-component font sizes
  // (arrowFontSize, stateFontSize) apply only to the state-machine view.
  deviceName: String,            // identifier-safe, default "Device"
  deviceDisplayName: String,     // optional free text (may include `\n`)
  deviceComponentFontSize: Number, // Component + Handler labels, default 12
  deviceInterfaceFontSize: Number, // Interface lollipop labels, default 11
  // Free-text device specification. A developer-facing document that
  // describes the device as a whole. Lives on Model (one per file),
  // persisted in JSON, never written to PlantUML. Edited via the
  // Device Specification panel below the canvas.
  deviceSpecification: String,
  // Device-wide type definitions. Reference material describing the
  // domain types used in parameter and state-variable type fields.
  // Documentation-only; never enforced or emitted. Each entry has a
  // single-word identifier-safe name (unique across types,
  // components, handlers, and non-default interfaces), an optional
  // description, and a free multi-line specification. The HTML and
  // docx specs render these as a Type definitions chapter at the
  // end of the document; parameter and state-variable type cells
  // auto-link to the matching type when the cell's string exactly
  // equals a defined type name.
  types: [ {name, description, specification} ],
  // Which view the canvas is rendering: "component" shows the active
  // component's state machine, "device" shows the component diagram.
  activeView: "component"|"device",
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

- **Interfaces and messages are device-wide.** They live on `Model` rather than in each component. Every component references the same interfaces and messages by name. Rename/delete of an interface or message cascades to every component's transitions — see the cascade-handling in `openInterfaceDialog`, `openMessageDialog` and `actionDelete`. This models the real-world semantic: an interface like `RTx` is a contract between components, not a per-component detail.

- **States, choice-points, and transitions are component-local.** A transition cannot reference a state in another component — transitions always stay within the component that owns them.

- **Components have `name` plus optional `displayName`.** Same convention as states. `name` is identifier-safe and stable (it's what `Model.connections[*].component` refers to, what mask-id keys are built from, what `Selection.components` stores). `displayName` is free text shown on the rendered diagram (device-view component box, state-machine outer wrapper) and may contain `\n` markers that PlantUML interprets as line breaks. The Components list shows the display label with `\n` collapsed to spaces, so the entry stays single-line. When `displayName` is empty, the canvas falls back to `name`. Files saved before this split stored free text directly in `name`; the loader migrates them by slugging the original into a valid `name` and promoting the original text to `displayName`. Connections referring to the old name are re-keyed via a rename map built during the migration. See §4.3.

- **Choice-point names don't include `CP_`.** Users enter `Whitelisted`, the model stores `Whitelisted`, but every appearance in PlantUML is rewritten as `CP_Whitelisted`. Inside transitions, however, the prefix is already baked in — `t.source === "CP_Whitelisted"`. This asymmetry is intentional: it keeps the user-visible names clean while mapping unambiguously to PlantUML tokens.

- **Transitions are "arrows", not "messages".** Multiple messages on the same source→target pair are grouped into a single transition with a `messages` array. This matches how PlantUML renders them (one arrow with stacked labels) and how the user thinks about them.

- **Special transition endpoints.** `source === "START"` means the initial transition. `target === "[H]"` means a history-target transition. `source === "*"` means an ANY (wildcard) source. These sentinels are recognised throughout the emitter and the delete/cleanup code.

### 3.2 `Selection`

Everything the user has currently marked. It drives the canvas highlighting, the right-panel list highlights, the transition-table row highlights, and all toolbar-button enablement rules.

```js
Selection = {
  states:         Set<name>,
  choicePoints:   Set<name>,
  stateVariables: Set<name>,           // per-component documentation rows
  constants:      Set<name>,           // per-component named values
  localFunctions: Set<name>,           // per-component action snippets
  interfaces:     Set<name>,
  messages:       Set<"iface:name">,
  transitions:    Set<"src|tgt|iface|msg">,  // per-message granularity
  start:   Boolean,   // START dot selected
  history: Boolean,   // H pseudostate selected
  any:     Boolean,   // * pseudostate selected
  // Click-order record across states, choice-points, and pseudostates.
  // Populated as {kind, id} on every toggle-to-selected, dropped on
  // toggle-to-deselected, pruned in clearSelectionForContext so it
  // only ever contains entries whose underlying node is still
  // selected. Consumed by actionAddTransition to pick a source
  // direction when two nodes are selected (earlier click = source),
  // making the explicit "which is the source?" dialog unnecessary
  // in the common case.
  nodeOrder: Array<{kind, id}>,
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

Only one component is *active* at a time. The canvas, the States and Choice-points lists, the transitions table, and the Action panel all reflect the active component. The **Components list** in the top-right device catalogue selects which component is active — clicking a row calls `switchToComponent(idx)` and a small chevron `▸` marks the active row. Two floating buttons on the canvas handle the view-switch: a `◇ Device` button at the top-left switches to the device view, and (in device view) a `Component ▸` button at the top-right enters the currently selected component's state machine. In device view no row is marked active because the canvas is showing the device diagram, not any single component's state machine.

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
- **Delete** (`deleteSelectedComponent` and friends): triggered by clicking the Components list's `−` button (per-list scope), or via the global Delete keyboard shortcut when the selection narrows to deletable items only. Confirmation dialog quotes the display label, not the identifier (more readable). Removes the component, adjusts `activeComponentIndex` so the UI stays on a valid component, and calls `onComponentDeleted` to prune any matching connections. Deletion is blocked when only one component remains — the file must always have at least one. The global `actionDelete` short-circuits to the per-component flow when the selection contains exactly one component and nothing else, since deleting a whole state machine warrants its own confirm-first handling distinct from the bulk-delete path used for states and transitions.
- **Switch** (`switchToComponent`): sets `activeComponentIndex`, sets `Model.activeView` to `"component"`, clears selection, triggers a refresh.

All four push a history snapshot before mutating so undo correctly restores component order, names, display names, and the active-component pointer. Component-name uniqueness is essential because mask-id keys (`"comp:" + name`) and connection-cascade lookups all assume it; the validator at every entry point keeps the invariant holding.

**Migration of pre-displayName files.** Earlier v3 saves (from before the Name/Display-name split) stored arbitrary text (including `\n` markers and spaces) in `name`. The loader (`loadModel`) walks `data.components` and, for any entry whose `name` isn't a valid identifier, slugs the original via `slugifyComponentName` (replace non-identifier chars with `_`, prepend `C_` if it doesn't start with a letter), promotes the original text to `displayName` if no displayName was already supplied, and disambiguates slug collisions with `_2`, `_3`, etc. A `renameMap` tracks any `oldName → newName` rewrites; `data.connections` is rewritten through that map before being loaded. The result is byte-identical visible output (the canvas renders displayName) with a clean, reference-stable `name` underneath.

### 4.4 Exports operate per-active-component

PlantUML, PNG, and Markdown exports use whatever the active component is at the time. To export every component, the user switches the active component (one click in the Components list) and exports each one. The file-level save operation (`.json`) is the only one that covers the full file (all components, the shared vocabulary, and the device diagram).

---

## 5. The refresh pipeline

Any change to the model or selection calls `refresh()`, which rebuilds the UI. Conceptually:

```
refresh()
  ├── document.body.classList toggle  — view-device / view-component
  ├── buildComponentList()     — one row per component, chevron on active
  ├── buildStateList()         — repopulate <ul> for States (+ START, H, *)
  ├── buildCPList()            — repopulate <ul> for Choice-points
  ├── buildInterfaceList()     — repopulate <ul> for Interfaces (device-wide)
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

### 6.4 ANY-message wildcards

The ANY-message wildcard is a *message* whose name is `*`. Two flavours coexist, distinguished by the interface field:

```js
{ source: "Idle", target: "Error", messages: [
  { interface: "*", name: "*" },                 // global wildcard
  { interface: "Connection", name: "*" },        // per-interface wildcard
  { interface: "Connection", name: "Disconnect" }
]}
```

Semantics. The **global wildcard** `*:*` matches any message arriving in the source state that isn't handled by another transition. The **per-interface wildcard** `Iface:*` matches any message on the named interface that isn't otherwise handled in the source state. The two compose: explicit messages take precedence over the per-interface wildcard within their interface, which takes precedence over the global wildcard. So with `Connection:Connect`, `Connection:*`, and `*:*` all leaving the same source state: a `Connection:Heartbeat` hits the per-interface fallback, a `Storage:WriteComplete` hits the global fallback, and `Connection:Connect` goes through the explicit transition.

In the model, neither wildcard pair corresponds to a real message record — `Model.messages` knows nothing about them. The global wildcard's interface is also not a real interface — `Model.interfaces` doesn't list `*`. The per-interface wildcard's interface field, by contrast, **is** a real interface name; its message name (`*`) is the only fictional part. Rename cascades to the interface field already work because the existing interface-rename pass walks every transition's messages array and updates the `interface` field for any matching entries — `Connection:*` automatically becomes `Conn:*` when `Connection` renames.

Both wildcards are recognised by renderers (PlantUML, transition table, spec output) via an explicit `m.name === "*"` check. The global wildcard adds the further check `m.interface === "*"`; the per-interface wildcard's interface field passes through normal interface-related logic (auto-link, wiring warning, alphabetical sort, etc.) since it's a real name.

The Messages list shows the global wildcard as a special pseudo-row at the top — always visible regardless of interface selection — and a per-interface wildcard pseudo-row for each selected non-default interface, in alphabetical order. Selection keys are the literal strings `"*:*"` and `"Iface:*"`. Validation:

- At most one global wildcard per source state, and at most one per-interface wildcard *per interface* per source state. Both enforced by `sourceAlreadyHandlesAnyOf`'s exact-match check on `(interface, name)` — duplicate sentinels are caught the same way as duplicate specific messages.
- Cannot be sourced from a choice-point (CPs only emit Yes/No).
- Cannot be mixed with Yes/No on the same transition (CP-vs-state sources are mutually exclusive). The validator's `hasAnyMsg` flag — `msgs.some(([_, n]) => n === "*")` — catches both flavours.

PlantUML emission: the alias step is skipped for any message whose name is `*`. The global wildcard emits the literal `*`; the per-interface wildcard emits the literal `Iface:*`. Bold and red highlighting still apply when selected/matched.

Wiring warnings: the row's `iface` field is checked against `"*"` to suppress the warning for the global wildcard only — its interface isn't a real one to wire. The per-interface wildcard's interface IS real and goes through the standard `isWired` check, so `Connection:*` on a transition correctly warns if `Connection` isn't wired to the active component.

Spec rendering. For the global wildcard, both Interface and Message cells render as plain text `*` because `idx.interfaces.get("*")` returns undefined. For the per-interface wildcard, the Interface cell auto-links to the interface (lookup hits) while the Message cell renders as plain `*` (lookup misses on `*` message name). No special cases needed in the spec emitter beyond what was already there.

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

Editing has the same per-list / global split as Delete (§8.4). Each list has its own `✎` button that operates on items selected in that list only; pressing <kbd>Enter</kbd> triggers the global edit dispatcher (`actionEdit`) when the selection uniquely identifies a single editable thing.

The global `canEdit()` predicate (used by the Enter shortcut) returns true when exactly one editable thing is selected:

- one state (not START), one choice-point, one component, one handler;
- one non-default interface, one non-default message;
- one function, one parameter (function or message);
- one state variable, one constant, one local function;
- or every row of exactly one transition (and no rows of any other).

The last case is subtle: if a user selects individual message rows from two different transitions, or one row from a transition plus a state, Edit is disabled because the selection doesn't uniquely identify one transition to edit. Transition editing mutates connector type/length, which is a property of the whole arrow — not of individual messages.

The earlier toolbar Edit button was removed for the same reason as the toolbar Delete (§8.4) — when the selection spans multiple lists, the action's scope was hidden behind invisible dispatch rules. The per-list `✎` buttons make scope explicit by tying the action to the list whose button you click. The Enter shortcut is preserved as the keyboard-driven multi-list path; the keyboard contract implicitly trusts the user to know what's selected.

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
- Deleting a component drops every connection and handler-call referencing it.
- Deleting a handler drops every handler-connection and handler-call referencing it.

The earlier toolbar Delete button was removed because it became confusing once selections could span multiple lists — a click on "Delete" wouldn't make it visually clear *which* list's selection was being acted on. The button was replaced with **per-list `−` buttons** in each list header, mirroring the existing `+` add buttons. Each list's button reads only its own Selection set, so the action's scope is never ambiguous: clicking the Components header's `−` deletes the component(s) selected in that list, ignoring whatever might be selected in States or Messages.

The keyboard shortcut <kbd>Delete</kbd> / <kbd>Backspace</kbd> remains and uses the global `canDelete()` predicate (extracted from what was previously inlined in `refresh()` for the toolbar button's disabled state). Keyboard shortcuts have an implicit "user knows what they have selected" contract — they don't need the same scope-advertising the visible button did. The shortcut routes through `actionDelete()`, which is the same multi-list dispatcher the toolbar button used to invoke.

Per-list editors / deleters: every list has its own `editSelected{Type}` and `deleteSelected{Type}` function that operates only on its corresponding Selection set. Six were added in this refactor (Components, Handlers, Interfaces, Messages, States, Choice-points); six already existed (Functions, function parameters, message parameters, State variables, Constants, Local functions). Per-list edit buttons (`✎`) enable on exactly-one-selection-of-the-right-type; per-list delete buttons (`−`) enable on at-least-one-selection, with default and pseudo entries excluded from the count. The disabled-state computation lives in `refresh()` alongside the existing button-state logic.

### 8.5 Save

A single, simple predicate: enabled only when the file has been saved at least once (`Model.savedFilename !== null`) **and** there are unsaved edits (`Model.dirty === true`). Save As is always available.

### 8.6 Keyboard-driven editing

Global shortcuts (Ctrl+N/O/S/Z/Y, Delete/Backspace) are wired in one document-level `keydown` handler that first checks `e.target.tagName` and bails on `INPUT`, `SELECT`, or `TEXTAREA` so typing in dialogs and the Action panel never triggers a shortcut.

**Arrow keys change transition direction.** When exactly one transition is fully selected and nothing else is selected, the four arrow keys change its `connector` to `Left`/`Right`/`Up`/`Down`. For `Up` and `Down`, repeatedly pressing the same key extends the arrow's `length` by one dash per press — a fast way to spread two arrows apart when PlantUML's auto-layout overlaps them, without opening the Edit dialog.

Self-transitions are fixed at `->` per the design spec, so arrow keys are ignored on them.

**Undo coalescing.** A module-level `arrowKeySession = {key, direction}` tracks whether the last arrow press was for the same transition and same direction. If so, no new history snapshot is taken — the whole "Up Up Up" sequence collapses into a single undo step. Changing direction, switching transitions, or pressing any non-arrow key ends the session. `refresh()` also ends the session when the selection changes, to keep the undo history clean.

### 8.7 Click-order direction inference for transitions

`Add Transition` with two nodes selected used to always ask a confirmation dialog for direction (which node is the source, which is the target). For the common state+state case this was pure friction — the user had already communicated direction by clicking the source first.

The fix is a small auxiliary data structure on the `Selection` singleton: `nodeOrder`, an array of `{kind, id}` entries recording the click sequence across states, choice-points, and the START/history/ANY pseudostates. Population:

- Every selection-toggle that adds a node appends a `{kind, id}` entry.
- Every selection-toggle that removes a node filters the matching entry out.
- `clearSelectionForContext` runs its usual per-context clears, then calls `Selection.pruneNodeOrder()` which drops any entries whose underlying Set/boolean is no longer "selected". This keeps the array synchronized through plain-click replacement semantics (single-select within a panel).
- `clearAll()` wipes it unconditionally.

The tracker is maintained at the selection-site boundary — wherever `Selection.states.add(n)` / `Selection.choicePoints.delete(n)` / `Selection.start = false` are called, a matching `noteNodeSelected` / `noteNodeDeselected` call runs alongside. Centralising via a proxy or a dedicated `setSelected` helper was considered and rejected: the selection sites aren't numerous enough to warrant the abstraction, and keeping the mutation pair co-located at each site makes the invariant easy to audit.

`actionAddTransition` consumes `nodeOrder` in the two-node branch:

1. Apply the existing structural validity filter (CPs can only source Yes/No; states cannot source Yes/No; the "source already handles these messages" guard).
2. If exactly one direction is valid structurally, use it — unchanged from before.
3. If **both** directions are valid, consult `nodeOrder`. The node with the lower index in `nodeOrder` is the source; the other is the target. No dialog.
4. If **neither** direction is valid (both fail the structural filter, typically because both candidate sources already handle one of the selected messages), fall back to the dialog. The user sees the explicit "pick a source" choice rather than a silent no-op.
5. If click-order lookup fails for some reason (neither node is in `nodeOrder`, or both map to the same index), also fall back to the dialog. This is a last-resort safety valve; in practice every two-node selection produced through normal clicking has distinct, well-defined entries.

**`nodeOrder` is not part of `snapshot()` and doesn't undo/redo.** Undo restores model state, not selection history. The next transition-add populates `nodeOrder` from fresh clicks regardless of what it held before — the tracker is transient working memory, not persistent application state.

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

The Action panel is a free-text editor **beside** the transitions table (to its right, on the same row) that lets developers document what the component does when a specific transition fires. Actions are stored per transition message row — one per `(source, target, interface, name)` tuple — and are persisted only in the saved JSON; they are intentionally **not** written into the generated PlantUML so the diagram itself stays uncluttered.

The panel and the transitions table share the bottom portion of the right column. They're wrapped in a horizontal flex container (`.trans-action-row`) with a draggable resize handle between them. Action has a fixed `300px` CSS default width; Transitions takes the remaining row width via `flex: 1`. Dragging the handle reallocates between them — the drag computes both widths so the sum stays equal to the row's available width minus the 12px handle footprint. The handle is independent of the resize handle in the lists-grid above (between the State variables/Constants column and the Local functions/Steps column); each resize affects only its own row. An earlier design coupled the two, with the Trans/Action boundary auto-tracking the lists-grid's lfns-column width to keep the columns visually aligned. In practice the alignment was cosmetic, not functional, and the cross-row coupling produced surprising effects when the user dragged either handle — so the rows were decoupled.

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
- **Binding rule.** `resolveDescriptionTarget()` picks the component whose description the panel reflects. In component view, always the active component. In device view, the selected component if `Selection.components.size === 1`, otherwise the active component. The header carries an italic suffix showing the bound component's display label so the user always knows what they are documenting.
- **Layout.** The panel sits *between* the device catalogue (top of the right panel) and the `.component-panel` (everything else). Default height 100 px. In device view, where `.component-panel` is hidden by CSS, the description panel grows to fill via `flex: 1 1 auto`; the resize handle below it is also hidden, since there is nothing below to resize against.

The Components list shows a small accent-coloured dot at the right of any row whose component has a non-empty description — same visual weight and convention as the action-dot in the transitions table, so users learn one pattern and recognise it everywhere.

The component-rename cascade re-keys the textarea's `dataset.compName` on the next refresh — the input handler reads the bound name from the dataset rather than capturing it in a closure, so a rename mid-typing-session correctly continues writing to the renamed component (the rename is a model mutation, not a re-binding).

### 10.6 The Device Specification panel

A third textarea-based panel — the **Device Specification panel** — lives below the canvas in a column flex wrapper (`#canvas-column`) that holds the canvas, a horizontal resize handle, and the panel. The panel is *always visible in both views*: it documents the device as a whole, independent of which component or diagram is on screen, so it earns a persistent slot rather than floating in the view-scoped right column.

The binding is the simplest of the three panels: one `Model.deviceSpecification` string, no selection logic, no placeholder mode, no has-description dot. `initDeviceSpecPanel()` wires the textarea's `input` handler to live-save into `Model.deviceSpecification` with a per-session history coalescer (`sysSpecEditSession.pushed` tracks whether the first keystroke of the current session has already pushed history); `blur` resets the session. `renderDeviceSpecPanel()` — called from every `refresh()` — syncs the textarea's `.value` from the model, guarded against re-writing the same value to avoid disrupting cursor position when a refresh happens mid-type.

The panel is a sibling of `#canvas-panel` under `#canvas-column`, with a draggable `#resize-handle-sysspec` between them. The handle's drag math is inverted from a "pull handle down" gesture because the handle is at the *top* of the panel — dragging up grows the panel (by subtracting `e.clientY - startY` from `startH`); min/max clamps leave a ~200 px floor for the canvas. The existing horizontal main-split slider (`#resize-handle-main`) now operates on `#canvas-column` rather than on `#canvas-panel` directly, so resizing the split changes the width of the whole column (canvas + spec panel together).

Persisted via `buildSerializedModel()` only when non-empty; loaded with a string-type fallback defaulting to `""`. Round-trips through `snapshot()`/`restore()` like every other field on `Model`, so undo/redo over a typing session behaves exactly like undo/redo on Description or Action text.

### 10.7 The Steps panel (local function bodies)

The **Steps panel** is a fourth textarea-based panel, structurally a twin of the Action panel but bound to a local function instead of a transition message row. Each local function carries two independent free-text fields: a single-line `description` (short purpose summary, same role as a state variable's description) and a multi-line `steps` field holding the actual step-by-step body. The Steps panel edits `steps`; `description` is a separate one-line field edited via the Add/Edit dialog.

This split emerged from UX feedback: a single combined field had to pull double duty as both summary and body, which made the list-row preview awkward (first line of a multi-line body is rarely a good summary) and the spec export ambiguous (one column to show both "what it is for" and "what it does"). Two fields read more naturally everywhere:

- **In the list row:** `name — description` matches state variables exactly, with the short summary being a proper one-liner.
- **In the dialog:** Name + Description, like state variables and handler functions.
- **In the Steps panel:** a dedicated textarea for the body, no summary text competing for the same space.
- **In the spec export:** three distinct columns — Name | Description | Steps — with only the Steps column preserving newlines.

**Layout.** The panel sits *inside* a new per-column wrapper `.lfns-column` in the top lists row — same pattern used for `.msgs-column` and `.fns-column`, which both split a list-box stacked above a `.params-panel`. The Local functions column is structurally:

```
.lfns-column
  └ .list-box            (Local functions list, flex: 1 1 auto)
  └ #resize-handle-steps (draggable divider; horizontal-drag)
  └ .steps-panel         (flex: 0 0 140px, user-resizable)
```

When no local function is bound, the panel and its top resize handle carry the `.hidden` class (`display: none`); the list-box then reclaims the column via its own `flex: 1`, giving the Local functions list the full column height as if no panel existed.

**Binding and visibility.** Parallel to Action panel semantics: visible only when exactly one local function is selected. Zero or multiple selections → placeholder shown on the panel header's sibling element, textarea hidden. The `.hidden` class on the outer panel handles the "nothing bound" case by removing the panel from the layout entirely, so the column doesn't show an empty-but-present placeholder block; the Parameters panels use the same idiom.

**Live save + session coalescing.** `stepsEditSession = { key, pushed }` mirrors `actionEditSession`. First keystroke in a session pushes history; subsequent keystrokes mutate `lf.steps` directly; blur ends the session. `scheduleDraftSave()` + `Model.dirty = true` + `updateToolbar()` run on each mutation for autosave + Save-button state. No list rebuild (the list row shows `description`, not `steps`) and no diagram re-render (local function content, like actions, never reaches PlantUML).

**No parameter list.** Local functions take no parameters by design (they close over state variables), so unlike the Messages and Functions columns there's no Parameters sub-panel. The column's second element is directly the Steps editor.

**Dialog carries Description only.** The Add/Edit dialog asks for Name and Description. Steps live in the panel; putting them in the dialog too would duplicate the editing surface for that field. A newly created function starts with empty steps and is auto-selected so the Steps panel opens on it ready to type. The Edit path touches name and description; step-body changes happen live in the panel. No auto-migration: when loading a file from before the description/steps split, whatever was in `description` stays in `description` — the user can move it to `steps` manually in the rare case the old content was actually step-body text.

### 10.8 Live backtick rendering

The four free-text panels (Device Specification, Description, Steps, Action) all contain backtick-delimited cross-references that render as hyperlinks in the spec export. Originally the editor showed only the raw backtick form — the user had to open the spec preview to see whether their references resolved. The live-rendering layer changes that: when a panel loses focus, a styled overlay replaces the textarea, showing the cooked form (backticks consumed, resolved references in monospace + accent color, unresolved references as plain monospace). Click the overlay or focus the textarea (e.g. via Tab or click on the panel area) to swap back to editing.

**Architecture.** The pattern is a focus-driven swap, chosen over (a) contenteditable with inline styled spans (cursor positioning is the classic contenteditable pain point, plus pasting + IME composition lose their native fidelity) and (b) an always-rendered overlay layered on top of the textarea (font-metric drift between the two layers breaks the illusion at any zoom level). The swap loses one round-trip click for the user but preserves textarea behavior entirely while editing.

**Rendering helper.** `renderLiveBackticks(text, context, idx)` mirrors `renderProse` but emits `<span class="live-ref">` for resolved references (with `data-tooltip` carrying the description) and `<span class="live-ref-plain">` for unresolved (plain monospace, no styling cue, no tooltip). Newlines are kept as `\n` (not `<br>`) since the overlay container uses `white-space: pre-wrap` for textarea-faithful rendering. The resolver is the same `resolveSpecReference()` used by the spec export — single source of truth for what counts as a valid reference.

**Wiring.** `attachLiveBacktickRendering(textarea, getContext, placeholder)` creates a sibling `<div class="live-render">` placed in the same flex slot as the textarea, manages show/hide via focus/blur listeners, and exposes two methods on the textarea object: `refreshLiveOverlay()` (re-render against current value) and `hideLive()` (hide both elements; used by the panel rebuild paths when there's no binding). The `getContext` callback is called per-render and returns the reference-resolution context for the field — this varies per panel: Device Specification uses `{kind:"device"}`, Steps uses `{kind:"component", componentName:Component.name}`, Description reads from the textarea's dataset (set by `buildDescriptionPanel`), Action includes `rowMessage` so the per-row `Msg:Param` shortcut resolves correctly.

**Refresh discipline.** The textarea's `.value` can change from many sources: user typing, undo/redo, file open, draft restore, panel rebinding to a different entity. The pattern is: any code path that programmatically reassigns `.value` must also call `refreshLiveOverlay()`, even when the value didn't change — the binding could have changed (e.g. clicking between two local functions whose Steps content happens to match) and the overlay's previous "I'm visible" state needs re-evaluation against the current visibility rules. The rules: empty content → textarea visible (placeholder shows), active focus on textarea → textarea stays visible, otherwise → overlay renders and shows.

**Esc-to-blur.** Each managed textarea has a keydown listener that calls `textarea.blur()` on Escape. This is a UX shortcut — the user types backtick references, hits Esc to "step back" and see them rendered without reaching for the mouse. Since edits are always live (typing immediately mutates the model), Esc doesn't need to handle "cancel my changes" semantics; it just exits the editing context. The event is `preventDefault`+`stopPropagation` so it doesn't bubble to the modal-close handler, which it wouldn't anyway since these textareas live in the main editor surface, not in modals.

**Tooltip mechanism.** `installLiveTooltipHandlers()` (called once at startup) ports the spec's hover-tooltip script to the editor. A single `<div class="live-tooltip">` element is appended to body; document-level `mouseover`/`mouseout` listeners filter to `.live-ref[data-tooltip]` via `.closest()` and show the tooltip with a 250ms delay. Position defaults to 6px below the span, flipping above when near the viewport bottom. The visual style mirrors the spec's `.ref-tooltip` rule for consistency — editor and spec output share the same hover idiom.

**The type-spec textarea is intentionally excluded.** That field lives inside the Type Definitions edit modal, where the focus-driven swap would feel jarring (the user is in a focused editing context; a swap to "cooked" view inside a modal contradicts the "I'm editing now" affordance the modal provides).

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

Files are saved as JSON with a top-level `format: "stadiae-v4"` tag. `buildSerializedModel()` emits the full file — every component, every handler, every shared interface/message, all wiring (Component-Interface connections, Handler-Interface connections, Component→Handler call dependencies), every description and action note, and the device-level settings (device name and font sizes). Defaults like `Timer:Timeout` on the messages list are re-synthesised on load, so only user-defined entries go to disk. Optional fields (displayName, description, handlers[], handlerConnections[], handlerCalls[], deviceName, deviceDisplayName, deviceComponentFontSize, deviceInterfaceFontSize) are written only when they diverge from their defaults — files that don't use a feature stay byte-minimal.

**Format tolerance.** The loader rejects anything other than `format: "stadiae-v4"` with a clear error. Within v4, every post-initial field is optional: a file without a `handlers` array loads with `Model.handlers = []`; a file without `deviceName` loads with the default `"Device"`. This schema tolerance is *forward*-compat — a v4 file from any point in v4's history loads cleanly — not backward-compat across format versions. The pre-v4 formats (`stadiae-v1`, the old single-component format, `stadiae-v2`, the first multi-component format, and `stadiae-v3`, the previous System-vocabulary format) are no longer supported; files saved under those tags must be loaded in an older build of Stadiæ and re-saved.

Save/Save-As uses a `showPrompt` for filenames rather than the native `<input type="file">` save dialog (which browsers don't expose to JS). The file is generated as a `Blob` and downloaded via a programmatic `<a>` click. Open uses a hidden `<input type="file">` triggered by the menu item; the user's selection is read with `FileReader` and parsed.

The "unsaved edits" dialog gates both New and Open — if `Model.dirty`, the user is asked to confirm discarding.

### 12.2 Export — PlantUML and PNG

Export as `.puml` writes the clean (unselected) PlantUML source of whatever is currently showing on the canvas to a text file — suitable for committing to source control or pasting into any PlantUML renderer. Actions, the per-render salt comment, and selection styling are all absent; the file contains only the reproducible diagram structure.

Export as `.png` re-renders the clean source via the public server, fetches the resulting image as a blob, and downloads it. Both exports always run with `withSelection: false, includeSalt: false` so the user's on-screen red highlighting and the per-render salt comment are never baked into the output.

The exporter dispatches on `Model.activeView`: in component view it calls `generatePlantUML` (the state-machine generator, scoped to the active component); in device view it calls `generateComponentDiagramPlantUML` (the device-level generator, covering the whole component/handler/interface topology). Default filename is derived from the active component's name or — in device view — the device's display name. To export every component of a multi-component file, switch the active component (one click in the Components list) and export each one; to export the device diagram, switch to device view and export.

### 12.3 Export — Transitions as Markdown

Under *Component → Copy transitions as Markdown table…*, `buildTransitionsMarkdown()` walks `Component.transitions` (the active component), flattens each transition into one row per message (initial transitions produce a single message-less row), sorts by the on-screen display labels, and emits a markdown table with columns **Source**, **Target**, **Interface**, **Message**, **Action**.

Source and target cells use `nodeLabel` for consistency with the transition table — state display names, choice-point questions, and the pseudostate symbols `●` / `H` / `∗` — not the raw identifiers. Escaping rules keep the output well-formed: pipes `|` become `\|`, and both literal `\n` sequences and actual newlines inside display names or actions become `<br>` so each cell stays on one markdown row.

The markdown text is shown in a read-only textarea inside a modal dialog. A **Copy to clipboard** button uses `navigator.clipboard.writeText` where available, falling back to `document.execCommand("copy")` on the already-selected textarea for contexts where the modern API is blocked (e.g. non-HTTPS).

### 12.4 Export — Specification as Word document

The most elaborate export: a full device specification as a `.docx`. Entry point is `File → Export Specification…`, implementation in `exportSpecification()` + `buildSpecificationDocx(d, progress)`. See §15 for the full design — the short version is that it lazy-loads the `docx` library from unpkg.com on first use, fetches every diagram in parallel as both SVG (primary) and PNG (fallback), and assembles a native Word document with proper headings, tables with row-span and fixed column widths, and embedded vector diagrams.

Unlike the .puml and .png exports which operate on the currently-visible canvas, the specification export operates on the **whole model** regardless of the active view or component. The output always covers every component, every handler, every interface, every message — one call produces the complete specification.

---

## 13. UI layout and styling

The layout is a standard CSS flex/grid arrangement; no layout framework is used. Structure:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Menu bar (dark chrome)                                               │
├──────────────────────────────────────────────────────────────────────┤
│ Toolbar (dark chrome)                                                │
├────────────────────────────────┬─────────────────────────────────────┤
│ ┌──────────┐    ┌─────────────┐│ ┌── Device catalogue (5 cols) ─────┐│
│ │ ◇ Device │    │ Component ▸ ││ │Comps+│Hdlrs+│Fns+│Ifaces+│ Msgs+ ││
│ └──────────┘    └─────────────┘│ │▸CompA│Rad   │    │ RTx   │       ││
│   (device-view only ─ top-right│ │ CompB│      │    │Storage│       ││
│    when a component selected)  │ │      │      ├────┤       ├───────┤│
│                                │ │      │      │Prms│       │ Prms  ││
│                                │ │      │      │+   │       │   +   ││
│                                │ └──────────────────────────────────┘│
│                                │ ──── resize handle ────             │
│ Canvas panel                   │ ┌── Description (active component)─┐│
│ (rendered PlantUML PNG of      │ │ [ free-text textarea ]           ││
│  the active component, or      │ └──────────────────────────────────┘│
│  the device diagram)           │ ──── resize handle ────             │
│                                │ ┌── Component panel (active) ────────────────┐ │
│  ──── resize handle ────       │ │ States │ Choice-pts │ Vars   │ │ LocalFns │ │
│ ┌── Device specification ────┐ │ │        │            │ Consts │↕│ Steps    │ │
│ │ [ free-text textarea ]    │ │ │        │            │  ↕     │ │   ↕      │ │
│ │                           │ │ ├──────────────────────────────────────────┬─┤ │
│ │                           │ │ │  Transitions table                       │A│ │
│ └───────────────────────────┘ │ │  • │ Src │ Tgt │ Iface │ Msg            │c│ │
│                                │ │                                          │t│ │
│                                │ └──────────────────────────────────────────┴─┘ │
└────────────────────────────────┴─────────────────────────────────────┘
            ↑                                   ↑
            canvas-column                       right-panel
     (canvas + Device spec, stacked)     (catalogue, description, component stack)
     ← horizontal drag slider between the two columns →
```

The canvas panel hosts the rendered diagram plus a small amount of floating chrome — the `◇ Device` button at its top-left (always visible, switches views), the `Component ▸` button at its top-right (visible in device view, enters the selected component), and occasionally a restored-draft banner along the top. Both buttons are absolutely positioned so they persist across the image-replacement cycle that happens on every render. Below the canvas and always visible in both views sits the **Device Specification panel** — a free-text textarea bound to `Model.deviceSpecification`, separated from the canvas by a vertical-drag resize handle.

The right panel is vertically subdivided into three regions:

- **Device catalogue** at the top holds the file's shared vocabulary as five side-by-side lists: Components, Handlers, Functions, Interfaces, Messages. Each list's header has a `+` button to add an entry. A small chevron `▸` on the active row of the Components list shows which component's state machine is currently displayed below. The Functions column is filtered by the single selected Handler (empty otherwise); the Messages column is filtered by the selected Interfaces. Each of those two columns additionally nests a Parameters panel below its list, visible when exactly one function (respectively message) is selected.
- **Description panel** sits beneath the catalogue and is always visible. It binds to the active component in component view, or to the selected component in device view (falling back to active when no component or many are selected). Live-saves to `Component.description` per keystroke; never reaches PlantUML.
- **Component panel** at the bottom shows the active component's States, Choice-points, State variables/Constants (stacked in one column), and Local functions/Steps (also stacked, in their own column) — four lists across plus the Steps editor under Local functions — and below them a horizontal row pairing the Transitions table with the Action panel. Hidden in device view, where the description panel grows to fill the available space.

There are user-draggable resize handles in several places in this stack:

- Between the device catalogue and the description panel (vertical drag).
- Between the description panel and the component panel (vertical drag).
- Between the lists-grid and the Transitions+Action row (vertical drag).
- Inside the lists-grid: between the State variables list and the Constants list (vertical drag, splits the column's height).
- Inside the lists-grid: between the Local functions list and the Steps editor (vertical drag, splits the column's height).
- Inside the lists-grid: between the State variables/Constants column and the Local functions/Steps column (horizontal drag, gives the Steps area more width when authoring long function bodies).
- Inside the trans-action-row: between Transitions (left) and Action (right) (horizontal drag).
- Outside the right panel, between canvas-column and right-panel (horizontal drag, the main left/right split).

The two horizontal handles inside the right panel are independent: dragging one doesn't move the other. By default, however, the Local functions/Steps column starts at the same width as the Action panel below — so on first load the column boundary aligns vertically with the Trans/Action boundary, even though subsequent drags decouple them. The default width is read from the Action panel's actual rendered width (`getBoundingClientRect`) on first paint, so the alignment is exact regardless of CSS rounding or scrollbar geometry.

**Responsive behaviour.** Both horizontal-drag handles have ResizeObserver companions that keep their panels proportionally responsive when an outer container resizes (e.g. the user drags the canvas/right-panel divider, or the window resizes). The pattern is the same in both observers:
1. Skip the first observation (the initial measurement) — set a baseline and continue.
2. On each subsequent change, if the panel has an inline width set, scale it proportionally from the previous container width to the new one. Bounded by min/max constraints (lfns: `[120, gridWidth - 332]`; Action: `[160, available - 320]`).
3. If the panel doesn't have an inline width yet (CSS default state, or just-reset via dblclick), snapshot the current rendered widths to inline first — this captures the "current" layout as the baseline for proportional scaling. Doing the snapshot makes the panels responsive even from the default state, not only after the user has dragged.

The lfns-column observer additionally re-applies its initial sizing when re-entering component view from device view (where the lists-grid is `display: none` and the column would otherwise have zero width).

Each vertical handle double-clicks to reset to its default. The horizontal Trans/Action handle's double-click clears its inline widths and lets CSS defaults take over (Action: 300px, Transitions: `flex: 1`); the lfns-column handle's double-click clears its inline width and re-applies the initial Action-aligned sizing.

Design decisions worth noting:

- **Dark chrome, light workspace.** The menu bar and toolbar sit on a deep slate background (`--chrome: #1e2230`), contrasting with the white workspace beneath. This pattern (used by Linear, Figma, VS Code) anchors the canvas visually.
- **One accent colour.** The Computerguided Systems indigo (`#2b2a8f`) from the logo is the only accent, used for primary buttons, hover states, selection highlights, the active component chevron, the Device button's "view active" fill, and the logo in the About dialog.
- **Section headers with subtle fills.** The right-panel list headers and the transition-table header use small-caps uppercase labels on a light grey fill — restrained, but enough to read as "sections". The `+` buttons sit in those same headers, flush right, visually integrated.
- **Active component is one chevron, not selection.** The active row uses a chevron marker rather than the selection-style background fill, so "active" and "selected" can coexist visually without conflict in device view (where a component can be selected for the Add Connection workflow without being the active state-machine subject).
- **Inter font.** Loaded from Google Fonts. All typography uses Inter in various weights, which reads cleaner than the default device fonts at small sizes.

The CSS uses custom properties extensively (`--bg`, `--surface`, `--accent`, etc.), which makes future re-theming straightforward.

---

## 14. Device diagram (FCM component view)

The device-level component diagram is a second "view" layered on top of the same `Model`. Where the per-component view renders a state machine on the canvas, the device view renders the components as boxes and the interfaces they are wired to as "lollipop" circles, with lines joining each component to each interface it uses. This corresponds to the top-level component diagram of the **FCM methodology** (Functional Components Method): components expose and connect to explicit interfaces, and their state machines handle messages arriving on those interfaces.

The two views share data: the same interfaces, the same messages, the same components. The wiring between them — which component connects to which interface — lives in `Model.connections` and is editable only in the device view.

### 14.1 `Model.connections` and `Model.activeView`

Two fields on `Model` carry the new state:

- `Model.connections: [ {component, interface, connector, length} ]` — flat list of wirings. `component` and `interface` are string references into `Model.components[*].name` and `Model.interfaces[*].name`. `connector` and `length` reuse the same vocabulary as state-machine transitions (see §3.1). Default interfaces (`Timer`, `Logical`) are deliberately never listed — they represent internal service concepts, not inter-component wiring.
- `Model.activeView: "component" | "device"` — controls canvas rendering and UI visibility. Defaults to `"component"`.

Cascade helpers (`onComponentRenamed`, `onComponentDeleted`, `onInterfaceRenamed`, `onInterfaceDeleted`) keep `Model.connections` consistent when the names they reference change or the referenced element is deleted. These are invoked from the same rename/delete paths that handle the existing cascades into `Component.transitions[*].messages[*]`, so one user action updates both "levels" atomically and the undo snapshot captures the combined state.

### 14.2 Save format: `stadiae-v4`

The save format's top-level tag is `stadiae-v4`. The file carries the full state: components, handlers, interfaces, messages, Component-Interface connections, Handler-Interface connections, Component→Handler call dependencies, and the device-level settings (device name and font sizes). Optional fields (`displayName`, `description`, the three Handler-related arrays, the four device-level fields) are emitted only when they diverge from their defaults, so files that don't use a given feature stay byte-minimal.

The loader rejects anything other than `stadiae-v4` with a clear error. Within v4, missing fields default cleanly — a file saved before `handlers` existed loads with `Model.handlers = []`, and the same applies to every other post-initial-v4 addition. This is forward-compat (an older v4 file loads in a newer build) rather than backward-compat across format versions: the pre-v4 formats (`stadiae-v1` single-component, `stadiae-v2` multi-component without connections, and `stadiae-v3` System-vocabulary) are not supported.

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

**Component multiplicity.** A component carrying a non-empty `multiplication` field renders inside an outer `rectangle <name>xN as "<value>" { … }`, where `<value>` is the user-supplied marker (typically `N`, `NUM`, or `i`) and `<name>xN` is a derived id with a fixed `xN` suffix to keep it disjoint from the inner `component <name>` id even if the user picks `N` itself as the marker. The wrapping rectangle has no Selection of its own and no styling in either mask or visible mode — it's pure layout. The red `line:FF0000;line.bold` highlight in selection-visible mode stays on the inner `component` line only.

**Interface multiplicity.** Every non-default interface that a multiplied component is wired to is also emitted inside `rectangle <Component>xN as "<value>" { … }` — note the *same id* as the component-wrapper rectangle. PlantUML treats repeated `rectangle <id>` declarations as one rectangle, so the component and all of its interfaces end up enclosed in a single visible box. The interface's visible label is suffixed `[]` to mark the multiplicity at the rendering level only — the model's interface name is unchanged. Like the component-wrapper, the interface-wrapper carries no styling: clicks on the rectangle's frame or on empty padding inside the box resolve to background, while clicks on the visible component box or on an enclosed interface lollipop still resolve correctly via their own mask ids.

**Multiplicity invariant.** A non-default interface can have AT MOST ONE multiplied component connected to it. The rule is enforced by `findMultipliedComponentConflict(ifaceName, candidateComp)` and checked in two places: (1) `actionAddConnection` rejects a `comp-iface` connection when the candidate component is multiplied and the target interface is already wired to another multiplied component; (2) `openComponentDialog`'s OK handler rejects setting a non-empty `multiplication` when any of the component's existing interfaces is already wired to another multiplied component. Plain-vs-multiplied is allowed; only multiplied-vs-multiplied is forbidden. The generator carries a defensive "first multiplied component wins" fallback so that a hand-edited file violating the rule still renders something rather than crashing.

### 14.4 Components list and the floating Device button

The Components list lives in the top-right device catalogue alongside the Interfaces and Messages lists. `buildComponentList()` emits one row per component; a small chevron `▸` marker on the row whose `idx === Model.activeComponentIndex` and `Model.activeView === "component"` shows which component is "showing its body" on the canvas. The marker space is reserved on every row (zero opacity for non-active rows) so the list doesn't reflow as the active component changes.

A floating `◇ Device` button (`#btn-device`) lives at the top-left of the diagram canvas. It is absolutely positioned over `#canvas-panel` with `z-index: 20`, sitting above the rendered PNG. Clicking it calls `switchToDevice()`, which flips `Model.activeView` to `"device"`, clears the selection, and refreshes. CSS gives the button an accent fill while `body.view-device` is set, so its state is unambiguously visible (`background: var(--accent); color: white;`).

The button isn't part of `#canvas-content` — that's the inner wrapper `renderDiagram` rebuilds on every render. The button needs to persist across renders without being torn out, so it's a sibling of `#canvas-content` inside `#canvas-panel`. The same arrangement holds the `restored-banner` (autosave restoration prompt) and would hold any future canvas-floating chrome.

Why the canvas, not the right panel: controlling-what-is-shown belongs spatially close to the thing being controlled. The button replaced an earlier pill in the Components list header that competed with the `Components` label and the `+` button for narrow header space. Moving it to the canvas freed the header for symmetric `[label] [+]` styling matching Interfaces and Messages, and put the toggle where the user's attention already is when they decide to switch views.

The component-row click handler dispatches on the active view: in component view it calls `switchToComponent(idx)` (flips view back to `"component"` and sets `activeComponentIndex`); in device view it adds/removes the component from `Selection.components`, the same semantic as clicking the component box on the device canvas — this lets users build connections without having to locate the canvas box.

The `activeView` and `activeComponentIndex` are both included in the visual fingerprint used by `refresh()` to decide when to re-render, so view and component changes correctly invalidate the cached PNG.

This layout was a refactor from an earlier tab-bar UI. Tabs broke down at scale: more than ~5–8 components forced horizontal scroll or label truncation. A vertical list scrolls cleanly to any size, sits naturally next to the other device-wide lists, and integrates the Edit/Delete toolbar workflow that already exists for every other entity kind. The Device button replaced what was previously a pinned `◇ Device` tab, then briefly lived in the Components list header before moving to the canvas.

### 14.5 View-scoped UI

`refresh()` sets either `body.view-device` or `body.view-component` on the document body. CSS rules keyed off these classes:

- Hide `.component-panel` (States, Choice-points, Transitions table, Action panel) in device view. These concepts don't apply to the component diagram.
- Hide the state-machine toolbar buttons (Add Transition, Redirect) in device view and the component-diagram button (Add Connection) in component view.

`updateToolbar()` additionally disables Add State and Add Choice-point in device view, belt-and-braces in case a button gets clicked via keyboard focus. Add Interface / Add Message remain live in both views, because interfaces and messages are device-wide vocabulary.

The canvas click handler uses the view to pick the selection context: `"canvas"` (clears states, choice-points, transitions, START/H/ANY) or `"sysCanvas"` (clears components, interfaces, connections, messages). Both contexts feed the same `selectClick()` rules — the context is only used for the plain-click-replaces-in-same-panel behaviour.

### 14.6 Entering a component

Entering a component's state machine from the device diagram goes through a floating `Component ▸` button at the top-right of the canvas. The button mirrors the `◇ Device` button's position (top-left) and visual weight — spatial symmetry that reads as "navigate up / navigate down" through the hierarchy. Only visible in device view (hidden via `body.view-component .canvas-enter-btn { display: none; }`). Enabled iff `canEnterComponent()` returns true: exactly one Component selected, no handlers/interfaces/messages/connections/handlerConnections/handlerCalls co-selected. On click, `enterSelectedComponent()` resolves the single selected name to a component index and calls `switchToComponent(idx)`.

The button replaced an earlier double-click-to-enter gesture on the canvas and on Components-list rows. That gesture was undiscoverable — nothing in the UI advertised that the boxes or rows were double-clickable, and single-click was already load-bearing (it mutated selection). The button makes the action visible: a user who selects a component sees the button light up and immediately understands what it does.

Unlike the Device button, the Component button is never accent-filled. The Device button is a toggle that doubles as a state indicator ("you are in device view"); the Component button is a pure action ("take me into this component"). Symmetric position, asymmetric semantics.

Also removed when the button was added: the script-level double-click detector (`lastCanvasClick` state plus `DBLCLICK_WINDOW_MS` / `DBLCLICK_SLOP_PX` constants) that worked around the browser's native `dblclick` being unreliable on Stadiæ's canvas. That detector's complexity is no longer justified — canvas clicks are pure single-click-to-select now.

### 14.7 Warning-badge device

Because a component's state machine uses interfaces for its transition messages, the device diagram's wiring should agree with what the state machines actually use. Stadiæ surfaces the mismatch advisory-only:

- **Interfaces list, in component view.** Non-default interfaces are dimmed when not wired to the active component (`.unwired` class) — a hint that they are out of scope. When an unwired interface is actually used by one of the active component's transitions, the entry switches to a warning style (`.unwired-warning` class) with a circular amber `!` badge. Tooltip text explains the inconsistency.
- **Handlers list, in component view.** Handlers are dimmed (`.unwired` class) when not linked to the active component. "Linked" means either a direct `Model.handlerCalls` entry exists from the component to the handler (the dashed-arrow call dependency), or the handler shares an interface with the component via `Model.handlerConnections` + `Model.connections`. The check is implemented by `isHandlerLinkedToComponent(handlerName, componentName)`. Unlike interfaces, handlers don't have a "used but unlinked" warning state — handler usage in actions is indirect (through references in prose, through shared interfaces) and there's no clean, automatic way to distinguish a missing dependency from prose that simply mentions a handler in passing.
- **Transitions table, in component view.** Rows whose interface is non-default and not wired to the active component render with an extra `!` marker in the first indicator column (via a `::after` pseudo-element on the existing `.action-dot` cell). Both the action-dot and the warning `!` can coexist for rows that have an action AND use an unwired interface; the column was widened from 18px to 28px to accommodate.

The warnings are *advisory*, not prescriptive — users can continue to work and save regardless. The design alternative ("dim unwired interfaces, allow use with a warning badge") was chosen explicitly during the Phase A design conversation; the stronger alternative ("block unwired usage") was rejected as too rigid for the "sketch, then formalise" workflow this tool supports.

Warnings are not shown in device view — the concept of "wired to the active component" doesn't apply when the active thing is the device diagram itself.

### 14.8 Editing connections

- `actionAddConnection()` is a pattern dispatcher: it looks at the current selection in device view and routes to one of three outcomes — Component+Interface wires a `Model.connections` entry; Handler+Interface wires a `Model.handlerConnections` entry; Component+Handler wires a `Model.handlerCalls` entry. `detectConnectionPattern()` returns the detected pattern (or `null`), `canAddConnection()` is a thin wrapper. Anything else in the selection (a second component, a random message, a pre-existing connection) makes the detector return `null` — the button stays disabled and the keyboard shortcut no-ops.
- `openConnectionDialog(existing)` is shared across all three wiring records. It duck-types the record — `{component, interface}` vs. `{handler, interface}` vs. `{component, handler}` — and relabels the read-only fields accordingly. Connector type and length inputs work the same way in all three.
- `changeTransitionDirectionByKey(direction)` was generalised via an `adjustDirection(obj, sessionKey, direction)` helper, shared between transitions and connections. Arrow keys adjust a sole selected transition or a sole selected connection; repeated ↑/↓ extends the length with session coalescing for undo.
- `actionDelete()` handles `Selection.connections`, `Selection.handlerConnections`, and `Selection.handlerCalls` in a bulk pass. Single-selection-of-one-Component or one-Handler short-circuits to a confirm-first path (both entities own a description and wiring worth pausing for).

### 14.9 Handlers

A **Handler** is a device-level entity parallel to a Component but without a state machine. Handlers represent asynchronous edges to the outside world — socket listeners, queue subscribers, database drivers. They render on the device diagram using PlantUML's `node` shape (3D brick), distinguishing them visually from the flat-rectangle Component shape.

The data model is three arrays plus a nested structure:

- `Model.handlers` — the Handlers themselves, each carrying `{name, displayName, description, functions}`. Names are identifier-safe and unique across `Model.components` ∪ `Model.handlers` (enforced by `isUniqueDeviceEntityName`). The `functions` array is empty-by-default and contains the handler's callable API.
- `Model.handlerConnections` — Handler ↔ Interface wiring. Same shape as `Model.connections` but with `handler` instead of `component`. A Handler on an interface is implicitly a sender; there is no send/receive flag on the record.
- `Model.handlerCalls` — Component ⇢ Handler function-call dependencies. No interface involved. Rendered as a dashed arrow pointing at the Handler.

**Handler functions** are the handler's exposed API: a list of `{name, description, parameters}` records where `parameters` has the same shape as `message.parameters` (`[{name, type, description}]`). Names are identifier-safe and unique within their parent handler (cross-handler duplicates are fine — two different handlers can each expose a `connect`). Descriptions are free-text single-line developer notes. All three fields are documentation only: they never reach PlantUML and don't affect diagram rendering. Functions exist so that when a developer writes a transition's action, they can reference a concrete API with real parameter names.

**Arrow direction on Component-Interface connections is derived, not stored.** When `Model.handlerConnections` contains any entry for a given interface, the generator renders every `Model.connections` entry touching that interface as a directed edge pointing at the Component (the Component is a receiver because there's a sender on the same interface). Without a Handler on the interface, the same Component-Interface line is plain. `interfaceHasHandler(name)` is the oracle the generator calls per connection. This keeps the connection record clean — the user never manually marks direction; it falls out of the wiring topology.

**Cascades.** Renaming or deleting a Handler rewrites `handlerConnections` and `handlerCalls` via `onHandlerRenamed` / `onHandlerDeleted`. Renaming or deleting a Component extends to `handlerCalls`. Renaming or deleting an Interface extends to `handlerConnections`. Rename paths also re-key the corresponding Selection sets (`Selection.handlers`, `Selection.handlerConnections`, `Selection.handlerCalls`) in place, matching the pattern used for Component and State renames. Function renames re-key `Selection.functions` and `Selection.functionParameters` in place for the same reason.

**Mask kinds.** `handler`, `hconn`, `hcall`. Wired through `toggleSelection` and `isRefSelected` so clicks on Handler boxes, Handler-Interface lines, or Component→Handler dashed arrows select the correct record. Functions and function parameters are not on the diagram, so they have no mask entries — they're selected via their list rows.

**Warning-badge device.** Handlers don't participate. Handlers have no transitions, so there's nothing to cross-check. The existing warning device for Component-Interface-vs-transition-usage is untouched.

**Catalogue layout.** The device catalogue is a five-column grid: Components, Handlers, **Functions**, Interfaces, Messages. The Functions column sits between Handlers and Interfaces — its content is filtered by the single selected Handler (parallel to how Messages is filtered by selected Interfaces). The Functions column is structurally like the Messages column: a `.fns-column` flex wrapper holding a `.list-box`, a resize handle (`#resize-handle-fnparams`), and a `.params-panel` (`#fnparams-panel`). The parameters panel is visible only when exactly one function is selected; hiding is via the same `.hidden` class and display-none CSS that the message-parameter panel uses. Both columns share the `.msgs-column, .fns-column` CSS rule — one place to tune column layout.

**Selection architecture for the handler→function→fn-parameter chain.** Three sets: `Selection.handlers`, `Selection.functions` (keys `"Handler:FunctionName"`), `Selection.functionParameters` (keys `"Handler:Function:ParamName"`). The chain is enforced at resolution time: `resolveBoundFunction` requires the parent handler to still be in `Selection.handlers`, so stale function keys left by the "plain-click-deselect an already-selected row" path (which bypasses `clearSelectionForContext`) don't leak. `buildFunctionList` performs analogous orphan-cleanup when no single handler is bound, and prefix-prunes within a bound handler when the user switches handlers. Same defensive patterns the message-parameter chain uses, generalized to three levels instead of two.

**Shared parameter-panel renderer.** Both message and function parameter panels go through `renderParamsPanel(panelId, handleId, placeholderId, tableId, tbodyId, addBtnId, owner, selectionSet, clickContext, keyPrefix)`. This is the entire renderer — `buildParamsPanel` and `buildFunctionParamsPanel` are two-line wrappers that resolve their owner and call it. Similarly `openParameterDialog(owner, existing, kind, ownerContext?)` dispatches on `kind === "message" | "function"` for label text and selection key construction; both add / edit flows share the same dialog. CRUD functions are still split per kind (`addParameter` / `addFnParameter`, `editSelected*`, `deleteSelected*`) — the dispatching is thin at the entry points and the shared code lives in the dialog and the renderer.

**Description panel binding.** `resolveDescriptionTarget()` returns a `{kind, entity, label}` triple. In device view, if exactly one Handler is selected with no Component, the Handler wins; if exactly one Component is selected with no Handler, the Component wins. Functions are *not* bound to the Description panel — their descriptions live inline in the Functions list row (em-dash style), consistent with states, interfaces, and messages. A full Description panel for functions would be over-scoped for single-line developer notes.

### 14.10 Device wrapper and font model

The device diagram wraps its contents in an outer PlantUML `component DeviceName { ... }` block so the whole diagram carries a visible boundary labelled with the device's name. The wrapper is emitted by `generateComponentDiagramPlantUML` right after the `skinparam` block, closed just before `@enduml`. Inside the wrapper sit the Interfaces, Components, Handlers, Component-Interface connections, Handler-Interface connections, and Component→Handler dependencies — i.e. everything that was previously emitted at top level is now one nesting level deeper. PlantUML allows this nesting across all the shape kinds Stadiæ uses (`component`, `node`, `()`, plain edges, dashed edges).

The wrapper's name uses the same Name + optional displayName convention as components: `Model.deviceName` is the identifier-safe PlantUML id (defaults to `"Device"`), `Model.deviceDisplayName` is free text that may contain `\n` line breaks. When both are set and differ, the emission is `component <deviceName> as "<displayName>" { ... }`; when displayName is empty, a plain `component <deviceName> { ... }` is emitted. The distinction matters for the PlantUML output's readability when committed to source control.

The wrapper does not participate in the selection-mask render. No `idAssigner` call is made for it, so a click anywhere inside the wrapper's bounds passes through to whichever interior element's mask pixel the click landed on. This is deliberate — the wrapper is a *boundary*, not a selectable entity; it exists to be seen, not interacted with. The device name is edited through the menu, never by clicking the canvas.

Two font sizes are stored on `Model` and emitted as `skinparam`:

- `Model.deviceComponentFontSize` (default 12) governs both Component and Handler labels. A single setting, because Components and Handlers are both "boxes" on the same diagram and divergent font sizes would create visual noise.
- `Model.deviceInterfaceFontSize` (default 11) governs Interface lollipop labels.

These are intentionally separate from `component.arrowFontSize` and `component.stateFontSize`, which are per-component and apply to the state-machine view only. Changing a device font size doesn't alter any state-machine rendering; changing a per-component font size doesn't alter the device diagram. Keeping the two font domains independent means users can tune each view's typography without bleeding side-effects.

**Menu dispatch.** The menu bar has both a Component menu and a Device menu. CSS rules `body.view-component .menu[data-menu="device"] { display: none; }` and its mirror hide one or the other depending on the active view, so exactly one is visible at any time. The Component menu's items (Change name, transition font, state font, Copy transitions…) all act on the active component; the Device menu's items (Change name, component/handler font, interface font) all act on the Model-level device settings. Action keys are prefixed (`dev-change-name`, `dev-change-cfont`, `dev-change-ifont`) to keep the dispatch switch unambiguous. The device-rename dialog is `openDeviceDialog()`, structurally identical to `openComponentDialog` but writing to `Model.deviceName` / `Model.deviceDisplayName` instead of a per-component record.

**Save format.** The four fields are emitted only when they differ from their defaults, keeping files that don't customise them byte-identical to before the feature was added. The loader applies the defaults when any field is missing or out of range; the format string stays `stadiae-v4` (the schema gained new optional fields, nothing became incompatible).

---

## 15. Specification export

The `File → Export Specification…` menu item opens a preview modal containing the device's specification rendered as a navigable HTML document. The modal carries three buttons: **Download HTML**, **Download .docx**, and **Close**. The HTML version is the primary preview format — the modal embeds it via an iframe with a sticky table-of-contents sidebar on the left and the rendered prose on the right. Both formats are produced from the same model walk; they diverge only at the rendering layer.

### Why both formats

- **HTML** is the format optimised for reading and reviewing. Self-contained (CSS inline, PlantUML diagrams inlined as SVG), navigable via the sidebar, with backtick-delimited cross-references inside free-text fields rendered as live hyperlinks. Diagrams stay crisp at any zoom and their text is searchable (Ctrl-F finds state names inside diagrams). Prints cleanly to PDF (`@media print` hides the sidebar and de-styles links). The single .html file works offline and from anywhere.
- **.docx** is the format optimised for hand-off into a corporate documentation pipeline — the same content as the HTML, but with native Word paragraphs and tables, rendered diagrams embedded as SVG (with PNG fallback for older viewers), opens directly in Word / LibreOffice Writer / Google Docs without a plugin.

### Why .docx (history)

An earlier iteration emitted Markdown with embedded HTML tables and PlantUML source in fenced blocks. Rendering the result required a viewer that supported all three at once; in practice different tools handle one or two but rarely all three cleanly. The .docx format side-stepped every piece of that: tables with row-span work natively, diagram images are inline vector graphics, styling comes from the docx's own built-in heading/paragraph styles, and the output opens in every consumer office tool without a plugin.

The cost is a runtime dependency on a .docx-building library. The export uses Dolan Miu's [`docx`](https://github.com/dolanmiu/docx), pinned to version 8.5.0, loaded from unpkg.com. It's ~600KB minified, lazy-loaded on first export, and cached thereafter on `window._docxLib`. Users who never export never pay the cost; users who export once don't pay it again within the same session. The HTML export does not require any external library — it's a single string built by `buildSpecificationHTML` from the model and the fetched diagram PNGs.

### Embedded source for round-trip distribution

The downloaded HTML file embeds the editable model as a `<script type="application/json" id="stadiae-model">` block in the document head. This is inert payload: the `application/json` MIME type tells the browser not to execute it, so the browser parses it but doesn't run it — making the script tag a labeled chunk of text addressable via `document.getElementById("stadiae-model").textContent`. The spec's inline JS exposes a discreet "Download source" button in the page footer; clicking it reads the textContent, wraps it in a `Blob({type: "application/json"})`, and triggers a download via temporary anchor + click. Recipients can extract the source and re-open it in Stadiæ to amend, regenerate, or fork — the spec stays linked to its editable origin instead of becoming a dead-end artifact.

**Why the script-tag idiom over alternatives.** Three options were considered: (a) a `<script type="application/json">` text block, (b) a base64-encoded data attribute on some host element, (c) a JS string literal. Option (a) is the standard idiom — clean text, easy to inspect with View Source, no double-encoding overhead, no escape gymnastics for the consuming JS. Option (b) is opaque and adds CPU for encode/decode at no benefit. Option (c) requires escaping every JS-significant character in the JSON, which is fragile. The script-tag approach is what tooling like Next.js uses for its `__NEXT_DATA__` and what most "embed structured data in HTML" patterns settle on.

**Escape gotcha.** The JSON payload may contain the literal text `</script` (e.g. inside a description that quotes HTML). Without escaping, the HTML tokenizer treats that sequence as the end of the host script tag and the rest of the JSON spills into the document body. The fix is a one-line `.replace(/<\/script/gi, "<\\/script")` pass before embedding — the JSON parser sees both forms identically, but the HTML tokenizer is fooled. The same idiom appears in many JSON-in-HTML embedders.

**Filename derivation.** Suggested download name comes from `Model.savedFilename` if set (with a known `.stadiae` or `.json` suffix stripped and `.json` appended), else a slugified `Model.deviceName`, else the literal `stadiae-model`. Always ends with `.json`. The filename is carried alongside the payload as `<meta name="stadiae-model-filename" content="...">` so the consuming JS doesn't need to know the model's structure.

**Round-trip safety.** The embed uses `buildSerializedModel()` — the same code path Save and snapshot use. So the embedded source is byte-identical to a fresh Save of the current state. Round-trip: Stadiæ → Save → JSON file = Stadiæ → Export Spec → embedded source. There's no "spec-only" data shape; the model is serialized once and used in three places (file save, history snapshot, spec embed). This is intentional: it means every code path that handles serialization is exercised by both saves and spec exports, so divergence bugs can't hide.

**Generation timestamp.** The footer also shows the spec's generation time as `YYYY-MM-DD HH:MM`. Useful when recipients are uncertain whether the spec they're reading reflects current source: the timestamp makes the snapshot dated explicitly. This value is captured at `buildSpecificationHTML` time, not at download time — so the timestamp on a re-downloaded HTML matches when the export was generated, not when the user clicked Download.

**Security note.** The embedded source is plain text inside the HTML — no encryption, no obfuscation. Anyone with the HTML file has the editable source. For most Stadiæ usage that's fine: the spec is documentation of the source, the source is the authoritative truth, and distributing both as a single artifact is the intent. For specs intended for wider distribution than the source itself, the relevant trade-off is the user's: this is a feature, not a leak. The manual notes this explicitly.


`buildSpecificationHTML(progress)` produces a single self-contained HTML string. The inputs are the live `Model` and the user's PlantUML server config; the outputs are the iframe `srcdoc` contents (used by the modal) and the downloadable HTML file (the same string, written via Blob + anchor-click).

**Anchor scheme.** Every named entity gets a deterministic, slug-safe anchor ID derived from its identifier:

- `comp-{name}` — component chapter
- `comp-{name}-context`, `comp-{name}-states`, `comp-{name}-cps`, `comp-{name}-statevars`, `comp-{name}-constants`, `comp-{name}-statediagram`, `comp-{name}-transitions`, `comp-{name}-localfns` — sub-sections within a component chapter
- `comp-{name}-state-{stateName}`, `comp-{name}-cp-{cpName}`, `comp-{name}-var-{varName}`, `comp-{name}-const-{constName}`, `comp-{name}-lfn-{lfnName}` — per-row anchors inside the per-component tables
- `iface-{name}`, `iface-{name}-msg-{msgName}`, `iface-{name}-msg-{msgName}-param-{paramName}` — interface chapter, message rows, and per-parameter sub-rows
- `handler-{name}`, `handler-{name}-fn-{fnName}`, `handler-{name}-fn-{fnName}-param-{paramName}` — handler chapter, function rows, and per-parameter sub-rows
- `type-{name}` — type definition row in the Type definitions chapter

Identifiers are already constrained to a-z A-Z 0-9 _ by `isValidIdentifier` (validated on every Add dialog), so they slug as URL fragments without escaping. Display names (which may contain spaces or punctuation for state and CP labels) are not used in anchors — only the underlying `name` field, which is the model's stable identifier.

Per-parameter anchors live on the parameter-name `<td>` cell rather than the row's `<tr>` because the row's `<tr>` already carries the parent message/function anchor — and an element can only have one `id`. The cell-level id works fine with `scrollIntoView` and gets a brief accent highlight when navigated to (`.ref-target` class added by the iframe's click handler, removed by `setTimeout` after the fade transition completes).

**Index and resolution.** `buildSpecAnchorIndex()` builds nested Maps over all components, handlers, interfaces, types, and their members — done once at the start of generation. Each interface entry's `messages` Map and each handler entry's `functions` Map stores `{anchor, parameters: Map(name → anchor)}` rather than a bare anchor string, so a single lookup can yield either the parent's anchor (two-segment use) or a parameter's anchor (three-segment use). The top-level `types` Map stores `{anchor, description}` keyed by name; types are referenced both via bare backtick lookups (`` `MyType` ``) and via exact-string matches in parameter / state-variable type cells. `resolveSpecReference(idx, token, context)` consumes that index plus the current rendering context and returns either an `{ anchor, label, description }` for a successful lookup or `null` for an unresolved reference. The bare-token fallback chain is: current context's members → top-level device entities (component, handler, interface, **type**) → cross-component scan → cross-interface and cross-handler scans.

The resolver dispatches by segment count (split on `:`). Empty segments (`A::B`, leading/trailing `:`) and 4+ segments are rejected as malformed.

**Function-call ornament.** Before splitting on `:`, each segment has any trailing `(...)` stripped. `recomputeTotal()` resolves to `recomputeTotal`; `Timer:getCurrentTime()` resolves to `Timer:getCurrentTime`; `doThis(arg)` resolves to `doThis`. The original token is preserved as the link's display text so prose like *Call `doThis(arg)` and check the result* keeps its call-syntax in the rendered output. The strip is segment-by-segment: anything from the first `(` of a segment onward is dropped from the lookup key, never affecting other segments.

**1 segment** — bare token like `Foo`:

- Search the current context first (the component / handler / interface whose chapter is being rendered).
- Then device-level entities (component / handler / interface names by themselves).
- Then alphabetical scans across other components, interfaces, and handlers.
- Tie-breaker on cross-list collision within a component: state variable beats constant (variables are more common in action prose).

**2 segments** — `Owner:Member` like `OrderManager:Idle`, `Card:Charge`, `Timer:getCurrentTime`:

- `Interface:Message` — exact lookup.
- `Handler:Function` — exact lookup.
- `Component:State|CP|Variable|Constant|LocalFunction` — exact lookup, in that priority.
- **Action-context fallback**: when `context.kind === "component"` and `context.rowMessage` is set, the resolver recognises `Message:Parameter` references whose first segment matches the row's message. The interface qualifier is implicit — the row's own message establishes it. Inside an Action whose row mentions `Connection / ConnectReq`, `ConnectReq:serverId` resolves to the `serverId` parameter without repeating the interface name. The fallback is strictly action-local: it never searches device-wide for messages matching the first segment, to avoid colliding with the existing `Owner:Member` kinds.

**3 segments** — `Iface:Msg:Param` and `Handler:Fn:Param`:

- Walks the index nesting: `idx.perInterface.get(iface).messages.get(msg).parameters.get(param)`.
- Same for handlers.
- Anything else (component-prefixed three-segment, etc.) is unresolved.

**Rendering context.** Each call into `renderProse` carries a `{ kind, ... }` object describing the surrounding chapter — `{ kind: "component", componentName }` while emitting a component chapter, `{ kind: "interface", interfaceName }` for an interface chapter, `{ kind: "handler", handlerName }` for a handler chapter, `{ kind: "device" }` for the device specification. The transition table's per-row Action cell extends this with `rowMessage: { interface, name }` so the action-context two-segment fallback knows which message the implicit qualifier maps to. The resolver consults `rowMessage` only when handling two-segment tokens; everywhere else it's ignored.

**Backtick parsing.** `renderProse(text, context, idx)` walks the input character-by-character. A backslash before a backtick is consumed as an escape, emitting a literal backtick and skipping past it. An un-escaped backtick opens a span that closes at the next un-escaped backtick. The contents go to `resolveSpecReference`; a successful resolution emits `<a class="ref" href="#{anchor}">{label}</a>`, an unresolved one emits `<code class="ref-unresolved" title="Unresolved reference">{token}</code>`. Unterminated backtick spans (no closing backtick before end-of-string) are emitted as literal text — defensive, in case the user typed an opening backtick without closing it.

`renderProseMultiline(text, context, idx)` splits on real newlines, runs each line through `renderProse`, and joins with `<br>` — backticks don't span lines anyway, and per-line processing keeps the parser simple. Used by the description fields (component, handler, interface) which stay plain.

**Markdown rendering for long-form fields.** Four free-text fields — Device Specification, transition Action notes, local-function Steps, type-definition Specification — render a curated Markdown subset (headings, bullet/numbered lists, paragraphs, `**bold**`, `*italic*`/`_italic_`) in both the spec export (HTML and docx) and the live preview. The pipeline is a small two-stage parser feeding two backends:

1. `parseMarkdownBlocks(text)` walks the input line-by-line and emits a flat block AST: `{type: "heading", level, text}`, `{type: "paragraph", text}` (consecutive non-empty lines joined with a single space, classic CommonMark soft-wrap), `{type: "ul", items}`, `{type: "ol", items}`. Lines starting with `#` … `######` followed by a space become headings; lines starting with `*` /`-` /`<digits>.` followed by a space become list items. Blank lines separate blocks. Nested lists, fenced code, blockquotes, tables, links, and inline HTML are deliberately not supported — the spec asked for a curated subset, and keeping the parser tight keeps behaviour predictable.

2. `parseMarkdownInline(text)` runs over each block's text and emits a Run AST: `{type: "text", text}`, `{type: "bold", runs}`, `{type: "italic", runs}`, `{type: "ref", inner}`. Backtick references are recognised at the same level as emphasis, with the existing `\\`` escape preserved. Unmatched openers (`**foo` with no close) render as literal text rather than swallowing the rest of the block — the user is most likely mid-typing.

The two backends consume the same AST. `renderRunsToHtml(runs, refRenderer)` produces HTML, parameterised on the per-mode reference-rendering function (`specRefHtml` for the spec export, `liveRefHtml` for the live preview). `runsToTextRuns(d, runs, style)` produces docx `TextRun[]`, walking the run tree with an ambient `{bold, italics}` style that bold/italic blocks add to and reference blocks inherit. `renderProseMarkdown(text, ctx, idx, opts)` is the spec-export entry point; `renderLiveMarkdown(text, ctx, idx)` is the live-preview entry point; `mkProseParas(d, text, opts)` is the docx entry point.

**Heading offset.** A Markdown `# Foo` inside a section that already uses `<h1>` and `<h2>` for its own structure should render as `<h3>` to fit underneath the surrounding hierarchy, not compete with it. The renderer takes a `headingOffset` option (added to every Markdown heading level, clamped to 6) — the Device Specification passes 2 because it sits under the `<h2>Description</h2>` chapter heading. Other fields land in table cells, where real headings disrupt the cell's row height; those callers pass `inTableCell: true`, which renders headings as bold paragraphs instead.

**Live-preview CSS.** The overlay's default `white-space: pre-wrap` faithfully echoes the textarea's literal whitespace, which is wrong for block-level Markdown output (paragraph margins, list indentation). When attached with `{ markdown: true }`, the overlay gets a `.markdown` class that flips white-space to `normal` and adds the `.live-md-h*`/`.live-md-p`/`.live-md-list` style rules. The `attachLiveBacktickRendering` helper picks `renderLiveMarkdown` over `renderLiveBackticks` based on the same flag. Three call-sites currently pass it: the Action panel, the Steps panel, and the Device Specification panel. The type-definitions modal's right-pane preview also switches to `renderLiveMarkdown` for parity with the export.

**Diagram embedding.** `fetchDiagramAsInlineSVG(plantUMLSource)` is a thin wrapper around the existing `fetchDiagramImage` helper used by the .docx export. It decodes the SVG ArrayBuffer as UTF-8, strips the `<?xml...?>` prolog and any DOCTYPE (which belong in stand-alone .svg files but are illegal inside HTML), and removes the root `<svg>` element's `width` and `height` attributes so CSS controls the rendered size. The cleaned SVG string is dropped directly into the HTML body inside a `<div class="diagram">` wrapper. Failures (PlantUML server unreachable, network error) return `null` instead of throwing, and `buildSpecBody` substitutes a `<div class="diagram-missing">` placeholder for the affected diagram. The HTML file remains fully usable even if some diagrams couldn't render.

The SVG approach was chosen over base64-embedded PNGs for three reasons: (1) crisp rendering at any zoom level, since SVG scales without pixelation and matches the docx export's vector-first approach; (2) searchable diagrams — the SVG keeps text as text, so Ctrl-F finds state names inside the rendered diagram; (3) typically smaller embedded size for diagram-heavy documents, since SVG path data and text labels serialize more compactly than equivalent base64 PNG bytes for typical PlantUML output.

**Sidebar TOC.** Rendered into the iframe document as a `<nav class="toc">` element, sticky-positioned on the left. The structure mirrors the document outline: Device overview / Device specification / Device diagram / Components (each component expandable to its sections) / Handlers / Interfaces. Active-section highlighting via `IntersectionObserver` inside the iframe — when an H1/H2 enters the upper portion of the viewport (`rootMargin: '-10% 0px -75% 0px'`), the matching TOC entry gets the `.active` class. Click-to-scroll uses `scrollIntoView({ behavior: 'smooth' })`.

**Print stylesheet.** A `@media print` block hides `.toc`, expands `<main>` to full width, removes the dotted-underline reference styling (printed links don't need the visual affordance), and applies `page-break-after: avoid` to H1/H2 so chapter headings don't strand at the bottom of a page.

**Type definitions and auto-linking.** Type definitions are device-wide reference entries (see `Model.types` in §3) rendered as their own chapter at the end of both the HTML and docx specs. They participate in the reference resolver as top-level entities — `` `MyType` `` is a bare reference that resolves to the type's anchor.

Beyond explicit backtick references, parameter and state-variable type *cells* in the spec auto-link when the cell's string exactly matches a defined type name. The helper `renderTypeCell(typeStr, idx)` consults `idx.types`: an exact match emits `<a class="ref" href="#type-{name}" data-tooltip="...">` (with the type's description as the tooltip when present), a non-match emits the escaped string verbatim. The match is exact-string only — compound type strings like `Map<String, int>` and nullable markers like `int?` stay plain text. Users wanting links into compound types can use the backtick syntax in surrounding descriptions.

`renderTypeCell` is called from five spec rendering sites: message parameter rows (first row + sub-rows of multi-parameter messages), state-variable rows, and function parameter rows (first row + sub-rows). It replaces what was previously `escapeHTML(p.type || "—")`, with the same em-dash fallback for empty strings.

**Type rename cascade.** When a type is renamed via the Type Definitions dialog, two passes run:
1. `applyRenameRewrite(makeOwnerRenamePredicate(old, new))` — rewrites backtick references in all prose, same as component / handler / interface renames.
2. `retypeOnRename(old, new)` — walks every parameter and state-variable type field and replaces exact-string matches. Lets the auto-link in spec tables keep working without forcing the user to edit each parameter row by hand.

Both passes are part of the same `pushHistory()` snapshot, so a single undo restores both the type's name and every cascaded reference.

**Modal architecture.** `openSpecificationModal()` is the menu-bound entry point. It:

1. Calls `buildSpecificationHTML(progress)` while showing a progress overlay (`Building specification…` → `Rendering device diagram…` → `Rendering {component} context…` → `Rendering {component} state diagram…`).
2. Replaces the progress overlay with the spec modal — `<div class="modal modal-spec">` containing a title strip, an iframe in the body, and three buttons in the footer.
3. Sets the iframe via `srcdoc=` (not `src=`) so the entire HTML lives inside the attribute and the iframe never makes a network request.
4. Wires the Download HTML button to write the same string as a `Blob` + anchor click; wires Download .docx to fall through to the existing `buildSpecificationDocx` pipeline; wires Close to `hideModal`.
5. Listens for `message` events from the iframe — the inline iframe script forwards Esc keypresses via `postMessage({ type: 'spec-modal-escape' })` so Esc closes the modal even when focus has moved into the iframe (where the parent's keydown handler can't reach it).

**Why an iframe.** The spec HTML is a complete document with its own CSS and `<script>`. Rendering it inline in the parent page would require either (a) injecting the styles into the parent (collisions with editor styles) or (b) using a Shadow DOM root. An iframe gives complete style and script isolation for free, plus it doubles as the "what does the downloaded file look like" preview — what you see in the modal is byte-for-byte what gets written to disk.

### Reference rewrite on rename

Backtick references in the model's prose are stored as text — `` `Connection:ConnectReq` `` is just those characters in an action's body — but the user expects them to track renames. Rename interface `Connection` to `Conn` and the action should read `` `Conn:ConnectReq` ``, not become an unresolved reference.

To deliver this, every rename dialog hooks a string-rewrite pass that runs *before* mutating the entity name. The pass walks every free-text field in the model and applies a per-rename predicate to each backtick-resolved token. Predicates return either a replacement string (rewrites the backtick contents) or null (leaves it alone).

**Walker.** `walkAllProse(transform)` visits every free-text field in the model, calling `transform(text, fieldContext)` and assigning the result back. The fields visited:

- `Model.deviceSpecification` (context `{kind:"device"}`)
- For each component: `description`, every state's `description`, every choice-point's `question` and `description`, every state variable's `description`, every constant's `value` and `description`, every local function's `description` and `steps`, every transition's every message's `action` (context `{kind:"component", componentName}`)
- For each handler: `description`, every function's `description`, every parameter's `description` (context `{kind:"handler", handlerName}`)
- For each interface: `description` (context `{kind:"interface", interfaceName}`)
- For each device message: `description`, every parameter's `description` (context `{kind:"message", interfaceName, name}`)

Identifier fields — state names, CP names, parameter names — are not visited. They're not prose; they're identifiers. Renames mutate them via the dialog's own logic and then the rewriter cascades the *references* in prose.

**Per-field rewriter.** `rewriteProse(text, predicate, fieldContext)` walks the input character-by-character, recognising backtick spans the same way `renderProse` does (with backslash-escape support and unterminated-span passthrough). For each enclosed token, it calls `predicate(token, fieldContext)`. The predicate decides whether to rewrite based on segment matching plus, when relevant, the field context.

**Token segmentation.** `splitTokenSegments(token)` splits on `:` and decomposes each segment into `{lead, bare, ornament}` so the parens-call ornament (and any leading whitespace) is preserved through a rewrite. `recomputeTotal()` becomes `newName()` — the segment's `bare` is rewritten while `ornament: "()"` is carried over. `joinTokenSegments(segs)` rebuilds the token string.

**Predicate factories.** Each rename kind has a factory that returns a predicate matching the right token shapes:

- `makeOwnerRenamePredicate(old, new)` — for component, handler, interface renames. Matches any token whose first segment equals the old name; rewrites it. Field context is irrelevant — these are global identifiers. Catches bare `Old`, qualified `Old:Member`, and three-segment `Old:Member:Param`.

- `makeComponentMemberRenamePredicate(owner, old, new)` — for state, choice-point, variable, constant, local-function renames within a component. Matches qualified `Owner:Old` (regardless of field), and bare `Old` *only* when the field belongs to the owning component (`fieldContext.componentName === owner`). The bare-scope rule prevents rewriting unrelated bare matches in other components' prose.

- `makeMessageRenamePredicate(iface, old, new)` — for message renames. Matches qualified `Iface:Old` and three-segment `Iface:Old:Param`. Does NOT touch bare `Old` (message names live in their interface namespace and a bare match could collide).

- `makeFunctionRenamePredicate(handler, old, new)` — for handler-function renames. Same shape as the component-member predicate: qualified `Handler:Old` everywhere, bare `Old` only inside the owning handler's prose.

- `makeParameterRenamePredicate(owner, member, old, new)` — for parameter renames. Matches three-segment `Owner:Member:Old` only. Two-segment action-context shorthand (`Member:Old` inside a row's action where the row's message is `Member`) is not auto-rewritten; the rewriter is a string operation that doesn't know which transition row each piece of action text belongs to. Users renaming parameters and using the action-context shorthand may need to update those references manually.

**Wiring.** Each rename dialog OK handler — `openComponentDialog`, `openHandlerDialog`, `openInterfaceDialog`, `openMessageDialog`, `openFunctionDialog`, `openStateDialog`, `openCPDialog`, `openStateVariableDialog`, `openConstantDialog`, `openLocalFunctionDialog`, `openParameterDialog` — calls `applyRenameRewrite(makeXxxRenamePredicate(...))` immediately after `pushHistory()` and before mutating the entity's name. The rewrite reads the *old* name and writes the *new* name in literal text; it doesn't depend on the entity record itself, so the order of "rewrite then mutate" vs "mutate then rewrite" doesn't matter for correctness — but doing it before mutation keeps the field-context lookups consistent (e.g., a message's interface field is still `Old` when we walk message descriptions, matching how `Old:Foo` references parse).

**Undo behaviour.** The rewrite runs *after* `pushHistory()`, so it's part of the same history snapshot as the rename. A single Ctrl+Z restores both the original name *and* the original prose verbatim.

**Deletions don't cascade.** When an entity is deleted, references to it become unresolved — the renderer styles them as warning-coloured monospace with a dotted underline. The user fixes them manually. This is intentional: silently rewriting `` `Connection:ConnectReq` `` to plain `Connection:ConnectReq` (no backticks) on delete would lose intent (the user wanted a reference here), and the unresolved styling provides a useful visual cue that something's broken.

### Flow

`exportSpecification()` drives the whole pipeline:

1. Prompt for a filename (default `<deviceName>-spec.docx`).
2. Show a progress modal ("Loading document library…" → "Rendering diagrams…" → "Packaging document…").
3. `loadDocxLibrary()` injects a `<script>` for the UMD build if not already loaded. Resolves to `window.docx` cached in `_docxLib`.
4. `buildSpecificationDocx(d, progress)` assembles the `docx.Document` tree by walking the model and fetching diagram images as it goes.
5. `docx.Packer.toBlob(doc)` packages the document. The resulting Blob is downloaded via anchor click.

### Diagram image fetching

Each diagram is fetched in **both** SVG and PNG form from the configured PlantUML server. `fetchDiagramImage(plantUMLSource)` returns `{svg, png, width, height}`:

- `plantUMLSVGURL(source)` builds the `/plantuml/svg/` URL, `plantUMLImageURL(source)` builds the `/plantuml/png/` URL. Same encoding, different format segment.
- Both fetches run in parallel via `Promise.all`. Per-diagram latency is roughly the slower of the two, not their sum.
- The server must send `Access-Control-Allow-Origin: *` for `arrayBuffer()` to succeed. The public `plantuml.com` does; a user-configured local server may or may not.
- Image dimensions come from the PNG (loaded briefly into an `Image` element to read `naturalWidth` / `naturalHeight`). SVG viewBox parsing would be messier and the pixel values are what docx's `ImageRun.transformation` expects anyway.

`fitDiagramToPage(w, h)` scales wide diagrams down to 600px width (preserving aspect ratio); smaller diagrams pass through at natural size. 600px matches ~6.25 inches at 96 DPI, which fits US Letter / A4 with standard 1-inch margins.

Failures (CORS, server 500, decode error, either format missing) throw from `fetchDiagramImage`. The generator catches per-diagram and substitutes an italic placeholder paragraph ("Could not render X: <message>"), so a single failed diagram doesn't abort the whole document.

### SVG + PNG fallback

Diagrams embed as vector graphics for crisp output at any zoom and print DPI — the default PlantUML PNG output is 72 DPI and produces visibly soft edges when Word scales it to its effective display DPI. `mkDiagramParagraph(d, imageData)` builds the centered image paragraph via:

```js
new d.ImageRun({
  type: "svg",
  data: imageData.svg,
  transformation: fitDiagramToPage(imageData.width, imageData.height),
  fallback: { type: "png", data: imageData.png }
})
```

Word renders the SVG natively. LibreOffice (recent versions) renders SVG natively. Google Docs falls back to the PNG — no worse than the pre-SVG baseline. Older Word versions (pre-2016) fall back to the PNG.

### Document structure

H1 is the literal phrase "Device specification" — the device's own display name lives in the docx metadata (visible in file properties), not in a visible heading. H1 chapters are the top-level structural units; H2 sections are the subunits within each chapter.

- **H1 "Device specification"** → H2 Description (user-authored device specification text) + H2 Device architecture (full diagram, component summary table, handler summary table).
- **H1 "Interfaces"** → H2 per interface with its messages table (row-span for multi-parameter messages).
- **H1 per component** → H2 Context (filtered-diagram image, no outer device wrapper) + H2 Constants + H2 State variables + H2 States + H2 Choice-points + H2 State diagram (full state machine image) + H2 State transition table (row-span for multi-message transitions) + H2 Local functions (per-component reusable action snippets — last section in the chapter so the reader has the full state-machine picture before encountering the refactored step sequences that the actions delegate to).
- **H1 per handler** → H2 Functions (row-span for multi-parameter functions).

A well-formed output opens with a table of contents that reads: Device specification / Interfaces / each Component / each Handler. The structure matches the user-provided PDF template that drove the design.

### Choice-points in spec output

The Stadiæ model carries three fields on a choice-point: `name` (an internal identifier used as part of the PlantUML id, e.g. `CP_Available`), `question` (the semantic content, e.g. "Is the item in stock?"), and `description`. The spec deliberately omits the name: it has no meaning to a spec reader, and the `CP_` prefix is a PlantUML-id anti-collision device.

The choice-points table therefore renders as **Question | Description** (not Name | Description). Choice-point rows are sorted alphabetically by question text.

The transition table has the same issue — when a transition's source or target *is* a choice-point, the raw model string is something like `CP_Available`. `nodeLabelInComponent(comp, id)` resolves these:

- `START` → `●`
- `[H]` → `H`
- `*` → `∗`
- `CP_<name>` → the choice-point's question (or `<name>` if the question is empty)
- Regular state id → the state's `displayName` when set, otherwise the identifier

It's a component-scoped twin of the editor's existing `nodeLabel` helper — the editor version reads from the active component, this one takes a component explicitly so the spec generator doesn't need to flip the active pointer to resolve an endpoint.

### Flattening `\n` markers

The model uses the literal two-character sequence `\n` (backslash-n) as a line-break marker in short labels — state display names, choice-point questions — so PlantUML can wrap them when diagram layout is tight. In prose the line-break is a rendering artifact, not semantic. `mkCell` normalises every cell's text: `\n` → space, real newlines → space, whitespace runs collapsed, trimmed. Same flattening applied to the H1 headings and prose sentences that embed component/handler labels.

Body prose (the device specification textarea, component descriptions, handler descriptions) uses `mkParas` which preserves real newlines as paragraph breaks — only **table cells** and **headings** are flattened to single-line.

### Tables and column widths

`mkCell(d, text, {rowSpan, width})` produces a docx `TableCell` with optional `rowSpan` and absolute `width` (in DXA — twentieths of a point). The docx library handles the underlying XML merge-cell syntax for rowspan; subsequent rows in a rowspan group carry fewer cells (the docx format expects "missing" cells where the row-span occupies them).

**Column widths are effectively mandatory.** Without explicit per-cell widths, Word computes column widths from minimum content, which collapses any column with a narrow heading to one character per line — the letters of "Source" stack vertically as `S / o / u / r / c / e`. Three layers of width declaration ship together, targeting three different viewer quirks:

1. **Per-cell width in DXA** via `{width: N}` on every `mkCell` and `mkHeaderCell` call. Word honours these directly.
2. **`TableLayoutType.FIXED`** at the table level. This emits `<w:tblLayout w:type="fixed"/>`, telling Word not to re-size columns based on content.
3. **`columnWidths` array** on the Table itself. This emits `<w:tblGrid>` with explicit column widths. Google Docs honours this grid more reliably than per-cell widths; without it, Google Docs runs its own minimum-content auto-layout pass on import and ignores the per-cell values.

**Why DXA instead of percentage.** An earlier iteration used `WidthType.PERCENTAGE`. Word and LibreOffice honoured it; Google Docs silently ignored it on import and fell back to auto-layout. Absolute DXA values are honoured by all three. 9000 DXA (≈6.25 inches) is the total table width, fitting inside US Letter and A4 with standard margins.

**Width profiles.** Defined once at the top of `buildSpecificationDocx` using a `pct(percents)` helper that scales percentages to DXA against the 9000-DXA total, so design intent stays percentage-based while the output is absolute:

- `COL_2 = pct([25, 75])` — two-column summary tables (Component/Description, Handler/Description, Interface name/Description, State/Description, Choice-point Question/Description).
- `COL_3 = pct([20, 20, 60])` — three-column state-variables table (Name | Type | Description).
- `COL_3S = pct([18, 30, 52])` — three-column local-functions table (Name | Description | Steps). Description is a short one-line summary; Steps is a multi-line body (the Steps column renders with `preserveNewlines: true` in `mkCell`, so line breaks the user typed survive to the Word output).
- `COL_4 = pct([18, 40, 22, 20])` — four-column table. Historically used for messages and functions before per-parameter descriptions got their own column; kept in the code as a reference profile and for any future four-column use.
- `COL_5 = pct([13, 13, 16, 16, 42])` — five-column transition table (Source | Target | Interface | Message | Action). Action gets nearly half the width because action text is the most verbose column.
- `COL_5P = pct([13, 30, 15, 12, 30])` — five-column message and function tables (Entity name | Entity description | Parameter | Type | Parameter description). The two description columns get equal weight at 30% each; name columns stay narrow because the reading flow is scan-right-to-read, not scan-right-to-identify. Distinct from the transition `COL_5` because the prose-density profile is different (two mid-prose columns vs one long-prose column).

### Parameter descriptions in message and function tables

Message parameters and function parameters each carry an optional `description` field alongside `name` and `type`. These render as a **dedicated fifth column** in the per-interface message table and the per-handler function table. The resulting column layout:

| Column | Role | Width |
|---|---|---|
| Message / Function | Entity name — rowspan across all parameter rows when N>1 | 13% |
| Message description / Function description | The entity's own description — rowspan | 30% |
| Parameter | Parameter name, one row per parameter | 15% |
| Type | Parameter type (`"-"` when empty) | 12% |
| Parameter description | Parameter's own free-text description | 30% |

The header text distinguishes "Message description" / "Function description" from "Parameter description" — both columns would otherwise read "Description" and ambiguate. An earlier iteration concatenated the parameter description into the Type cell with an em-dash separator (the `typeCell(p)` helper); that kept the table at four columns but pushed longer parameter descriptions into a cell too narrow to read them comfortably. The fifth-column layout reclaims the width.

### State machine rendering per component

`generatePlantUML()` reads from `Model.activeComponentIndex`. The export generator temporarily re-points the index at the component being documented, renders, then restores — wrapped in `try/finally` so a fetch failure mid-render can't leave the UI focused on the wrong component. An alternative would be to thread a component-index argument through `generatePlantUML`, but that's a deeper refactor affecting the main UI render path; the save/restore is simpler and safe.

### Per-component Context diagrams

Each component section includes a Context diagram — the device diagram restricted to that component's immediate neighbourhood. The filter is computed by `buildFocusFilter(componentName)` and threaded into `generateComponentDiagramPlantUML` via a `focus` option.

The neighbourhood is:

- The component itself.
- Interfaces the component is directly wired to.
- Handlers on any of those interfaces (showing who's on the other end).
- Handlers the component calls directly.

Explicitly *not* included: other components on the same interface. The context diagram is the component's outgoing/incoming contract surface, not the full ecosystem. Cross-component relationships belong in the device diagram proper.

**The outer device wrapper is dropped for Context diagrams.** The full device diagram encloses everything in `component DeviceName { ... }` to carry the visible device boundary. For a single-component focused view that's visual redundancy — there's no "whole device" being shown, just one component's neighbourhood. `buildFocusFilter` sets `skipDeviceWrapper: true` on the returned filter; the generator tests this flag and skips both the opening `component DeviceName {` line and its matching `}` closer.

`generateComponentDiagramPlantUML` exposes six `allow*` predicates (`allowComponent`, `allowHandler`, `allowInterface`, `allowConnection`, `allowHandlerConnection`, `allowHandlerCall`) that default to `() => true` when `focus` is null, and consult the filter sets when focus is set. The predicates gate every emission loop — components, handlers, interfaces (via `wiredInterfaces`), and all three wiring kinds. The `skipDeviceWrapper` flag is handled separately from the allow-predicates since it gates structural syntax (the outer `component {...}` block) rather than entity emission.

### Empty-case and error fallbacks

Every potentially-empty section falls back to a one-line italic statement rather than an empty table: `"No handlers are defined for this device."`, `"This interface has no messages."`, `"This component has no choice-points."`, `"The <handler> exposes no functions."`, and so on. Missing descriptions render as `"No description provided."` in cells. Per-diagram render failures produce `"Could not render <diagram>: <reason>"` italic paragraphs in place of the image. The document always generates.

### What the generator doesn't do

- **No requirements, non-functional, or scenarios sections.** The model doesn't carry that information; the template deliberately leaves these to the human to add after export.
- **No sequence diagrams.** Scenarios are outside scope; the static model covers the contract, not the choreography.
- **No cross-referencing.** The document is flat — no anchor links between the interface vocabulary and the component sections that use it. Word's built-in "Heading" styles make it easy for the user to add a table of contents manually post-export.

---

## 16. Known limitations

- **PlantUML server dependency for rendering.** Live diagram rendering requires a reachable PlantUML server. The default is the public `plantuml.com`; the user can point to a local server via `File → PlantUML server…` (the setting is persisted to `localStorage`). The export-as-`.puml` path works fully offline — it emits source without rendering — but canvas preview, PNG export, and the specification export all require a server round-trip per diagram.
- **Canvas selection depends on CORS.** If the configured PlantUML server stops sending `Access-Control-Allow-Origin: *` on PNG responses, the mask pixel read becomes impossible in the browser and canvas-click selection silently fails (list-based selection continues to work). Same constraint applies to the specification exporter's image fetching.
- **Specification export needs unpkg.com on first use.** The `docx` library is lazy-loaded from `https://unpkg.com/docx@8.5.0/build/index.umd.js` the first time the user triggers an export. If unpkg is unreachable, the export fails with an error dialog; subsequent exports in the same session use the cached library without network I/O. Fully offline specification generation would require bundling the ~600KB library into the HTML file, which is a deliberate trade-off declined in favour of keeping the base file small.
- **Google Docs renders PNG, not SVG, for embedded diagrams.** The exporter ships both SVG and PNG for every diagram; Word and LibreOffice render the sharper SVG natively, Google Docs falls back to the PNG on import. The resulting quality in Google Docs is equivalent to the pre-SVG baseline.
- **No composite/nested states.** The model is intentionally flat; PlantUML supports composite states but Stadiæ doesn't currently expose them.
- **No multi-select on the canvas.** Clicks are single-toggle only; multi-select is only available through the side lists and transition table.
- **Server-side layout.** The user can influence arrow direction and length per transition, but the overall layout is decided by PlantUML. Manual drag-positioning of nodes is not supported.

---

## 17. Pointers for extension

If you want to:

- **Add a new element type** (e.g. an "end" pseudostate): add a flag to `Selection`, a row to the States list in `buildStateList`, emission logic in `generatePlantUML` (both modes — visible with styling, mask with id assignment), a case in `canAddTransition` if it participates in transitions, a resolution case in `nodeLabelInComponent` (for the spec transition table), a `pruneNodeOrder` case and `noteNodeSelected`/`noteNodeDeselected` calls at the new element's selection sites (if it can participate in transitions — so click-order direction inference works for it too, see §8.7), and a manual section.

- **Add a new documentation-only per-component field** (like `stateVariables` or `localFunctions`): add the field to `makeEmptyComponent`, a getter/setter to the `Component` proxy (this is the step that was initially missed for `stateVariables` — without a proxy accessor the feature silently writes to a global property instead of the per-component record), to the serializer (only when non-empty to keep files from users who don't use the feature byte-minimal), to the loader (defensive normalisation), and to `snapshot()` via the component object. Build a UI list with `build{Field}List`, wire it into `refresh()`, add CRUD helpers and a dialog matching `openStateVariableDialog` / `openLocalFunctionDialog`, a Selection set + `clearAll` case + `clearSelectionForContext` case, a list-header button group (`+` for add, `✎` for edit, `−` for delete) with enabled-state rules in `refresh()`, per-list `editSelectedField` / `deleteSelectedField` functions, and `canEdit` / `actionEdit` / `actionDelete` branches for the keyboard-shortcut path. For the spec export, add an H2 section in the per-component chapter and a column-width profile if the shape is new.

- **Add a new per-transition-row field** (like the `action` field): extend the message objects in `Component.transitions[*].messages`, add UI for viewing/editing it (following the Action panel pattern — live save with per-session history via `pushHistory`, suppressed diagram re-renders since it doesn't affect PlantUML), and surface presence in the table via an indicator column or cell. Extend the spec exporter's transition table to include it; widths in `COL_5` may need rebalancing.

- **Add a new entity kind to the spec export** (e.g. a "Scenarios" chapter): add the section in `buildSpecificationDocx`, match its heading level to the H1/H2 convention (chapter heading is H1, subsections H2), and use the existing `mkTable` / `mkCell` helpers with one of the `COL_N` width profiles (or add a new profile if the column layout is different). Remember to apply `{width: COL_N[i]}` to every body cell — omitting it lets Google Docs collapse the column on import.

- **Change visual theming**: edit the CSS custom properties block at the top of `<style>`. The accent colour threads through toolbar hover, selection, primary buttons, the active component chevron, the Device button's view-active fill, and the logo — one variable.

- **Add a new menu item**: add `<div class="item" data-action="...">` under the right `<div class="menu">`, then a `case` in the menu click-dispatch switch.

- **Persist across sessions**: the model serialises cleanly via `snapshot()`. Writing that string to `localStorage` on every `pushHistory` and restoring on startup would add autosave without touching the rest of the code.

- **Support offline rendering**: replace `plantUMLImageURL(source)` with a call to a local PlantUML instance (e.g. served via `plantuml -picoweb`), keeping everything else the same — `plantUMLSVGURL` follows the same pattern for the spec export. The selection-mask technique works identically as long as the local server sends CORS headers.

---

*This document reflects the design as of the current build.*
