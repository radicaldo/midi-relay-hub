const express = require('express')
const http = require('http')
const socketio = require('socket.io')

const util = require('./util.js')
const config = require('./config.js')
const notifications = require('./notifications.js')
const path = require('path')

const package_json = require('./package.json')
const VERSION = package_json.version

let server = null
let httpServer = null
let io = null

// =============================================================================
// Surfaces (Button Panels)
// =============================================================================

// In-memory registry of connected surfaces. A surface can be a ScreenDeck instance
// or any other client which reports a button grid + state.
//
// NOTE: This is intentionally ephemeral for now (no persistence).
const surfaces = new Map() // surfaceId -> surface
const surfaceIdBySocketId = new Map() // socket.id -> surfaceId

function sanitizeSurfaceId(value) {
	if (typeof value !== 'string') return null
	const trimmed = value.trim()
	if (!trimmed) return null
	// keep it simple/URL-safe-ish
	if (!/^[a-zA-Z0-9_-]{1,64}$/.test(trimmed)) return null
	return trimmed
}

function clampInt(n, min, max) {
	const v = Number.parseInt(String(n), 10)
	if (!Number.isFinite(v)) return min
	return Math.max(min, Math.min(max, v))
}

function surfacesSnapshot() {
	return Array.from(surfaces.values()).map((s) => ({
		surfaceId: s.surfaceId,
		name: s.name,
		product: s.product,
		host: s.host,
		columns: s.columns,
		rows: s.rows,
		connectedAt: s.connectedAt,
		lastSeen: s.lastSeen,
		keys: s.keys || {},
	}))
}

function broadcastSurfaces() {
	if (io) io.sockets.emit('surfaces', surfacesSnapshot())
}

// =============================================================================
// Validation Middleware
// =============================================================================

/**
 * Middleware to validate MIDI objects before sending
 */
function validateSendMidi(req, res, next) {
	const midiObj = req.body || req.query

	// Convert query string values to appropriate types for GET requests
	if (req.method === 'GET' && midiObj) {
		if (midiObj.channel !== undefined) midiObj.channel = parseInt(midiObj.channel, 10)
		if (midiObj.note !== undefined) midiObj.note = parseInt(midiObj.note, 10)
		if (midiObj.velocity !== undefined) midiObj.velocity = parseInt(midiObj.velocity, 10)
		if (midiObj.value !== undefined) midiObj.value = parseInt(midiObj.value, 10)
		if (midiObj.controller !== undefined) midiObj.controller = parseInt(midiObj.controller, 10)
	}

	const validation = util.validateMIDIObject(midiObj)

	if (!validation.valid) {
		return res.status(400).json({
			error: true,
			message: 'Invalid MIDI parameters',
			errors: validation.errors,
		})
	}

	next()
}

/**
 * Middleware to validate trigger objects
 */
function validateTrigger(req, res, next) {
	const triggerObj = req.body

	const validation = util.validateTriggerObject(triggerObj)

	if (!validation.valid) {
		return res.status(400).json({
			error: true,
			message: 'Invalid trigger parameters',
			errors: validation.errors,
		})
	}

	next()
}

/**
 * Async route wrapper to catch errors
 */
function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next)
	}
}

function sanitizeHttpUrl(value) {
	if (typeof value !== 'string') return ''
	const trimmed = value.trim()
	if (!trimmed) return ''
	if (trimmed.length > 2048) return ''
	try {
		const u = new URL(trimmed)
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
		return u.toString()
	} catch (_) {
		return ''
	}
}

function clampInt(value, min, max, fallback) {
	const n = Number.parseInt(String(value), 10)
	if (!Number.isFinite(n)) return fallback
	if (n < min) return min
	if (n > max) return max
	return n
}

function clampOpacity01Or100(value, fallback) {
	// UI currently uses 0-100. Store as 0-100 integer.
	return clampInt(value, 0, 100, fallback)
}

function sanitizeColorString(value, fallback) {
	if (typeof value !== 'string') return fallback
	const v = value.trim()
	if (!v) return fallback
	if (v.length > 32) return fallback
	return v
}

function sanitizeScreenDeckDevices(devices) {
	if (!Array.isArray(devices)) return undefined
	const cleaned = []
	for (const d of devices) {
		if (!d || typeof d !== 'object') continue
		const id = typeof d.id === 'string' ? d.id.trim() : ''
		if (!id || id.length > 128) continue
		cleaned.push({
			id,
			columns: clampInt(d.columns, 1, 32, 8),
			rows: clampInt(d.rows, 1, 32, 4),
			bitmap: clampInt(d.bitmap, 1, 512, 72),
			backgroundColor: sanitizeColorString(d.backgroundColor, '#000000'),
			backgroundOpacity: clampOpacity01Or100(d.backgroundOpacity, 60),
			alwaysOnTop: !!d.alwaysOnTop,
			movable: !!d.movable,
			disableButtonPresses: !!d.disableButtonPresses,
		})
		if (cleaned.length >= 32) break
	}
	return cleaned
}

class API {
	static start(port) {
		//starts the REST API
		server = express()

		httpServer = new http.Server(server)
		io = new socketio.Server(httpServer, { allowEIO3: true })

		server.use(express.json()) //parse json in body

		server.use(express.static(path.join(__dirname, 'static')))

		server.get('/', (req, res) => {
			res.sendFile('index.html', { root: path.join(__dirname, 'static') })
		})

		server.get('/version', function (req, res) {
			res.send({ version: VERSION })
		})

		server.get('/control_status', function (req, res) {
			res.send({ control_status: config.get('allowControl') })
		})

		server.get('/midi_outputs', function (req, res) {
			res.send(util.getMIDIOutputs())
		})

		server.get('/refresh', function (req, res) {
			util.refreshPorts()
			res.send({ result: 'refresh-command-sent' })
		})

		server.get('/logs', function (req, res) {
			res.send(global.MIDIRelaysLog)
		})

		// ScreenDeck / Companion surface integration settings
		server.get('/integrations/screendeck', function (_req, res) {
			const sd = config.get('screenDeck') || {}
			res.json({
				screenDeck: {
					companionHost: sd.companionHost || '127.0.0.1',
					companionPort: Number(sd.companionPort) || 16622,
					emulatorUrl: typeof sd.emulatorUrl === 'string' ? sd.emulatorUrl : '',
					devices: Array.isArray(sd.devices) ? sd.devices : [],
				},
			})
		})

		server.post('/integrations/screendeck', function (req, res) {
			try {
				const body = req.body || {}
				const existing = config.get('screenDeck') || {}
				const next = { ...existing }

				if (typeof body.companionHost === 'string') next.companionHost = body.companionHost.trim() || existing.companionHost
				if (body.companionPort !== undefined) {
					const p = Number.parseInt(String(body.companionPort), 10)
					if (Number.isFinite(p) && p >= 1 && p <= 65535) next.companionPort = p
				}
				if (body.emulatorUrl !== undefined) next.emulatorUrl = sanitizeHttpUrl(body.emulatorUrl)
				if (body.devices !== undefined) {
					const sanitized = sanitizeScreenDeckDevices(body.devices)
					if (sanitized !== undefined) next.devices = sanitized
				}

				config.set('screenDeck', next)
				res.json({ success: true, screenDeck: next })
			} catch (err) {
				res.status(400).json({ success: false, error: err && err.message ? err.message : String(err) })
			}
		})

		server.get('/surfaces', function (_req, res) {
			res.json({ surfaces: surfacesSnapshot() })
		})

		server.post('/logs/clear', function (req, res) {
			global.MIDIRelaysLog = []
			API.broadcastLogsCleared()
			res.send({ success: true })
		})

		server.post('/trigger/test', function (req, res) {
			try {
				let triggerId = req.body?.id
				if (!triggerId) {
					return res.status(400).json({ success: false, error: 'Trigger ID is required' })
				}
				let result = util.testTrigger(triggerId)
				res.json(result)
			} catch (err) {
				console.error('trigger/test error:', err)
				res.status(500).json({ success: false, error: 'Failed to test trigger' })
			}
		})

		server.get('/profiles', function (req, res) {
			try {
				const profiles = util.getProfiles()
				const list = Object.keys(profiles || {}).map((name) => {
					const p = profiles[name] || {}
					return { name, savedAt: p.savedAt || null, triggerCount: Array.isArray(p.triggers) ? p.triggers.length : null }
				})
				list.sort((a, b) => a.name.localeCompare(b.name))
				res.json({ profiles: list })
			} catch (err) {
				console.error('profiles GET error:', err)
				res.status(500).json({ error: true, message: 'Failed to get profiles' })
			}
		})

		server.post('/profiles/save', function (req, res) {
			try {
				const name = req.body && req.body.name
				const saved = util.saveProfile(name)
				res.send({ success: true, profile: { name: saved.name, savedAt: saved.savedAt, triggerCount: saved.triggers.length } })
			} catch (err) {
				res.status(400).send({ success: false, error: err && err.message ? err.message : String(err) })
			}
		})

		server.post('/profiles/load', function (req, res) {
			try {
				const name = req.body && req.body.name
				util.loadProfile(name)
				API.broadcastTriggers()
				res.send({ success: true })
			} catch (err) {
				res.status(400).send({ success: false, error: err && err.message ? err.message : String(err) })
			}
		})

		server.post('/profiles/delete', function (req, res) {
			try {
				const name = req.body && req.body.name
				const ok = util.deleteProfile(name)
				res.send({ success: true, deleted: ok })
			} catch (err) {
				res.status(400).send({ success: false, error: err && err.message ? err.message : String(err) })
			}
		})

		server.post('/sendmidi', validateSendMidi, function (req, res) {
			try {
				let midiObj = req.body

				util.sendMIDI(midiObj, function (result) {
					if (result.error) {
						res.status(500).json({ error: true, message: result.error })
					} else {
						res.json({ result: result.result || 'midi-sent-successfully', midiObj: result.midiObj })
					}
				})
			} catch (err) {
				console.error('sendmidi POST error:', err)
				res.status(500).json({ error: true, message: 'Failed to send MIDI' })
			}
		})

		server.get('/sendmidi', validateSendMidi, function (req, res) {
			try {
				let midiObj = req.query

				// Convert query string values to numbers
				if (midiObj.channel !== undefined) midiObj.channel = parseInt(midiObj.channel, 10)
				if (midiObj.note !== undefined) midiObj.note = parseInt(midiObj.note, 10)
				if (midiObj.velocity !== undefined) midiObj.velocity = parseInt(midiObj.velocity, 10)
				if (midiObj.value !== undefined) midiObj.value = parseInt(midiObj.value, 10)
				if (midiObj.controller !== undefined) midiObj.controller = parseInt(midiObj.controller, 10)

				util.sendMIDI(midiObj, function (result) {
					if (result.error) {
						res.status(500).json({ error: true, message: result.error })
					} else {
						res.json({ result: result.result || 'midi-sent-successfully', midiObj: result.midiObj })
					}
				})
			} catch (err) {
				console.error('sendmidi GET error:', err)
				res.status(500).json({ error: true, message: 'Failed to send MIDI' })
			}
		})

		server.get('/', function (req, res) {
			res.redirect('/index.html')
		})

		// Global error handler - must be defined after all routes
		server.use(function (err, req, res, next) {
			console.error('Unhandled API error:', err)
			res.status(500).json({
				error: true,
				message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
			})
		})

		// 404 handler - must be last
		server.use(function (req, res) {
			res.status(404).json({ error: true, message: req.originalUrl + ' not found' })
		})

		io.sockets.on('connection', (socket) => {
			let ipAddr = socket.handshake.address
			socket.emit('control_status', config.get('allowControl'))

			socket.on('surface_register', function (info) {
				try {
					const surfaceId = sanitizeSurfaceId(info && info.surfaceId)
					if (!surfaceId) {
						socket.emit('surface_error', { error: true, message: 'Invalid surfaceId' })
						return
					}

					const name = typeof info.name === 'string' && info.name.trim() ? info.name.trim() : surfaceId
					const product = typeof info.product === 'string' && info.product.trim() ? info.product.trim() : null
					const columns = clampInt(info.columns, 1, 32)
					const rows = clampInt(info.rows, 1, 32)

					surfaceIdBySocketId.set(socket.id, surfaceId)
					surfaces.set(surfaceId, {
						surfaceId,
						name,
						product,
						host: info.host || ipAddr || null,
						columns,
						rows,
						connectedAt: Date.now(),
						lastSeen: Date.now(),
						keys: {},
					})

					socket.emit('surface_registered', { success: true, surfaceId })
					broadcastSurfaces()
				} catch (err) {
					socket.emit('surface_error', { error: true, message: err && err.message ? err.message : String(err) })
				}
			})

			socket.on('surface_draw', function (payload) {
				try {
					const surfaceId = sanitizeSurfaceId(payload && payload.surfaceId) || surfaceIdBySocketId.get(socket.id)
					if (!surfaceId) return
					const surface = surfaces.get(surfaceId)
					if (!surface) return

					const x = clampInt(payload.x, 0, surface.columns - 1)
					const y = clampInt(payload.y, 0, surface.rows - 1)
					const key = `${x},${y}`

					const nextState = {
						text: typeof payload.text === 'string' ? payload.text : undefined,
						bgColor: typeof payload.bgColor === 'string' ? payload.bgColor : undefined,
						color: typeof payload.color === 'string' ? payload.color : undefined,
						imageBase64: typeof payload.imageBase64 === 'string' ? payload.imageBase64 : undefined,
					}
					surface.keys[key] = { ...(surface.keys[key] || {}), ...nextState }
					surface.lastSeen = Date.now()

					if (io) {
						io.sockets.emit('surface_draw', { surfaceId, x, y, state: surface.keys[key] })
					}
				} catch (err) {
					// ignore malformed draw packets
				}
			})

			socket.on('surface_key', function (payload) {
				try {
					const surfaceId = sanitizeSurfaceId(payload && payload.surfaceId) || surfaceIdBySocketId.get(socket.id)
					if (!surfaceId) return
					const surface = surfaces.get(surfaceId)
					if (!surface) return
					const x = clampInt(payload.x, 0, surface.columns - 1)
					const y = clampInt(payload.y, 0, surface.rows - 1)
					const action = typeof payload.action === 'string' ? payload.action : 'press'
					surface.lastSeen = Date.now()

					if (io) io.sockets.emit('surface_key', { surfaceId, x, y, action })
				} catch (err) {
					// ignore
				}
			})

			socket.on('version', function () {
				socket.emit('version', VERSION)
			})

			socket.on('control_status', function () {
				socket.emit('control_status', config.get('allowControl'))
			})

			socket.on('midi_outputs', function () {
				socket.emit('midi_outputs', util.getMIDIOutputs())
			})

			socket.on('refresh', function () {
				util.refreshPorts()
			})

			socket.on('sendmidi', function (midiObj) {
				if (midiObj) {
					// Validate MIDI object before sending
					const validation = util.validateMIDIObject(midiObj)
					if (!validation.valid) {
						socket.emit('result', { error: true, message: 'Invalid MIDI parameters', errors: validation.errors })
						return
					}

					util.sendMIDI(midiObj, function (result) {
						socket.emit('result', result)
					})
				}
			})

			socket.on('getMidiInputs', function () {
				socket.emit('midi_inputs', util.getMIDIInputs())
			})

			socket.on('getTriggers', function () {
				socket.emit('triggers', util.getTriggers())
			})

			socket.on('getTriggers_download', function () {
				socket.emit('triggers_download', util.getTriggers())
			})

			socket.on('trigger_add', function (triggerObj) {
				if (triggerObj) {
					// Validate trigger object before adding
					const validation = util.validateTriggerObject(triggerObj)
					if (!validation.valid) {
						socket.emit('trigger_error', { error: true, message: 'Invalid trigger parameters', errors: validation.errors })
						return
					}
					util.addTrigger(triggerObj)
				}
			})

			socket.on('trigger_update', function (triggerObj) {
				if (triggerObj) {
					// Validate trigger object before updating
					const validation = util.validateTriggerObject(triggerObj)
					if (!validation.valid) {
						socket.emit('trigger_error', { error: true, message: 'Invalid trigger parameters', errors: validation.errors })
						return
					}
					util.updateTrigger(triggerObj)
				}
			})

			socket.on('trigger_delete', function (triggerObj) {
				if (triggerObj) {
					util.deleteTrigger(triggerObj)
				}
			})

			socket.on('disconnect', function () {
				const surfaceId = surfaceIdBySocketId.get(socket.id)
				if (surfaceId) {
					surfaceIdBySocketId.delete(socket.id)
					surfaces.delete(surfaceId)
					broadcastSurfaces()
				}
			})
		})

		try {
			httpServer.listen(port)
			console.log('REST/Socket.io API server started on: ' + port)
		} catch (error) {
			if (error.code === 'EADDRINUSE') {
				notifications.showNotification({
					title: 'Error',
					body: 'Unable to start server. is midi-relay already running?',
					showNotification: true,
				})
			}
		}

		util.startUp()
	}

	static sendControlStatus() {
		io.sockets.emit('control_status', config.get('allowControl'))
	}

	static sendMIDIBack(midiObj) {
		io.sockets.emit('midi_back', midiObj)
	}

	static sendLog(logEntry) {
		if (io) {
			io.sockets.emit('midi_log', logEntry)
		}
	}

	static broadcastTriggers() {
		if (io) {
			io.sockets.emit('triggers', util.getTriggers())
		}
	}

	static broadcastLogsCleared() {
		if (io) {
			io.sockets.emit('logs_cleared')
		}
	}
}

module.exports = API
