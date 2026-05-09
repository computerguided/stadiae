# Stadiæ MCP bridge — design

This document describes the design of `bridge.mjs`, the Node process that connects Claude Desktop to the Stadiæ editor running in a browser. It covers the protocol surfaces on each side, the dispatch model, the error-handling shape, and the assumptions and limitations that informed the choices.

## Purpose and scope

The bridge is a transport. It does not understand `stadiae-v4`, does not validate models, does not maintain state about the model, and does not cache anything. Its job is to translate between two protocols:

- **MCP over stdio** on the Claude Desktop side. Claude calls tools and reads resources; the bridge advertises a catalogue and routes each call.
- **WebSocket on `127.0.0.1:7531`** on the browser side. The browser opens a single WebSocket to the bridge and exchanges JSON-RPC-style request/response frames.

The bridge also serves the `stadiae-v4` reference document (the schema and FCM design conventions) to Claude as both an MCP resource and a tool. The document file itself is read from disk on each request; the bridge owns the delivery mechanism, not the content.

Anything semantic — what a valid model looks like, what the editor can and cannot change, what the user sees — lives on the browser side. The bridge stays small on purpose: it has no schema knowledge to maintain, no surface area to break when the editor evolves, and no state to lose if it restarts.

## Architecture

```
+--------------------+           stdio (MCP)          +-------------+        WebSocket          +-----------------+
|   Claude Desktop   |  <========================>    |  bridge.mjs |  <======================> |  stadiae.html   |
|  (LLM, tool user)  |                                |   (Node)    |   ws://127.0.0.1:7531     |   (browser)     |
+--------------------+                                +-------------+                           +-----------------+
                                                            ^
                                                            |
                                              spawned and managed by Claude Desktop
                                                  via mcpServers config
```

Three processes, two transport hops. The bridge is started and stopped by Claude Desktop; the browser connects opportunistically when the editor page loads.

## MCP side (Claude Desktop ↔ bridge)

### Server identity

The bridge identifies itself as:

```javascript
new Server({ name: "stadiae-bridge", version: "0.1.0" }, { capabilities: { tools: {}, resources: {} } });
```

The `tools: {}` capability declares that the server provides tools. The `resources: {}` capability declares that it provides resources. Adding `prompts: {}` later would follow the same pattern: declare the capability, register a request handler.

### Tool catalogue

Tool advertisement is handled by `setRequestHandler(ListToolsRequestSchema, ...)`. The handler returns a static array — one entry per tool — each with three fields:

- `name` — the identifier Claude calls. Snake_case verbs by convention.
- `description` — prose Claude reads to decide whether and when to call the tool. This is the only thing Claude sees about the tool's purpose; it does its share of the work.
- `inputSchema` — JSON Schema describing the tool's parameters. Empty object for tools that take none.

The current catalogue contains three entries:

- **`get_model`** — forwards to the browser; returns the user's current model as `stadiae-v4` JSON, alongside a session-local version stamp. Used whenever Claude needs to know what's actually in the editor, and as the prerequisite for any subsequent `replace_model` call (see *Optimistic concurrency* below).
- **`get_schema`** — bridge-local; returns the `stadiae-v4` reference document. The same content is served as the `stadiae://schema` MCP resource (see *Resources* below); the tool exists as a fallback for clients that don't surface resources to the LLM automatically.
- **`replace_model`** — forwards to the browser; replaces the user's model with a supplied `stadiae-v4` document after strict validation. Requires the version stamp from a prior `get_model` as `expectedVersion`; on stale-version or validation failure the call is rejected with structured per-field detail and no change is applied. Used whenever the user asks Claude to build, modify, or restructure their model.

Tool descriptions are deliberately written to do three jobs: state what is returned, give example phrasings the user might use to trigger the tool, and state what the tool does *not* do. Claude grounds its decision-making in this text; underwritten descriptions cause Claude to either skip the tool or misuse it.

### Tool dispatch

`setRequestHandler(CallToolRequestSchema, ...)` handles every tool invocation. The handler dispatches on `req.params.name` with a `switch`:

```javascript
switch (toolName) {
  case "get_model":
    // forward to browser, wrap response
  case "get_schema":
    // read the schema doc from disk, wrap as text content
  case "replace_model":
    // forward to browser with model + expectedVersion, wrap response
  default:
    return toolError(`Unknown tool: ${toolName}`);
}
```

The dispatch model supports two kinds of tool implementations:

- **Browser-forwarding tools.** The handler calls `callBrowser(method, args)` with a method name that matches a handler on the browser side, awaits the response, and wraps it as an MCP `CallToolResult`. Use this for any tool whose answer depends on the user's model state, or that mutates it. `get_model` and `replace_model` are both browser-forwarding.
- **Bridge-local tools.** The handler computes the answer directly without forwarding. Use this for tools that report bridge-owned state — schema documents, version information, capability lists. `get_schema` is one.

The `default` arm exists to handle the case where Claude calls a tool that isn't in the catalogue. This should not happen in normal operation — Claude only calls tools it has seen in the `ListTools` response — but defends against version skew between the advertised catalogue and the implemented dispatch (e.g. during development).

### Result shape

A successful tool call returns:

```javascript
{
  content: [
    { type: "text", text: <stringified JSON> }
  ]
}
```

The `content` array is the MCP standard. A single text block holds the response payload as stringified JSON. Claude parses it back to a JavaScript object on its end.

The choice of compact (no indentation) vs. pretty-printed JSON is cosmetic; Claude reads both equally well. Compact is the default; pretty-printed makes MCP traces easier to inspect during debugging but inflates payload size.

### Error shape

Errors use the MCP `CallToolResult` error variant rather than thrown exceptions:

```javascript
{
  content: [
    { type: "text", text: JSON.stringify({ error: "..." }) }
  ],
  isError: true
}
```

`isError: true` tells Claude Desktop to surface the call as a failure within the conversation flow rather than as a stack trace. The text body holds a structured object so future tools can add fields (error code, retry hint, etc.) without changing the envelope.

This is the responsibility of the `toolError(message)` helper. Every error path — unknown tool, browser disconnected, browser timeout — funnels through it.

### Resources

The bridge serves the `stadiae-v4` reference document as an MCP resource. Two handlers cover it:

- `setRequestHandler(ListResourcesRequestSchema, ...)` advertises one resource with URI `stadiae://schema`, name *Stadiæ stadiae-v4 reference*, and `mimeType: "text/markdown"`.
- `setRequestHandler(ReadResourceRequestSchema, ...)` returns the file contents when the matching URI is read.

Both handlers funnel through a shared `readSchema()` helper that reads the file from disk. The `get_schema` tool calls the same helper, so the file lookup, error behaviour, and any future caching live in one place — change `readSchema()` once and the resource and tool stay in sync.

The schema document path resolves like this:

- If `STADIAE_SCHEMA_PATH` is set in the environment, the bridge uses that path verbatim (resolved to absolute).
- Otherwise the bridge looks for `stadiae_mcp_instructions.md` in the same directory as `bridge.mjs`.

The file is read on every request, not cached. The doc is small (~40 KB), reads are essentially free, and not caching means edits to the file propagate to Claude without restarting the bridge — useful while iterating.

A startup probe (`access(SCHEMA_PATH)` once at boot) emits a stderr warning if the file is missing. The bridge does not crash — `get_model` still works without the schema — but the warning surfaces in Claude Desktop's MCP logs so the misconfiguration is visible.

The reason for serving the schema both ways:

- **MCP resources** are the protocol-correct delivery channel. Some clients automatically surface advertised resources to the LLM; in that case the schema reaches Claude without any explicit action.
- **The `get_schema` tool** is the bulletproof fallback. Claude can decide to call it, and clients that don't auto-load resources still get the doc into context once Claude reaches for it.

Phase 1 testing surfaced a real example of why both paths matter: an early Claude Desktop build advertised the resource correctly but did not pull it into Claude's context, and the LLM produced confidently wrong content (e.g. expanding *FCM* as *Function Class Model*). Telling Claude *"Use the `get_schema` tool"* fixed the problem immediately. As Claude Desktop matures, the resource path may become reliable enough to make the tool redundant; until then, both stay.

### Optimistic concurrency: the model version contract

`get_model` and `replace_model` are not transactionally linked. A conversation typically reads the model once, edits it slowly while Claude composes a response, and writes it back several seconds (or minutes) later. In the meantime, the user is free to edit the model directly in the editor — and without a guard, those edits are silently overwritten when Claude submits its replacement built from the stale read.

The bridge solves this with optimistic concurrency control. Every state-changing operation in the editor increments a monotonic `Model.version` counter. The protocol is:

1. `get_model` returns `{ model, version }` — the document and the version stamp at the moment of read.
2. `replace_model` requires an `expectedVersion` parameter alongside the new model. The editor compares it to the current `Model.version`:
   - If they match, the replacement proceeds, the version increments, and the response includes the new version.
   - If they differ, the call is rejected with a structured error containing the current version, and **no change is applied**.
3. Claude reacts to a stale-version rejection by calling `get_model` again, reapplying its intended edit on top of the fresh state, and resubmitting with the new version.

The check happens *before* schema validation. There is no value in reporting field-level errors against a model the caller is going to refetch and recompose anyway.

The version is opaque to the user. It does not appear in the UI, is not persisted to file, and is not part of the `stadiae-v4` on-disk format — it is a session-local counter that exists solely for this contract. A bridge restart resets it; clients that survive a bridge restart should refetch.

What counts as version-incrementing:

- Every call to `pushHistory()` (the editor's standard mutation entry point).
- Every `undo()` and `redo()` (they change the visible model from what was previously read, even though the user did not "edit" in the conventional sense).
- Loading a file (`applyLoadedModel`) — the model is wholly replaced.
- A successful `replace_model` (so the response's version is one ahead of the request's `expectedVersion`).

Operations that don't change model state (canvas pan, zoom, opening dialogs without saving) do not increment.

Why optimistic and not pessimistic locking: the conflict is rare (the user does not usually edit during a Claude turn), and a lock would block the user's UI on a Claude operation that may take seconds. Optimistic concurrency makes the no-conflict path free and pushes the cost onto the rare conflict, which is exactly the right shape for an interactive editor with an occasional concurrent agent.

The error returned on a version mismatch carries `errors: [{ path: "expectedVersion", message: "Submitted ... current ...", currentVersion: N }]`. The `currentVersion` field exists so a sufficiently sophisticated client could refetch lazily by short-circuiting the next `get_model` round-trip; current usage just calls `get_model` again. The message itself is written for an LLM reader: it states the diagnostic facts and the expected recovery (refetch + reapply + resubmit) explicitly.

## Browser side (bridge ↔ stadiae.html)

### Listener

The bridge runs a `WebSocketServer` listening on `127.0.0.1:7531`. The listener accepts any incoming connection from `localhost` and ignores network interfaces — the server is not reachable from outside the machine.

The port number is hardcoded. The browser side must use the same port; configuring it is a deferred concern.

### Single-connection model

The bridge keeps one reference, `browserSocket`, to the active browser connection. When a new browser connects, `browserSocket` is reassigned to the new socket; any previous socket is left to its own lifecycle (the browser-side close handler clears the bridge-side reference if the bridge still holds it).

This is "last connection wins". It is appropriate for a single-user desktop tool with one editor tab open at a time. Two simultaneous tabs is an unsupported configuration: the more recent one is the one the bridge talks to, and the earlier one's pending requests will time out.

A future change to support multiple tabs (or to negotiate which is the "active" one) would require:

- Tracking all live sockets, not just the most recent.
- A way for tabs to declare themselves available or busy.
- Routing decisions when a request could go to either tab.

Worth doing only if real friction emerges; the single-connection assumption is documented and intentional.

### Frame format

Every frame is a single JSON object. The bridge → browser direction uses request frames:

```json
{ "id": 17, "method": "get_model", "params": {} }
```

The browser → bridge direction uses response frames:

```json
{ "id": 17, "result": { ... } }
```

…or error frames:

```json
{ "id": 17, "error": { "message": "..." } }
```

`id` is a monotonically increasing integer assigned by the bridge. The browser must echo it on the response so the bridge can match the response to the originating request. Frames without a matching pending `id` are silently dropped; frames that fail to parse as JSON are silently dropped.

The shape is intentionally JSON-RPC-like without claiming JSON-RPC compliance — there is no `jsonrpc: "2.0"` field, no batch support, no notifications. The protocol is just enough to support correlated request/response over a WebSocket.

### `callBrowser(method, params)`

Bridge-side helper that sends a request and returns a Promise resolving to the response (or rejecting on error). Mechanics:

1. If `browserSocket` is null, reject immediately with `"No browser connected"`.
2. Allocate a fresh `id` (`nextId++`), register a resolver in the `pending` map keyed by that `id`.
3. Send `{ id, method, params }` over the WebSocket.
4. Schedule a 30-second timeout; if the resolver has not been invoked by then, delete it from `pending` and reject with `"Browser timeout"`.
5. When a response arrives, the WebSocket `message` handler looks up the resolver by `id`, removes it, and invokes it with the parsed message. If the message contains an `error` field, the resolver rejects; otherwise it resolves with the full message.

The 30-second timeout is a safety net. Expected round-trip latency is milliseconds; a 30-second wait indicates the browser hung, the tab was navigated away, or a debugger paused execution. The bridge does not retry — failure is final and reported back through the error path.

### Browser disconnect handling

When the WebSocket emits `close`, the bridge clears `browserSocket` if it still points at the closing socket. Any requests already pending against that socket will time out at the 30-second mark and surface as `"Browser timeout"` errors. There is no proactive cancellation of pending work, no reconnection logic, no buffering of requests for a future browser connection.

A user-visible consequence: if the user closes the editor tab while Claude is mid-call, they will see the error roughly 30 seconds later. Acceptable for now.

## Error mapping

The bridge translates raw connection-layer errors into user-facing prose before passing them up. The translation lives in `connectionMessage(err)`:

| Raw error                      | User-facing message                                                                                          |
|--------------------------------|--------------------------------------------------------------------------------------------------------------|
| `"No browser connected"`       | *Stadiæ is not connected. Open the Stadiæ editor in your browser so it can connect to this bridge.*           |
| `"Browser timeout"`            | *Stadiæ did not respond in time. Check that the editor tab is still open and active.*                        |
| anything else                  | *(passed through with the original message)*                                                                  |

The translation matters because Claude passes these messages through to the user verbatim. A user who installed the bridge needs to know what to do, not what went wrong technically. *"WebSocket connection refused on 127.0.0.1:7531"* is correct but unactionable; *"Open the Stadiæ editor in your browser"* tells them the next step.

New translation entries are added as the bridge gains failure modes that warrant specific guidance. Anything left unmapped falls through with its original message — better than swallowing.

## Lifecycle

The bridge process is started and stopped by Claude Desktop. The relevant config entry is:

```json
{
  "mcpServers": {
    "stadiae-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/bridge.mjs"]
    }
  }
}
```

Claude Desktop spawns the bridge when the user starts a conversation that may use it, and terminates it when the conversation ends or the desktop client closes. The bridge does not persist anything across runs and does not need to.

Termination is handled in three ways, any of which is sufficient to exit cleanly and release the WebSocket port:

- `SIGTERM` — the standard signal Claude Desktop sends to a child MCP server during shutdown.
- `SIGINT` — Ctrl+C when the bridge is run manually for testing.
- stdin EOF — Claude Desktop also closes the bridge's stdin during shutdown. On platforms where signal delivery is unreliable (notably some Linux Electron builds), the stdin close is the more reliable signal that the parent has gone away.

A `shutdown()` helper is wired to all three. It closes the `WebSocketServer` (releasing the port), terminates any active browser socket, and exits with code 0. The helper is idempotent: shutting down twice is harmless. Without these handlers — as in earlier versions of the bridge — the WebSocket server kept the process alive after stdio closed, leaving the port held until the bridge was killed manually. The next Claude Desktop launch then hit `EADDRINUSE` on its fresh bridge.

If the bridge fails to start because the port is already in use (a stray older process, or a manually-launched instance), the `WebSocketServer` `error` event is caught and the bridge exits with code 1 after writing a friendly diagnostic line to stderr. That line surfaces in Claude Desktop's MCP logs and tells the user how to find and stop the stale process.

The browser connection lifecycle is independent. The browser opens its WebSocket when `stadiae.html` loads (and tries again on a backoff if the bridge is not yet running). It closes the WebSocket on page unload. A bridge restart while the editor is open will appear to the browser as a connection drop, and the browser is responsible for reconnecting.

## Configuration

Two values are hardcoded:

- **Listening port** — `7531`, defined as `const PORT`. Change to relocate the listener; the browser side must agree.
- **Browser request timeout** — `30000` ms, defined as `BROWSER_TIMEOUT_MS`. Change with care: too short and slow networks (or paused tabs) generate spurious errors; too long and a hung browser blocks tool calls for longer than the user will tolerate.

One value is overridable via environment variable:

- **`STADIAE_SCHEMA_PATH`** — path to the `stadiae-v4` reference document served by the resource and the `get_schema` tool. Defaults to `stadiae_mcp_instructions.md` next to `bridge.mjs`. Override only for non-standard layouts.

The port and timeout are not currently exposed as environment variables. Worth introducing if multiple users want different ports or if integration tests need shorter timeouts.

## Threat model and safety

The listener is bound to `127.0.0.1` only and is not reachable from outside the machine. There is no authentication: any local process can connect to the WebSocket and pretend to be the editor. This is appropriate for a single-user desktop tool but not for multi-user systems.

Specifically not in scope:

- Defending against a malicious local process. A process running as the user can already access Claude Desktop's data, the user's files, and the editor's tab — adding a token to the WebSocket would not meaningfully raise the bar.
- Defending against a hostile Claude Desktop. The bridge trusts whatever tool calls arrive over stdio. If Claude Desktop is compromised, the bridge is compromised.

If multi-user use becomes a real requirement, the appropriate fix is per-bridge tokens negotiated at startup (Claude Desktop launches the bridge with a fresh token in its environment, the bridge requires that token in the WebSocket handshake, the editor reads it from a known location). Until then, the trust model is "single-user desktop, all local."

## Logging

The bridge does not log. Every operation is silent. This keeps stdout clean for the MCP protocol stream and keeps stderr from filling Claude Desktop's logs with routine traffic.

When debugging is needed, add `console.error(...)` lines locally. They go to stderr, which Claude Desktop captures separately from the protocol stream. Avoid `console.log` — that lands on stdout and corrupts the MCP framing.

## Extension recipes

### Adding a new browser-forwarding tool

1. Implement the handler on the browser side, dispatched by `method` name.
2. Add a catalogue entry in `setRequestHandler(ListToolsRequestSchema, ...)` with `name`, `description`, `inputSchema`.
3. Add a `case` arm in `setRequestHandler(CallToolRequestSchema, ...)` that calls `callBrowser(toolName, args)` and wraps the response.

The browser-side method name and the MCP tool name conventionally match; nothing in the bridge requires this, but it keeps debugging traceable.

`replace_model` is the worked example of a browser-forwarding tool that does more than read state. Its catalogue entry advertises both required parameters (`model` and `expectedVersion`); its dispatch arm forwards both verbatim; the browser-side handler validates strictly, throws a structured `{message, errors}` payload on failure, and the bridge's `catch` block surfaces the structured detail back to Claude via `toolError(msg, errors)`. Mutating tools follow this shape: a strict validator on the browser side and structured errors that reach the LLM unmodified.

### Adding a bridge-local tool

1. Add a catalogue entry as above.
2. Add a `case` arm that returns the result directly without calling `callBrowser`.

A natural candidate is `get_capabilities`, returning the bridge's version, the supported `stadiae-v4` features, and the list of advertised tools. Reading from a config file is a bridge-local concern; reading from the user's model is a browser-forwarding concern.

### Adding a new resource

1. Pick a URI under the `stadiae://` scheme.
2. Add an entry to the array returned by `setRequestHandler(ListResourcesRequestSchema, ...)`.
3. Add a matching `if (req.params.uri === ...)` arm in `setRequestHandler(ReadResourceRequestSchema, ...)`.
4. If the resource is a file on disk, route the read through a shared helper (modelled on `readSchema()`) so the path resolution and error handling stay in one place.

If the same content is also useful as a tool the LLM can call explicitly, add a parallel `get_*` tool that funnels through the same helper. The resource is the protocol-correct surface; the tool is the fallback for clients that don't auto-load resources.

### Mapping a new error

1. Identify the raw error message produced (often by adding a temporary log line).
2. Add a `raw.includes(...)` arm in `connectionMessage()` returning user-facing prose.

Keep the user-facing text actionable: tell the user what to do, not what failed.

## Troubleshooting

The bridge has only a few moving parts, but the wider integration — Claude Desktop spawning a Node process, that process listening on a TCP port, and the browser-side WebSocket connecting back — has more failure modes than the bridge itself does. The patterns below are the ones encountered during Phase 1 setup; future installs are likely to hit some of them again.

### Bridge does not start at all

Symptoms: Claude Desktop's MCP log for `stadiae-bridge` shows no activity at all, or shows the server "starting" and immediately disconnecting. No `bridge.mjs` process visible in `pgrep -af bridge.mjs`.

Most likely causes, in order:

1. **`isUsingBuiltInNodeForMcp: true`** in `claude_desktop_config.json`. When this flag is on, Claude Desktop ignores the `command` field and tries to run the bridge with its own bundled Node binary. On Linux Electron builds the bundled Node is often missing or broken, and the spawn fails silently. Setting the flag to `false` (or removing the line entirely) is the fix. This is the most common cause and the easiest to overlook because the spawn failure produces no useful error.

2. **`node` not on Claude Desktop's PATH.** Claude Desktop launches from the desktop environment, which has a smaller PATH than an interactive shell. If `node` is installed under nvm, snap, or a non-standard prefix, the bare `"command": "node"` will fail. Replace with the absolute path:
   ```json
   "command": "/usr/bin/node"
   ```
   Find the right value with `which node`. If the result lives under `~/.nvm/versions/...`, use that full path — accepting that you'll re-edit the config when you upgrade Node.

3. **JSON syntax error in the config file.** A trailing comma or stray character makes Claude Desktop silently ignore the entire `mcpServers` block. Validate with:
   ```
   python3 -m json.tool ~/.config/Claude/claude_desktop_config.json
   ```
   A successful parse confirms the structure; an error message identifies the line.

4. **Bridge file path wrong, or `node_modules` missing.** Run the bridge manually:
   ```
   node /path/to/bridge.mjs
   ```
   It should sit silently waiting for input. If it crashes with `Cannot find module '@modelcontextprotocol/sdk'` or similar, run `npm install` in the bridge's directory.

### Bridge starts but exits with `Port 7531 is already in use`

Symptoms: Claude Desktop's MCP log shows the bridge starting, then a stderr line like *"[stadiae-bridge] Port 7531 is already in use. Another bridge process may still be running…"*, followed by exit code 1.

Cause: another bridge process is bound to port 7531. This is rare in normal operation — the bridge releases the port on `SIGTERM`, `SIGINT`, or stdin EOF, all of which Claude Desktop produces during shutdown. It usually means either a manually-launched bridge instance is still running (e.g. one started for testing), or a previous bridge crashed in a way that bypassed the shutdown handlers (a hard kill via `kill -9`, an out-of-memory exit, etc.).

Diagnosis:
```
pgrep -af bridge.mjs        # any stale processes?
ss -lnt | grep 7531         # anything still listening?
```

Fix:
```
pkill -f bridge.mjs
```

Then restart Claude Desktop. The port should be free and the new bridge will start cleanly.

In earlier versions of the bridge this scenario was much more disruptive: stdio close did not stop the WebSocket server, so every Claude Desktop shutdown left a stale bridge holding the port. The current bridge listens for `SIGTERM`, `SIGINT`, and stdin EOF, exits cleanly on all three, and produces the friendly stderr message above when it does encounter a port conflict (instead of crashing with a stack trace).

### Bridge runs but the editor cannot connect

Symptoms: Claude Desktop shows the bridge connected; `pgrep -af bridge.mjs` shows the process; but clicking *Connect* in Stadiæ's File → Bridge dialog leaves the status at *Disconnected* or *Connecting…* indefinitely.

Most likely causes:

1. **Wrong URL in the dialog.** The default is `ws://127.0.0.1:7531`. Verify the protocol scheme (`ws://`, not `http://`) and the port matches the bridge's `PORT` constant.

2. **A different process holds the port.** `ss -lnt | grep 7531` should show the bridge listening. If something else is using the port, change `PORT` in `bridge.mjs` and the URL in the dialog to match.

3. **Browser security restriction.** Stadiæ served from a `file://` URL or over HTTPS connecting to a `ws://` URL can run into mixed-content blocks. The console (browser DevTools) will say so. Serving Stadiæ from HTTP locally usually clears this.

### Schema not reaching Claude

Symptoms: Claude answers questions about Stadiæ models with confidently wrong content — making up FCM expansions, inventing schema rules, or describing the model in generic state-machine terms instead of FCM vocabulary.

Diagnosis: ask Claude *"Use the `get_schema` tool to read the reference doc, then answer my previous question."* If after the explicit prompt the answer becomes correct, the resource is not being auto-loaded by Claude Desktop and Claude has been working without the schema.

Possible causes:

1. **The bridge does not have the schema file.** Check `ls /path/to/bridge/stadiae_mcp_instructions.md`. If missing, copy it next to `bridge.mjs` (or set `STADIAE_SCHEMA_PATH`).

2. **The bridge starts before the schema file is in place.** Restart Claude Desktop after putting the file there.

3. **The Claude Desktop build does not auto-surface MCP resources.** Resource auto-loading varies by client version. The `get_schema` tool exists precisely for this case — Claude can call it explicitly. If users hit this often, consider strengthening the tool's description with stronger language about calling it at the start of any model-related conversation.

### A "stale answer" mystery

Symptoms: Claude describes a model that no longer matches what's in the editor — references a state that was renamed, mentions a component that was deleted.

Cause: Claude is answering from an earlier `get_model` response held in its conversation context, not from a fresh fetch.

Fix: ask Claude to re-fetch (*"check the model again"*). If the issue is recurring, strengthen `get_model`'s description with language about each call returning a fresh snapshot — Claude reads the description on every catalogue refresh and adjusts its caching instinct.

## Limitations and deferred work

- **No reconnection logic.** The browser is responsible for reconnecting if the bridge restarts; the bridge is responsible for nothing.
- **No request cancellation.** Once a request is sent to the browser, the bridge will wait for either a response or the timeout. There is no way for Claude to cancel an in-flight call.
- **No multi-tab support.** Last connection wins. See Single-connection model.
- **No streaming.** Every tool returns one result. Long-running operations would have to be modelled as poll-and-fetch.
- **No persistence.** Bridge state is in-memory; restarting the bridge loses pending requests (and the browser will see them time out).
- **No metrics.** No request count, no latency tracking, no error rate. Worth adding when there is a question to answer with them.
