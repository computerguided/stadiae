# Stadiæ — State Diagram Editor

A lightweight, zero-install graphical editor for [PlantUML](https://plantuml.com) state diagrams of functional components, running entirely in your browser.

**🚀 [Try it live](https://htmlpreview.github.io/?https://raw.githubusercontent.com/computerguided/stadiae/refs/heads/main/stadiae.html)**

---

## What is it?

Stadiæ is a visual front-end for modelling **systems of communicating components**. You draw state machines, wire components to shared interfaces, declare the messages they exchange, and reference the handlers they depend on — all with point-and-click — and Stadiæ generates clean PlantUML source you can commit, hand-edit, or feed into your own toolchain.

It's built around the vocabulary engineers use when describing functional-component behaviour:

- **Components** with their own state machines: **states**, **choice-points**, **transitions**, plus per-component **state variables** (documentation of what each component holds) and **local functions** (reusable action snippets referenced from transition actions), and the usual **START**, **history**, and **ANY** pseudostates.
- **Handlers** — external collaborators (card readers, databases, printers, etc.) with **functions** they expose as a synchronous API.
- **Interfaces** carrying **messages** with typed parameters, shared across components.
- The **system diagram** tying it all together: components, handlers, interface wiring, and call dependencies.

## Features

- **Multi-component systems.** Model any number of components in a single file. Switch between them with one click; the state machine below the canvas tracks the active component. The Components list shows a chevron on the active row.
- **System view.** One click on the `◇ System` button flips the canvas from a state machine to a component-level diagram showing every component, handler, interface, and their wiring. All list views stay in view — they're shared vocabulary.
- **Live rendering.** Every edit re-generates the PlantUML and re-renders the diagram instantly, against either the public PlantUML server or one you've configured locally.
- **Five shared catalogues.** Components, Handlers, Functions, Interfaces, Messages — five side-by-side lists at the top of the app. Select a Handler to see its Functions; select an Interface to see its Messages; select a Message or Function to see and edit its Parameters.
- **Click-to-select on the canvas.** States, choice-points, transition arrows, components, handlers, and all wiring lines are clickable directly on the rendered image. Selected elements highlight in red across both views.
- **Grouped transitions.** Multiple messages can share a single arrow for a cleaner diagram; each message row is individually selectable so you can edit or delete them one by one.
- **Transition action notes.** Document what each transition does in a free-text Action panel. Actions round-trip in the saved `.json` but stay out of the generated PlantUML to keep the diagram uncluttered.
- **State variables.** Per-component documentation of the data each component holds — name, type, description. Listed alongside States and Choice-points in the component view. Documentation-only: never reach the diagram, but appear as a dedicated section in the spec export.
- **Local functions.** Per-component reusable action snippets — name plus multi-line description/steps. Reference them by name from transition action text to avoid repeating common step sequences. Take no parameters (they access the component's state variables by closure) and don't reach the generated PlantUML. Appear as the final section of each component's chapter in the spec export, with multi-line descriptions preserved.
- **Descriptions everywhere.** Every component, handler, function, interface, message, state, and choice-point has an optional free-text description. A small accent-coloured dot indicates rows with a non-empty description.
- **System specification textarea.** A free-text field for the system's overall description, used as the opening of the exported specification document.
- **Undo / redo** for every mutating action.
- **Save and open** `.json` project files. **Export** to `.puml`, `.png`, a Markdown transitions table, or a full Word specification document.
- **Export full specification as `.docx`.** One command produces a complete Word document describing the whole system — title, description, system architecture diagram, interface vocabulary, one chapter per component (with filtered context diagram, state diagram, states, choice-points, and transition table with actions), and one chapter per handler (with functions and parameters). Tables use native row-span merging; diagrams are embedded as SVG (crisp at any zoom) with PNG fallback for Google Docs.
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

- A **menu bar**: File / Component / System / Help
- A **toolbar** with Save, Undo/Redo, Delete, Add State / Choice-point / Transition / Handler / Interface / Message / Function, and Edit
- A **diagram canvas** on the left showing the live render (a state machine in component view, or the system diagram in system view)
- **Five shared lists** at the top right: Components, Handlers, Functions, Interfaces, Messages
- A **transition table** and **Action panel** in the bottom right (component view only)
- A **Description panel** and **System Specification textarea** toggled to whichever entity is selected

**A minimal workflow:**

1. Stadiæ opens with a blank single-component file. Click `◇ System` to flip to system view.
2. Add a Component (`+` button in the Components list).
3. Add an Interface, then Messages under it. Give each message its parameters.
4. Optionally add a Handler, and its Functions with parameters.
5. Wire the Component to the Interface by selecting both and clicking `Connect`.
6. Double-click a Component (or select it and click `Component ▸`) to drill into its state machine. Add states, choice-points, and transitions as usual.
7. Save as `.json`, or export as `.puml`, `.png`, Markdown, or a full Word specification document.

The **complete manual** is available inside the app under `Help → User Manual` — including the full selection rules, keyboard shortcuts, and a troubleshooting guide.

## Example

[`coffee-pos.json`](coffee-pos.json) is a worked example: a coffee-shop point-of-sale system with two components (OrderManager, InventoryTracker), four handlers (CardReader, Printer, Display, Database), four interfaces, and full state machines for each component. Open it in Stadiæ to see the features in action; export it as `.docx` to see what the specification export produces on a populated system.

## File format

Saved `.json` files use the `stadiae-v3` format and round-trip losslessly: every component, handler (with its functions), shared interface, message (with its parameters), wiring, call dependency, action note, and description is preserved. The generated PlantUML is always derivable from the JSON, but not vice versa — the JSON is the canonical storage format.

The format is forward-compatible within v3: optional fields are only written when they diverge from their defaults, so files that don't use a feature (e.g. no handlers) stay byte-minimal. Files saved under earlier formats (`stadiae-v1`, `stadiae-v2`) are no longer supported.

## Keyboard shortcuts

| Shortcut                 | Action           |
|--------------------------|------------------|
| `Ctrl+N`                 | New diagram      |
| `Ctrl+O`                 | Open             |
| `Ctrl+S`                 | Save             |
| `Ctrl+Z`                 | Undo             |
| `Ctrl+Y` / `Ctrl+Shift+Z`| Redo             |
| `Delete` / `Backspace`   | Delete selected  |

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
