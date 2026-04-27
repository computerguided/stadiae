# Stadiæ — State Diagram Editor

A lightweight, zero-install graphical editor for [PlantUML](https://plantuml.com) state diagrams of functional components, running entirely in your browser.

**🚀 [Try it live](https://htmlpreview.github.io/?https://raw.githubusercontent.com/computerguided/stadiae/refs/heads/main/stadiae.html)**

---

## What is it?

Stadiæ is a visual front-end for modelling **devices of communicating components**. You draw state machines, wire components to shared interfaces, declare the messages they exchange, and reference the handlers they depend on — all with point-and-click. The editor saves a compact JSON project file as the canonical model and renders the diagrams via PlantUML; PlantUML source can also be exported separately for hand-editing or feeding into your own toolchain.

It's built around the vocabulary engineers use when describing functional-component behaviour:

- **Components** with their own state machines: **states**, **choice-points**, **transitions**, plus per-component **state variables** (documentation of what each component holds), **constants** (named values referenced from action text), and **local functions** (reusable action snippets referenced from transition actions), and the usual **START**, **history**, and **ANY** pseudostates.
- **Handlers** — external collaborators (card readers, databases, printers, etc.) with **functions** they expose as a synchronous API.
- **Interfaces** carrying **messages** with typed parameters, shared across components.
- The **device diagram** tying it all together: components, handlers, interface wiring, and call dependencies.

## Features

- **Multi-component devices.** Model any number of components in a single file. Switch between them with one click; the state machine below the canvas tracks the active component. The Components list shows a chevron on the active row.
- **Device view.** One click on the `◇ Device` button flips the canvas from a state machine to a component-level diagram showing every component, handler, interface, and their wiring. All list views stay in view — they're shared vocabulary.
- **Live rendering.** Every edit instantly re-renders the diagram via PlantUML, against either the public PlantUML server or one you've configured locally.
- **Five shared catalogues.** Components, Handlers, Functions, Interfaces, Messages — five side-by-side lists at the top of the app. Select a Handler to see its Functions; select an Interface to see its Messages; select a Message or Function to see and edit its Parameters.
- **Click-to-select on the canvas.** States, choice-points, transition arrows, components, handlers, and all wiring lines are clickable directly on the rendered image. Selected elements highlight in red across both views.
- **Grouped transitions.** Multiple messages can share a single arrow for a cleaner diagram; each message row is individually selectable so you can edit or delete them one by one.
- **Transition action notes.** Document what each transition does in a free-text Action panel. Actions round-trip in the saved `.json` but stay out of the generated PlantUML to keep the diagram uncluttered.
- **State variables.** Per-component documentation of the data each component holds — name, type, description. Listed alongside States and Choice-points in the component view. Documentation-only: never reach the diagram, but appear as a dedicated section in the spec export.
- **Constants.** Per-component named values referenced by name from action text — e.g. *"Start the timer with the ADVERTISEMENT interval."* Three free-text fields (name, value, description); no type discipline so the value can be a number, string, hex literal, or any domain notation. Live in the same column as State variables, below them. Appear as their own section in the spec export.
- **Local functions.** Per-component reusable action snippets — name plus multi-line description/steps. Reference them by name from transition action text to avoid repeating common step sequences. Take no parameters (they access the component's state variables by closure) and don't reach the generated PlantUML. Appear as the final section of each component's chapter in the spec export, with multi-line descriptions preserved.
- **Type definitions.** Device-wide named definitions of domain types (`UserId`, `Timestamp`, `Currency`) with descriptions and free-text specifications. Defined under *Device → Type definitions...*. Auto-link to the type's definition wherever a parameter or state-variable type field exactly matches a type name. Appear as a dedicated chapter at the end of the spec export.
- **Cross-references in prose.** Wrap a name in backticks inside any free-text field (Device Specification, transition Actions, descriptions everywhere) to turn it into a hyperlink in the spec export. Bare references like `` `Idle` `` resolve in context; qualified references like `` `Card:Charge` `` or `` `Connection:ConnectReq:serverId` `` link to specific messages or parameters. Renames cascade automatically — change a name and references update everywhere. Hover any link in the rendered spec to see the target's description in a tooltip. **Live preview while editing:** in the Device Specification, transition Action, local-function Steps, and Description panels, references render in styled monospace (with hover tooltips) when the field loses focus, so you can verify your references resolve without opening the spec preview. Press `Esc` to leave the field quickly.
- **Descriptions everywhere.** Every component, handler, function, interface, message, state, and choice-point has an optional free-text description. A small accent-coloured dot indicates rows with a non-empty description.
- **Device specification textarea.** A free-text field for the device's overall description, used as the opening of the exported specification document.
- **Undo / redo** for every mutating action.
- **Save and open** `.json` project files. **Export** to `.puml`, `.png`, a Markdown transitions table, or a full device specification as either an HTML or Word document.
- **Export full specification.** *File → Export Specification…* opens a preview of the spec rendered as a navigable HTML document — sticky sidebar TOC, every named entity hyperlinked, hover tooltips showing descriptions, embedded diagrams. Two download buttons in the modal: **Download HTML** for a self-contained single-file document (CSS inlined, diagrams inlined as SVG so they stay crisp at any zoom and their text remains searchable) and **Download .docx** for a native Word document with row-spanning tables and SVG diagrams. Both formats describe the entire device: title, device specification, device architecture diagram with component and handler summary tables, interfaces with messages and parameters, one chapter per component (with filtered context diagram, state diagram, states, choice-points, state variables, constants, transition table with actions, and local functions), one chapter per handler, and a Type definitions chapter at the end.
- **Built-in user manual** under Help — the full reference is one click away.
- **Single-file.** The entire application is one self-contained HTML file. No build step, no npm, no server. Open the file and it works.

## Quick start

1. Download or clone this repository.
2. Open `stadiae.html` in any modern browser.
3. That's it — start editing.

Alternatively, click the [live demo link](https://htmlpreview.github.io/?https://raw.githubusercontent.com/computerguided/stadiae/refs/heads/main/stadiae.html) above.

> Stadiæ renders diagrams by sending PlantUML source to a **PlantUML server**. The default is the public server at `plantuml.com`, but you can point Stadiæ at a local server via `File → PlantUML server…` — useful for offline work, air-gapped environments, or avoiding the public server's rate limits. All editing, saving, and exporting-to-`.puml` works fully offline; only the rendered previews and the `.docx` specification export need server access. The specification export also loads its document-building library (`docx`) from unpkg.com on first use per session.

## Usage at a glance

When you open Stadiæ you'll see:

- A **menu bar**: File / Component / Device / Help
- A **toolbar** with Save, Undo/Redo, Copy/Paste, Add Transition, Redirect, Add Connection
- A **diagram canvas** on the left showing the live render (a state machine in component view, or the device diagram in device view)
- **Five shared lists** at the top right: Components, Handlers, Functions, Interfaces, Messages
- A **transition table** and **Action panel** in the bottom right (component view only)
- A **Description panel** and **Device Specification textarea** toggled to whichever entity is selected

**A minimal workflow:**

1. Stadiæ opens with a blank single-component file. Click `◇ Device` to flip to device view.
2. Add a Component (`+` button in the Components list).
3. Add an Interface, then Messages under it. Give each message its parameters.
4. Optionally add a Handler, and its Functions with parameters.
5. Wire the Component to the Interface by selecting both and clicking `Connect`.
6. Double-click a Component (or select it and click `Component ▸`) to drill into its state machine. Add states, choice-points, and transitions as usual.
7. Save as `.json`, or export as `.puml`, `.png`, Markdown, or a full Word specification document.

The **complete manual** is available inside the app under `Help → User Manual` — including the full selection rules, keyboard shortcuts, and a troubleshooting guide.

## Example

[`coffee-pos.json`](coffee-pos.json) is a worked example: a coffee-shop point-of-sale device with two components (OrderManager, InventoryTracker), four handlers (CardReader, Printer, Display, Database), four interfaces, and full state machines for each component. Open it in Stadiæ to see the features in action; export it as `.docx` to see what the specification export produces on a populated device.

## File format

Saved `.json` files use the `stadiae-v4` format and round-trip losslessly: every component, handler (with its functions), shared interface, message (with its parameters), wiring, call dependency, action note, and description is preserved. The generated PlantUML is always derivable from the JSON, but not vice versa — the JSON is the canonical storage format.

The format is forward-compatible within v4: optional fields are only written when they diverge from their defaults, so files that don't use a feature (e.g. no handlers) stay byte-minimal. Files saved under earlier formats (`stadiae-v1`, `stadiae-v2`, `stadiae-v3`) are no longer supported.

## Keyboard shortcuts

| Shortcut                 | Action           |
|--------------------------|------------------|
| `Ctrl+N`                 | New diagram      |
| `Ctrl+O`                 | Open             |
| `Ctrl+S`                 | Save             |
| `Ctrl+Z`                 | Undo             |
| `Ctrl+Y` / `Ctrl+Shift+Z`| Redo             |
| `Ctrl+C` / `Ctrl+V`      | Copy / paste selected states and choice-points |
| `Delete` / `Backspace`   | Delete selected  |
| `Enter`                  | Edit selected (when one editable item is selected) |
| `Esc`                    | Close dialog, or leave a free-text panel (live preview takes over) |
| `← → ↑ ↓`                | Change direction (and length) of selected transition |

## Limitations

- **Requires a PlantUML server** for preview rendering and for the `.docx` specification export. The default is public (`plantuml.com`); you can configure a local one via `File → PlantUML server…`. Exports to `.puml` work fully offline.
- **Specification export needs unpkg.com on first use** to fetch the document-building library (~600KB, cached for the rest of the session).
- **Canvas click selection depends on CORS** — it uses a pixel-mask technique that requires the PlantUML server to send cross-origin headers. If this fails, list-based selection continues to work.
- **No composite states** — Stadiæ covers flat state machines with choice-points and history. Nested/composite states are not supported by the current UI.
- **No multi-select on the canvas.** Clicks are single-toggle only; multi-select is available through the side lists and transition table.

## Contributing

Issues and pull requests are welcome. Since the whole tool is a single HTML file, changes are easy to review and easy to try out locally — just open `stadiae.html`.

For developers wanting to understand or extend the internals, see [design.md](design.md).

## License

Released under the [MIT License](LICENSE.txt). See the `LICENSE` file for details.

## Credits

Built as a GUI front-end for [PlantUML](https://plantuml.com). Diagram rendering uses the public PlantUML server by default (configurable).
