# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.6.0] - 2025-01-12

### Added
- **JZZ.js MIDI Engine** — Replaced node-midi with actively maintained JZZ.js library
  - MIDI 2.0 support ready
  - Better async/await patterns
  - Improved cross-platform compatibility
  - No native compilation required
- **Live MIDI Traffic Log** — Real-time WebSocket stream of all MIDI events
- **Trigger Test Button** — Validate HTTP webhook URLs from the UI
- **Profile System** — Save/load trigger configurations for different events
- **Input Validation** — Comprehensive MIDI parameter validation with helpful error messages
- **Configurable Timeout** — HTTP trigger timeout is now configurable (`httpTimeout` setting)
- **Jest Test Suite** — Unit tests for validation logic
- **Pre-commit Hooks** — Husky + lint-staged for code quality

### Changed
- **BREAKING:** Switched MIDI engine from `node-midi` to `jzz` (API compatible)
- Replaced deprecated `request` package with native `fetch` (Node 18+)
- Improved error messages for HTTP triggers (timeout, connection refused, host not found)
- Renamed project to "Midi Relay Hub"
- Updated README with comprehensive documentation

### Removed
- Removed `midi` (node-midi) package dependency
- Removed `request` package dependency (deprecated, security vulnerabilities)
- Removed `body-parser` package (unused, Express has built-in JSON parsing)
- Removed `mdns-js` package (unmaintained since 2016)

### Security
- 0 vulnerabilities in `npm audit`
- All dependencies updated to latest stable versions

---

## [Unreleased] - 2026-01-12

### Added
- **Surfaces tab** in the UI to view registered surfaces and a preview panel
- **Companion Emulator embed (Last Resort)** — store an emulator URL and display it in an iframe inside Surfaces
- **ScreenDeck / StreamDeck settings UI (WIP)** — configure Companion Satellite host/port and define virtual ScreenDeck devices
- **ScreenDeck settings REST endpoints**: `GET/POST /integrations/screendeck`
- **Surfaces snapshot endpoint**: `GET /surfaces`

### Changed
- mDNS support is optional at runtime; the app can run without `mdns-js` installed

### Fixed
- Jest tests no longer require the native `midi` module to be installed (virtual mock)
- Husky pre-commit hook updated to remove deprecated v10 loader lines
- UI: Emulator URL field no longer appears squashed in Surfaces

---

## [3.5.0] and earlier

See [upstream midi-relay releases](https://github.com/josephdadams/midi-relay/releases) for previous changelog.

---

## Fork Notes

This is a fork of [midi-relay](https://github.com/josephdadams/midi-relay) by Joseph Adams.

Key differences from upstream:
- Focus on church production and automation workflows
- Integration with n8n and Companion
- Enhanced logging and debugging capabilities
- Profile management for event-based configurations
