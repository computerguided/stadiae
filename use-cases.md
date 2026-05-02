# Stadiæ — Use Cases & Scenario Specification

This document specifies the **Stadiæ** state-diagram editor as a set of
**use cases** — the goals a user pursues with the tool — together with
the **scenarios** that achieve each goal. Every scenario is described in
*precondition / sequence / postcondition* form.

A use case is a single objective. A scenario is one way of reaching it.
A typical use case has several scenarios: a primary success path,
variations on it, and the failure or refusal paths the editor can take.
For example, use case 2 — *Model at the device level* — bundles the
goal of working with the diagram as a whole. It is achieved by seven
scenarios: switching to and from device view, renaming the device,
adjusting device-diagram font sizes, and the three ways of managing
type definitions (add, edit, delete). Each scenario has its own
preconditions, steps, and postconditions.

Scenarios are numbered after their use case: scenarios `1.1`, `1.2`,
`1.3` all belong to use case 1; scenario `4.10` belongs to use case 4.
Cross-references between scenarios use the form *Scenario X.Y*.

The set covers the editor in its entirety: managing files, modelling at
the device level, managing components, defining the shared vocabulary,
building state machines, documenting them, navigating and editing them,
configuring the view, exporting, and consulting help.

The actor in every scenario is the **User** working in the browser tab
in which Stadiæ is loaded. "Stadiæ" or "the editor" denotes the
application as a whole — the diagram canvas, the side lists, the menus
and toolbar, and the autosave that runs quietly in the background.

---

## Table of contents

1. [Manage files](#1-manage-files)
2. [Model at the device level](#2-model-at-the-device-level)
3. [Manage components](#3-manage-components)
4. [Define the shared vocabulary](#4-define-the-shared-vocabulary)
5. [Build a state machine — nodes](#5-build-a-state-machine--nodes)
6. [Build a state machine — transitions](#6-build-a-state-machine--transitions)
7. [Document a component](#7-document-a-component)
8. [Edit free-text documentation](#8-edit-free-text-documentation)
9. [Select, edit, and undo](#9-select-edit-and-undo)
10. [Configure view and layout](#10-configure-view-and-layout)
11. [Export](#11-export)
12. [Get help](#12-get-help)

---

## 1. Manage files

**Goal.** Create, save, open, and restore Stadiæ project files. Configure
which PlantUML server is used to render the diagrams.

**Scenarios.** Creating a new diagram, opening one from disk or a URL,
saving and saving-as, restoring an autosaved draft after a crash,
configuring the PlantUML server, and exiting the editor.

### Scenario 1.1 — Start a new diagram

**Precondition.** The editor is open in the browser. The current diagram
may have unsaved edits.

**Sequence.**
1. The User chooses *File → New* (or presses `Ctrl+N`).
2. If there are unsaved edits, Stadiæ asks whether they should be
   discarded. The User confirms.
3. A prompt asks for the initial component's name, with the default
   *"Component Name"*. The User accepts the default or types a different
   name.
4. Stadiæ resets the diagram to a fresh empty state. If the entered
   name contains a space (or any other non-identifier character), the
   space becomes an underscore — so the default *"Component Name"*
   becomes a component called `Component_Name`, with the original text
   used as its display label. Beyond that single component, the new
   diagram has no user-defined interfaces, messages, handlers, or
   connections; the device is called `Device` and its specification is
   empty.
5. The undo and redo history is cleared, nothing is selected, the
   autosaved draft from any previous session is discarded, and the
   diagram is treated as having no associated file on disk.
6. The canvas shows the empty state machine of the new component
   (Stadiæ is in *Component* view).

**Postcondition.** The editor holds an empty, unsaved diagram. The
Components list shows exactly one row, marked active.

---

### Scenario 1.2 — Open a file from disk

**Precondition.** The User has a `.json` file previously saved by Stadiæ
(format tag `stadiae-v4`).

**Sequence.**
1. The User chooses *File → Open* (or presses `Ctrl+O`).
2. If the current diagram has unsaved edits, Stadiæ asks whether they
   should be discarded. The User confirms.
3. The browser's file picker opens. The User selects the `.json` file
   and confirms.
4. If the file is not a `stadiae-v4` Stadiæ file, an error dialog
   explains the rejection and the use case ends.
5. Otherwise Stadiæ loads everything from the file: components,
   handlers, interfaces and messages, connections, type definitions,
   the Device Specification, descriptions, and transition action notes.
   Built-in entries (the `Timer` and `Logical` interfaces, the
   `TimerHandler`, etc.) are always present and are restored on top.
   Any wiring entry that points to something that no longer exists is
   silently dropped.
6. The view is set to **Device view** — Stadiæ deliberately presents
   the device diagram first when a file opens, so the User sees an
   overview of the loaded file before drilling into any one component.
   The first component in the file becomes the active one. Nothing is
   selected. The undo and redo history is cleared. The diagram is
   marked clean, with the opened file as its associated filename.
7. The canvas shows the device diagram.

**Postcondition.** The editor reflects the file's contents. Subsequent
*Save* actions write to the same filename without prompting.

---

### Scenario 1.3 — Open a file from a URL

**Precondition.** The User has the URL of a publicly fetchable Stadiæ
`.json` file, served by a host that allows cross-origin browser
fetches (e.g. `raw.githubusercontent.com`).

**Sequence.**
1. The User chooses *File → Open from URL...*.
2. If the current diagram has unsaved edits, Stadiæ asks whether they
   should be discarded.
3. A dialog asks for the URL. The User pastes the URL and confirms. If
   the URL is a `github.com/.../blob/...` URL, Stadiæ rewrites it to
   its raw equivalent automatically.
4. Stadiæ fetches the file. If the fetch fails because the host
   doesn't permit cross-origin browser access, the error dialog
   suggests trying a host that does; other failures are reported
   verbatim. The use case ends.
5. The fetched file is loaded with the same logic as *Scenario 1.2 (Open a
   file from disk)* steps 4–7, with the view set to *Device*. The
   associated filename is taken from the last segment of the URL (or
   `diagram.json` if the URL doesn't end in `.json`).

**Postcondition.** The editor reflects the fetched file. Subsequent
*Save* actions write to the URL-derived filename without prompting.

---

### Scenario 1.4 — Save the current diagram

**Precondition.** The User wishes to persist the current diagram to
disk. The diagram may or may not already have an associated filename
(from a previous *Open* or *Save As*).

**Sequence.**
1. The User chooses *File → Save* (or presses `Ctrl+S`, or clicks the
   toolbar *Save* button — the toolbar button is enabled only when
   there is both an associated filename and unsaved edits).
2. If there is no associated filename, the use case continues as
   *Scenario 1.5 (Save As...)*.
3. Otherwise, the browser downloads the diagram as a `.json` file
   under the associated filename. The file contains everything the
   editor knows about the diagram; built-in entries and unset optional
   fields are omitted to keep the file compact.
4. The diagram is marked as having no unsaved edits.

**Postcondition.** A `.json` file is on disk. The browser's "leave
page?" warning will no longer appear unless the User makes new edits.

---

### Scenario 1.5 — Save under a new filename

**Precondition.** The User has any diagram, saved or unsaved.

**Sequence.**
1. The User chooses *File → Save As...*.
2. The browser's save-file dialog opens. The User picks a filename
   ending in `.json` and confirms.
3. The browser writes the file as in *Scenario 1.4* step 3.
4. The new filename becomes the diagram's associated filename for
   subsequent *Save* actions.

**Postcondition.** The `.json` file exists on disk. The diagram has no
unsaved edits.

---

### Scenario 1.6 — Restore an autosaved draft after browser closure

**Precondition.** The User had a diagram open when the browser tab was
closed, the page was refreshed, or the browser crashed. As the User
worked, Stadiæ was quietly autosaving every change to a draft kept
inside the browser itself (separate from any file on disk).

**Sequence.**
1. The User reopens Stadiæ in the same browser. Stadiæ finds the draft
   and restores the diagram from it. If the User had unsaved edits at
   the time, those edits are present and the diagram is shown as
   having unsaved edits; if the User had just saved to disk, the
   restored diagram is shown as clean.
2. A small banner appears at the top of the canvas reading *"Restored
   unsaved work from your previous session."* with two buttons:
   **Keep** and **Discard**.
3. The banner disappears automatically after about 8 seconds, or when
   the User clicks either button.
   - **Keep:** the banner is removed and the User continues working
     with the restored diagram.
   - **Discard:** the banner is removed, the autosaved draft is
     thrown away, and Stadiæ resets to a fresh empty diagram (no
     prompt for a component name, unlike *Scenario 1.1*; the slug
     `Component_Name` is used directly).

**Postcondition.** The User is editing either the restored diagram or
a fresh empty one. Autosave continues in the background as the User
works.

---

### Scenario 1.7 — Configure the PlantUML server

**Precondition.** Stadiæ is open. The User wishes to switch between the
public `plantuml.com` server and a local PlantUML server, or change the
URL of the local server.

**Sequence.**
1. The User opens the configuration dialog via *File → PlantUML server...*
   or by clicking the small `plantuml:` indicator in the menu bar.
2. The dialog presents two options: *Online — plantuml.com* and *Local
   server*. Selecting *Local server* enables the *Base URL* field.
3. The User picks an option, edits the base URL if applicable, and
   confirms. The dialog shows a live preview of the resulting request
   URL so the User can verify it before committing.
4. Stadiæ remembers the choice between sessions.
5. The canvas re-renders against the new server.

**Postcondition.** Subsequent diagram renders, click-selection on the
canvas, and `.docx` specification exports use the configured server.
The `plantuml:` indicator in the menu bar reflects the new state (blue
dot for online, green for local).

---

### Scenario 1.8 — Exit the editor

**Precondition.** The User has finished working and wishes to close
Stadiæ.

**Sequence.**
1. **Via the menu.** Choosing *File → Exit* opens an alert reading *"In
   a desktop app this would close the application. Close the browser
   tab to exit."* The menu item is informational — it does not
   actually close anything. The User dismisses the alert.
2. **Via the browser.** The User closes the browser tab (or window)
   the normal way. If the diagram has unsaved edits, the browser shows
   its "leave page?" warning. The User confirms.
3. Whatever the latest state of the diagram was, autosave has already
   captured it (with a small delay), so a subsequent visit to Stadiæ
   in the same browser can restore it (see *Scenario 1.6*).

**Postcondition.** The browser tab closes (when the User uses the
browser's own close action). The autosaved draft persists for next
time.

---

## 2. Model at the device level

**Goal.** Work with the diagram as a whole: switch between the device
view and component views, name the device, adjust device-diagram font
sizes, and define the named domain types used throughout the model.

**Scenarios.** Switching to and from device view, renaming the device,
adjusting device-diagram font sizes, and adding, editing, or deleting
type definitions.

### Scenario 2.1 — Switch to the device view

**Precondition.** The editor is in *Component* view (the default).

**Sequence.**
1. The User clicks the floating `◇ Device` button at the top-left of
   the diagram canvas.
2. The canvas switches to the device diagram and the component-only
   panels (States, Choice-points, State variables, Constants, Local
   functions, Steps, Transitions, Action) disappear from view. The
   current selection is cleared.

**Postcondition.** The canvas shows the device diagram: components as
boxes, handlers as 3D-brick boxes, interfaces as lollipops, all wiring
lines, and the outer device box. The Device button is accent-coloured.
The `Component ▸` button at the top-right of the canvas is now visible.

---

### Scenario 2.2 — Return to a component's state machine

**Precondition.** The editor is in *Device* view.

**Sequence.**
1. The User selects exactly one component, either by clicking its box
   on the canvas or its row in the Components list.
2. The User clicks the floating `Component ▸` button at the top-right
   of the diagram canvas.
3. The canvas switches to the selected component's state machine, the
   component-only panels reappear, and the chosen component becomes
   the active one. The current selection is cleared.

**Alternative.** From *Component* view, simply clicking another row in
the Components list switches the active component directly without
needing the device view.

**Postcondition.** The canvas shows the active component's state
machine. The Components list shows a chevron `▸` next to the active
component.

---

### Scenario 2.3 — Rename the device

**Precondition.** The editor is in *Device* view (the *Device* menu is
hidden in *Component* view).

**Sequence.**
1. The User chooses *Device → Change name...*.
2. A dialog presents two fields: the identifier-safe *Name* (defaults
   to `Device`) and the optional free-text *Display name* (which may
   include `\n` for line breaks). There is no Description field — the
   device's long-form documentation is the *Device Specification*
   panel below the canvas (see *Scenario 8.1*).
3. The User edits the fields and confirms. Stadiæ rejects the change
   if the Name is empty, contains spaces, or otherwise isn't a valid
   identifier.
4. The device diagram re-renders with the new outer-box label.

**Postcondition.** The device's Name and Display name are updated. The
default filename for spec exports becomes `<deviceName>-spec.{html|docx}`.

---

### Scenario 2.4 — Adjust device-diagram font sizes

**Precondition.** The editor is in *Device* view.

**Sequence.**
1. The User chooses *Device → Change component/handler font size...*
   (for component and handler box labels) or *Device → Change interface
   font size...* (for interface lollipop labels).
2. A dialog asks for an integer point size and shows the current
   value. The User enters a new value and confirms.
3. The device diagram re-renders at the new font size.

**Postcondition.** The label sizes on the device diagram are adjusted.
Component-view (state machine) font sizes are unaffected.

---

### Scenario 2.5 — Add a type definition

**Precondition.** The editor is in *Device* view.

**Sequence.**
1. The User chooses *Device → Type definitions...*. The Type
   Definitions dialog opens with two side-by-side panes: a list of
   existing types on the left, the selected type's full body on the
   right.
2. The User clicks *Add*. A sub-dialog asks for *Name* (identifier-
   safe, unique device-wide), optional *Description* (single line),
   and optional *Specification* (free multi-line text).
3. The User confirms. The new type appears in the list, sorted
   alphabetically.
4. The User closes the Type Definitions dialog.

**Postcondition.** The new type is available device-wide. It appears
in autocomplete suggestions wherever a *Type* field is shown
(parameter dialogs, state-variable dialog), and it gets a chapter in
the specification export. Backtick references that name the type
resolve from now on.

---

### Scenario 2.6 — Edit a type definition

**Precondition.** The editor is in *Device* view. At least one
user-defined type exists.

**Sequence.**
1. The User chooses *Device → Type definitions...*.
2. The User selects a type in the list and clicks *Edit* (or
   double-clicks the row). The sub-dialog opens with the existing
   *Name*, *Description*, and *Specification* values.
3. The User edits the fields and confirms.
4. If the *Name* changed, the rename cascades: every backtick
   reference to the type in the diagram's prose is updated, and
   every parameter and state-variable *Type* field that names this
   type exactly switches to the new name. Type fields that contain
   the name as part of a longer string (e.g. `List<UserId>`) are
   *not* auto-rewritten — those need manual updates.
5. The User closes the Type Definitions dialog.

**Postcondition.** The type definition reflects the edits. References
elsewhere in the diagram are consistent with the new name.

---

### Scenario 2.7 — Delete a type definition

**Precondition.** The editor is in *Device* view. At least one
user-defined type exists.

**Sequence.**
1. The User chooses *Device → Type definitions...*.
2. The User selects a type in the list and clicks *Delete*.
3. Stadiæ asks for confirmation. The User confirms.
4. The User closes the Type Definitions dialog.

**Postcondition.** The type is gone from the type definitions list,
and the *Type definitions* chapter of the specification export
shrinks accordingly. References to the deleted type in prose, and
parameter and state-variable *Type* fields that named it, are *not*
auto-rewritten — they show as unresolved in the spec preview until
the User fixes them.

---

## 3. Manage components

**Goal.** Add, switch between, rename, and remove components — the
top-level state machines that make up the device. A diagram always
holds at least one component.

**Scenarios.** Adding a component, switching the active component,
renaming or otherwise editing a component, and deleting a component.

### Scenario 3.1 — Add a component

**Precondition.** The editor is in either view.

**Sequence.**
1. The User clicks the `+` button in the Components list header.
2. A dialog asks for *Name* (identifier-safe, unique among components
   and handlers), optional *Display name* (may contain `\n` line
   breaks), and an optional *Multiplication* marker (free text, e.g.
   `N`). There is no Description field in this dialog — the
   component's description is edited via the Description panel (see
   *Scenario 8.2*).
3. The User fills in the fields and confirms.
4. The new component appears in the Components list and **becomes the
   active component**. The current selection is cleared.
5. The chevron `▸` moves to the new row and the canvas shows the new
   (empty) state machine.

**Postcondition.** The new component exists and is active. The User
can immediately add states, choice-points, and transitions to it.

---

### Scenario 3.2 — Switch the active component

**Precondition.** The diagram has at least two components. The editor
is in *Component* view.

**Sequence.**
1. The User clicks a row in the Components list other than the active
   one.
2. The clicked component becomes the active one, the canvas switches
   to its state machine, and the current selection is cleared. The
   chevron `▸` moves to the new row. The States, Choice-points, State
   variables, Constants, Local functions, and Transitions panels all
   refresh to show this component's contents.

**Postcondition.** The canvas and the component-local panels reflect
the newly active component. Shared catalogues (Interfaces, Messages,
Handlers, Functions) are unchanged.

---

### Scenario 3.3 — Rename a component (or change display name, multiplication)

**Precondition.** The User wishes to edit a component. In *Component*
view, the active component can be edited via the *Component* menu; in
either view, any component selected in the Components list can be
edited via the list's `✎` button.

**Sequence.**
1. The User selects the target component's row in the Components list
   and clicks `✎`. (Alternatively, for the active component in
   *Component* view, *Component → Change name...*.)
2. The dialog opens with the existing values for *Name*, *Display
   name*, and *Multiplication*. (The *Description* is not in this
   dialog — it's edited via the Description panel; see *Scenario 8.2*.)
3. The User edits the fields and confirms. Stadiæ rejects the change
   if the new Name isn't a valid identifier or clashes with another
   component or handler.
4. **Multiplication conflict check.** If the User is setting a
   non-empty *Multiplication*, Stadiæ checks every interface this
   component is already wired to. If any of those interfaces is also
   wired to a different multiplied component, Stadiæ refuses with an
   error dialog naming the conflicting other component. The User must
   disconnect first or remove the other multiplication.
5. If the Name changed, Stadiæ rewrites every backtick reference to
   the old name in the diagram's prose (qualified `OldName:Member`
   references and bare `OldName` references — component names are
   visible everywhere). The component is then renamed and any wiring
   that referenced it (interface connections, handler-call
   dependencies, current selection) follows automatically.

**Postcondition.** The component's identity, label, and multiplicity
marker are updated. All references in prose and connections are
consistent. A single `Ctrl+Z` reverses the rename together with the
prose rewrites — they're a single undoable step.

---

### Scenario 3.4 — Delete a component

**Precondition.** The diagram has at least two components (the last
remaining component cannot be deleted). The User wants to remove one.

**Sequence.**
1. The User selects the target component's row in the Components list
   and clicks `−`.
2. Stadiæ shows a confirmation dialog noting that the component's
   states, choice-points, transitions, state variables, constants, and
   local functions will be removed.
3. The User confirms. The component is removed from the Components
   list, along with every interface connection and handler-call
   dependency that referenced it.
4. If the deleted component was the active one, the previous (or
   first remaining) component takes its place.

**Postcondition.** The component is gone. Backtick references to the
deleted component or its members in prose now render as unresolved
(warning style).

---

## 4. Define the shared vocabulary

**Goal.** Build the shared catalogue of interfaces, messages, handlers,
and the wiring that connects them on the device diagram. The vocabulary
defined here is what the components in UC-3 use to talk to each other
and to the outside world.

**Scenarios.** Adding interfaces, messages, and message parameters;
adding handlers, their functions, and the function parameters; the
three wiring patterns on the device diagram (component to interface,
handler to interface, component to handler); adjusting the direction
or length of a connection; and the rename and delete paths for shared
interfaces and messages.

### Scenario 4.1 — Add an interface

**Precondition.** The editor is open, in either view.

**Sequence.**
1. The User clicks the `+` button in the Interfaces list header.
2. A dialog asks for *Name* (identifier-safe, unique among interfaces)
   and optional *Description*.
3. The User confirms. The new interface appears in the Interfaces list
   and is automatically selected, so the User can immediately add its
   first message.

**Postcondition.** The new interface is available in the Interfaces
list across all components. It does not appear on the device diagram
until at least one connection is wired to it.

---

### Scenario 4.2 — Add a message to an interface

**Precondition.** Exactly one non-default interface is selected.

**Sequence.**
1. The User clicks the `+` button in the Messages list header.
2. A dialog asks for *Name* (identifier-safe, unique within the parent
   interface) and optional *Description*.
3. The User confirms. The new message appears in the Messages list
   under the selected interface.

**Postcondition.** The new message is available for use in transitions
of any component.

---

### Scenario 4.3 — Add a message parameter

**Precondition.** Exactly one non-default message is selected. The
Parameters panel below the Messages list is visible.

**Sequence.**
1. The User clicks the `+` button in the Parameters panel header.
2. A dialog asks for *Name* (identifier-safe, unique within the
   message), optional *Type* (free text; autocompletes against the
   defined type names), and optional *Description*.
3. The User confirms. The new parameter appears in the Parameters
   panel, in alphabetical order.

**Postcondition.** The parameter is shown as
`name : type — description`. It is documentation only — it never
reaches the generated PlantUML — but it appears in the spec export's
message table and can be the target of three-segment backtick
references like `Iface:Msg:Param`.

---

### Scenario 4.4 — Edit a message parameter

**Precondition.** Exactly one non-default message is selected, and
exactly one of its parameters is selected in the Parameters panel.

**Sequence.**
1. The User clicks the `✎` button on the parameter row (or presses
   `Enter`).
2. The dialog opens with the existing *Name*, *Type*, and
   *Description* values. The User edits them and confirms.
3. If the *Name* changed, every three-segment backtick reference
   `Iface:Msg:Old` in the diagram's prose is rewritten to point at
   the new name (with the limitation noted in *Scenario 9.6* for the
   action-context shorthand).

**Postcondition.** The parameter reflects the edits. References to
it elsewhere in the diagram are consistent (with the shorthand
exception noted above).

---

### Scenario 4.5 — Add a handler

**Precondition.** The editor is open, in either view.

**Sequence.**
1. The User clicks the `+` button in the Handlers list header.
2. A dialog asks for *Name* (identifier-safe, unique among components
   and handlers) and optional *Display name*. Handlers do not have a
   Multiplication field, and the Handler's Description is edited via
   the Description panel (see *Scenario 8.2*) — not in this dialog.
3. The User confirms. The new handler appears in the Handlers list
   with no functions and no description yet.
4. **Auto-switch to Device view.** If the editor was in *Component*
   view, Stadiæ switches to *Device* view automatically — handlers
   only show on the device diagram, and the User will want to see
   what was just added.

**Postcondition.** The new handler appears in the Handlers list and on
the device diagram. The built-in `TimerHandler` remains muted and
locked from edits.

---

### Scenario 4.6 — Add a handler function

**Precondition.** Exactly one non-default handler is selected. The
Functions list is visible and shows that handler's existing
functions.

**Sequence.**
1. The User clicks the `+` button in the Functions list header.
2. A dialog asks for *Name* (identifier-safe, unique within the
   handler) and optional *Description*.
3. The User confirms. The new function appears in the Functions
   list.

**Postcondition.** The handler exposes a new function. It has no
parameters yet (see *Scenario 4.8* to add them). The function is
documentation only — it never reaches the generated PlantUML — but
it appears in the spec export's handler chapter.

---

### Scenario 4.7 — Edit a handler function

**Precondition.** Exactly one function is selected in the Functions
list of a non-default handler.

**Sequence.**
1. The User clicks the `✎` button on the function row (or presses
   `Enter`).
2. The dialog opens with the existing *Name* and *Description*. The
   User edits them and confirms.
3. If the *Name* changed, every backtick reference `Handler:Old` in
   the diagram's prose is rewritten, plus any bare `Old` references
   inside the owning handler's own description.

**Postcondition.** The function reflects the edits. References to
it elsewhere in the diagram are consistent.

---

### Scenario 4.8 — Add a handler-function parameter

**Precondition.** Exactly one function is selected in the Functions
list of a non-default handler. The Parameters panel below the
Functions list is visible.

**Sequence.**
1. The User clicks the `+` button in the Parameters panel header.
2. A dialog asks for *Name* (identifier-safe, unique within the
   function), optional *Type* (free text; autocompletes against
   the defined type names), and optional *Description*.
3. The User confirms. The new parameter appears in the Parameters
   panel, in alphabetical order.

**Postcondition.** The parameter is shown as
`name : type — description`. Like the function itself, it is
documentation only and appears in the spec export's handler chapter.

---

### Scenario 4.9 — Edit a handler-function parameter

**Precondition.** Exactly one function is selected, and exactly one
of its parameters is selected in the Parameters panel.

**Sequence.**
1. The User clicks the `✎` button on the parameter row (or presses
   `Enter`).
2. The dialog opens with the existing *Name*, *Type*, and
   *Description* values. The User edits them and confirms.
3. If the *Name* changed, every three-segment backtick reference
   `Handler:Function:Old` in the diagram's prose is rewritten.

**Postcondition.** The parameter reflects the edits. References to
it elsewhere in the diagram are consistent.

---

### Scenario 4.10 — Wire a component to an interface

**Precondition.** The editor is in *Device* view. The component and the
interface both exist (the interface is non-default — `Timer` and
`Logical` aren't wired explicitly).

**Sequence.**
1. The User selects exactly one **Component** and one non-default
   **Interface** — in the Components and Interfaces lists or directly
   on the canvas. Nothing else is selected.
2. The User clicks the *Add Connection* toolbar button.
3. **Multiplication check.** If the component carries a multiplication
   marker (e.g. `N`) and the interface is already wired to a different
   multiplied component, Stadiæ refuses with an error dialog naming
   the other multiplied component, and the use case ends. (At most one
   multiplied component per interface.)
4. Otherwise a new wiring line is drawn between the component and the
   interface, pointing to the right by default. The device diagram
   updates to show it. If the component is multiplied, the interface
   is wrapped in the same multiplication rectangle on the diagram and
   its label gets a `[]` suffix.

**Postcondition.** The device diagram shows the new wiring line. If
the same interface also has a Handler wired to it, the Component-side
line is drawn with an arrowhead pointing at the Component — Stadiæ
infers from the topology that the Handler is the sender on that
interface and the Component the receiver.

**Failure mode.** Multiplication invariant violation (step 3) — the
User must remove the conflicting connection or change one of the
multiplications before retrying.

---

### Scenario 4.11 — Wire a handler to an interface

**Precondition.** The editor is in *Device* view. The handler and the
interface both exist (the interface is non-default).

**Sequence.**
1. The User selects exactly one **Handler** and one non-default
   **Interface** — in the Handlers and Interfaces lists or directly
   on the canvas. Nothing else is selected.
2. The User clicks the *Add Connection* toolbar button.
3. A new wiring line is drawn between the handler and the interface,
   pointing to the right by default. By being on this interface the
   handler is implicitly declared as the sender of the interface's
   messages — components wired to the same interface are the
   receivers.

**Postcondition.** The device diagram shows the new wiring line. Any
Component–Interface lines on the same interface gain an arrowhead
pointing at the Component (the Handler is now the inferred sender;
the Components are receivers).

---

### Scenario 4.12 — Wire a component to a handler (call dependency)

**Precondition.** The editor is in *Device* view. The component and
the handler both exist. The User wishes to record that the component
calls one or more of the handler's functions directly (not via an
interface).

**Sequence.**
1. The User selects exactly one **Component** and one **Handler** —
   in the Components and Handlers lists or directly on the canvas.
   Nothing else is selected.
2. The User clicks the *Add Connection* toolbar button.
3. A new call-dependency line is drawn from the component to the
   handler, pointing to the right by default.

**Postcondition.** The device diagram shows the new line. The
dependency is documentation only — it doesn't change which functions
the component can reference from action text (any handler function
can already be referenced by qualified name; this line just makes the
relationship visible on the device diagram and in the spec export's
component context diagram).

---

### Scenario 4.13 — Adjust connection direction or length

**Precondition.** Exactly one connection (Component–Interface,
Handler–Interface, or Component → Handler) is selected on the device
canvas.

**Sequence.**
1. The User opens the Connection Properties dialog by pressing
   `Enter`. *Or* the User uses the arrow-key shortcut: `←` `→` `↑` `↓`
   change the connection's direction directly without opening the
   dialog.
2. In the dialog, the User picks one of *Right / Left / Up / Down* and
   for *Up* and *Down* sets a *Length* (number of dashes). The User
   confirms.
3. Repeated `↑` or `↓` keystrokes via the shortcut path extend the
   length by one dash each press, with undo coalescing — the entire
   keystroke run is one undo step.

**Postcondition.** The device diagram shows the connection in the new
direction and length.

---

### Scenario 4.14 — Delete a connection or a wiring entry

**Precondition.** One or more connections or wiring entries are
selected on the device canvas (or in the Components, Handlers, or
Interfaces lists).

**Sequence.**
1. The User presses `Delete` (or `Backspace`).
2. The selected wiring lines are removed from the device diagram.
   Interfaces left without any wiring disappear from the canvas
   (they remain in the Interfaces list).

**Postcondition.** The selected connections are gone. State machines
and their transitions are unaffected, but the wiring-vs-usage warning
device may now flag interfaces as unwired.

---

### Scenario 4.15 — Rename a shared interface

**Precondition.** Exactly one non-default interface is selected.

**Sequence.**
1. The User clicks `✎` (or presses `Enter`).
2. The dialog opens with the existing *Name* and *Description*. The
   User edits them and confirms. Stadiæ rejects the change if the
   new Name isn't a valid identifier or clashes with another
   interface.
3. If the *Name* changed, Stadiæ rewrites every backtick reference
   to the old name across the diagram's prose (qualified
   `OldIface:Member` and bare `OldIface`), then renames the
   interface. Transitions in every component and the wiring on the
   device diagram follow automatically.

**Postcondition.** The interface has its new name. References in
prose, transitions, and wiring are consistent. A single `Ctrl+Z`
reverses the rename together with the prose rewrites.

---

### Scenario 4.16 — Rename a message

**Precondition.** Exactly one non-default message is selected.

**Sequence.**
1. The User clicks `✎` (or presses `Enter`).
2. The dialog opens with the existing *Name* and *Description*. The
   User edits them and confirms. Stadiæ rejects the change if the
   new Name isn't a valid identifier or clashes with another
   message of the same interface.
3. If the *Name* changed, Stadiæ rewrites every backtick reference
   `Iface:Old` and every parameter reference `Iface:Old:Param` in
   the diagram's prose, then renames the message. Every transition
   that used the message follows automatically.

**Postcondition.** The message has its new name. References in
prose and transitions are consistent.

---

### Scenario 4.17 — Delete a shared interface

**Precondition.** Exactly one non-default interface is selected.

**Sequence.**
1. The User clicks `−` (or presses `Delete`).
2. Stadiæ asks for confirmation. The User confirms.
3. The interface is removed from the Interfaces list. Cascades:
   - Every message under the interface disappears.
   - Every transition that used those messages drops the message
     row; if a transition arrow is left with no messages, the
     arrow itself disappears (except for the initial transition,
     which is allowed to have no messages).
   - Every wiring line on the interface (component-side or
     handler-side) is removed from the device diagram.
4. Backtick references to the deleted interface or any of its
   messages or parameters become unresolved.

**Postcondition.** Lists, diagrams, and Transitions tables are
consistent across the diagram.

---

### Scenario 4.18 — Delete a message

**Precondition.** Exactly one non-default message is selected.

**Sequence.**
1. The User clicks `−` (or presses `Delete`).
2. Stadiæ asks for confirmation. The User confirms.
3. The message is removed from the Messages list. Cascades:
   - Every transition that used the message drops the message row;
     if an arrow is left with no messages, the arrow itself
     disappears (except for the initial transition).
4. Backtick references to the deleted message or its parameters
   become unresolved.

**Postcondition.** The message is gone. Transitions tables and
state-machine diagrams reflect the change.

---

## 5. Build a state machine — nodes

**Goal.** Add and edit the nodes of the active component's state
machine: states (where the component sits) and choice-points (where
it branches on a Yes/No question).

**Scenarios.** Adding a state, editing a state, adding a choice-point,
and deleting either kind. (Choice-point editing follows the same
dialog mechanics as state editing and is implicit in *Scenario 5.2*.)

### Scenario 5.1 — Add a state

**Precondition.** The editor is in *Component* view, with an active
component.

**Sequence.**
1. The User clicks the `+` button in the States list header.
2. A dialog asks for *Name* (identifier-safe, unique among the
   component's states and choice-points; cannot be `START` or
   `component`), optional *Display name* (may contain `\n`), and
   optional *Description*.
3. The User confirms. The state machine on the canvas updates to show
   the new state.

**Postcondition.** The new state exists. It can be a transition source
or target in the active component.

---

### Scenario 5.2 — Edit a state (rename, change display name, description)

**Precondition.** Exactly one state (not the START pseudostate) is
selected in the States list or on the canvas.

**Sequence.**
1. The User clicks `✎` (or presses `Enter`).
2. The dialog opens with the existing values. The User edits and
   confirms. Stadiæ rejects the change if the new Name isn't a valid
   identifier or clashes with another state or choice-point in the
   same component.
3. If the Name changed, Stadiæ rewrites every backtick reference to
   the old name across the diagram's prose, then renames the state.
   Every transition that pointed to or from the old name follows
   automatically, and the state stays selected through the rename.

**Postcondition.** The state's identity, label, and description are
updated consistently across the component.

---

### Scenario 5.3 — Add a choice-point

**Precondition.** The editor is in *Component* view.

**Sequence.**
1. The User clicks the `+` button in the Choice-points list header.
2. A dialog asks for *Name* (identifier-safe, unique among the
   component's states and choice-points), *Question* (the text shown
   on the diagram; may contain `\n`), and optional *Description*.
3. The User confirms.

**Postcondition.** The choice-point appears as a white rectangle on
the diagram. It can be the target of any state's transition and the
source of exactly one *Yes* and one *No* outgoing transition.

---

### Scenario 5.4 — Delete a state or choice-point

**Precondition.** One or more states (not START) and/or choice-points
are selected.

**Sequence.**
1. The User presses `Delete` (or clicks `−` in the corresponding list
   header).
2. The selected nodes are removed from the active component's state
   machine, along with every transition that had a deleted node as
   its source or target.

**Postcondition.** The component's state machine is consistent.
Backtick references in prose pointing to deleted nodes become
unresolved.

---

## 6. Build a state machine — transitions

**Goal.** Add, edit, document, redirect, and delete the transitions
that connect the nodes of a component's state machine.

**Scenarios.** Six flavours of transition (initial, state-to-state,
Yes-No branch, history, wildcard source, wildcard message), grouping
multiple messages on a single arrow, editing a transition's direction
and length, redirecting a transition, documenting a transition's
action, and deleting a transition or one of its message rows.

### Scenario 6.1 — Add an initial (START) transition

**Precondition.** The active component does *not* yet have a START
transition.

**Sequence.**
1. The User selects the **START** pseudostate in the States list and
   exactly one target state. No message is selected.
2. The User clicks *Add Transition*.
3. The diagram now shows a black dot leading into the chosen state.

**Postcondition.** The component has its initial transition. A
component has at most one START transition; *Add Transition* is
disabled while one already exists with START selected.

---

### Scenario 6.2 — Add a state-to-state transition with one or more messages

**Precondition.** The active component has at least two states (or
one state and one choice-point, or one state for a self-transition).

**Sequence.**
1. The User selects the source and target nodes (in any order). For
   a self-transition, the User selects exactly one state.
2. The User selects one or more messages in the Messages list. The
   messages must be non-`Yes`/`No` (a state cannot emit `Yes` or `No`).
3. The User clicks *Add Transition*.
4. **Direction inference.** With two distinct nodes, the node clicked
   first becomes the source. If both directions would be invalid
   (typically because both candidate sources already handle one of
   the selected messages), Stadiæ asks explicitly.
5. **Determinism guard.** If the chosen source already handles any of
   the selected messages anywhere in this component, Stadiæ refuses
   the addition and reports the conflict.
6. If a transition already exists between the chosen source and
   target, the new messages are added to that arrow (grouped on the
   same arrow). Otherwise a new arrow is drawn, pointing to the right
   by default.

**Postcondition.** The diagram shows the new (or extended) arrow. The
Transitions table grows by one row per added message.

---

### Scenario 6.3 — Add a choice-point branch (Yes / No)

**Precondition.** A choice-point exists. Its outgoing branches are not
both already defined.

**Sequence.**
1. The User selects the choice-point (source) and exactly one other node
   (target — a state or another choice-point).
2. The User selects exactly one of the messages `Logical:Yes` or
   `Logical:No`.
3. The User clicks *Add Transition*.

**Postcondition.** The diagram shows a labelled `Yes` or `No` arrow
leaving the choice-point. A choice-point may have at most one *Yes*
outgoing and at most one *No* outgoing transition.

---

### Scenario 6.4 — Add a history transition

**Precondition.** The active component has at least one state or
choice-point.

**Sequence.**
1. The User selects the **H (history)** pseudostate in the States
   list, exactly one source node (state or choice-point), and one or
   more messages.
2. The User clicks *Add Transition*.
3. The diagram shows an arrow from the source into a circled `H`.

**Postcondition.** Multiple history transitions are allowed; each is
shown as its own H icon on the diagram.

---

### Scenario 6.5 — Add an ANY-source (wildcard) transition

**Precondition.** The active component has at least one state or
choice-point.

**Sequence.**
1. The User selects the **∗ (any)** pseudostate in the States list,
   exactly one target node, and one or more non-`Yes`/`No` messages.
2. The User clicks *Add Transition*.
3. The diagram shows an arrow from a `*` icon to the target. Multiple
   ANY-source transitions appear as separate `*` icons.

**Postcondition.** A given message may be used on at most one
ANY-source transition at a time.

---

### Scenario 6.6 — Add an ANY-message wildcard on a transition

**Precondition.** A source state and a target state (or choice-point)
are selected, plus the wildcard pseudo-row in the Messages list
(either the global `*:*` at the top, or the per-interface `Iface:*`
row that appears when an interface is selected).

**Sequence.**
1. The User clicks *Add Transition*.
2. The wildcard message is added to the transition. The same rules
   apply as for any other transition addition, with these extras:
   - At most one global wildcard per source state.
   - At most one per-interface wildcard per interface per source
     state.
   - Wildcards cannot be sourced from a choice-point.
   - Wildcards cannot be mixed with `Yes`/`No` on the same transition.

**Postcondition.** The Transitions table shows a row with `*` (or
`Iface:*`) as the message. At runtime, this transition matches any
otherwise-unhandled message in the source state, with explicit
messages taking precedence over per-interface wildcards over the
global wildcard.

---

### Scenario 6.7 — Group multiple messages on one arrow

**Precondition.** A transition between a particular source and target
already exists (created via *Scenario 6.2* or similar). The same source and
target pair, plus extra messages, are selected.

**Sequence.**
1. The User selects the same source and target as the existing
   transition, plus one or more new messages not yet on that arrow.
2. The User clicks *Add Transition*.
3. The new messages are added to the existing arrow. The determinism
   guard still applies — the source must not already handle the new
   messages anywhere else.

**Postcondition.** The diagram shows the additional message labels
stacked on the same arrow. The Transitions table shows one row per
message; rows can be selected and edited individually.

---

### Scenario 6.8 — Edit a transition's connector direction and length

**Precondition.** Exactly one transition is selected in the
Transitions table or on the canvas (every message of the transition
selected — see *Scenario 9.5* for per-message selection).

**Sequence.**
1. The User opens the Transition Properties dialog by pressing
   `Enter`, *or* uses the arrow-key shortcut.
2. *Dialog path.* The User picks *Right / Left / Up / Down* and (for
   *Up* and *Down*) a *Length* (number of dashes). The User confirms.
3. *Shortcut path.* Pressing `←` `→` `↑` `↓` directly sets the
   direction. Repeated `↑` or `↓` extends the length by one dash per
   press, with undo coalescing into a single step.

**Postcondition.** The diagram shows the transition in the new
direction and length. Self-transitions are fixed at `->` and ignore
the shortcut.

---

### Scenario 6.9 — Redirect a transition to a different target

**Precondition.** One or more transition rows are selected in the
Transitions table, and exactly one target node (state, choice-point,
or H pseudostate) is selected.

**Sequence.**
1. The User clicks the *Redirect* toolbar button.
2. Stadiæ checks every selected redirect first: if any one of them
   would create a duplicate transition (the source already handles
   that message at the new target) or would be a no-op (the row
   already targets the chosen node), Stadiæ aborts the entire
   operation before any change and lists the conflicts.
3. Otherwise, each selected row moves to point at the new target.
   Original messages and action notes are preserved. Rows from
   different sources are redirected independently.
4. The redirected rows become the new selection.

**Postcondition.** The Transitions table reflects the new arrows.
Action notes and message identities are preserved.

---

### Scenario 6.10 — Document a transition's action

**Precondition.** Exactly one row in the Transitions table is selected
(a single message of a single transition; not the initial transition,
which has no message and no action).

**Sequence.**
1. The Action panel (right of the Transitions table) opens to an
   editable textarea showing the selected row's action note.
2. The User types prose into the textarea. Edits save as the User
   types — no explicit *Save* needed. A whole typing session counts
   as one undo step, so a single `Ctrl+Z` reverses the lot.
3. The User clicks elsewhere or selects a different row to end the
   editing session.
4. Backtick references in the action text render in styled monospace
   with hover tooltips when the field loses focus (the live preview);
   pressing `Esc` blurs the field as a shortcut.

**Postcondition.** The transition row has its action note. The note
is persisted in the saved `.json` and rendered in the spec export,
but never in the generated PlantUML. A small accent-coloured dot in
the indicator column of the row marks it as having an action.

---

### Scenario 6.11 — Delete a transition or a single message row

**Precondition.** One or more rows in the Transitions table are
selected, or a whole transition arrow is selected on the canvas.

**Sequence.**
1. The User presses `Delete` (or clicks `−`).
2. The selected message rows are removed. If a transition is left
   with no messages as a result, the whole arrow is removed (except
   the initial transition, which is allowed to have no messages).
3. Selecting an arrow on the canvas selects all of its message rows
   together; pressing `Delete` then removes the entire arrow at once.

**Postcondition.** The diagram and Transitions table are consistent.

---

## 7. Document a component

**Goal.** Capture the data, named values, and reusable behaviour
fragments that belong to a single component but never reach the
generated PlantUML — state variables, constants, and local functions.
These documentation entries appear as their own sections in the spec
export and can be referenced by name from action text.

**Scenarios.** Add, edit, and delete for each of state variables,
constants, and local functions; plus a separate scenario for editing
a local function's multi-line step body in the Steps panel.

### Scenario 7.1 — Add a state variable

**Precondition.** The editor is in *Component* view.

**Sequence.**
1. The User clicks the `+` button in the State variables list
   header.
2. A dialog asks for *Name* (identifier-safe, unique among the
   component's state variables), optional *Type* (free text;
   autocompletes from the defined type names), and optional
   *Description* (one line).
3. The User confirms.

**Postcondition.** The state variable appears in the State variables
list as `name : type — description`. It is documentation only and
never reaches the generated PlantUML, but it appears as a section in
the component's chapter of the spec export. It can be referenced by
name from action text (bare reference inside the owning component).

---

### Scenario 7.2 — Edit a state variable

**Precondition.** Exactly one state variable is selected in the
State variables list.

**Sequence.**
1. The User clicks the `✎` button on the row (or presses `Enter`).
2. The dialog opens with the existing *Name*, *Type*, and
   *Description*. The User edits them and confirms.
3. If the *Name* changed, every backtick reference `Component:Old`
   in the diagram's prose is rewritten, plus any bare `Old`
   references inside the owning component's prose.

**Postcondition.** The state variable reflects the edits.
References to it elsewhere in the diagram are consistent.

---

### Scenario 7.3 — Add a constant

**Precondition.** The editor is in *Component* view.

**Sequence.**
1. The User clicks the `+` button in the Constants list header.
2. A dialog asks for *Name* (identifier-safe, unique among the
   component's constants), free-text *Value* (any notation: `30
   seconds`, `0xFF`, `42`, an enum literal — no type discipline),
   and optional *Description*.
3. The User confirms.

**Postcondition.** The constant appears in the Constants list as
`name = value — description`. It is documentation only and can be
referenced by name from action text.

---

### Scenario 7.4 — Edit a constant

**Precondition.** Exactly one constant is selected in the Constants
list.

**Sequence.**
1. The User clicks the `✎` button on the row (or presses `Enter`).
2. The dialog opens with the existing *Name*, *Value*, and
   *Description*. The User edits them and confirms.
3. If the *Name* changed, every backtick reference `Component:Old`
   in the diagram's prose is rewritten, plus any bare `Old`
   references inside the owning component's prose. The *Value*
   text, by contrast, is free text and never auto-rewrites — when
   the value of a constant changes, references to it by name still
   resolve.

**Postcondition.** The constant reflects the edits. References to
it elsewhere in the diagram are consistent.

---

### Scenario 7.5 — Add a local function

**Precondition.** The editor is in *Component* view.

**Sequence.**
1. The User clicks the `+` button in the Local functions list
   header.
2. A dialog asks for *Name* (identifier-safe, unique among the
   component's local functions) and optional *Description* (one-
   line summary).
3. The User confirms. The new function appears in the Local
   functions list and is selected automatically, so the Steps panel
   below the list is ready to edit (see *Scenario 7.7*).

**Postcondition.** The local function exists with its name and
one-line description, but no step body yet. It is documentation only
— not emitted to PlantUML — and appears in the spec export as a
Name / Description / Steps row at the end of the component's chapter.
It can be referenced by name from action text (bare reference inside
the owning component).

---

### Scenario 7.6 — Edit a local function's name or description

**Precondition.** Exactly one local function is selected in the
Local functions list.

**Sequence.**
1. The User clicks the `✎` button on the row (or presses `Enter`).
2. The dialog opens with the existing *Name* and *Description*. The
   User edits them and confirms.
3. If the *Name* changed, every backtick reference `Component:Old`
   in the diagram's prose is rewritten, plus any bare `Old`
   references inside the owning component's prose.

**Postcondition.** The function's name and description reflect the
edits. References to it elsewhere in the diagram are consistent.

---

### Scenario 7.7 — Edit a local function's step body

**Precondition.** Exactly one local function is selected in the
Local functions list. The Steps panel below the list shows that
function's step body.

**Sequence.**
1. The User clicks into the Steps textarea and types. Edits save
   as the User types — no explicit *Save* needed. A whole typing
   session counts as one undo step.
2. Backtick references to other named entities render with hover
   tooltips when the field loses focus; pressing `Esc` blurs the
   field as a shortcut.

**Postcondition.** The function's step body reflects the edits.
The Steps appear as the corresponding cell in the spec export's
Local functions table for this component.

---

### Scenario 7.8 — Delete a state variable

**Precondition.** One or more rows in the State variables list are
selected.

**Sequence.**
1. The User presses `Delete` (or clicks `−` in the list header).
2. The selected state variables are removed from the active
   component.

**Postcondition.** The state variables are gone. Backtick references
to them in prose become unresolved.

---

### Scenario 7.9 — Delete a constant

**Precondition.** One or more rows in the Constants list are
selected.

**Sequence.**
1. The User presses `Delete` (or clicks `−` in the list header).
2. The selected constants are removed from the active component.

**Postcondition.** The constants are gone. Backtick references to
them in prose become unresolved. Note that any free-text *Value*
field elsewhere in the diagram that mentioned the constant by name
in plain (non-backtick) text is unaffected — values are free text
and have no link semantics.

---

### Scenario 7.10 — Delete a local function

**Precondition.** One or more rows in the Local functions list are
selected.

**Sequence.**
1. The User presses `Delete` (or clicks `−` in the list header).
2. The selected local functions are removed from the active
   component, along with their step bodies.

**Postcondition.** The local functions are gone. Backtick references
to them in prose (typically in transition Action notes that called
them) become unresolved.

---

## 8. Edit free-text documentation

**Goal.** Write the longer-form prose that documents the device, its
components and handlers, and the actions of individual transitions.
All of these fields support a curated Markdown subset and backtick
cross-references that auto-link to other named entities.

**Scenarios.** Editing the device-level specification, editing a
component or handler description, editing a transition's action note,
editing a local function's step body, and using backtick cross-
references inside any of the free-text fields.

### Scenario 8.1 — Edit the Device Specification

**Precondition.** The editor is open in either view. The Device
Specification panel sits below the canvas and is always visible.

**Sequence.**
1. The User clicks into the Device Specification textarea. The live
   preview gives way to the editable textarea, with backticks visible.
2. The User types prose. Edits save as the User types — no explicit
   *Save* needed. A whole typing session counts as a single undo step.
3. The text supports a curated subset of Markdown (headings, bullet
   and numbered lists, paragraphs, `**bold**`, `*italic*`) plus
   backtick references.
4. The User presses `Esc` (or clicks elsewhere) to end the editing
   session. The live preview takes over, rendering the Markdown and
   resolving references with hover tooltips.

**Postcondition.** The Device Specification is part of the diagram. It
is persisted in the saved `.json` file and rendered as the opening
chapter of the spec export, but never written to the generated
PlantUML.

---

### Scenario 8.2 — Edit a component or handler description

**Precondition.** The User wishes to document a component or handler.
The Description panel between the device catalogue and the lower
right column is always visible. Which entity it documents follows
these rules:

- *Component view:* the active component.
- *Device view:* the selected handler if exactly one handler is
  selected; else the selected component if exactly one component is
  selected; else the active component.

The header of the Description panel shows the name of the entity it's
currently documenting.

**Sequence.**
1. The User adjusts which entity the panel is documenting by selecting
   the desired component or handler in the catalogue (or by switching
   the active component in *Component* view).
2. The User clicks into the Description textarea and types. Edits save
   as the User types — same live-save and undo behaviour as the Action
   panel.
3. Markdown subset and backtick references are supported (same as the
   Device Specification — see *Scenario 8.1*).
4. `Esc` ends editing.

**Postcondition.** The component or handler now has its description.
A small accent-coloured dot appears next to its row in the Components
or Handlers list, indicating the description is non-empty.

---

### Scenario 8.3 — Edit a transition's action note (Action panel)

See *Scenario 6.10*.

---

### Scenario 8.4 — Edit a local function's step body (Steps panel)

See *Scenario 7.7*.

---

### Scenario 8.5 — Use backtick cross-references

**Precondition.** The User is editing any free-text field (Device
Specification, Description, Action, Steps, type Specification,
parameter or other description).

**Sequence.**
1. The User wraps a name in backticks: `` `Idle` `` (bare reference),
   `` `Card:Charge` `` (qualified two-segment), or
   `` `Connection:ConnectReq:serverId` `` (qualified three-segment).
2. When the field loses focus, the live preview replaces backticks
   with styled monospace links. Resolved references use the accent
   colour; unresolved references render plain (Markdown-supporting
   fields use warning style with dotted underline).
3. Hovering a resolved reference shows the target's description in a
   tooltip.
4. **Action panel shorthand.** Inside a transition's Action text, the
   row's own message establishes the interface, so
   `` `ConnectReq:serverId` `` resolves the same way as
   `` `Connection:ConnectReq:serverId` `` would.
5. **Function-call syntax.** `` `recomputeTotal()` `` and similar
   parenthesised forms are accepted; the parens are decorative and
   ignored when resolving the link.

**Postcondition.** The reference is stored as the literal backtick text
the User typed. In the spec export it renders as a hyperlink with a
hover tooltip. Renaming the target updates the reference text in
place (see *Scenario 9.6*).

---

## 9. Select, edit, and undo

**Goal.** Build up multi-element selections, navigate them, edit them,
copy and paste them, and step backward and forward through the edit
history.

**Scenarios.** The cross-cutting selection model (which items can
coexist in a selection, how clicks toggle and replace), canvas
click-selection, the keyboard-driven editing dispatch, copy and paste
of nodes and of messages, the rename-with-cascade behaviour that
applies to most named entities, undo and redo, and the cascading
rules that govern Delete.

### Scenario 9.1 — Build a multi-element selection (transition composition)

**Precondition.** The User wishes to compose a transition or perform any
other operation requiring elements from multiple panels.

**Sequence.**
1. The User clicks an interface in the Interfaces list. The interface
   becomes the only selection in that list.
2. The User clicks a message in the Messages list. The message is
   added to the selection — the interface stays selected, because
   the click was in a different panel.
3. The User clicks the source state in the States list (or canvas).
   Added to the selection.
4. The User clicks the target state. Added.
5. At any point, plain-clicking another item in *the same* list
   swaps: the previous selection in that list is cleared, the new
   item is selected. Plain-clicking an already-selected item
   deselects only that item.
6. `Ctrl-click` (`⌘-click` on Mac) toggles without clearing,
   regardless of panel — useful for selecting multiple items in the
   same list.
7. Clicking empty space on the canvas clears the entire selection.

**Postcondition.** The selection contains the desired combination,
ready to drive an action like *Add Transition* or *Add Connection*.

---

### Scenario 9.2 — Click an element on the canvas to select it

**Precondition.** The diagram is rendered on the canvas. Click-
selection requires the PlantUML server to have served both the visible
diagram and an internal selection map; if the server's setup blocks
this (cross-origin restrictions), click-selection is unavailable but
list-based selection still works.

**Sequence.**
1. The User clicks a state, choice-point, transition arrow, component
   box, handler box, interface lollipop, or wiring line on the canvas.
2. Stadiæ identifies which element was clicked and applies the same
   plain-click rules as the side lists (swap within the same panel;
   add across panels — see *Scenario 9.1*).

**Postcondition.** The clicked element is selected (or deselected if
it was already selected). The diagram redraws with selection
highlights — selected states and choice-points get a red border,
selected transitions turn red, the START dot turns red.

**Failure mode.** If click-selection is unavailable, canvas clicks are
silently ignored. The User can still select via the side lists and
Transitions table.

---

### Scenario 9.3 — Edit any selected entity via the keyboard

**Precondition.** The selection identifies a single editable entity.

**Sequence.**
1. The User presses `Enter`.
2. Stadiæ opens the relevant entity's Edit dialog based on the
   selection: a single state, choice-point, component, handler,
   interface, non-default message, handler function, message or
   function parameter, state variable, constant, local function,
   connection (Component–Interface, Handler–Interface, or Component →
   Handler), or a transition with all its message rows selected. Some
   kinds (function, function parameter, message parameter) require
   their parent (handler / message) to also be selected because the
   panel that displays them is only visible while the parent is
   selected; this is naturally satisfied by clicking the row.
3. **Type definitions** are not edited via this keyboard shortcut —
   they have no presence in the side lists. They are managed only
   through *Device → Type definitions...* (see *Scenario 2.5*–*Scenario 2.7*).

**Postcondition.** The dialog opens. From here the flow follows the
relevant entity-specific use case.

---

### Scenario 9.4 — Copy and paste states and choice-points

**Precondition.** One or more states and/or choice-points are selected
in the active component.

**Sequence.**
1. The User presses `Ctrl+C` (or clicks *Copy*). The clipboard
   captures:
   - The selected states (with their names and display names) and
     choice-points (with their names and questions).
   - Every transition whose source *and* target are both in the
     selection, including those transitions' grouped messages and any
     attached action notes.

   **Not captured:** state and choice-point descriptions are not
   carried over; the initial transition (from START), history-
   targeted transitions, and ANY-source transitions are excluded by
   definition (their endpoints aren't in the selection).
2. The User optionally switches to a different component.
3. The User presses `Ctrl+V` (or clicks *Paste*).
4. The copied nodes and the transitions between them are inserted
   into the active component. Name collisions are resolved by
   appending `_1`, `_2`, ... to the pasted copies; original display
   names and questions are kept verbatim.

**Postcondition.** The pasted nodes appear as a separate, disconnected
group in the active component, ready to be wired to the rest by adding
transitions in the usual way.

---

### Scenario 9.5 — Copy and paste messages between interfaces

**Precondition.** One or more messages are selected (or a whole
interface, with none of its individual messages selected, which
counts as "all messages of this interface").

**Sequence.**
1. The User presses `Ctrl+C` (or clicks *Copy*). The clipboard
   captures the message names (without their interface).
2. The User selects exactly one non-default target interface.
3. The User presses `Ctrl+V` (or clicks *Paste*).
4. The messages appear under the target interface. Name collisions
   are resolved with `_1`, `_2`, ... suffixes — pasting into the
   original interface duplicates the message set.

**Postcondition.** The target interface holds the copied messages.
The clipboard supersedes whatever it held before; copying messages
clears any previously copied elements (and vice versa).

---

### Scenario 9.6 — Rename an entity with cascading reference rewrite

**Precondition.** The User wishes to rename any named entity that
might be referenced from prose elsewhere in the diagram.

**Sequence.**
1. The User opens the entity's Edit dialog (any of the entity-specific
   use cases).
2. The User types a new Name and confirms.
3. **Before** renaming the entity itself, Stadiæ scans every free-text
   field in the diagram — the Device Specification, every component's
   description, every state and choice-point description and question,
   every state-variable description, every constant value and
   description, every local-function description and steps, every
   transition's action note, every handler / function / parameter
   description, and every interface and message description — and
   rewrites each backtick reference that names the old entity. The
   exact rule depends on the entity kind:
   - *Component / Handler / Interface rename:* every `Old:Member` and
     every bare `Old`.
   - *State / Choice-point / State-variable / Constant / Local-
     function rename:* qualified `Component:Old` everywhere; bare
     `Old` only inside the owning component's prose.
   - *Message rename:* `Iface:Old` and `Iface:Old:Param` everywhere.
   - *Function rename:* `Handler:Old` everywhere; bare `Old` inside
     the owning handler's prose.
   - *Parameter rename:* `Owner:Member:Old` everywhere.

   **Limitation:** the two-segment action-context shorthand
   `Member:Old` (used inside a transition Action where the row's own
   message establishes the interface) is *not* auto-rewritten on
   parameter rename. Users who rename parameters and reference them
   via the shorthand must update those references manually; the spec
   preview will show them as unresolved until they're fixed.
4. Stadiæ then renames the entity itself, and any wiring or
   transitions that referred to it follow automatically.
5. The whole rename — prose rewrites, the entity rename, and the
   wiring follow-up — counts as a single undo step, so a single
   `Ctrl+Z` reverses the lot.

**Postcondition.** The entity has its new name. References in prose
are updated (with the parameter-shorthand exception noted above). The
selection follows the rename so the entity stays selected, and any
connections or transitions that referred to it now refer to the new
name.

---

### Scenario 9.7 — Undo and redo

**Precondition.** At least one mutating action has been performed
since the diagram was loaded or reset.

**Sequence.**
1. The User presses `Ctrl+Z` (or clicks *Undo*).
2. Stadiæ rolls the diagram back one step. The current selection is
   cleared (because some of the previously selected items might no
   longer exist after the rollback). The canvas updates to match.
3. To redo, the User presses `Ctrl+Y` (or `Ctrl+Shift+Z`, or clicks
   *Redo*).

**Postcondition.** The diagram is at the chosen point in its history.
Subsequent edits clear the redo trail.

---

### Scenario 9.8 — Delete with cascading effects

**Precondition.** One or more deletable entities are selected.
Built-in entries (Timer, Logical, Yes, No, Timeout, TimerHandler,
Time, TimerID, START) are protected and never deleted.

**Sequence.**
1. The User presses `Delete` / `Backspace` (or clicks `−` in a
   specific list header — the per-list `−` button only acts on that
   list's selection).
2. **Confirmation rule.** Stadiæ asks for confirmation in exactly two
   cases — both governed by the *whole* current selection, not by
   what's inside it:
   - Exactly one component is selected and *nothing else at all* —
     no states, no choice-points, no handlers, no connections, etc.
   - Exactly one handler is selected and *nothing else at all*.

   In every other case (mixed selections, multiple entities of one
   kind, states, choice-points, interfaces, messages, transitions,
   parameters, functions, state variables, constants, local
   functions, connections of any kind), the deletion proceeds
   immediately with no confirmation. Users rely on `Ctrl+Z` to
   recover.

   The "delete the last component" case is also blocked: Stadiæ
   refuses with an alert *"A file must have at least one component."*
3. Cascades on the executed deletes:
   - Deleting a state or choice-point also removes every transition
     having it as source or target.
   - Deleting an interface removes its messages, drops them from
     every transition (removing any arrow that becomes empty as a
     result, except the initial transition), and drops every wiring
     line on it.
   - Deleting a message drops it from every transition.
   - Deleting a component removes every wiring line and every
     handler-call dependency that referenced it.
   - Deleting a handler removes every wiring line and every
     handler-call dependency that referenced it.
   - Deleting a function or parameter removes only that record (no
     transition cascade — these are documentation only).
4. **Interface vs. message disambiguation.** When the selection
   includes both an interface and one or more of its messages, the
   message deletion takes priority and the parent interface is left
   alone — the User's intent is read as "delete these messages" not
   "delete the interface". The interface remains selected after the
   operation.
5. Backtick references to deleted entities become unresolved (warning
   style); they are not auto-rewritten.

**Postcondition.** The diagram is consistent. Diagrams and lists
reflect the changes.

---

## 10. Configure view and layout

**Goal.** Adjust the rendering of the active component's state machine,
resize the editor's panels, and print the current diagram.

**Scenarios.** Adjusting font sizes for the component-level diagram,
dragging the panel dividers, and printing.

### Scenario 10.1 — Adjust component-level font sizes

**Precondition.** The editor is in *Component* view.

**Sequence.**
1. The User chooses *Component → Change transition font size...* or
   *Component → Change state font size...*.
2. A dialog asks for an integer point size and shows the current
   value.
3. The User confirms. The state machine re-renders at the new font
   size.

**Postcondition.** The chosen font size applies to the active
component only; other components and the device diagram are
unaffected.

---

### Scenario 10.2 — Resize panels and dividers

**Precondition.** The editor is open. Multiple resizable dividers exist.

**Sequence.**
1. The User drags any of the following handles:
   - The main vertical slider between the canvas column and the
     right panel (changes the left/right split).
   - The horizontal slider above the Device Specification panel
     (resizes that panel against the canvas).
   - Vertical bars between stacked panels in the right column (Device
     catalogue ↔ Description ↔ component-panel ↔ Transitions/Action
     row).
   - Within the lists row: vertical bars between State variables ↔
     Constants and between Local functions ↔ Steps, plus a horizontal
     bar between the State-variables/Constants column and the Local-
     functions/Steps column.
   - The horizontal bar between Transitions table and Action panel.
2. **Reset.** Double-clicking any handle restores its default size.

**Postcondition.** The User's preferred layout is in effect. Layout
choices are not remembered between reloads — only the diagram itself
is, via autosave.

---

### Scenario 10.3 — Print the current diagram

**Precondition.** The canvas shows the diagram the User wishes to
print.

**Sequence.**
1. The User clicks the small printer icon in the canvas's bottom-right
   corner.
2. The browser's print dialog opens. The diagram is supplied as inline
   SVG, so it stays crisp at any DPI when saved as PDF. Selection
   highlighting is suppressed in the printed output.

**Postcondition.** The diagram has been sent to the printer or saved as
PDF.

---

## 11. Export

**Goal.** Get the diagram out of Stadiæ in a form usable elsewhere —
as PlantUML source for hand-editing or other toolchains, as a PNG for
sharing, as a Markdown table for inclusion in design documents, or as
a complete navigable HTML or Word specification.

**Scenarios.** One per export format: PlantUML source, PNG, a
Markdown table of the active component's transitions, and the full
HTML / Word specification.

### Scenario 11.1 — Export the active diagram as PlantUML source

**Precondition.** The canvas shows the diagram (component state
machine or device diagram) the User wishes to export. A PlantUML
server is *not* required — this export works fully offline.

**Sequence.**
1. The User chooses *File → Export as PlantUML (.puml)...*.
2. A save-file dialog opens with a default filename. The User
   confirms.
3. The browser downloads a `.puml` file containing clean PlantUML
   source for whatever is currently on the canvas (no selection
   highlighting, no internal markings used by click-selection).

**Postcondition.** A `.puml` file containing the source of the
current view is on disk. It can be fed to any PlantUML tool.

---

### Scenario 11.2 — Export the active diagram as PNG

**Precondition.** The canvas has rendered successfully (PlantUML server
is reachable).

**Sequence.**
1. The User chooses *File → Export as PNG image...*.
2. A save-file dialog opens. The User confirms.
3. Stadiæ downloads the currently-rendered PNG (without selection
   highlighting).

**Postcondition.** A `.png` file of the current view is on disk.

---

### Scenario 11.3 — Export the active component's transitions as Markdown

**Precondition.** The editor is in *Component* view, and the active
component has at least one transition.

**Sequence.**
1. The User chooses *Component → Copy transitions as Markdown table...*.
2. A modal opens with a textarea containing the Markdown table. Columns
   are *Source*, *Target*, *Interface*, *Message*, *Action*. Source and
   target use display names / questions; newlines inside cells become
   `<br>`.
3. The User clicks *Copy to clipboard* (or selects-all in the textarea
   and copies manually) and closes the modal.

**Postcondition.** The Markdown table is on the clipboard, ready for
pasting into a wiki, PR description, or design document.

---

### Scenario 11.4 — Export the full specification (HTML or .docx)

**Precondition.** The editor is open. The PlantUML server must be
reachable for the diagrams. For `.docx`, the docx library at unpkg.com
must be reachable on first use per session.

**Sequence.**
1. The User chooses *File → Export Specification...*.
2. A progress modal indicates: *Loading document library...* (only the
   first time), *Rendering diagrams...*, *Packaging document...*
3. Stadiæ assembles the specification, covering the diagram
   end-to-end:
   - Title and intro.
   - Device Specification chapter (free-text body with Markdown
     subset).
   - Device diagram (rendered via PlantUML).
   - One chapter per component, containing: filtered context diagram,
     description, Constants table, State variables table, States
     section, Choice-points section, state diagram, transitions
     table (with row-spanning for grouped messages), Local functions
     table.
   - One section per handler with its functions and parameters.
   - One section per non-default interface with its messages and
     parameters.
   - Type definitions chapter at the end.
4. A preview modal opens showing the spec rendered as HTML, with a
   sticky sidebar table of contents. Two download buttons are
   available: *Download HTML* and *Download .docx*. *Close* dismisses
   the modal.
5. The User clicks one of the download buttons. The browser downloads
   the corresponding file (`<deviceName>-spec.html` or
   `<deviceName>-spec.docx`).

**Postcondition.** The specification document is on disk in the chosen
format. The HTML version is self-contained (CSS inlined, diagrams as
inline SVG, embedded `.json` source recoverable via *Download source*
in the page footer). The `.docx` version uses native Word tables and
embedded SVG diagrams.

**Failure modes.**
- PlantUML server unreachable → diagrams render as empty placeholders;
  the modal shows an error and the User can retry once the server is
  available.
- unpkg.com unreachable on first use → the `.docx` download fails with
  an explanation; HTML preview and download still work.

---

## 12. Get help

**Goal.** Look up reference information about Stadiæ — the full user
manual or the version and credits.

**Scenarios.** Opening the user manual and opening the About dialog.

### Scenario 12.1 — Open the user manual

**Precondition.** The editor is open.

**Sequence.**
1. The User chooses *Help → User Manual*.
2. A modal opens with the full reference manual: Introduction, Core
   Concepts, Interface, Components, Device Diagram, Typical Workflow,
   States, Choice-points, State variables, Constants, Local functions,
   Interfaces & Messages, Type definitions, Transitions, History State,
   ANY State, ANY Message, Selection, Editing & Deleting, Saving &
   Exporting, PlantUML Server, Rules Reference, Keyboard Shortcuts,
   Troubleshooting.
3. The User navigates via the sticky sidebar table of contents on the
   left, which highlights the active section as the User scrolls.
4. The User clicks *Close* (or presses `Esc`) to dismiss the modal.

**Postcondition.** The User has the reference information visible.

---

### Scenario 12.2 — Open the About dialog

**Precondition.** The editor is open.

**Sequence.**
1. The User chooses *Help → About*.
2. A small modal shows the editor's name, version, license attribution,
   and a credits line for PlantUML.
3. The User dismisses the modal.

**Postcondition.** The User has seen the version information.

---

## Appendix A — Cross-cutting rules and invariants

These are not standalone scenarios but invariants enforced across many
of the scenarios above. They are listed here for cross-reference.

- **Identifier rule.** Names entered in *Name* fields must start with
  a letter and contain only letters, digits, and underscores. Empty
  values, names starting with a digit, and names with whitespace are
  rejected.
- **Uniqueness scopes.**
  - States and choice-points: unique within the same component.
  - Interfaces: unique device-wide.
  - Messages: unique within their interface.
  - Components and handlers: unique device-wide (single shared scope).
  - Functions: unique within their handler.
  - Parameters: unique within their message or function.
  - State variables, constants, local functions: unique within their
    component.
  - Type definitions: unique device-wide, also disjoint from component,
    handler, and non-default interface names.
- **Built-in entries are protected.** The `Timer` and `Logical`
  interfaces, the `Timeout` / `Yes` / `No` messages, the `TimerHandler`
  with its `setTimeout` and `cancelTimeout` functions, and the `Time`
  and `TimerID` types cannot be renamed, edited, or deleted. They are
  always present (shown in muted italic in the lists) and don't appear
  on the device diagram — they're conceptually always available, the
  same way primitive operations are in a programming language.
- **Determinism.** A given source state can handle any specific message
  at most once across all its outgoing transitions. The Add Transition
  scenarios enforce this.
- **Wildcard exclusivity.** Wildcard messages (`*:*`, `Iface:*`) cannot
  be used on choice-point sources, cannot be mixed with `Yes`/`No` on
  the same transition, and at most one of each scope per source state.
- **Multiplication invariant.** A non-default interface can have at most
  one multiplied component connected to it.
- **View-scoped UI.** The menubar and panels follow the active view:
  - The *Component* menu is visible only in *Component* view; the
    *Device* menu is visible only in *Device* view.
  - The *Add Transition* and *Redirect* toolbar buttons are visible
    only in *Component* view; *Add Connection* is visible only in
    *Device* view.
  - The States, Choice-points, State variables, Constants, Local
    functions, Steps, Transitions, and Action panels are hidden in
    *Device* view.
  - The Components, Handlers, Functions, Interfaces, Messages lists,
    the Description panel, and the Device Specification panel are
    visible in both views.
- **Wiring-vs-usage warning device.** In *Component* view, an
  interface used by the active component's transitions but not wired
  to it on the device diagram shows a small amber `!` badge in the
  Interfaces list; the same `!` appears in the indicator column of
  every transition row that references such an interface. The warning
  is advisory — it does not block any operation and is not shown in
  *Device* view.
- **PlantUML server scope.** Editing, saving, opening, and exporting
  to `.puml` work fully offline. Diagram rendering on the canvas,
  click-selection on the canvas, and the `.docx` specification
  export require the server. The `.docx` export additionally fetches
  a small library from unpkg.com the first time it's used in a
  session.
- **Autosave scope.** Autosave runs continuously in the background as
  the User works, with a small delay between an edit and the draft
  being committed. The draft is scoped to the browser tab on the local
  machine and survives crashes and tab reloads. It is cleared by
  *File → New* or the *Discard* button on the restoration banner.
  Sharing a diagram with another user or another machine still
  requires *Save As* and explicit file transfer.
