# Stadiæ MCP bridge — setup on Linux

The Stadiæ MCP bridge connects Claude Desktop to the Stadiæ editor running in your browser. Once installed, Claude can read your current Stadiæ model, look up the schema and design conventions, and apply edits you ask for. This document walks through installing it on Linux. The bridge itself is plain Node.js and works identically on macOS and Windows — only the desktop-integration steps differ.

## Installing Claude Desktop on Linux

Anthropic does not currently ship an official Linux build of Claude Desktop — only macOS and Windows are officially supported. Linux users rely on community ports that repackage the official Windows Electron build for Linux, replacing the Windows-specific native modules with Linux equivalents. The recommended port is **`aaddrick/claude-desktop-debian`**, the most actively maintained option, with a maintained APT and DNF repository for automatic updates through your regular package manager.

### Install via APT (Debian, Ubuntu)

```bash
# Add the GPG key
curl -fsSL https://pkg.claude-desktop-debian.dev/KEY.gpg | \
  sudo gpg --dearmor -o /usr/share/keyrings/claude-desktop.gpg

# Add the repository
echo "deb [signed-by=/usr/share/keyrings/claude-desktop.gpg arch=amd64,arm64] \
  https://pkg.claude-desktop-debian.dev stable main" | \
  sudo tee /etc/apt/sources.list.d/claude-desktop.list

# Install
sudo apt update
sudo apt install claude-desktop
```

Future updates arrive via the regular `sudo apt upgrade` cycle.

### Install via DNF (Fedora, RHEL)

```bash
sudo curl -fsSL https://pkg.claude-desktop-debian.dev/rpm/claude-desktop.repo \
  -o /etc/yum.repos.d/claude-desktop.repo
sudo dnf install claude-desktop
```

### Other distributions

The project also ships AppImage builds, an AUR package (`claude-desktop-appimage`), and a Nix flake. See the project's [GitHub repository](https://github.com/aaddrick/claude-desktop-debian) for current instructions — install URLs and signing keys may change, so the upstream documentation is the source of truth.

### After installing

Launch Claude Desktop once and sign in. Verify that it created the configuration directory:

```bash
ls -la ~/.config/Claude/
```

You should see a `claude_desktop_config.json` (perhaps empty or with default settings) and a `logs/` directory. Both are referenced later in this guide. If the directory doesn't exist yet, create it manually:

```bash
mkdir -p ~/.config/Claude/logs
```

### A few Linux-specific caveats

- **Updating an existing install (April 2026 migration).** If you installed `claude-desktop` before April 2026, your APT sources point at the old `aaddrick.github.io` URL and `apt update` will refuse the HTTPS-to-HTTP redirect to the new repo. Replace the URL in `/etc/sources.list.d/claude-desktop.list` with `https://pkg.claude-desktop-debian.dev` and re-add the GPG key as shown above. DNF users are unaffected.

- **Ubuntu 24.04 + Cowork.** Cowork (the agent feature that runs sandboxed subprocesses) uses `bwrap`, which Ubuntu 24.04 blocks via AppArmor's restriction on unprivileged user namespaces. The project ships an AppArmor profile workaround. **Chat and MCP servers — including this bridge — are unaffected**; only Cowork hits this.

- **Claude Code tab.** The Claude Code tab inside Claude Desktop is not supported on Linux. Standard chat and MCP server support — what this bridge needs — work fine.

> Because these are unofficial builds, occasional breakage is part of the deal. If a Claude Desktop update suddenly breaks something MCP-related, check the [project's issue tracker](https://github.com/aaddrick/claude-desktop-debian/issues) — the maintainers there typically know about and patch issues faster than anyone else.

## Prerequisites

- **Node.js**, version 20 or newer. Verify with `node --version`. If you don't have it, install it from your distro's package manager (`sudo apt install nodejs npm` on Debian/Ubuntu) or from [nodejs.org](https://nodejs.org).
- **Claude Desktop**. See the section above; the rest of this guide assumes it is installed and has been launched at least once.
- **Stadiæ**. Either the local `stadiae.html` file or the [hosted version](https://htmlpreview.github.io/?https://raw.githubusercontent.com/computerguided/stadiae/refs/heads/main/stadiae.html). Both work.

## Install the bridge

1. **Pick a directory** for the bridge. The convention used in this guide is `~/stadiae-bridge`. You can use any path; remember it because Claude Desktop's config will reference the absolute path.

   ```bash
   mkdir -p ~/stadiae-bridge
   cd ~/stadiae-bridge
   ```

2. **Place the bridge files** in that directory:

   - `bridge.mjs` — the bridge itself.
   - `stadiae_mcp_instructions.md` — the schema reference document the bridge serves to Claude.
   - *(optional)* `stadiae-icon.png` (or `.svg`) — a custom icon for the connector list.

   All three live in the same directory. The bridge resolves them by sibling-file lookup; no environment variables required.

3. **Install dependencies.** The bridge depends on the MCP SDK and the `ws` WebSocket library:

   ```bash
   cd ~/stadiae-bridge
   npm init -y
   npm install @modelcontextprotocol/sdk ws
   ```

   This creates `package.json` and `node_modules/` in the bridge directory.

4. **Verify the bridge runs manually.** A quick sanity check before wiring it up to Claude Desktop:

   ```bash
   node ~/stadiae-bridge/bridge.mjs
   ```

   It should sit silently waiting for input. Press `Ctrl+C` to exit. If it crashes with an error like `Cannot find module '@modelcontextprotocol/sdk'`, step 3 didn't run successfully — re-do it from inside the bridge directory.

## Configure Claude Desktop

Claude Desktop spawns MCP servers based on the contents of `~/.config/Claude/claude_desktop_config.json`. Edit that file to register the bridge:

```json
{
  "mcpServers": {
    "stadiae-bridge": {
      "command": "/usr/bin/node",
      "args": ["/home/<your-username>/stadiae-bridge/bridge.mjs"]
    }
  },
  "isUsingBuiltInNodeForMcp": false
}
```

Three things are critical here:

- **`command` must be the absolute path to `node`**, not just `"node"`. Find the right value with `which node`. On most Linux distros it's `/usr/bin/node`; under nvm it'll be something like `/home/<user>/.nvm/versions/node/v20.x.x/bin/node`. Claude Desktop's PATH is shorter than your shell's, so a bare `"node"` often fails to resolve.

- **`args` must be the absolute path to `bridge.mjs`**. `~` does not expand inside this file.

- **`isUsingBuiltInNodeForMcp` must be `false`** (or omitted). When it's `true`, Claude Desktop tries to run MCP servers using its bundled Node binary, which on Linux Electron builds is often missing or broken. The spawn fails silently and the bridge never starts. This single flag is the most common reason a new bridge install doesn't work.

If your config file already exists with other settings (e.g. `preferences`), keep them and add the `mcpServers` block alongside.

## Verify the bridge is running

After saving the config, **fully quit Claude Desktop** (don't just close the window — quit the application, so any spawned children are terminated too) and relaunch it. Then verify:

```bash
pgrep -af bridge.mjs
```

You should see one line showing the running bridge — something like:

```
12345 /usr/bin/node /home/yourname/stadiae-bridge/bridge.mjs
```

If you see nothing, the bridge didn't start. The most likely causes are listed under *Troubleshooting* below.

You can also peek at Claude Desktop's MCP log for the bridge:

```bash
tail -f ~/.config/Claude/logs/mcp-server-stadiae-bridge.log
```

A successful start logs `Server started and connected successfully` and an `initialize` exchange.

## Connect from the Stadiæ editor

1. Open `stadiae.html` in your browser.
2. In the menubar, you'll see a `bridge: off` indicator next to the existing `plantuml:` indicator. Click it (or use *File → Bridge…*).
3. The dialog shows a WebSocket URL pre-filled to `ws://127.0.0.1:7531`. Click **Connect**.
4. The status flips through *Connecting…* to *Connected*. The menubar indicator goes green.

Once connected, ask Claude something about your model — *"what's in my current model?"* is a good first test. Claude should call `get_model`, see the model, and describe it.

## Where everything lives

After setup the layout is:

```
~/stadiae-bridge/
├── bridge.mjs                        # the bridge
├── stadiae_mcp_instructions.md       # schema doc served to Claude
├── stadiae-icon.png                  # (optional) connector-list icon
├── package.json                      # created by npm init
├── package-lock.json                 # created by npm install
└── node_modules/                     # bridge dependencies

~/.config/Claude/
├── claude_desktop_config.json        # registers the bridge with Claude Desktop
└── logs/
    └── mcp-server-stadiae-bridge.log # bridge stdout/stderr while spawned
```

## Troubleshooting

### "I see no `bridge.mjs` process at all"

Three causes, in order of likelihood:

**`isUsingBuiltInNodeForMcp` is set to `true` in the config.** Set it to `false` (or remove the line). This is by far the most common cause on Linux.

**`node` is not on Claude Desktop's PATH.** Replace `"command": "node"` with an absolute path. Find the right value with `which node`. If you use nvm, you'll need the full version-pinned path.

**JSON syntax error in the config file.** A trailing comma or stray character makes Claude Desktop silently ignore the entire `mcpServers` block. Validate with:

```bash
python3 -m json.tool ~/.config/Claude/claude_desktop_config.json
```

A successful parse confirms the structure; an error message identifies the line.

### "Bridge crashes with `EADDRINUSE` or doesn't start after a Claude Desktop restart"

Usually means a previous bridge process is still bound to port 7531. The current bridge handles signals cleanly, so this should be rare — but it can happen if a bridge was killed forcibly (`kill -9`, system crash, etc.). Diagnose:

```bash
pgrep -af bridge.mjs        # any stale processes?
ss -lnt | grep 7531         # anything still listening?
```

Fix:

```bash
pkill -f bridge.mjs
```

Then restart Claude Desktop.

### "The bridge is running but the editor cannot connect"

Click the `bridge: off` indicator in the editor and check the URL is `ws://127.0.0.1:7531` (not `http://`, not a different port). If the URL is correct, check that the bridge is actually listening:

```bash
ss -lnt | grep 7531
```

If nothing is listening, the bridge may have started and immediately crashed — check the MCP log.

### "Claude knows about my model but gets the schema wrong"

Symptoms include Claude inventing things like *"FCM = Function Class Model"* or describing the model in generic state-machine terms instead of FCM vocabulary. Means the schema document isn't reaching Claude.

Check that `stadiae_mcp_instructions.md` is sitting next to `bridge.mjs`:

```bash
ls /home/<your-username>/stadiae-bridge/stadiae_mcp_instructions.md
```

If missing, copy it there and restart Claude Desktop.

If the file is present but Claude still gets the schema wrong, ask Claude explicitly *"use the `get_schema` tool to read the reference doc, then answer my previous question."* Some Claude Desktop builds advertise the schema as an MCP resource without auto-loading it; the `get_schema` tool is the bulletproof fallback.

### "I changed the config but the bridge is still using old behaviour"

Claude Desktop reads the config at startup. After editing, **fully quit and relaunch** — closing the window isn't enough; the spawned MCP servers stay alive. Use `pkill -f bridge.mjs` if you want to be certain the old process is gone before relaunching.

## Updating the bridge

To install a newer bridge:

1. Replace `bridge.mjs` (and `stadiae_mcp_instructions.md` if it changed) in `~/stadiae-bridge/`.
2. `pkill -f bridge.mjs` to terminate the running instance.
3. Fully quit and relaunch Claude Desktop.

`node_modules` rarely needs updating. If a new bridge requires a newer SDK version, the `npm install` step from the initial setup re-runs cleanly.
