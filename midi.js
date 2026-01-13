'use strict'

/**
 * MIDI Engine using JZZ.js
 *
 * This is a drop-in replacement for the node-midi based implementation.
 * JZZ.js provides:
 * - Active maintenance and MIDI 2.0 support
 * - Helper functions (noteOn, cc, etc.)
 * - Better async/await support
 * - Cross-platform compatibility
 */

const JZZ = require('jzz')

const notifications = require('./notifications.js')
const contextmenu = require('./contextmenu.js')
const config = require('./config.js')
const _ = require('lodash')

// =============================================================================
// Logging
// =============================================================================

function addToLog(direction, port, command, data) {
	const logEntry = {
		timestamp: new Date().toISOString(),
		direction: direction,
		port: port,
		command: command,
		data: data,
	}

	global.MIDIRelaysLog.push(logEntry)

	if (global.MIDIRelaysLog.length > 500) {
		global.MIDIRelaysLog.shift()
	}

	if (global.sendLog) {
		global.sendLog(logEntry)
	}
}

// =============================================================================
// JZZ Engine State
// =============================================================================

let jzzEngine = null
let virtualInPort = null
let virtualOutPort = null
const openInputs = new Map() // portName -> JZZ input port
const openOutputs = new Map() // portName -> JZZ output port

// =============================================================================
// Engine Initialization
// =============================================================================

async function initEngine() {
	if (jzzEngine) return jzzEngine

	try {
		jzzEngine = await JZZ()
		console.log('JZZ MIDI engine initialized')
		return jzzEngine
	} catch (error) {
		console.error('Failed to initialize JZZ MIDI engine:', error)
		throw error
	}
}

// =============================================================================
// Virtual MIDI Ports
// =============================================================================

async function createVirtualMIDIPort() {
	try {
		await initEngine()

		// Create a virtual input widget that receives MIDI and processes it
		const inputWidget = JZZ.Widget({
			_receive: function (msg) {
				console.log('virtual message received:', msg.toString())
				receiveMIDI('midi-relay-hub', Array.from(msg))
			},
		})

		// Create virtual output widget
		const outputWidget = JZZ.Widget()

		// Register as virtual ports
		JZZ.addMidiIn('midi-relay-hub', inputWidget)
		JZZ.addMidiOut('midi-relay-hub', outputWidget)

		virtualInPort = inputWidget
		virtualOutPort = outputWidget

		notifications.showNotification({
			title: 'Virtual MIDI Port',
			body: 'Virtual MIDI Port Created: midi-relay-hub',
			showNotification: true,
		})
	} catch (error) {
		console.warn('Virtual ports not supported or failed to create:', error.message)
		notifications.showNotification({
			title: 'Virtual MIDI Port Error',
			body: 'Unable to create virtual MIDI port.',
			showNotification: true,
		})
	}
}

// =============================================================================
// Port Management
// =============================================================================

async function GetPorts(showNotification) {
	global.MIDI_OUTPUTS = []
	global.MIDI_INPUTS = []

	try {
		const engine = await initEngine()

		// Get output ports
		const outputs = engine.info().outputs
		outputs.forEach((port, index) => {
			global.MIDI_OUTPUTS.push({
				id: port.name,
				name: port.name,
				manufacturer: port.manufacturer || '',
			})
		})

		// Get input ports
		const inputs = engine.info().inputs
		inputs.forEach((port, index) => {
			const alreadyExists = global.MIDI_INPUTS.find((p) => p.name === port.name)
			if (!alreadyExists) {
				global.MIDI_INPUTS.push({
					id: index,
					name: port.name,
					manufacturer: port.manufacturer || '',
					opened: openInputs.has(port.name),
				})
			}
		})

		// Open ports that should be open
		const portsToOpen = global.MIDI_INPUTS.filter((port) => !isInputDisabled(port.name) && !port.opened)
		for (const port of portsToOpen) {
			await OpenPort(port.name)
		}

		loadMIDITriggers()

		if (showNotification) {
			const bodyText = global.MIDI_OUTPUTS.map((port) => port.name).join('\n')
			notifications.showNotification({
				title: `${global.MIDI_OUTPUTS.length} MIDI Output Ports Found.`,
				body: bodyText,
				showNotification: true,
			})
		}

		contextmenu.buildContextMenu()
	} catch (error) {
		console.error('Error scanning MIDI ports:', error)
	}
}

async function OpenPort(portName) {
	if (openInputs.has(portName)) {
		return // Already open
	}

	try {
		const engine = await initEngine()
		const input = await engine.openMidiIn(portName)

		input.connect(function (msg) {
			receiveMIDI(portName, Array.from(msg))
		})

		openInputs.set(portName, input)

		const port = global.MIDI_INPUTS.find((p) => p.name === portName)
		if (port) port.opened = true

		notifications.showNotification({
			title: `MIDI Port Opened: ${portName}`,
			body: `MIDI Port Opened: ${portName}`,
			showNotification: true,
		})
	} catch (error) {
		console.warn(`Error opening MIDI port ${portName}:`, error.message)
	}
}

async function ClosePort(portName) {
	const input = openInputs.get(portName)
	if (input) {
		try {
			await input.close()
			openInputs.delete(portName)

			const port = global.MIDI_INPUTS.find((p) => p.name === portName)
			if (port) port.opened = false
		} catch (error) {
			console.warn(`Error closing MIDI port ${portName}:`, error.message)
		}
	}
}

async function refreshPorts(showNotification) {
	try {
		await GetPorts(showNotification)
	} catch (error) {
		console.error('Error refreshing ports:', error)
	}
}

// =============================================================================
// MIDI Sending
// =============================================================================

async function sendMIDI(midiObj, callback) {
	try {
		const engine = await initEngine()

		// Get or open the output port
		let output = openOutputs.get(midiObj.midiport)
		if (!output) {
			output = await engine.openMidiOut(midiObj.midiport)
			openOutputs.set(midiObj.midiport, output)
		}

		let message = []

		switch (midiObj.midicommand.toLowerCase()) {
			case 'noteon':
				// JZZ helper: noteOn(channel, note, velocity)
				message = [0x90 + midiObj.channel, midiObj.note, midiObj.velocity || 127]
				break
			case 'noteoff':
				message = [0x80 + midiObj.channel, midiObj.note, midiObj.velocity || 0]
				break
			case 'cc':
				message = [0xb0 + midiObj.channel, midiObj.controller, midiObj.value]
				break
			case 'pc':
				message = [0xc0 + midiObj.channel, midiObj.value]
				break
			case 'pressure':
				message = [0xd0 + midiObj.channel, midiObj.value]
				break
			case 'pitchbend':
				const lsb = midiObj.value & 0x7f
				const msb = (midiObj.value >> 7) & 0x7f
				message = [0xe0 + midiObj.channel, lsb, msb]
				break
			case 'sysex':
				message = midiObj.message.split(',').map((v) => parseInt(v.trim()))
				break
			case 'msc':
				message = BuildMSC(
					midiObj.deviceid,
					midiObj.commandformat,
					midiObj.command,
					midiObj.cue,
					midiObj.cuelist,
					midiObj.cuepath,
				)
				break
			default:
				callback({ result: 'invalid-midi-command' })
				return
		}

		// Send the message
		output.send(message)
		addToLog('TX', midiObj.midiport, midiObj.midicommand, midiObj)
		callback({ result: 'midi-sent-successfully', midiObj, message })
	} catch (error) {
		console.error('Error sending MIDI:', error)
		callback({ result: 'error', error: error.message })
	}
}

// =============================================================================
// MIDI Receiving
// =============================================================================

function receiveMIDI(portName, message) {
	if (!message || message.length === 0) return

	const statusByte = message[0]
	const channel = statusByte & 0x0f
	const command = statusByte & 0xf0

	let midiType = ''
	let midiData = { channel, raw: message }

	switch (command) {
		case 0x90: // Note On
			midiType = message[2] > 0 ? 'noteon' : 'noteoff'
			midiData.note = message[1]
			midiData.velocity = message[2]
			break
		case 0x80: // Note Off
			midiType = 'noteoff'
			midiData.note = message[1]
			midiData.velocity = message[2]
			break
		case 0xb0: // CC
			midiType = 'cc'
			midiData.controller = message[1]
			midiData.value = message[2]
			break
		case 0xc0: // Program Change
			midiType = 'pc'
			midiData.value = message[1]
			break
		case 0xd0: // Channel Pressure
			midiType = 'pressure'
			midiData.value = message[1]
			break
		case 0xe0: // Pitch Bend
			midiType = 'pitchbend'
			midiData.value = message[1] | (message[2] << 7)
			break
		case 0xf0: // System messages
			if (statusByte === 0xf0) {
				midiType = 'sysex'
				midiData.message = message
				// Check for MSC
				if (message.length >= 5 && message[1] === 0x7f && message[3] === 0x02) {
					midiType = 'msc'
					midiData = parseMSC(message)
				}
			}
			break
		default:
			midiType = 'unknown'
	}

	if (midiType && midiType !== 'unknown') {
		addToLog('RX', portName, midiType, midiData)

		// Send to connected clients
		if (global.sendMIDIBack) {
			global.sendMIDIBack({
				port: portName,
				type: midiType,
				...midiData,
			})
		}

		// Check triggers
		processMIDITriggers(portName, midiType, midiData)
	}
}

// =============================================================================
// MSC (MIDI Show Control)
// =============================================================================

function BuildMSC(deviceId, commandFormat, command, cue, cueList, cuePath) {
	let deviceId_hex = null
	let commandFormat_hex = null
	let command_hex = null

	try {
		deviceId_hex = isNaN(parseInt(deviceId)) ? parseStringDeviceId(deviceId) : parseIntegerDeviceId(parseInt(deviceId))
	} catch (err) {
		console.warn('Error parsing MSC deviceId:', err.message)
		return []
	}

	// Command Format mapping
	const formatMap = {
		'lighting.general': 0x01,
		'sound.general': 0x10,
		'machinery.general': 0x20,
		'video.general': 0x30,
		'projection.general': 0x40,
		'processcontrol.general': 0x50,
		'pyro.general': 0x60,
	}
	commandFormat_hex = formatMap[commandFormat] || 0x7f

	// Command mapping
	const commandMap = {
		go: 0x01,
		stop: 0x02,
		resume: 0x03,
		timedgo: 0x04,
		load: 0x05,
		set: 0x06,
		fire: 0x07,
		alloff: 0x08,
		restore: 0x09,
		reset: 0x0a,
		gooff: 0x0b,
		gojam: 0x10,
	}
	command_hex = commandMap[command] || 0x01

	// Build message
	const msg = [0xf0, 0x7f, deviceId_hex, 0x02, commandFormat_hex, command_hex]

	// Add cue data if present
	if (cue) {
		const cueBytes = stringToMSCData(cue)
		msg.push(...cueBytes)
	}
	if (cueList) {
		msg.push(0x00) // separator
		const listBytes = stringToMSCData(cueList)
		msg.push(...listBytes)
	}
	if (cuePath) {
		msg.push(0x00)
		const pathBytes = stringToMSCData(cuePath)
		msg.push(...pathBytes)
	}

	msg.push(0xf7) // End of SysEx
	return msg
}

function parseStringDeviceId(deviceId) {
	if (deviceId === 'all') return 0x7f
	if (deviceId.startsWith('g')) {
		const group = parseInt(deviceId.substring(1))
		if (group >= 1 && group <= 15) return 0x70 + (group - 1)
	}
	return 0x7f
}

function parseIntegerDeviceId(deviceId) {
	if (deviceId >= 0 && deviceId <= 111) return deviceId
	return 0x7f
}

function stringToMSCData(str) {
	return str.split('').map((c) => c.charCodeAt(0))
}

function parseMSC(message) {
	return {
		deviceid: message[2],
		commandformat: message[4],
		command: message[5],
		raw: message,
	}
}

// =============================================================================
// Triggers
// =============================================================================

function loadMIDITriggers() {
	// Triggers are stored in config
	const triggers = config.get('triggers') || []
	global.MIDI_TRIGGERS = triggers
}

function processMIDITriggers(portName, midiType, midiData) {
	const triggers = global.MIDI_TRIGGERS || []

	for (const trigger of triggers) {
		if (matchesTrigger(trigger, portName, midiType, midiData)) {
			executeTrigger(trigger, midiData)
		}
	}
}

function matchesTrigger(trigger, portName, midiType, midiData) {
	// Check MIDI command type
	if (trigger.midicommand.toLowerCase() !== midiType) return false

	// Check port if specified
	if (trigger.midiport && trigger.midiport !== '*' && trigger.midiport !== portName) return false

	// Check channel (if applicable)
	if (trigger.channel !== undefined && trigger.channel !== '*') {
		if (parseInt(trigger.channel) !== midiData.channel) return false
	}

	// Check note (for note on/off)
	if ((midiType === 'noteon' || midiType === 'noteoff') && trigger.note !== undefined) {
		if (trigger.note !== '*' && parseInt(trigger.note) !== midiData.note) return false
	}

	// Check velocity (optional)
	if (trigger.velocity !== undefined && trigger.velocity !== '*') {
		if (parseInt(trigger.velocity) !== midiData.velocity) return false
	}

	// Check controller (for CC)
	if (midiType === 'cc' && trigger.controller !== undefined) {
		if (trigger.controller !== '*' && parseInt(trigger.controller) !== midiData.controller) return false
	}

	// Check value (for CC, PC, etc.)
	if (trigger.value !== undefined && trigger.value !== '*') {
		if (parseInt(trigger.value) !== midiData.value) return false
	}

	return true
}

async function executeTrigger(trigger, midiData) {
	console.log('Executing trigger:', trigger.id)

	switch (trigger.actiontype) {
		case 'http':
			await runMIDITrigger_HTTP(trigger)
			break
		case 'midi':
			await runMIDITrigger_MIDI(trigger)
			break
		default:
			console.warn('Unknown trigger action type:', trigger.actiontype)
	}
}

// =============================================================================
// HTTP Trigger Action
// =============================================================================

async function runMIDITrigger_HTTP(midiTriggerObj) {
	let explicitMethod = (midiTriggerObj.method || '').toString().trim().toUpperCase()
	let method = explicitMethod || (midiTriggerObj.jsondata ? 'POST' : 'GET')

	const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
	if (!allowedMethods.has(method)) {
		method = midiTriggerObj.jsondata ? 'POST' : 'GET'
	}

	const timeoutMs = config.get('httpTimeout') || 5000
	const controller = new AbortController()
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

	const fetchOptions = {
		method,
		signal: controller.signal,
	}

	if (midiTriggerObj.jsondata) {
		try {
			JSON.parse(midiTriggerObj.jsondata)
			fetchOptions.headers = { 'Content-Type': 'application/json' }
			fetchOptions.body = midiTriggerObj.jsondata
		} catch (error) {
			console.log(error)
			addToLog('APP-ERR', 'HTTP ' + method, midiTriggerObj.url, { error: 'Invalid JSON: ' + error.message })
			return
		}
	} else if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
		fetchOptions.headers = { 'Content-Type': 'application/json' }
		fetchOptions.body = '{}'
	}

	try {
		const response = await fetch(midiTriggerObj.url, fetchOptions)
		clearTimeout(timeoutId)
		const responseBody = await response.text()

		if (response.ok) {
			console.log(responseBody)
			addToLog('TRIGGER', 'HTTP ' + method, midiTriggerObj.url, { status: response.status })
		} else {
			console.log(response.status)
			console.log(responseBody)
			addToLog('APP-ERR', 'HTTP ' + method, midiTriggerObj.url, {
				error: 'Status Error',
				status: response.status,
			})
		}
	} catch (error) {
		clearTimeout(timeoutId)
		let errorMsg = error.message
		if (error.name === 'AbortError') {
			errorMsg = `Timeout after ${timeoutMs}ms - server not responding`
		} else if (error.cause?.code === 'ECONNREFUSED') {
			errorMsg = 'Connection refused - server not running on that port'
		} else if (error.cause?.code === 'ENOTFOUND') {
			errorMsg = 'Host not found - check hostname/IP'
		}
		console.log(`HTTP Trigger Error: ${errorMsg}`)
		addToLog('APP-ERR', 'HTTP ' + method, midiTriggerObj.url, {
			error: errorMsg,
			status: 'N/A',
		})
	}
}

async function runMIDITrigger_MIDI(trigger) {
	// Send MIDI to another port
	const midiObj = {
		midiport: trigger.outputport,
		midicommand: trigger.outputcommand || trigger.midicommand,
		channel: trigger.outputchannel ?? trigger.channel,
		note: trigger.outputnote ?? trigger.note,
		velocity: trigger.outputvelocity ?? trigger.velocity,
		controller: trigger.outputcontroller ?? trigger.controller,
		value: trigger.outputvalue ?? trigger.value,
	}

	sendMIDI(midiObj, (result) => {
		if (result.result === 'midi-sent-successfully') {
			addToLog('TRIGGER', 'MIDI', trigger.outputport, midiObj)
		} else {
			addToLog('APP-ERR', 'MIDI Trigger', trigger.outputport, { error: result.error || result.result })
		}
	})
}

// =============================================================================
// Trigger CRUD
// =============================================================================

function uuidv4() {
	return 'xxxxxxxx'.replace(/[xy]/g, function (c) {
		var r = (Math.random() * 16) | 0,
			v = c === 'x' ? r : (r & 0x3) | 0x8
		return v.toString(16)
	})
}

function addTrigger(triggerObj) {
	triggerObj.id = 'trigger-' + uuidv4()
	const triggers = config.get('triggers') || []
	triggers.push(triggerObj)
	config.set('triggers', triggers)
	global.MIDI_TRIGGERS = triggers
	return triggerObj
}

function updateTrigger(triggerObj) {
	const triggers = config.get('triggers') || []
	const index = triggers.findIndex((t) => t.id === triggerObj.id)
	if (index !== -1) {
		triggers[index] = triggerObj
		config.set('triggers', triggers)
		global.MIDI_TRIGGERS = triggers
		return true
	}
	return false
}

function deleteTrigger(triggerId) {
	const triggers = config.get('triggers') || []
	const filtered = triggers.filter((t) => t.id !== triggerId)
	if (filtered.length !== triggers.length) {
		config.set('triggers', filtered)
		global.MIDI_TRIGGERS = filtered
		return true
	}
	return false
}

async function testTrigger(triggerId) {
	const triggers = config.get('triggers') || []
	const trigger = triggers.find((t) => t.id === triggerId)

	if (!trigger) {
		return { success: false, error: 'Trigger not found' }
	}

	if (trigger.actiontype === 'http') {
		const timeoutMs = config.get('httpTimeout') || 5000
		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

		try {
			const method = trigger.method || (trigger.jsondata ? 'POST' : 'GET')
			const fetchOptions = {
				method,
				signal: controller.signal,
			}

			if (trigger.jsondata) {
				fetchOptions.headers = { 'Content-Type': 'application/json' }
				fetchOptions.body = trigger.jsondata
			}

			const response = await fetch(trigger.url, fetchOptions)
			clearTimeout(timeoutId)
			const body = await response.text()

			return {
				success: response.ok,
				status: response.status,
				statusText: response.statusText,
				body: body.substring(0, 500),
			}
		} catch (error) {
			clearTimeout(timeoutId)
			let errorMsg = error.message
			if (error.name === 'AbortError') {
				errorMsg = `Timeout after ${timeoutMs}ms`
			}
			return { success: false, error: errorMsg }
		}
	}

	return { success: false, error: 'Test not supported for this action type' }
}

// =============================================================================
// Input Enable/Disable
// =============================================================================

function toggleInputDisabled(inputId) {
	const disabledInputs = config.get('disabledInputs') || []
	const index = disabledInputs.indexOf(inputId)

	if (index === -1) {
		disabledInputs.push(inputId)
		ClosePort(inputId)
	} else {
		disabledInputs.splice(index, 1)
		OpenPort(inputId)
	}

	config.set('disabledInputs', disabledInputs)
}

function isInputDisabled(inputId) {
	const disabledInputs = config.get('disabledInputs') || []
	return disabledInputs.includes(inputId)
}

// =============================================================================
// Startup
// =============================================================================

async function startMIDI() {
	await initEngine()
	await GetPorts(true)
	await createVirtualMIDIPort()
}

// =============================================================================
// Cleanup
// =============================================================================

async function closeMIDI() {
	// Close all open inputs
	for (const [name, input] of openInputs) {
		try {
			await input.close()
		} catch (e) {
			/* ignore */
		}
	}
	openInputs.clear()

	// Close all open outputs
	for (const [name, output] of openOutputs) {
		try {
			await output.close()
		} catch (e) {
			/* ignore */
		}
	}
	openOutputs.clear()

	// Close JZZ engine
	if (jzzEngine) {
		try {
			await jzzEngine.close()
		} catch (e) {
			/* ignore */
		}
		jzzEngine = null
	}
}

// =============================================================================
// Validation (same as before)
// =============================================================================

const MIDI_LIMITS = {
	channel: { min: 0, max: 15, name: 'Channel' },
	note: { min: 0, max: 127, name: 'Note' },
	velocity: { min: 0, max: 127, name: 'Velocity' },
	value: { min: 0, max: 127, name: 'Value' },
	controller: { min: 0, max: 127, name: 'Controller' },
	program: { min: 0, max: 127, name: 'Program' },
	pitchbend: { min: 0, max: 16383, name: 'Pitch Bend' },
}

const VALID_MIDI_COMMANDS = ['noteon', 'noteoff', 'cc', 'pc', 'pressure', 'pitchbend', 'sysex', 'msc']

function validateMIDIValue(paramName, value, allowWildcard = false) {
	if (allowWildcard && value === '*') {
		return { valid: true, value: '*' }
	}

	const limits = MIDI_LIMITS[paramName]
	if (!limits) {
		return { valid: false, error: `Unknown MIDI parameter: ${paramName}` }
	}

	const num = parseInt(value, 10)
	if (isNaN(num)) {
		return { valid: false, error: `${limits.name} must be a number, got: ${value}` }
	}

	if (num < limits.min || num > limits.max) {
		return { valid: false, error: `${limits.name} must be ${limits.min}-${limits.max}, got: ${num}` }
	}

	return { valid: true, value: num }
}

function validateMIDIObject(midiObj) {
	const errors = []

	if (!midiObj) {
		return { valid: false, errors: ['MIDI object is required'] }
	}

	if (!midiObj.midicommand) {
		errors.push('midicommand is required')
	} else if (!VALID_MIDI_COMMANDS.includes(midiObj.midicommand.toLowerCase())) {
		errors.push(`Invalid midicommand: ${midiObj.midicommand}. Valid commands: ${VALID_MIDI_COMMANDS.join(', ')}`)
	}

	if (!midiObj.midiport) {
		errors.push('midiport is required')
	}

	const command = (midiObj.midicommand || '').toLowerCase()

	if (['noteon', 'noteoff', 'cc', 'pc', 'pressure', 'pitchbend'].includes(command)) {
		if (midiObj.channel === undefined || midiObj.channel === null || midiObj.channel === '') {
			errors.push('channel is required for ' + command)
		} else {
			const channelResult = validateMIDIValue('channel', midiObj.channel)
			if (!channelResult.valid) errors.push(channelResult.error)
		}
	}

	if (['noteon', 'noteoff'].includes(command)) {
		if (midiObj.note === undefined || midiObj.note === null || midiObj.note === '') {
			errors.push('note is required for ' + command)
		} else {
			const noteResult = validateMIDIValue('note', midiObj.note)
			if (!noteResult.valid) errors.push(noteResult.error)
		}
	}

	if (['noteon', 'noteoff'].includes(command) && midiObj.velocity !== undefined) {
		const velResult = validateMIDIValue('velocity', midiObj.velocity)
		if (!velResult.valid) errors.push(velResult.error)
	}

	if (command === 'cc') {
		if (midiObj.controller === undefined || midiObj.controller === null || midiObj.controller === '') {
			errors.push('controller is required for cc')
		} else {
			const ctrlResult = validateMIDIValue('controller', midiObj.controller)
			if (!ctrlResult.valid) errors.push(ctrlResult.error)
		}
	}

	if (['cc', 'pc', 'pressure'].includes(command)) {
		if (midiObj.value === undefined || midiObj.value === null || midiObj.value === '') {
			errors.push('value is required for ' + command)
		} else {
			const valResult = validateMIDIValue('value', midiObj.value)
			if (!valResult.valid) errors.push(valResult.error)
		}
	}

	if (command === 'pitchbend') {
		if (midiObj.value === undefined || midiObj.value === null || midiObj.value === '') {
			errors.push('value is required for pitchbend')
		} else {
			const pbResult = validateMIDIValue('pitchbend', midiObj.value)
			if (!pbResult.valid) errors.push(pbResult.error)
		}
	}

	return errors.length > 0 ? { valid: false, errors } : { valid: true }
}

function validateTriggerObject(triggerObj) {
	const errors = []

	if (!triggerObj) {
		return { valid: false, errors: ['Trigger object is required'] }
	}

	if (!triggerObj.midicommand) {
		errors.push('midicommand is required')
	} else if (!VALID_MIDI_COMMANDS.includes(triggerObj.midicommand.toLowerCase())) {
		errors.push(`Invalid midicommand: ${triggerObj.midicommand}`)
	}

	const command = (triggerObj.midicommand || '').toLowerCase()

	// Validate channel (allow wildcards for triggers)
	if (['noteon', 'noteoff', 'cc', 'pc', 'pressure', 'pitchbend'].includes(command)) {
		if (triggerObj.channel !== undefined && triggerObj.channel !== '*') {
			const result = validateMIDIValue('channel', triggerObj.channel)
			if (!result.valid) errors.push(result.error)
		}
	}

	// Validate note
	if (['noteon', 'noteoff'].includes(command) && triggerObj.note !== undefined && triggerObj.note !== '*') {
		const result = validateMIDIValue('note', triggerObj.note)
		if (!result.valid) errors.push(result.error)
	}

	// Validate action type
	if (!triggerObj.actiontype) {
		errors.push('actiontype is required')
	} else if (!['http', 'midi'].includes(triggerObj.actiontype)) {
		errors.push(`Invalid actiontype: ${triggerObj.actiontype}. Valid types: http, midi`)
	}

	// HTTP action requires URL
	if (triggerObj.actiontype === 'http' && !triggerObj.url) {
		errors.push('url is required for http action')
	}

	// MIDI action requires output port
	if (triggerObj.actiontype === 'midi' && !triggerObj.outputport) {
		errors.push('outputport is required for midi action')
	}

	return errors.length > 0 ? { valid: false, errors } : { valid: true }
}

// =============================================================================
// Exports
// =============================================================================

module.exports = {
	startMIDI,
	closeMIDI,
	GetPorts,
	OpenPort,
	ClosePort,
	refreshPorts,
	sendMIDI,
	createVirtualMIDIPort,
	addTrigger,
	updateTrigger,
	deleteTrigger,
	testTrigger,
	toggleInputDisabled,
	isInputDisabled,
	loadMIDITriggers,
	// Validation
	validateMIDIValue,
	validateMIDIObject,
	validateTriggerObject,
	MIDI_LIMITS,
	VALID_MIDI_COMMANDS,
}
