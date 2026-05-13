# Stadiæ — `stadiae-v4` reference

A Stadiæ file describes one **device**: a collection of communicating **components** (each with a state machine), the **handlers** they call out to, the **interfaces** carrying the **messages** they exchange, the wiring between all of these, and a small set of free-text documentation fields.

## Design context — the FCM method

Stadiæ models implement the **Functional Components Method (FCM)**, an architecture method for embedded software. Two kinds of rules apply: structural rules that say what is valid `stadiae-v4` JSON, and design conventions that say what makes a model *good FCM*. Both apply to every model.

### The two roles inside a Device

Every entity in the model is one of two roles, with the same JSON shape but different identification triggers.

- **Functional Components** own behaviour. Each is a state machine with one well-defined responsibility — a connection lifecycle, a session, a feature, a control loop, a sequencer. They communicate only through messages on shared interfaces; they never call each other directly and never share state.
- **Handlers** sit on the Device boundary. They have no state machine, expose a synchronous non-blocking function API to Components, and deliver any results back as messages on shared interfaces. Two kinds, identified by different questions:
  - **Asynchronous Interface Handlers** mediate every asynchronous source or sink in the environment — a radio stack, a peripheral driver, a storage subsystem, an OS service. Identify one per distinct asynchronous concern.
  - **Worker Handlers** mediate long-running internal computation — image decoding, cryptography, signal processing, search/planning. Identify one for every computation that "would take too long to run inside an action."

Both kinds use the same `handlers[]` JSON shape; the distinction is conceptual.

### Identification order

When generating a model from a textual description, follow this order:

1. **Boundary first.** List every asynchronous source/sink and every long-running computation in the environment. Each becomes a Handler. This step also fixes what is *outside* the Device.
2. **Components second.** Decompose the remaining responsibilities into Functional Components. Each Component should pass three tests: a single responsibility (summarisable in one sentence without "and"); mode-driven behaviour (distinct phases that justify a state machine); and an independent lifecycle (it can start, stop, recover, or fail without dragging others along).
3. **Interfaces third.** For each pair of Components, and each Component-Handler pair on the boundary, ask what messages flow and what coherent vocabulary groups them. An interface is a contract, not a bag of unrelated messages.

Reaching for Components first produces designs that mirror the textual requirements rather than the architectural seams.

### Run-to-completion: how transition actions are written

Inside the Device, message dispatch is serialised under **run-to-completion (RTC)** semantics: one message at a time, dispatched to one Component, whose transition action runs to the target state without interruption before the next message is dispatched.

The RTC discipline determines how to write transition actions:

- **Actions never block.** When a Component needs to wait, it does not block in the action. It calls a Handler function to initiate the wait, transitions to a state representing the wait, and reacts to the eventual completion message in a *separate* transition.
- **Actions are bounded.** Each action is a short sequence of steps: state-variable updates, Handler function calls, local-function invocations. Long-running computation goes to a Worker Handler.
- **Yes/No on choice-points is automatic.** A choice-point's evaluation runs against the Component's state variables on entry and emits a `Logical:Yes` or `Logical:No` message synchronously. The two outgoing transitions handle the two cases. Don't model the evaluation as a separate state.

### Idiomatic patterns

- **Wait pattern.** Component receives request → calls `Handler:doSomething(...)` (returns immediately) → transitions to a waiting state → handles the eventual completion message in a separate transition. The waiting state's name says what the Component is waiting for: `Connecting`, `Storing`, `Loading`.
- **Timer pattern.** To wait for time, the Component calls `TimerHandler:setTimeout(interval, timerId)`, stores the `timerId` in a state variable typed `TimerID`, and transitions to a waiting state. A `Timer:Timeout` message arrives when the timer expires; the Component handles it in a transition out of the waiting state.
- **Transient-fault pattern.** A `*`-source transition with `target: "[H]"` (any source, history target) on a fault message lets the Component go through fault handling and return to the state it was in. Idiomatic for handling resets, brown-outs, transient peripheral failures.
- **Error pattern.** A `*` source transition to a fixed error or shutdown state is the standard way to handle non-recoverable conditions. Use sparingly.

### Red flags

When the model is taking shape, the following patterns indicate the decomposition needs revisiting:

- A Component touching an unreasonable number of interfaces — usually has more than one responsibility; split it.
- A Component that only forwards messages without state-dependent behaviour — fold its logic into the neighbour.
- Two Components that need to share state — extract the shared state into a new Component.
- An interface spoken by only one Component (other than its Handler) — likely an internal concern; demote it.
- Several `*`-source transitions for ordinary messages — real state structure is missing; commit to which states actually accept those messages instead of hiding behind the wildcard.

---

## Top-level structure

A file is a single JSON object with the following keys. `format` is mandatory and must be exactly `"stadiae-v4"`; everything else is either required-when-present or optional.

```json
{
  "format": "stadiae-v4",

  "interfaces":          [ ... ],   // device-wide
  "messages":            [ ... ],   // device-wide
  "components":          [ ... ],
  "handlers":            [ ... ],   // optional — omit when empty

  "connections":         [ ... ],   // component ↔ interface wiring
  "handlerConnections":  [ ... ],   // handler ↔ interface wiring — optional
  "handlerCalls":        [ ... ],   // component → handler call deps — optional

  "deviceName":              "Device",     // optional, default "Device"
  "deviceDisplayName":       "...",        // optional free-text label
  "deviceSpecification":     "...",        // optional free-text description
  "deviceComponentFontSize": 12,           // optional, default 12
  "deviceInterfaceFontSize": 11,           // optional, default 11

  "types":                   [ ... ],      // device-wide named types — optional
  "activeComponentIndex":    0             // optional; loader will set this
}
```

**Byte-minimality.** The save format is *byte-minimal*: any optional field whose value equals its default is omitted. Empty arrays are omitted entirely (e.g. a model with no handlers omits the `handlers`, `handlerConnections`, and `handlerCalls` keys). Empty strings are omitted. Do not include empty arrays, empty strings, or fields equal to their defaults in the JSON.

**Identifiers.** Wherever a field is described below as *identifier-safe*, the value must match the regex `^[A-Za-z][A-Za-z0-9_]*$` — start with a letter, then letters / digits / underscores only. No spaces, no punctuation, no leading digit. Display labels (`displayName`, `question`, etc.) have no such restriction and may contain spaces, and follow the line-break rule below.

**Display-label line breaks.** Display labels — every `displayName` on components, states, handlers; choice-point `question`s; the top-level `deviceDisplayName` — break onto multiple lines via a single explicit marker: the **literal two-character sequence backslash + `n`**. In JSON source that is written `"\\n"`, which deserialises to the two characters `\` and `n`. The editor's PlantUML generator translates that marker into the renderer's line-break syntax.

A raw newline character (U+000A) in one of these fields is **not** the same thing and is rejected by the strict validator. The trap is that JSON source's `"\n"` is one character (a real newline), whereas the marker is two characters (a backslash followed by an `n`), so the JSON source needs `"\\n"`.

- ✅ `"displayName": "Server\\nConnector"` — JSON source contains `\\n`, the deserialised value contains `\n` (two characters), the editor renders as two lines.
- ❌ `"displayName": "Server\nConnector"` — JSON source contains `\n`, the deserialised value contains a real newline (one character), validator rejects.

This rule applies only to display labels. Every other free-text field — every `description`, transition `action`, local-function `steps`, type `specification`, constant `value`, and the top-level `deviceSpecification` — is full prose and uses real newlines normally. Write `"\n"` in those, not `"\\n"`.

## Built-in vocabulary — do not declare

A small set of built-in entities is implicit in every file. Do not declare them.

**Built-in interfaces:**

- `Logical` — used for choice-point branching. Carries the messages `Yes` and `No`.
- `Timer` — carries the message `Timeout(timerId: TimerID)`.

**Built-in handler:**

- `TimerHandler` — exposes `setTimeout(timeout: Time, timerId: TimerID)` and `cancelTimeout(timerId: TimerID)`.

**Built-in types:**

- `Time` and `TimerID`.

**Built-in per-component local functions** (every component automatically carries these):

- `initialize` — startup logic. The `steps` body is user-editable; include `initialize` in `localFunctions` only when the user has filled in steps, and only with the fields `name` and `steps` — exactly `{"name": "initialize", "steps": "..."}`. Do not add `description`, `isDefault`, or any other field; the editor injects the rest from the built-in. Adding a `description` makes Claude's `initialize` collide with the built-in's metadata.
- `resendLastReceivedMessage` — re-injects the last received message at the head of the queue. Wholly fixed; never include it in the JSON.

You **may** reference any of these in your model — `Yes`/`No` on choice-point transitions, `Timer:Timeout` on a state-machine transition, `TimerHandler:setTimeout` in a transition's action text, `Time` as a parameter type. You **must not** declare them in `interfaces`, `messages`, `handlers`, `types`, or `localFunctions`. A file that does either is rejected by the loader (or has the duplicate silently overwritten on re-load), and changing one of these definitions has no effect.

## Interfaces and messages (device-wide)

Interfaces and messages are *shared* across all components — they describe the contract vocabulary of the device as a whole, not anything one component owns.

### Interfaces

```json
"interfaces": [
  { "name": "Connection", "description": "Wireless transceiver messages." }
]
```

| Field         | Type   | Required | Notes                                                |
|---------------|--------|----------|------------------------------------------------------|
| `name`        | string | yes      | Identifier-safe. **Globally unique** across `interfaces`. Cannot be `Logical` or `Timer`. |
| `description` | string | no       | Free-text, may contain backtick references. Omit when empty. |

### Messages

Each message belongs to one interface and carries an optional list of typed parameters.

```json
"messages": [
  {
    "interface": "Connection",
    "name": "ConnectReq",
    "description": "Request received to connect to a server.",
    "parameters": [
      { "name": "serverId", "type": "uint", "description": "ID of the server." }
    ]
  }
]
```

| Field         | Type   | Required | Notes                                                |
|---------------|--------|----------|------------------------------------------------------|
| `interface`   | string | yes      | Must match an existing `interfaces[].name`. Cannot reference `Logical` or `Timer`. |
| `name`        | string | yes      | Identifier-safe. **Unique within the interface** (the same name may appear under different interfaces). |
| `description` | string | no       | Free-text with backtick references. Omit when empty. |
| `parameters`  | array  | no       | Omit when empty. Each parameter: `name` (identifier-safe, unique within the message), `type` (free text, often a built-in or user-defined type name), `description` (free-text, optional). |

Parameters are documentation, not behaviour: they describe the message's payload and are referenceable from action text as `` `Connection:ConnectReq:serverId` ``.

## Components

A component is one independent state machine plus its associated documentation. A file may contain any number of components; at least one is required.

```json
"components": [
  {
    "name": "ServerConnector",
    "displayName": "Server\\nConnector",
    "description": "Controls the connection with the server.",
    "states":         [ ... ],
    "choicePoints":   [ ... ],
    "stateVariables": [ ... ],
    "constants":      [ ... ],
    "localFunctions": [ ... ],
    "transitions":    [ ... ]
  }
]
```

### Component header fields

| Field            | Type   | Required | Notes                                            |
|------------------|--------|----------|--------------------------------------------------|
| `name`           | string | yes      | Identifier-safe. Unique across **both** `components` and `handlers` (they share one device-wide namespace). |
| `displayName`    | string | no       | Free-text label. May contain `\n` markers (literal backslash + n) to break onto multiple lines. Omit when empty *or* equal to `name`. |
| `description`    | string | no       | Developer documentation. Free-text with backtick references. Omit when empty. |
| `multiplication` | string | no       | Free-text marker (typical: `N`, `NUM`, `i`). Non-empty marks the component as having multiple instances at runtime. Omit when empty. **Invariant:** at most one multiplied component may be wired to any given interface. Handlers do not have this field. |
| `arrowFontSize`  | number | no       | Per-component transition-label font size. Default 9. |
| `stateFontSize`  | number | no       | Per-component state/CP-label font size. Default 12. |

### States

```json
"states": [
  { "name": "Connecting" },
  { "name": "Awaiting", "displayName": "Awaiting\\nServer", "description": "Idle until ..." }
]
```

| Field         | Type   | Required | Notes                                                |
|---------------|--------|----------|------------------------------------------------------|
| `name`        | string | yes      | Identifier-safe. **Unique within the component** (different components may both have a state called `Idle`). May not be `START`, `[H]`, or `*` — those are pseudostates. |
| `displayName` | string | no       | Free-text label, may contain `\n`. Omit when empty or equal to `name`. |
| `description` | string | no       | Free-text with backtick references. Omit when empty. |

### Choice-points

```json
"choicePoints": [
  { "name": "WhiteListed", "question": "Server\\nwhitelisted?", "description": "..." }
]
```

| Field         | Type   | Required | Notes                                                |
|---------------|--------|----------|------------------------------------------------------|
| `name`        | string | yes      | Identifier-safe. **Unique within the component** — states and choice-points share one namespace within a component. Stored here without prefix; referenced from `transitions[].source/target` as `CP_<name>`. |
| `question`    | string | yes      | Free-text question shown inside the diamond, may contain `\n`. |
| `description` | string | no       | Free-text. Omit when empty. |

### State variables

Per-component documentation of the data each component holds. Documentation, not behaviour.

```json
"stateVariables": [
  { "name": "serverId", "type": "uint", "description": "The connected server's ID." }
]
```

| Field         | Type   | Required | Notes                                                |
|---------------|--------|----------|------------------------------------------------------|
| `name`        | string | yes      | Identifier-safe. Unique within the component's state-variables list. |
| `type`        | string | no       | Free text. Typically the name of a user-defined type (auto-links in the spec) or an inline type expression. Omit when empty. |
| `description` | string | no       | Free-text with backtick references. Omit when empty. |

Omit the entire `stateVariables` array when the component has none.

### Constants

Per-component named values referenced by name from action text — e.g. *"Start the timer with the `ADVERTISEMENT` interval."* Three free-text fields, no type discipline.

```json
"constants": [
  { "name": "ADVERTISEMENT", "value": "1000", "description": "Advertisement interval in ms." }
]
```

| Field         | Type   | Required | Notes                                                |
|---------------|--------|----------|------------------------------------------------------|
| `name`        | string | yes      | Identifier-safe. Unique within the component's constants list. |
| `value`       | string | no       | Free-text — number, string, hex literal, or any domain notation. Omit when empty. |
| `description` | string | no       | Free-text with backtick references. Omit when empty. |

Omit the entire `constants` array when empty.

### Local functions

Per-component reusable action snippets, referenced by name from transition action text. Take no parameters (they access the component's state variables by closure).

```json
"localFunctions": [
  {
    "name": "doAdvertise",
    "description": "Send advertisement packet and start timer.",
    "steps": "Call `WirelessTransceiver:sendAdvertisementPacket()`.\nCall `TimerHandler:setTimeout`(`ADVERTISEMENT`)."
  }
]
```

| Field         | Type   | Required | Notes                                                |
|---------------|--------|----------|------------------------------------------------------|
| `name`        | string | yes      | Identifier-safe. Unique within the component. May not collide with the built-ins (`initialize`, `resendLastReceivedMessage`) unless you are including the editable-steps form of `initialize`. |
| `description` | string | no       | Short one-line summary of the function's purpose. Omit when empty. |
| `steps`       | string | no       | Multi-line body describing the steps in execution order. Newlines preserved end-to-end. May contain backtick references and the supported Markdown subset. Omit when empty. |

For the built-in `initialize`, the only fields permitted in the JSON are `name` and `steps`. Do not add a `description` or any other field. Include the entry only when `steps` is non-empty. Never include `resendLastReceivedMessage` at all.

Omit the entire `localFunctions` array when, after stripping built-ins, nothing remains.

### Transitions

The component's behaviour. Each transition has a source, a target, an optional list of messages, and the connector geometry.

```json
"transitions": [
  {
    "source": "Connecting",
    "target": "Connected",
    "messages": [ { "interface": "Connection", "name": "ConnectedInd" } ],
    "connector": "Right",
    "length": 1
  }
]
```

| Field       | Type   | Required | Notes                                                |
|-------------|--------|----------|------------------------------------------------------|
| `source`    | string | yes      | Either an existing state name, an existing choice-point name (with the `CP_` prefix), or one of `START`, `*`. Never `[H]` — the history pseudostate is target-only. |
| `target`    | string | yes      | Either an existing state name, an existing choice-point name (with the `CP_` prefix), or `[H]`. Never `START` or `*`. |
| `messages`  | array  | yes      | List of `{interface, name}` pairs (and optional `action`). May be empty *only* for the initial transition (`source: "START"`). |
| `connector` | string | yes      | One of `"Right"`, `"Left"`, `"Up"`, `"Down"`. |
| `length`    | number | yes      | Positive integer. Controls the visual length of the arrow. |

Each entry in `messages` is:

| Field       | Type   | Required | Notes                                                |
|-------------|--------|----------|------------------------------------------------------|
| `interface` | string | yes      | Must match an existing interface (including built-ins). May be `"*"` to denote the ANY-message wildcard. |
| `name`      | string | yes      | Must match an existing message of that interface. May be `"*"` only when `interface` is also `"*"`. |
| `action`    | string | no       | Free-text description of what the transition does, with backtick references and supported Markdown. Documentation, not behaviour. Omit when empty. |

A transition object's `messages` array carries one or more `(interface, name)` entries. Each entry represents a separate transition in the underlying model — *receive `MsgA` while in state `S`, go to `T`* and *receive `MsgB` while in state `S`, also go to `T`* are two distinct transitions. **When several transitions share both `source` and `target`, they must be combined into a single transition object with multiple messages.** Two transition objects with the same `(source, target)` pair is invalid; emit one object with both messages in its `messages` array. Each message carries its own `action` field.

## Pseudostates and wildcards

### `START`

The component's initial pseudostate. At most one transition has `source: "START"`, and that transition has an empty `messages` array. Its target is the state the component enters at startup.

```json
{ "source": "START", "target": "Uninitialised", "messages": [], "connector": "Down", "length": 1 }
```

### `[H]` — history pseudostate

A transition can have `target: "[H]"` to mean "return to whatever state this component was last in". The brackets are part of the on-the-wire name and must be present. `[H]` is **target-only** — it never appears as a `source`.

The combination `source: "*"` + `target: "[H]"` is idiomatic for transient faults: handle the fault from wherever the component currently is, then return to the same state.

```json
{ "source": "*", "target": "[H]", "messages": [ { "interface": "Device", "name": "ResumeInd" } ],
  "connector": "Right", "length": 1 }
```

### `*` — ANY-source wildcard

`source: "*"` means "from any state in this component". Used to express transitions that should fire regardless of current state — typically global error or shutdown handlers.

```json
{ "source": "*", "target": "Uninitialised",
  "messages": [ { "interface": "Device", "name": "ErrorInd" } ],
  "connector": "Right", "length": 1 }
```

### ANY-message wildcard

A single message entry of `{"interface": "*", "name": "*"}` means "any unhandled message". Used on self-transitions to silently absorb messages that the current state doesn't otherwise handle. Only valid as the sole message on a self-transition (`source === target`).

```json
{ "source": "Uninitialised", "target": "Uninitialised",
  "messages": [ { "interface": "*", "name": "*" } ],
  "connector": "Right", "length": 1 }
```

## Wiring (device-level)

Three flat arrays describe how components, handlers, and interfaces are wired at the device level. All are optional and omitted when empty.

### `connections` — component ↔ interface

```json
"connections": [
  { "component": "ServerConnector", "interface": "Connection", "connector": "Down", "length": 1 }
]
```

Each entry wires one component to one interface. `component` references `components[].name`, `interface` references `interfaces[].name`. `connector` and `length` use the same vocabulary as transitions but are undirected (no arrowhead). Default interfaces (`Logical`, `Timer`) **must not** appear here.

**Multiplication invariant.** At most one component carrying a non-empty `multiplication` may be wired to any given interface. The loader does not enforce this; honour it when authoring.

### `handlerConnections` — handler ↔ interface

```json
"handlerConnections": [
  { "handler": "WirelessTransceiver", "interface": "Connection", "connector": "Down", "length": 1 }
]
```

Identical shape to `connections`, with `handler` instead of `component`. Default interfaces must not appear.

### `handlerCalls` — component → handler call dependency

```json
"handlerCalls": [
  { "component": "ServerConnector", "handler": "WirelessTransceiver", "connector": "Left", "length": 1 }
]
```

Marks that a component's transition actions call functions on a handler. The pair `(component, handler)` should be unique.

## Handlers

Handlers are device-level entities parallel to components but with no state machine. They represent the asynchronous edges of the system — sockets, queues, DB drivers, hardware peripherals — and expose a synchronous-looking API of **functions**.

```json
"handlers": [
  {
    "name": "WirelessTransceiver",
    "displayName": "Wireless\\nTransceiver",
    "description": "Drives the radio.",
    "functions": [
      {
        "name": "connectServer",
        "description": "Initiate connection to the given server.",
        "parameters": [ { "name": "serverId", "type": "uint" } ]
      }
    ]
  }
]
```

| Field         | Type   | Required | Notes                                                |
|---------------|--------|----------|------------------------------------------------------|
| `name`        | string | yes      | Identifier-safe. Unique across the **shared** components-and-handlers namespace. Cannot be `TimerHandler`. |
| `displayName` | string | no       | Free-text label, may contain `\n`. Omit when empty or equal to `name`. |
| `description` | string | no       | Free-text with backtick references. Omit when empty. |
| `functions`   | array  | no       | Omit when empty. Each function has `name` (identifier-safe, unique within the handler), optional `description`, and optional `parameters` (same shape as message parameters). |

Functions are documentation, not behaviour — they describe a handler's API and are referenceable from action text as `` `Handler:function` `` or `` `Handler:function:param` ``. They are not declared on any interface and have no transitions.

## Types

Device-wide named type definitions. Referenced by parameter `type` and state-variable `type` fields, and by backtick references like `` `uint` `` from any free-text field.

```json
"types": [
  { "name": "uint",      "description": "Unsigned integer.", "specification": "32-bit numerical value." },
  { "name": "byteArray", "description": "Array of bytes.",   "specification": "uint8[]" }
]
```

| Field           | Type   | Required | Notes                                                |
|-----------------|--------|----------|------------------------------------------------------|
| `name`          | string | yes      | Identifier-safe. Unique across `types`. Cannot collide with built-in types (`Time`, `TimerID`). |
| `description`   | string | no       | Short one-line summary. Omit when empty. |
| `specification` | string | no       | Free-text formal definition with backtick references and supported Markdown. May reference other types: `` `uint`[][] `` is fine. Omit when empty. |

Omit the entire `types` array when empty.

## Free-text fields: backtick references and Markdown

Two formatting features apply to free-text fields. The set of fields that supports each one is *different*:

**Backtick cross-references** are honoured in every free-text field — every `description`, every `action`, every `steps`, every `specification`, every `value` (on constants), and the device-level `deviceSpecification`.

**Markdown** is honoured in only six fields:

- `deviceSpecification`
- component `description`
- handler `description`
- transition message `action`
- local function `steps`
- type `specification`

Other free-text fields (state, choice-point, interface, message, state-variable, constant, parameter, local-function `description`, type `description`) accept backtick references but render as plain text — Markdown syntax in them is shown literally.

### Backtick references

Wrap a name in backticks to mark it as a cross-reference.

**Bare references** (no colon) resolve in the current context (the component you are inside, then a device-wide fallback):

- `` `Idle` `` — a state, choice-point, state variable, constant, or local function in the current component, or a top-level entity (component, handler, interface, type) device-wide.

**Qualified references** (one colon) name the owner explicitly:

- `` `Connection:ConnectReq` `` — a message on an interface.
- `` `WirelessTransceiver:connectServer` `` — a function on a handler.
- `` `ServerConnector:Idle` `` — a state, choice-point, state variable, constant, or local function on a specific component.

**Doubly-qualified references** (two colons) reach into parameters:

- `` `Connection:ConnectReq:serverId` `` — a message parameter.
- `` `WirelessTransceiver:connectServer:serverId` `` — a function parameter.

A trailing `()` is treated as ornament and stripped before lookup, so `` `doThis()` ``, `` `Timer:getCurrentTime()` ``, and `` `doThis(arg)` `` all resolve as if the parens weren't there.

Backtick references should resolve.

### Markdown subset

The supported Markdown features are: headings (`#` through `######`), bullet lists (`-` or `*`), numbered lists, paragraphs, `**bold**`, and `*italic*`. Backtick references inside Markdown still resolve — `` **bold mention of `Idle`** `` is valid.

Lists are flat: nested lists are not supported. Indented bullet lines (e.g. `  - sub-item`) render as plain text with the dash visible, not as a nested list. Restructure into separate top-level lists, sub-headings followed by their own lists, or prose with inline emphasis instead.

## Worked example — minimal device

A complete, valid two-component file with one handler, two user interfaces, and one user type. Shows a START transition, an ANY-source transition, an ANY-message wildcard, a choice-point with both branches, a `Timer:Timeout` transition with the built-in `TimerID` type referenced as a state-variable type without declaration, and transitions with backtick-referenced action text.

```json
{
  "format": "stadiae-v4",
  "interfaces": [
    { "name": "Device" },
    { "name": "Connection", "description": "Transceiver messages." }
  ],
  "messages": [
    { "interface": "Device",     "name": "ReadyInd" },
    { "interface": "Device",     "name": "ErrorInd" },
    { "interface": "Connection", "name": "ConnectReq",
      "parameters": [ { "name": "serverId", "type": "uint" } ] },
    { "interface": "Connection", "name": "ConnectedInd" }
  ],
  "components": [
    {
      "name": "ServerConnector",
      "description": "Establishes and maintains the server connection.",
      "states": [
        { "name": "Idle" },
        { "name": "Connecting" },
        { "name": "Connected" }
      ],
      "choicePoints": [
        { "name": "Allowed", "question": "Server\\nallowed?" }
      ],
      "stateVariables": [
        { "name": "serverId", "type": "uint" },
        { "name": "connectTimerId", "type": "TimerID", "description": "Timer for the connect attempt." }
      ],
      "constants": [
        { "name": "TIMEOUT", "value": "500", "description": "Connection timeout (ms)." }
      ],
      "localFunctions": [
        { "name": "initialize", "steps": "Reset `serverId` to zero." }
      ],
      "transitions": [
        { "source": "START", "target": "Idle", "messages": [], "connector": "Down", "length": 1 },
        { "source": "Idle", "target": "CP_Allowed",
          "messages": [ { "interface": "Connection", "name": "ConnectReq",
                          "action": "Store `serverId`." } ],
          "connector": "Down", "length": 1 },
        { "source": "CP_Allowed", "target": "Connecting",
          "messages": [ { "interface": "Logical", "name": "Yes",
                          "action": "Call `TimerHandler:setTimeout`(`TIMEOUT`, `connectTimerId`)." } ],
          "connector": "Down", "length": 1 },
        { "source": "CP_Allowed", "target": "Idle",
          "messages": [ { "interface": "Logical", "name": "No" } ],
          "connector": "Down", "length": 1 },
        { "source": "Connecting", "target": "Connected",
          "messages": [ { "interface": "Connection", "name": "ConnectedInd" } ],
          "connector": "Down", "length": 1 },
        { "source": "Connecting", "target": "Idle",
          "messages": [ { "interface": "Timer", "name": "Timeout",
                          "action": "Connection attempt timed out." } ],
          "connector": "Down", "length": 1 },
        { "source": "*", "target": "Idle",
          "messages": [ { "interface": "Device", "name": "ErrorInd" } ],
          "connector": "Down", "length": 1 }
      ]
    },
    {
      "name": "DeviceMonitor",
      "states": [ { "name": "Watching" } ],
      "transitions": [
        { "source": "START", "target": "Watching", "messages": [], "connector": "Down", "length": 1 },
        { "source": "Watching", "target": "Watching",
          "messages": [ { "interface": "*", "name": "*" } ],
          "connector": "Down", "length": 1 }
      ]
    }
  ],
  "handlers": [
    {
      "name": "Radio",
      "functions": [
        { "name": "connectServer",
          "parameters": [ { "name": "serverId", "type": "uint" } ] }
      ]
    }
  ],
  "connections": [
    { "component": "ServerConnector", "interface": "Connection", "connector": "Down", "length": 1 },
    { "component": "ServerConnector", "interface": "Device",     "connector": "Down", "length": 1 },
    { "component": "DeviceMonitor",   "interface": "Device",     "connector": "Down", "length": 1 }
  ],
  "handlerConnections": [
    { "handler": "Radio", "interface": "Connection", "connector": "Down", "length": 1 }
  ],
  "handlerCalls": [
    { "component": "ServerConnector", "handler": "Radio", "connector": "Down", "length": 1 }
  ],
  "types": [
    { "name": "uint", "description": "Unsigned integer." }
  ]
}
```

Note: the choice-point in `transitions` is referenced as `CP_Allowed` (the source/target convention prepends `CP_`), but its declaration in `choicePoints` uses just `Allowed`. This is the only place where the on-the-wire name in transitions diverges from the declaration name. Note also that `connectTimerId` is typed `TimerID` (a built-in), so it appears as a `stateVariable.type` value without any matching entry in `types` — built-in types are referenceable everywhere but never declared.

## Pre-submission checklist

Before submitting a model, run through these checks:

**Structure**

- [ ] `format` is exactly `"stadiae-v4"`.
- [ ] At least one component is present.
- [ ] No empty arrays, no empty strings, no fields equal to their defaults.

**Identifiers and uniqueness**

- [ ] Every `name` field that should be identifier-safe matches `^[A-Za-z][A-Za-z0-9_]*$`.
- [ ] Interface names are unique across `interfaces`.
- [ ] Component and handler names are unique across the **combined** namespace.
- [ ] Within each component: state names + choice-point names form one unique set; state variables, constants, and local functions each unique within their own list.
- [ ] Within each interface: message names unique. Within each handler: function names unique. Within each message/function: parameter names unique.
- [ ] Across `types`: type names unique (device-wide), and don't collide with built-in types (`Time`, `TimerID`).

**Display labels**

- [ ] Every display label (`deviceDisplayName`, every `displayName`, choice-point `question`) uses the literal two-character marker for line breaks — JSON source `"\\n"`, deserialised value `\n` (backslash plus `n`). A raw newline character in any of these fields is rejected.
- [ ] Other free-text fields (every `description`, transition `action`, local-function `steps`, type `specification`, constant `value`, `deviceSpecification`) use real newlines normally — JSON source `"\n"`, **not** `"\\n"`.

**Built-ins**

- [ ] No declarations of `Logical`, `Timer`, `TimerHandler`, `Time`, `TimerID`, or their messages/functions.
- [ ] `resendLastReceivedMessage` is not in any `localFunctions` array.
- [ ] `initialize`, when included, has *only* `name` and `steps` (no `description`, no other fields), and `steps` is non-empty.

**Transitions**

- [ ] Every `source` is one of: an existing state, an existing choice-point (with the `CP_` prefix), `START`, or `*`. Never `[H]`.
- [ ] Every `target` is one of: an existing state, an existing choice-point (with the `CP_` prefix), or `[H]`. Never `START` or `*`.
- [ ] Choice-point references in `source`/`target` use the `CP_` prefix; declarations in `choicePoints` do not.
- [ ] At most one transition has `source: "START"`, with `messages: []`.
- [ ] `Logical:Yes` / `Logical:No` are valid **only** as messages on transitions out of a choice-point.
- [ ] Transitions out of a choice-point carry **only** `Logical:Yes` / `Logical:No` — no other messages.
- [ ] No `(source, message)` pair is duplicated within one component.
- [ ] No two transition objects share the same `(source, target)` pair — when they would, they are merged into one object with both messages in its `messages` array.
- [ ] ANY-message wildcards (`interface: "*", name: "*"`) appear only as the sole message on a self-transition.
- [ ] Every `connector` is one of `"Right"`, `"Left"`, `"Up"`, `"Down"`. Every `length` is a positive integer.

**Wiring**

- [ ] `connections[].component` references exist; `connections[].interface` references exist and are not `Logical` or `Timer`.
- [ ] `handlerConnections[].handler` and `.interface` references exist; interface is not default.
- [ ] `handlerCalls[].component` and `.handler` references exist.
- [ ] At most one component with non-empty `multiplication` is connected to any given interface.
- [ ] Handlers do not carry a `multiplication` field.

**References**

- [ ] Backtick references in free-text fields resolve (component-local first, then qualified).
- [ ] Type references in `parameter.type` and `stateVariable.type` either match a defined type, are a built-in (`Time`, `TimerID`), or are intentionally free-text.

## Conventions and house style

The schema permits more than the project's models tend to use. These conventions produce well-formed models:

- **State names** are PascalCase nouns or noun phrases describing a condition: `Idle`, `Connecting`, `AwaitingPeripherals`. Not verbs (`Connect`), not snake_case (`awaiting_peripherals`).
- **Choice-point names** are PascalCase predicates without trailing `?`: `WhiteListed`, `AllReady`. The question mark goes in the `question` field.
- **Component names** are PascalCase compound nouns: `ServerConnector`, `DeviceStatusController`. Use `displayName` with a `\n` marker to break long labels: `"Server\\nConnector"`.
- **Interface names** are PascalCase nouns describing the message family: `Connection`, `Display`, `Audio`. Not plurals (`Connections`).
- **Message names** are PascalCase with a suffix indicating direction or kind: `ConnectReq`, `ConnectedInd`, `ErrorInd`, `Timeout`. `Req` for requests, `Ind` for indications/notifications, `Cnf` for confirmations is a common convention but not required.
- **Handler names** are PascalCase nouns: `WirelessTransceiver`, `TouchDisplay`. Often the physical or logical device they wrap.
- **Function names** on handlers are camelCase verbs or verb phrases: `connectServer`, `playSound`, `displayError`.
- **Parameter names** are camelCase: `serverId`, `soundId`, `image`.
- **Constants** are UPPER_SNAKE_CASE: `ADVERTISEMENT`, `CONNECTION_TIMEOUT`, `NUM_PERIPHERALS`.
- **State variables** are camelCase: `serverId`, `whitelist`.
- **Type names** are camelCase or PascalCase nouns: `uint`, `byteArray`, `UserId`, `Timestamp`.
- **Device naming.** When the device has a natural short identifier (an acronym or codename), put it in `deviceName` and the prose form in `deviceDisplayName` — e.g. `"deviceName": "DCSC", "deviceDisplayName": "Doors Controlling System Controller (DCSC)"`. When there's no natural short form, leave `deviceName` at its `"Device"` default and use only `deviceDisplayName`.
- **Connector and length defaults.** Set every transition's and connection's `connector` to `"Down"` and `length` to `1`. This applies uniformly to state-machine transitions and to the three device-level wiring arrays (`connections`, `handlerConnections`, `handlerCalls`). The other directions (`"Right"`, `"Left"`, `"Up"`) and longer lengths are valid — files edited by hand in the editor will use them to tune the layout — but generated models should default to `Down` / `1` and leave layout refinement to the user. **`connector` and `length` are layout hints with no model-level meaning. They are not part of the model's behaviour, are not user-facing, and should not be referenced when describing or summarising a model.** Do not list them in summaries, do not point to them as features of a transition, do not include them in change explanations.

In transition `action` text and local-function `steps`, sentences end with periods and references to functions use call syntax: *"Call `WirelessTransceiver:connectServer`(`serverId`)."* Constants are referenced bare: *"Start the timer with the `ADVERTISEMENT` interval."* Empty actions should be omitted, not stubbed with `"-"` or other placeholder text.

When the same action sequence appears on two or more transitions, define it once as a local function on the component and reference it by name (`` `doAdvertise()` ``) from each transition's `action`. Local functions take no parameters — they read and write the component's state variables directly.

## Description register: external vs. internal

Free-text descriptions in a model fall into two registers, and the choice of register is a real authoring decision rather than a stylistic preference.

**External-view fields** describe an entity from outside, as a contract: what it is responsible for, what messages it handles, what it produces, what behaviour callers can rely on. The state machine is one *implementation* of that contract; a different state machine could implement the same contract. External-view descriptions should remain valid through any state-machine refactor — which means they must not reference state names, choice-point names, or specific transitions. The right mental frame is *"this description was written before the state machine was implemented; the state machine is one realisation of what the description specifies"*.

The external-view fields are:

- component `description`
- handler `description`
- interface `description`
- message `description`
- `deviceSpecification`

**Internal-view fields** document specific implementation pieces. They naturally name the surrounding code — a state's `description` describes that state, a local function's `steps` describes a procedure that reads and writes state variables, a transition's `action` describes what happens when that transition fires. The convention here is to name what you are documenting and use backtick references freely.

The internal-view fields are:

- state `description`
- choice-point `description`
- state variable `description`
- constant `description`
- local function `description` and `steps`
- transition message `action`
- type `description` and `specification`
- parameter `description`

### Example: the same component, two registers

A `ServerConnector` component with three states (`Idle`, `Connecting`, `Connected`) and a choice-point that gates connection on a whitelist check.

**Less good — references states and choice-points (internal register in an external-view field):**

> Starts in the `Idle` state. On `ConnectReq`, moves through the `Allowed` choice-point: if the server is whitelisted, transitions to `Connecting` and starts a timer; if not, returns to `Idle`. From `Connecting`, transitions to `Connected` on `ConnectedInd`, or back to `Idle` on `Timer:Timeout`.

This description names states and a choice-point. If the state machine is refactored — `Connecting` split into `Authenticating` and `Negotiating`, the whitelist check moved to a guard on the `ConnectReq` transition, the timer pattern replaced — the description goes out of sync.

**Good — describes the contract (external register):**

> Establishes and maintains the connection to a server on request. On `ConnectReq`, attempts to connect to the requested server provided the server is on the whitelist; otherwise the request is silently dropped. A connection attempt that does not complete within the configured timeout is abandoned. Notifies on successful connection via `ConnectedInd`.

This description describes *what the component does*, not *how its state machine implements it*. It survives any internal refactor because it never named the internals.

When asked to update a component description after a state-machine change, default to the external register. If the change is genuinely a contract change — a new message type accepted, a new outcome produced — the description naturally needs to update. If the change is an internal restructuring, the description should not need to change at all.
