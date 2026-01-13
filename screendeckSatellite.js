'use strict'

const net = require('net')
const { BrowserWindow } = require('electron')

const config = require('./config.js')
const API = require('./api.js')

function safeString(v, fallback = '') {
	return typeof v === 'string' ? v : fallback
}

function detectImageMime(buffer) {
	if (!buffer || buffer.length < 4) return null
	// PNG: 89 50 4E 47
	if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png'
	// JPEG: FF D8
	if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg'
	// BMP: 42 4D
	if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp'
	// GIF: 47 49 46
	if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif'
	return null
}

function clampInt(value, min, max, fallback) {
	const n = Number.parseInt(String(value), 10)
	if (!Number.isFinite(n)) return fallback
	return Math.max(min, Math.min(max, n))
}

function splitTokensPreservingQuotes(line) {
	// Splits by spaces, but keeps quoted values together. Supports escaping with backslash.
	const tokens = []
	let cur = ''
	let inQuotes = false
	for (let i = 0; i < line.length; i++) {
		const c = line[i]
		if (c === '\\') {
			// copy next char literally if present
			if (i + 1 < line.length) {
				cur += line[i + 1]
				i++
			}
			continue
		}
		if (c === '"') {
			inQuotes = !inQuotes
			continue
		}
		if (!inQuotes && c === ' ') {
			if (cur) tokens.push(cur)
			cur = ''
			continue
		}
		cur += c
	}
	if (cur) tokens.push(cur)
	return tokens
}

function parseParams(body) {
	const tokens = splitTokensPreservingQuotes(body || '')
	const out = {}
	for (const t of tokens) {
		const eq = t.indexOf('=')
		if (eq === -1) {
			out[t] = true
			continue
		}
		const k = t.slice(0, eq)
		let v = t.slice(eq + 1)
		// Unwrap quotes if present (quotes are stripped by tokenizer)
		out[k] = v
	}
	return out
}

class ScreenDeckSatellite {
	constructor() {
		this.apiPort = null
		this.socket = null
		this.buffer = ''
		this.connected = false
		this.connecting = false
		this.reconnectTimer = null
		this.lastBegin = null
		this.devices = new Map() // id -> config
		this.windows = new Map() // id -> BrowserWindow
		this.registeredDevices = new Set()
		this.pendingDevices = new Set()
	}

	init({ apiPort }) {
		this.apiPort = apiPort
		this.reloadFromConfig()

		// Keep in sync with settings
		if (typeof config.onDidChange === 'function') {
			config.onDidChange('screenDeck', () => {
				this.reloadFromConfig()
				this.reconnect()
			})
		}

		// Start connection if anything is configured
		this.reconnect()
	}

	getStatus() {
		return {
			connected: this.connected,
			connecting: this.connecting,
			companionVersion: this.lastBegin ? safeString(this.lastBegin.CompanionVersion, null) : null,
			companionApiVersion: this.lastBegin ? safeString(this.lastBegin.ApiVersion, null) : null,
			deviceCount: this.devices.size,
			registeredCount: this.registeredDevices.size,
		}
	}

	reloadFromConfig() {
		const sd = config.get('screenDeck') || {}
		const devices = Array.isArray(sd.devices) ? sd.devices : []

		const previousIds = new Set(this.devices.keys())
		this.devices.clear()
		for (const d of devices) {
			if (!d || typeof d !== 'object') continue
			const id = typeof d.id === 'string' ? d.id.trim() : ''
			if (!id) continue
			this.devices.set(id, {
				id,
				columns: clampInt(d.columns, 1, 32, 8),
				rows: clampInt(d.rows, 1, 32, 4),
				bitmap: clampInt(d.bitmap, 1, 512, 72),
				backgroundColor: typeof d.backgroundColor === 'string' ? d.backgroundColor : '#000000',
				backgroundOpacity: clampInt(d.backgroundOpacity, 0, 100, 60),
				alwaysOnTop: !!d.alwaysOnTop,
				movable: !!d.movable,
				disableButtonPresses: !!d.disableButtonPresses,
			})
		}

		// Register/update surfaces in the UI registry
		for (const dev of this.devices.values()) {
			API.internalRegisterSurface({
				surfaceId: dev.id,
				name: dev.id,
				product: 'ScreenDeck (Built-in Satellite)',
				columns: dev.columns,
				rows: dev.rows,
				host: 'local',
			})
		}

		// Remove surfaces for devices no longer configured
		for (const id of previousIds) {
			if (!this.devices.has(id)) {
				API.internalRemoveSurface({ surfaceId: id })
			}
		}

		// Remove windows for devices no longer configured
		for (const [id, win] of this.windows.entries()) {
			if (!this.devices.has(id)) {
				try {
					win.close()
				} catch (_e) {
					// ignore
				}
				this.windows.delete(id)
			}
		}
	}

	reconnect() {
		const sd = config.get('screenDeck') || {}
		const host = typeof sd.companionHost === 'string' && sd.companionHost.trim() ? sd.companionHost.trim() : '127.0.0.1'
		const port = clampInt(sd.companionPort, 1, 65535, 16622)

		if (this.devices.size === 0) {
			this.disconnect()
			return
		}

		this.connect(host, port)
	}

	connect(host, port) {
		this.disconnect()

		this.connecting = true
		this.connected = false
		this.lastBegin = null
		this.registeredDevices.clear()
		this.pendingDevices.clear()

		const socket = new net.Socket()
		this.socket = socket

		socket.setNoDelay(true)
		socket.on('connect', () => {
			this.connecting = true
			this.connected = true
			this.buffer = ''
			// Wait for BEGIN from Companion
		})

		socket.on('data', (data) => {
			this.handleData(data.toString('utf8'))
		})

		socket.on('error', (_err) => {
			this.connecting = false
			this.connected = false
			this.lastBegin = null
			this.registeredDevices.clear()
			this.pendingDevices.clear()
			this.scheduleReconnect()
		})

		socket.on('close', () => {
			this.connecting = false
			this.connected = false
			this.lastBegin = null
			this.registeredDevices.clear()
			this.pendingDevices.clear()
			this.scheduleReconnect()
		})

		try {
			socket.connect(port, host)
		} catch (_e) {
			this.connecting = false
			this.connected = false
		}
	}

	disconnect() {
		this.connecting = false
		this.connected = false
		this.lastBegin = null
		this.registeredDevices.clear()
		this.pendingDevices.clear()
		this.buffer = ''
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}

		const s = this.socket
		this.socket = null
		if (s) {
			try {
				s.destroy()
			} catch (_e) {
				// ignore
			}
		}
	}

	scheduleReconnect() {
		if (this.reconnectTimer) return
		if (this.devices.size === 0) return
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null
			this.reconnect()
		}, 1000)
	}

	sendLine(line) {
		if (!this.socket || !this.connected) return
		try {
			this.socket.write(line.endsWith('\n') ? line : line + '\n')
		} catch (_e) {
			// ignore
		}
	}

	sendCommand(cmd, args = {}) {
		const chunks = [cmd]
		for (const [k, v] of Object.entries(args)) {
			if (typeof v === 'boolean') chunks.push(`${k}=${v ? '1' : '0'}`)
			else if (typeof v === 'number') chunks.push(`${k}=${v}`)
			else chunks.push(`${k}="${String(v)}"`)
		}
		this.sendLine(chunks.join(' '))
	}

	addDeviceToCompanion(dev) {
		if (!this.connected || !this.socket) return
		if (this.registeredDevices.has(dev.id) || this.pendingDevices.has(dev.id)) return

		this.pendingDevices.add(dev.id)
		this.sendCommand('ADD-DEVICE', {
			DEVICEID: dev.id,
			PRODUCT_NAME: `ScreenDeck ${dev.id}`,
			KEYS_TOTAL: dev.columns * dev.rows,
			KEYS_PER_ROW: dev.columns,
			BITMAPS: dev.bitmap,
			COLORS: true,
			TEXT: true,
			TEXT_STYLE: false,
			VARIABLES: Buffer.from(JSON.stringify([])).toString('base64'),
			BRIGHTNESS: 100,
			PINCODE_LOCK: '',
		})
	}

	keyPress(deviceId, x, y, pressed) {
		const dev = this.devices.get(deviceId)
		if (!dev) return
		const xi = clampInt(x, 0, dev.columns - 1, 0)
		const yi = clampInt(y, 0, dev.rows - 1, 0)
		const keyIndex = yi * dev.columns + xi
		this.sendCommand('KEY-PRESS', {
			DEVICEID: deviceId,
			KEY: keyIndex,
			PRESSED: !!pressed,
		})
		API.internalSurfaceKey({ surfaceId: deviceId, x: xi, y: yi, action: pressed ? 'press' : 'release' })
	}

	openAllWindows() {
		if (!this.apiPort) return
		for (const dev of this.devices.values()) {
			this.openWindow(dev.id)
		}
	}

	openWindow(deviceId) {
		const dev = this.devices.get(deviceId)
		if (!dev || !this.apiPort) return

		const existing = this.windows.get(deviceId)
		if (existing && !existing.isDestroyed()) {
			existing.show()
			existing.focus()
			return
		}

		const bitmap = dev.bitmap || 72
		const columns = dev.columns || 8
		const rows = dev.rows || 4
		const padding = 16
		const gap = 10
		const width = Math.max(300, padding * 2 + columns * bitmap + (columns - 1) * gap + 40)
		const height = Math.max(240, padding * 2 + rows * bitmap + (rows - 1) * gap + 80)

		const win = new BrowserWindow({
			title: `ScreenDeck: ${deviceId}`,
			width,
			height,
			alwaysOnTop: dev.alwaysOnTop,
			movable: dev.movable,
			webPreferences: {
				nodeIntegration: true,
				contextIsolation: false,
			},
		})

		win.on('closed', () => {
			this.windows.delete(deviceId)
		})

		const url = `http://127.0.0.1:${this.apiPort}/screendeck.html?deviceId=${encodeURIComponent(deviceId)}`
		win.loadURL(url).catch(() => null)
		this.windows.set(deviceId, win)
	}

	broadcastToDeviceWindow(deviceId, channel, payload) {
		const win = this.windows.get(deviceId)
		if (!win || win.isDestroyed()) return
		try {
			win.webContents.send(channel, payload)
		} catch (_e) {
			// ignore
		}
	}

	handleData(chunk) {
		this.buffer += chunk
		let idx
		while ((idx = this.buffer.indexOf('\n')) !== -1) {
			let line = this.buffer.slice(0, idx)
			this.buffer = this.buffer.slice(idx + 1)
			if (line.endsWith('\r')) line = line.slice(0, -1)
			if (line) this.handleLine(line)
		}
	}

	handleLine(line) {
		const firstSpace = line.indexOf(' ')
		const cmd = (firstSpace === -1 ? line : line.slice(0, firstSpace)).toUpperCase()
		const body = firstSpace === -1 ? '' : line.slice(firstSpace + 1)
		const params = parseParams(body)

		if (cmd === 'PING') {
			this.sendLine(`PONG ${body}`)
			return
		}
		if (cmd === 'PONG') return

		if (cmd === 'BEGIN') {
			this.lastBegin = params
			this.connecting = false
			// Register all devices
			for (const dev of this.devices.values()) this.addDeviceToCompanion(dev)
			return
		}

		if (cmd === 'ADD-DEVICE') {
			// Expect OK/ERROR flags in params
			const ok = params.OK === true || params.OK === '1'
			const deviceId = typeof params.DEVICEID === 'string' ? params.DEVICEID : typeof params.DEVICEID === 'number' ? String(params.DEVICEID) : params.DEVICEID
			if (typeof deviceId === 'string' && deviceId) {
				this.pendingDevices.delete(deviceId)
				if (ok && !params.ERROR) this.registeredDevices.add(deviceId)
			}
			return
		}

		if (cmd === 'KEYS-CLEAR') {
			const deviceId = safeString(params.DEVICEID, '')
			if (!deviceId) return
			API.internalSurfaceClear({ surfaceId: deviceId })
			this.broadcastToDeviceWindow(deviceId, 'screendeck:clear', {})
			return
		}

		if (cmd === 'KEY-STATE') {
			const deviceId = safeString(params.DEVICEID, '')
			if (!deviceId) return
			const dev = this.devices.get(deviceId)
			if (!dev) return

			let x = 0
			let y = 0
			if (typeof params.KEY === 'string' && params.KEY.includes('/')) {
				const [rowStr, colStr] = params.KEY.split('/', 2)
				y = clampInt(rowStr, 0, dev.rows - 1, 0)
				x = clampInt(colStr, 0, dev.columns - 1, 0)
			} else {
				const keyIndex = clampInt(params.KEY, 0, dev.columns * dev.rows - 1, 0)
				x = keyIndex % dev.columns
				y = Math.floor(keyIndex / dev.columns)
			}

			let imageDataUrl = null
			if (typeof params.BITMAP === 'string' && params.BITMAP) {
				try {
					const buf = Buffer.from(params.BITMAP, 'base64')
					const mime = detectImageMime(buf) || 'application/octet-stream'
					imageDataUrl = `data:${mime};base64,${buf.toString('base64')}`
				} catch (_e) {
					imageDataUrl = null
				}
			}

			let text = null
			if (typeof params.TEXT === 'string' && params.TEXT) {
				try {
					text = Buffer.from(params.TEXT, 'base64').toString('utf8')
				} catch (_e) {
					text = null
				}
			}

			const color = typeof params.COLOR === 'string' ? params.COLOR : null

			const state = {
				text: text || undefined,
				bgColor: undefined,
				color: color || undefined,
				imageDataUrl: imageDataUrl || undefined,
			}

			API.internalSurfaceDraw({ surfaceId: deviceId, x, y, state })
			this.broadcastToDeviceWindow(deviceId, 'screendeck:draw', { x, y, state })
			return
		}
	}
}

module.exports = { ScreenDeckSatellite }
