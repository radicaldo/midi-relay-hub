# Midi Relay Hub

**MIDI over HTTP — simple, powerful, and cross-platform.**

Added quite a few enhancements and tools for troubleshooting network midi issues in complex multi system setups.


Midi Relay Hub lets you send and receive MIDI messages across a network using JSON-based HTTP requests. Built for AV and stage production (Church, Concerts, stage shows, plays, etc), automation, and integration with tools like streamdeck, [Bitfocus Companion](https://bitfocus.io/companion) and [n8n](https://n8n.io).

> 🎹 Originally forked from [midi-relay](https://github.com/josephdadams/midi-relay) (Joseph Adams) and expanded significantly.

---

## Features

- **HTTP API** — Send MIDI messages via REST endpoints (JSON)
- **Real-time Logging** — Live WebSocket stream of all MIDI traffic
  
  <img width="787" height="458" alt="image" src="https://github.com/user-attachments/assets/b721c950-872e-40c9-a039-3f50130416ab" />

- **Triggers** — React to incoming MIDI with HTTP webhooks, scripts, or automation
- **Profiles** — Save/load trigger configurations for different events
- **Test Button** — Validate your webhook URLs before going live
- **Cross-platform** — Runs on Windows/Linux; macOS from source (packaging/signing currently disabled)
- **Companion API URL Builder** — Helps construct URLs to send to companion for triggers and testing
- **Surfaces (Preview + Embed)** — View registered button surfaces and embed a Companion emulator URL as a fallback viewer
  
<img width="797" height="757" alt="image" src="https://github.com/user-attachments/assets/d08a97aa-89bb-45f9-a4ad-720f1c0e97f8" />

- **ScreenDeck Settings (WIP)** — Configure Companion Satellite host/port and define ScreenDeck devices
- **Optional mDNS** — Runs even if `mdns-js` is not installed (discovery is optional) - caused errors and dependency vulnerabilities as of Jan-2026

---

## Getting Started

### Desktop Application (v1.x)

1. Download the latest release from [Releases](https://github.com/radicaldo/midi-relay-hub/releases)
2. On Windows, run the installer `.exe`
3. MIDI ports are scanned automatically on startup
4. Access the web UI at `http://127.0.0.1:8090` (default; configurable via `apiPort`)

Note: macOS packaging/signing is currently disabled until an Apple Developer ID is available.

### Development

```bash
# Clone the repo
git clone https://github.com/radicaldo/midi-relay-hub.git
cd midi-relay-hub

# Install dependencies
yarn install

# Start the app
yarn start
```

### Running Tests

```bash
yarn test               # Run all tests
yarn test:watch         # Watch mode
yarn test:coverage      # With coverage report
```

---

## API

The HTTP API allows integration with any system that can make HTTP requests.

📘 **[Full API Documentation](./api.md)**

### Quick Examples

**Send a Note On:**
```bash
curl -X POST http://localhost:4000/sendmidi \
  -H "Content-Type: application/json" \
  -d '{"midiport":"My MIDI Device","midicommand":"noteon","channel":0,"note":60,"velocity":127}'
```

**Get MIDI Ports:**
```bash
curl http://localhost:4000/midi_outputs
curl http://localhost:4000/midi_inputs
```

**View Live Log:**
```bash
curl http://localhost:4000/log
```

### ScreenDeck / Surfaces (New)

**Get ScreenDeck integration settings:**
```bash
curl http://127.0.0.1:8090/integrations/screendeck
```

**Update ScreenDeck integration settings (emulator URL / host / port / devices):**
```bash
curl -X POST http://127.0.0.1:8090/integrations/screendeck \
  -H "Content-Type: application/json" \
  -d '{"emulatorUrl":"http://127.0.0.1:8000/emulator/"}'
```

**List currently-registered surfaces (snapshot):**
```bash
curl http://127.0.0.1:8090/surfaces
```

---

## Triggers

Triggers let you react to incoming MIDI messages. When a matching MIDI message is received, the trigger fires an action:

| Action Type | Description |
|-------------|-------------|
| `http` | Send HTTP GET/POST/PUT/PATCH/DELETE to a URL |
| `midi` | Send a MIDI message to another port |

### Trigger API

```bash
# List all triggers
curl http://localhost:4000/triggers

# Add a trigger
curl -X POST http://localhost:4000/trigger/add \
  -H "Content-Type: application/json" \
  -d '{"midicommand":"noteon","channel":0,"note":60,"actiontype":"http","url":"http://your-webhook.com"}'

# Test a trigger
curl -X POST http://localhost:4000/trigger/test \
  -H "Content-Type: application/json" \
  -d '{"id":"trigger-abc123"}'
```

---

## Profiles

Save and load different trigger configurations:

```bash
# List profiles
curl http://localhost:4000/profiles

# Save current triggers as a profile
curl -X POST http://localhost:4000/profiles/save \
  -H "Content-Type: application/json" \
  -d '{"name":"Sunday Service"}'

# Load a profile
curl -X POST http://localhost:4000/profiles/load \
  -H "Content-Type: application/json" \
  -d '{"name":"Sunday Service"}'
```

---

## Configuration

The app stores configuration using `electron-store`. Settings include:

| Setting | Default | Description |
|---------|---------|-------------|
| `apiPort` | `8090` | HTTP server port |
| `allowControl` | `true` | Allow sending MIDI via API |
| `logLevel` | `info` | Log verbosity (debug/info/warn/error) |
| `httpTimeout` | `5000` | Timeout for HTTP triggers (ms) |

### ScreenDeck Settings

These settings are stored under the `screenDeck` key:

| Setting | Default | Description |
|---------|---------|-------------|
| `screenDeck.companionHost` | `127.0.0.1` | Companion Satellite host/IP |
| `screenDeck.companionPort` | `16622` | Companion Satellite port |
| `screenDeck.emulatorUrl` | `""` | Optional Companion emulator URL for iframe embed in Surfaces |
| `screenDeck.devices` | `[]` | Virtual deck definitions (cols/rows/bitmap/bg/etc) |

Note: the ScreenDeck settings UI exists, but the actual Satellite connection/rendering is still pending.

## Surfaces

The **Surfaces** tab is intended to display “button surfaces” (virtual or physical) across your network.

- You can embed a remote Companion emulator URL (useful as a last-resort viewer)
- You can also register custom surfaces via Socket.IO (see `surface_register` in the UI tip)

---

## Integration Examples

### n8n Workflow

1. Create a webhook trigger in n8n
2. Add a trigger in Midi Relay Hub pointing to your n8n webhook URL
3. Incoming MIDI will now trigger your n8n workflow

### Bitfocus Companion

Use the [midi-relay Companion module](https://github.com/bitfocus/companion-module-josephdadams-midi-relay) to send MIDI from Companion buttons or from Midi Relay Hub you can control companion or remote streamdecks.

---

## Project Structure

```
├── index.js          # Electron main process
├── api.js            # Express HTTP API
├── midi.js           # MIDI port management & triggers
├── util.js           # Utilities and validation exports
├── config.js         # Electron-store configuration
├── logger.js         # Logging utility
├── static/           # Web UI assets
└── __tests__/        # Jest test suite
```

---

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Ensure `npm test` passes
5. Submit a pull request

---

## Acknowledgments

This project stands on the shoulders of giants. Huge thanks to:

### Core Dependencies

| Project | Author | Why It's Awesome |
|---------|--------|------------------|
| [**midi-relay**](https://github.com/josephdadams/midi-relay) | [Joseph Adams](https://josephadams.dev) | The original project this fork is built on. Clean, simple MIDI-over-HTTP that just works. |
| [**JZZ.js**](https://github.com/jazz-soft/JZZ) | [Sema / jazz-soft](https://github.com/jazz-soft) | Actively maintained MIDI library with MIDI 2.0 support. The backbone of this app. |
| [**Electron**](https://www.electronjs.org/) | GitHub/OpenJS Foundation | Cross-platform desktop apps with web tech |
| [**Express**](https://expressjs.com/) | TJ Holowaychuk & community | Fast, unopinionated web framework |
| [**Socket.IO**](https://socket.io/) | Guillermo Rauch | Real-time bidirectional event-based communication |

### Ecosystem & Integrations

| Project | Description |
|---------|-------------|
| [**Bitfocus Companion**](https://bitfocus.io/companion) | Stream Deck software for broadcast/production — has a midi-relay module |
| [**n8n**](https://n8n.io) | Workflow automation that pairs perfectly with MIDI triggers |
| [**Lodash**](https://lodash.com/) | Utility functions that make JS less painful |

### Dev Tools

| Tool | Purpose |
|------|---------|
| [**Jest**](https://jestjs.io/) | Testing framework |
| [**Husky**](https://typicode.github.io/husky/) | Git hooks made easy |
| [**Prettier**](https://prettier.io/) | Code formatting |

---

## Watching for Updates

Want to stay informed when upstream projects release updates?

### GitHub Watch Feature

1. Go to any repo (e.g., [JZZ](https://github.com/jazz-soft/JZZ) or [midi-relay](https://github.com/josephdadams/midi-relay))
2. Click the **Watch** button (top right)
3. Select **Custom** → Check **Releases**
4. You'll get notified when new versions are published

### Dependabot (Automatic)

This repo uses GitHub's Dependabot to automatically create PRs when dependencies have updates. Check `.github/dependabot.yml` for configuration.

### Manual Check

```bash
# Check for outdated packages
npm outdated

# Update to latest (minor/patch)
npm update

# Check for major version updates
npx npm-check-updates
```

---

## Licenses

MIT License
Forked and extended by [Radicaldo](https://github.com/radicaldo).
Midi Relay Originally created by [Joseph Adams](https://josephadams.dev).  

