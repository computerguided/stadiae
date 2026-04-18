# Stadiæ — State Diagram Editor

A lightweight, zero-install graphical editor for [PlantUML](https://plantuml.com) state diagrams, running entirely in your browser.

**🚀 [Try it live](
https://htmlpreview.github.io/?https://raw.githubusercontent.com/computerguided/stadiae/refs/heads/main/stadiae.html)**

---

## What is it?

Stadiæ is a visual front-end for writing PlantUML state diagrams of functional components. You draw the state machine with point-and-click, and Stadiæ generates clean, structured PlantUML source that you can export, commit to source control, or render with any other PlantUML-compatible tool.

It is designed around the vocabulary engineers actually use when describing component behaviour: **states**, **choice-points** (decision nodes), **interfaces**, **messages**, **transitions**, plus the usual **START** and **history** pseudostates.

## Features

- **Live rendering** — every edit re-generates the PlantUML and re-renders the diagram instantly.
- **Full element model** — states, choice-points, interfaces, messages, and transitions are first-class, each with its own properties dialog.
- **Grouped transitions** — multiple messages can share a single arrow for a cleaner diagram; each message row is individually selectable so you can edit or delete them one by one.
- **History pseudostate** — drop a `[H]` target onto any transition without declaring it anywhere.
- **Choice-points rendered distinctly** — drawn as sharp white rectangles so they never get confused with regular states.
- **Selection highlighting** — the selected transition (or a single message on a grouped arrow) is drawn in red on the canvas so you always know what you're editing.
- **Undo / redo** for every mutating action.
- **Save and open** `.json` project files; **export** to `.puml` or `.png`.
- **Built-in user manual** under Help — the full reference is one click away.
- **Single-file** — the entire application is one self-contained HTML file. No build step, no npm, no server. Open the file and it works.

## Quick start

1. Download or clone this repository.
2. Open `stadiae.html` in any modern browser.
3. That's it — start editing.

Alternatively, just click the [live demo link](https://htmlpreview.github.io/?https://raw.githubusercontent.com/computerguided/stadiae/refs/heads/main/stadiae.html) mentioned already above.

> Stadiæ renders diagrams by calling the public PlantUML server at `plantuml.com`, so an internet connection is required for the canvas preview. All editing, saving, and exporting works offline; only the rendered PNG needs the network. If you need fully offline rendering, export to `.puml` and run PlantUML locally.

## Usage at a glance

Open Stadiæ and you'll see:

- A **menu bar** (File / Component / Help)
- A **toolbar** with Save, Undo/Redo, Delete, Add State / Choice-point / Transition / Interface / Message, and Edit
- A **diagram canvas** on the left showing the live render
- Four **lists** (States, Choice-points, Interfaces, Messages) and a **transition table** on the right

**Basic flow:**

1. Set the component name via `Component → Change name…` (or `File → New`).
2. Add an interface, then messages under it.
3. Add states and choice-points.
4. Select a source state, a target, and a message, then click `Add Transition`.
5. Mark the initial state: select `● START` + a state, click `Add Transition`.
6. Save (`.json`) or export (`.puml` / `.png`).

The **complete manual** is available inside the app under `Help → User Manual` — including the full selection rules, keyboard shortcuts, and a troubleshooting guide.

## Generated PlantUML

Stadiæ produces well-structured PlantUML that you can reasonably read and hand-edit. A minimal generated file looks like:

```plantuml
@startuml
'== Formatting ==
hide empty description
skinparam Arrow { FontSize 9 }
skinparam State { FontSize 12 }
<style>
  .choicepoint {
    BackgroundColor #ffffff
    RoundCorner 0
  }
</style>

'== Default interfaces ==
!$Timer = Timer
!$Logical = Logical

'== Default messages ==
!$Timer_Timeout = Timeout
!$Logical_No = No
!$Logical_Yes = Yes

'== Interfaces ==
!$RTx = RTx

'== Messages ==
!$RTx_ConnectReq = $RTx + ":" + ConnectReq

'== Component ==
state component as "Node" {
  state START <<start>> #000000

  '== States ==
  state Advertising

  '== Choice-points ==
  state CP_Whitelisted as "Is Server\nWhitelisted?" <<choicepoint>>

  '== Transitions ==
  START -> Advertising
  Advertising -> CP_Whitelisted : $RTx_ConnectReq
}
@enduml
```

## File format

Saved `.json` files use the `stadiae-v1` format and round-trip losslessly: every property you set in the editor is preserved. The generated PlantUML is always derivable from the JSON, but not vice versa — the JSON is the canonical storage format.

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | New diagram |
| `Ctrl+O` | Open |
| `Ctrl+S` | Save |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Delete` / `Backspace` | Delete selected |

## Limitations

- **Canvas selection via click** — selecting elements by clicking them in the rendered canvas is not implemented. Use the element lists and transition table to build your selection. Clicking the canvas background clears the selection.
- **Requires the public PlantUML server** for preview rendering. Exports to `.puml` work fully offline.
- **No composite states** — Stadiæ covers flat state machines with choice-points and history. Nested/composite states are not supported by the current UI.

## Contributing

Issues and pull requests are welcome. Since the whole tool is a single HTML file, changes are easy to review and easy to try out locally — just open `stadiae.html`.

## License

Add a license of your choice here (e.g. MIT). Pick one before inviting contributions.

## Credits

Built as a GUI front-end for [PlantUML](https://plantuml.com). Renders use the public PlantUML server.
