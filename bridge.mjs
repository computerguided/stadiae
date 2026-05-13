// Stadiæ ↔ Claude Desktop MCP bridge.
//
// Sits between Claude Desktop (stdio, MCP protocol) and the Stadiæ editor
// running in a browser (WebSocket on 127.0.0.1:7531). Claude calls tools;
// the bridge dispatches each call either to the browser (for tools that
// touch the user's model) or handles it locally (for tools that report
// the bridge's own state).
//
// The bridge also serves the stadiae-v4 reference document — the schema
// and FCM design conventions — as both an MCP resource (preferred) and
// a tool (fallback). Clients that surface MCP resources to the LLM will
// pick up the resource automatically; clients that don't can still call
// the get_schema tool to fetch the same content.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WebSocketServer } from "ws";
import { readFile, access } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const PORT = 7531;
const BROWSER_TIMEOUT_MS = 30000;

// Schema document location. Defaults to a sibling file alongside this
// script; override with STADIAE_SCHEMA_PATH for development or unusual
// layouts. The file is read on every request so edits propagate without
// restarting the bridge.
const SCHEMA_FILENAME = "stadiae_mcp_instructions.md";
const SCHEMA_PATH = process.env.STADIAE_SCHEMA_PATH
  ? resolve(process.env.STADIAE_SCHEMA_PATH)
  : resolve(dirname(fileURLToPath(import.meta.url)), SCHEMA_FILENAME);
const SCHEMA_URI = "stadiae://schema";

// Use-cases document location. The use-cases catalogue describes how to
// perform every editor operation — adding components, wiring interfaces,
// renaming, deleting, configuring. Served as both an MCP resource and a
// tool, exactly like the schema doc. Defaults to a sibling file alongside
// this script; override with STADIAE_USE_CASES_PATH. Same read-on-every-
// request behaviour as the schema so edits propagate without restarting.
const USE_CASES_FILENAME = "use-cases.html";
const USE_CASES_PATH = process.env.STADIAE_USE_CASES_PATH
  ? resolve(process.env.STADIAE_USE_CASES_PATH)
  : resolve(dirname(fileURLToPath(import.meta.url)), USE_CASES_FILENAME);
const USE_CASES_URI = "stadiae://use-cases";

// Optional icon for the server, surfaced in the Claude Desktop connector
// list as an entry in the `icons` array of the server's Implementation
// object (per the MCP `icons` extension). The icon is optional — if no
// file is found the bridge runs as before and the client falls back to
// its built-in placeholder.
//
// Resolution: STADIAE_ICON_PATH is honoured if set. Otherwise the bridge
// looks for `stadiae-icon.{png,svg,jpg,jpeg,webp}` in its own directory
// and uses the first one that exists. The MIME type follows from the
// extension. PNG and JPEG are universally supported by icon-rendering
// clients; SVG and WebP are required-to-be-supported by those that
// implement the optional half of the spec.
//
// Read once at startup; restart the bridge to pick up a changed icon.
const ICON_EXTENSIONS = ["png", "svg", "jpg", "jpeg", "webp"];
const ICON_PATH = (() => {
  if (process.env.STADIAE_ICON_PATH) {
    return resolve(process.env.STADIAE_ICON_PATH);
  }
  const dir = dirname(fileURLToPath(import.meta.url));
  for (const ext of ICON_EXTENSIONS) {
    const candidate = resolve(dir, `stadiae-icon.${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
})();
// Build the Icon object spelled out in the MCP spec:
//   { src: "data:...;base64,...", mimeType: "image/...", sizes: [...]? }
// `sizes` is set to ["any"] for SVG (scalable, no fixed size), and
// omitted for raster formats — without parsing the file we don't know
// the actual dimensions, and the spec says the field is optional.
const ICON = (() => {
  if (!ICON_PATH || !existsSync(ICON_PATH)) return null;
  try {
    const b64 = readFileSync(ICON_PATH).toString("base64");
    const lower = ICON_PATH.toLowerCase();
    const mimeType = lower.endsWith(".svg")  ? "image/svg+xml"
                   : lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg"
                   : lower.endsWith(".webp") ? "image/webp"
                   : "image/png";
    const icon = {
      src: `data:${mimeType};base64,${b64}`,
      mimeType,
    };
    if (mimeType === "image/svg+xml") icon.sizes = ["any"];
    return icon;
  } catch (_) {
    return null;
  }
})();

let browserSocket = null;
const pending = new Map();
let nextId = 1;

// --- WebSocket side: the browser connects here ---
//
// Single-connection model: whichever browser tab connected most recently
// is the one we talk to. If a second tab connects, the first one's pending
// requests will time out — fine for a single-user desktop tool, revisit
// if multi-tab usage becomes real.
const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });
wss.on("connection", (ws) => {
  browserSocket = ws;
  ws.on("message", (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return; // ignore malformed frames
    }
    const resolver = pending.get(msg.id);
    if (resolver) {
      pending.delete(msg.id);
      resolver(msg);
    }
  });
  ws.on("close", () => {
    if (browserSocket === ws) browserSocket = null;
  });
});

// Catch listener-level errors (most commonly EADDRINUSE: another bridge
// process is already bound to the port). Without a handler, Node's
// default behaviour for a `WebSocketServer` `error` event is to throw,
// crashing the process with a stack trace that isn't useful to the
// user. Convert to a friendly stderr line and exit cleanly.
wss.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(
      `[stadiae-bridge] Port ${PORT} is already in use. ` +
      `Another bridge process may still be running — check with \`pgrep -af bridge.mjs\` ` +
      `and \`pkill -f bridge.mjs\` if so. Exiting.`
    );
  } else {
    console.error(`[stadiae-bridge] WebSocket server error: ${err?.message || err}`);
  }
  process.exit(1);
});

// Send a request to the browser and wait for the matching response.
// Rejects on missing connection, on timeout, or if the browser reports
// an error in its response envelope.
function callBrowser(method, params) {
  return new Promise((resolve, reject) => {
    if (!browserSocket) {
      return reject(new Error("No browser connected"));
    }
    const id = nextId++;
    pending.set(id, (msg) => {
      if (msg.error) {
        // The browser side may attach a structured `.errors` array with
        // per-field validation detail. Preserve it on the rejected
        // Error so the dispatch layer can pass it through to the LLM.
        const e = new Error(msg.error.message || String(msg.error));
        if (Array.isArray(msg.error.errors)) e.errors = msg.error.errors;
        reject(e);
      } else {
        resolve(msg);
      }
    });
    browserSocket.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("Browser timeout"));
      }
    }, BROWSER_TIMEOUT_MS);
  });
}

// --- MCP side: Claude Desktop talks to us over stdio ---
const serverInfo = { name: "stadiae-bridge", version: "0.1.0" };
// Attach the icon to serverInfo only when one was loaded. The MCP spec
// uses an `icons` array on the server's Implementation object; clients
// pick the most appropriate one based on size or theme. We only ever
// emit a single entry today, but the array shape is the spec contract.
if (ICON) serverInfo.icons = [ICON];
const server = new Server(
  serverInfo,
  { capabilities: { tools: {}, resources: {} } }
);

// Tool catalogue — what Claude sees when it asks "what tools are available?"
// The description text matters: it's the only thing Claude reads to decide
// whether and when to call this tool.
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_model",
      description:
        "Returns the Stadiæ device model currently open in the user's browser, as a `stadiae-v4` JSON document, " +
        "alongside the model's current version stamp. The response shape is `{model, version}`. Use this when the " +
        "user refers to their model, current diagram, or design — phrases like \"my model\", \"the current device\", " +
        "\"what I have so far\", \"this diagram\". Also call it before suggesting any modification, so the suggestion " +
        "is grounded in what's actually there rather than what you assume is there. " +
        "The `version` is required for any subsequent `replace_model` call: pass it back as `expectedVersion`. " +
        "If a `replace_model` call fails because the version is stale (the user has edited in the meantime), call " +
        "`get_model` again to refetch and reapply your edit on top of the new state. " +
        "The version is an internal synchronisation token. Do not mention it in replies to the user; it is not part " +
        "of the model's content and the user has no use for it. " +
        "Read-only: does not modify the model. Each call returns a fresh snapshot.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "get_schema",
      description:
        "Returns the Stadiæ stadiae-v4 reference document (Markdown) — the schema for the model format and the " +
        "FCM design conventions that distinguish a good model from a merely valid one. Call this once at the start " +
        "of any conversation that involves understanding, describing, or generating a Stadiæ model, before calling " +
        "get_model. The same content is also available as the `stadiae://schema` MCP resource; if your client has " +
        "already loaded that resource into context, this tool is redundant.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "get_use_cases",
      description:
        "Returns the Stadiæ use-cases catalogue (HTML) — step-by-step instructions for every editor operation: " +
        "adding/renaming/deleting components, handlers, interfaces, messages, states, choice-points, transitions; " +
        "wiring components to interfaces; setting per-component multiplication; configuring type definitions; " +
        "navigating between component and device views; saving and exporting; connecting and disconnecting the " +
        "Claude Desktop bridge. Call this whenever the user asks how to do something in the editor — phrases like " +
        "\"how do I add a…\", \"how do I rename…\", \"what does the X button do\", \"how do I export…\", \"how do I " +
        "connect the bridge\". This catalogue describes the user interface, not the data model — for questions about " +
        "what makes a model valid or well-designed, use get_schema instead. The same content is also available as " +
        "the `stadiae://use-cases` MCP resource. Episodic: do not load proactively; call only when a question about " +
        "editor operations arises.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "replace_model",
      description:
        "Replaces the user's current Stadiæ model with the supplied stadiae-v4 JSON document. The new model is " +
        "validated strictly before it is loaded; on validation failure the call returns an error containing per-field " +
        "detail (path, message, and where applicable the set of valid alternatives), which you should use to correct " +
        "the document and retry. On success the editor refreshes immediately and the change is undoable in one step. " +
        "Use this when the user asks you to build, modify, or restructure their model. " +
        "Always call `get_model` first and pass back the version it returned as `expectedVersion`. This guards " +
        "against silently overwriting changes the user made in the editor since you last read the model. If the call " +
        "is rejected because the version is stale, call `get_model` again, reapply your intended edit on the fresh " +
        "state, and resubmit with the new version. Consult `get_schema` (or the stadiae://schema resource) if you " +
        "are unsure of the format.",
      inputSchema: {
        type: "object",
        properties: {
          model: {
            type: "object",
            description: "A complete stadiae-v4 model document. Must include the `format: \"stadiae-v4\"` marker.",
          },
          expectedVersion: {
            type: "number",
            description: "The version stamp returned by the most recent get_model call. The replace is rejected if the model has changed since.",
          },
        },
        required: ["model", "expectedVersion"],
      },
    },
    {
      name: "get_diagram",
      description:
        "Returns an SVG rendering of one of the user's Stadiæ diagrams. With `scope: \"device\"` returns the " +
        "device-level diagram — every component, handler, and interface and their wiring. With `scope: \"component\"` " +
        "and a `component` name returns the state-machine diagram for that one component. The SVG is always rendered " +
        "clean, with no selection highlight. " +
        "Use this when the user asks to see a diagram (\"show me the device\", \"what does ServerConnector look like\", " +
        "\"render the state machine\"), or when you want to visually verify the layout of an edit you just applied. " +
        "The SVG is fetched fresh on every call — no caching — so the result reflects whatever is currently in the " +
        "editor. The response shape is `{svg, scope, component?}`; `component` is echoed back only when scope was " +
        "\"component\". " +
        "When showing a diagram to the user, prefer rendering the SVG inline rather than dumping the markup as text. " +
        "Diagram SVGs can be several kilobytes; the inline content is what the user wants to see. " +
        "If the user has not configured a PlantUML server, or the configured one is unreachable, this call returns " +
        "an error explaining what went wrong — the diagram cannot be rendered without it. The same server powers " +
        "the editor's canvas preview, so any failure here likely also breaks live editing. " +
        "Read-only: does not modify the model or its version.",
      inputSchema: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["device", "component"],
            description: 'Which diagram to fetch. "device" for the device-level diagram, "component" for one component\'s state machine.',
          },
          component: {
            type: "string",
            description: 'The component name. Required when scope is "component"; ignored otherwise. Must match an existing component in the current model — call get_model first if you are not sure of the available names.',
          },
        },
        required: ["scope"],
      },
    },
  ],
}));

// Tool dispatch — switch on tool name. Tools that read or write the user's
// model forward to the browser via callBrowser. Future tools that report
// bridge-local state (e.g. capabilities, version) would be handled here
// directly without forwarding.
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const toolName = req.params.name;
  const args = req.params.arguments || {};

  try {
    switch (toolName) {
      case "get_model": {
        const response = await callBrowser("get_model", args);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response.result ?? response),
            },
          ],
        };
      }
      case "get_schema": {
        const text = await readSchema();
        return {
          content: [{ type: "text", text }],
        };
      }
      case "get_use_cases": {
        const text = await readUseCases();
        return {
          content: [{ type: "text", text }],
        };
      }
      case "replace_model": {
        const response = await callBrowser("replace_model", {
          model: args.model,
          expectedVersion: args.expectedVersion,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response.result ?? { ok: true }),
            },
          ],
        };
      }
      case "get_diagram": {
        // Browser-forwarding: the editor owns the model and the
        // PlantUML pipeline, so it produces the SVG. The bridge just
        // relays. Argument validation lives on the browser side too —
        // it knows the current component names and can populate the
        // `valid` array with real choices.
        const response = await callBrowser("get_diagram", {
          scope: args.scope,
          component: args.component,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response.result ?? response),
            },
          ],
        };
      }
      default:
        return toolError(`Unknown tool: ${toolName}`);
    }
  } catch (err) {
    // Validation failures from the browser carry an `errors` array with
    // per-field detail. Surface those structurally so the LLM has the
    // exact path and rule and can correct the document on the next try.
    if (Array.isArray(err?.errors)) {
      return toolError(err.message || "Validation failed", err.errors);
    }
    // Anything else is a connection-layer issue — translate to user-
    // facing language via the existing mapper.
    return toolError(connectionMessage(err));
  }
});

// Resource catalogue — what Claude sees when it asks "what resources are
// available?". Two resources today: the stadiae-v4 reference document
// (the schema and design conventions) and the use-cases catalogue (the
// editor-operations guide). Both are also exposed as tools (get_schema,
// get_use_cases) for clients that don't auto-surface resources. Clients
// that do surface resources to the LLM will pull these in without an
// explicit tool call.
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: SCHEMA_URI,
      name: "Stadiæ stadiae-v4 reference",
      description:
        "Reference for the Stadiæ stadiae-v4 model format and FCM design conventions. " +
        "Read at the start of any conversation involving Stadiæ models.",
      mimeType: "text/markdown",
    },
    {
      uri: USE_CASES_URI,
      name: "Stadiæ use-cases catalogue",
      description:
        "Step-by-step instructions for every editor operation: adding/renaming/deleting model elements, " +
        "wiring components, navigating views, saving, exporting, and configuring the bridge. " +
        "Consult when the user asks how to do something in the editor — operational \"how do I\" questions " +
        "rather than modelling questions. Episodic: not needed for modelling conversations.",
      mimeType: "text/html",
    },
  ],
}));

// Resource read — dispatches on URI and returns the document content.
// Reads from disk on every request so edits to the file propagate without
// restarting the bridge.
server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  if (req.params.uri === SCHEMA_URI) {
    const text = await readSchema();
    return {
      contents: [
        {
          uri: SCHEMA_URI,
          mimeType: "text/markdown",
          text,
        },
      ],
    };
  }
  if (req.params.uri === USE_CASES_URI) {
    const text = await readUseCases();
    return {
      contents: [
        {
          uri: USE_CASES_URI,
          mimeType: "text/html",
          text,
        },
      ],
    };
  }
  throw new Error(`Unknown resource: ${req.params.uri}`);
});

// Reads the schema document from disk. Both the get_schema tool and the
// MCP resource handler funnel through here so the file lookup, error
// behaviour, and any future caching live in one place.
async function readSchema() {
  try {
    return await readFile(SCHEMA_PATH, "utf8");
  } catch (err) {
    throw new Error(
      `Could not read schema document at ${SCHEMA_PATH}: ${err?.message || err}. ` +
      `Set the STADIAE_SCHEMA_PATH environment variable to point at the file.`
    );
  }
}

// Reads the use-cases catalogue from disk. Parallel to readSchema — both
// the get_use_cases tool and the MCP resource handler funnel through here.
async function readUseCases() {
  try {
    return await readFile(USE_CASES_PATH, "utf8");
  } catch (err) {
    throw new Error(
      `Could not read use-cases catalogue at ${USE_CASES_PATH}: ${err?.message || err}. ` +
      `Set the STADIAE_USE_CASES_PATH environment variable to point at the file.`
    );
  }
}

// Wraps an error message as an MCP CallToolResult with isError set, so
// Claude Desktop surfaces it as a tool-call failure rather than a thrown
// exception. The text body is structured JSON: `error` is always a
// human-readable summary; `errors` (when supplied) is the structured
// per-field detail used by validators, intended for the LLM to act on.
function toolError(message, structuredErrors) {
  const body = { error: message };
  if (Array.isArray(structuredErrors) && structuredErrors.length > 0) {
    body.errors = structuredErrors;
  }
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(body),
      },
    ],
    isError: true,
  };
}

// Translate raw connection-layer errors into user-facing language. Claude
// passes these through to the user verbatim, so the wording matters: it
// should tell the user what to do, not what went wrong technically.
// Anything we don't recognise falls through with its original message.
function connectionMessage(err) {
  const raw = err?.message || String(err);
  if (raw.includes("No browser connected")) {
    return "Stadiæ is not connected. Open the Stadiæ editor in your browser so it can connect to this bridge.";
  }
  if (raw.includes("Browser timeout")) {
    return "Stadiæ did not respond in time. Check that the editor tab is still open and active.";
  }
  return raw;
}

// Startup sanity check on the schema file. Don't crash if it's missing —
// the bridge can still serve get_model — but warn to stderr so the
// problem is visible in Claude Desktop's MCP logs.
try {
  await access(SCHEMA_PATH);
} catch (_) {
  console.error(
    `[stadiae-bridge] Warning: schema document not found at ${SCHEMA_PATH}. ` +
    `get_schema and the stadiae://schema resource will return errors until this is resolved. ` +
    `Set STADIAE_SCHEMA_PATH to override the default location.`
  );
}

// Parallel sanity check for the use-cases catalogue. Same policy: warn,
// don't crash. The other tools keep working without it.
try {
  await access(USE_CASES_PATH);
} catch (_) {
  console.error(
    `[stadiae-bridge] Warning: use-cases catalogue not found at ${USE_CASES_PATH}. ` +
    `get_use_cases and the stadiae://use-cases resource will return errors until this is resolved. ` +
    `Set STADIAE_USE_CASES_PATH to override the default location.`
  );
}

await server.connect(new StdioServerTransport());

// Clean shutdown. Claude Desktop terminates the bridge in two steps:
// it sends SIGTERM and closes the bridge's stdin. Without explicit
// handling, the WebSocket server keeps the process alive and the
// listening socket holds the port — so the next launch hits EADDRINUSE.
//
// We listen for both signals and a stdin EOF. Whichever fires first
// closes the WebSocket server (releasing the port promptly) and exits.
// Listeners are idempotent: shutting down twice is harmless.
let shuttingDown = false;
function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  // Best effort: close the WSS so the port is released. If close hangs
  // for any reason, the process.exit below ends the process anyway.
  try { wss.close(); } catch (_) { /* ignore */ }
  // Closing all current sockets is wss.close()'s job, but we also
  // proactively drop the browser side just in case the close handler
  // is slow.
  if (browserSocket) {
    try { browserSocket.terminate(); } catch (_) { /* ignore */ }
  }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
// Claude Desktop closes the bridge's stdin as part of its shutdown
// sequence. On platforms where SIGTERM delivery is unreliable (notably
// some Linux Electron builds), the stdin EOF is the more reliable
// signal that the parent has gone away.
process.stdin.on("end",   () => shutdown("stdin end"));
process.stdin.on("close", () => shutdown("stdin close"));
