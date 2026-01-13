'use strict'

const { app, systemPreferences } = require('electron')

const config = require('./config.js')

const midi = require('./midi.js')
// mdns-js removed - was unmaintained (last update 2016)

const notifications = require('./notifications.js')
const contextmenu = require('./contextmenu.js')

function subscribeToNotifications() {
	//system events that can notify the app of a system change - perhaps like USB device being plugged in
	let allowedEvents = config.get('allowedEvents')
	for (let i = 0; i < allowedEvents.length; i++) {
		systemPreferences.subscribeNotification(allowedEvents[i], (event, userInfo) => {
			processNotification(event, userInfo)
		})
	}
}

function processNotification(event, info) {
	//process the system event
	try {
		if (config.get('allowedEvents').includes(event)) {
			//do the stuff with the things
			switch (event) {
				default:
					break
			}
		}
	} catch (error) {
		console.log(error)
	}
}

function startRescanInterval() {
	if (config.get('allowRescan')) {
		global.RESCAN_INTERVAL = setInterval(() => {
			midi.refreshPorts(false)
		}, 60000)
	} else {
		clearInterval(global.RESCAN_INTERVAL)
	}
}

module.exports = {
	startUp() {
		contextmenu.buildContextMenu()
		midi.startMIDI()
		startRescanInterval()
		subscribeToNotifications() //for system notifications to alert the app of changes like usb devices detected
	},

	getMIDIOutputs() {
		return global.MIDI_OUTPUTS
	},

	getMIDIInputs() {
		return global.MIDI_INPUTS
	},

	sendMIDI(midiObj, callback) {
		midi.sendMIDI(midiObj, callback)
	},

	refreshPorts() {
		midi.refreshPorts(true)
	},

	startRescanInterval() {
		startRescanInterval()
	},

	getTriggers() {
		return config.get('triggers')
	},

	getProfiles() {
		return config.get('profiles') || {}
	},

	listProfiles() {
		const profiles = config.get('profiles') || {}
		return Object.keys(profiles).sort((a, b) => a.localeCompare(b))
	},

	saveProfile(profileName) {
		if (!profileName || typeof profileName !== 'string' || profileName.trim() === '') {
			throw new Error('Profile name is required')
		}
		const name = profileName.trim()
		const profiles = config.get('profiles') || {}
		profiles[name] = {
			name,
			savedAt: Date.now(),
			triggers: config.get('triggers') || [],
		}
		config.set('profiles', profiles)
		return profiles[name]
	},

	loadProfile(profileName) {
		if (!profileName || typeof profileName !== 'string' || profileName.trim() === '') {
			throw new Error('Profile name is required')
		}
		const name = profileName.trim()
		const profiles = config.get('profiles') || {}
		const profile = profiles[name]
		if (!profile) {
			throw new Error(`Profile not found: ${name}`)
		}
		if (!Array.isArray(profile.triggers)) {
			throw new Error(`Profile is invalid (triggers missing): ${name}`)
		}
		config.set('triggers', profile.triggers)
		// Trigger refresh attempts to open any now-enabled ports
		midi.refreshPorts(true)
		return profile
	},

	deleteProfile(profileName) {
		if (!profileName || typeof profileName !== 'string' || profileName.trim() === '') {
			throw new Error('Profile name is required')
		}
		const name = profileName.trim()
		const profiles = config.get('profiles') || {}
		if (!profiles[name]) {
			return false
		}
		delete profiles[name]
		config.set('profiles', profiles)
		return true
	},

	addTrigger(triggerObj) {
		midi.addTrigger(triggerObj)
	},

	updateTrigger(triggerObj) {
		midi.updateTrigger(triggerObj)
	},

	deleteTrigger(triggerId) {
		midi.deleteTrigger(triggerId)
	},

	testTrigger(triggerId) {
		return midi.testTrigger(triggerId)
	},

	toggleInputDisabled(inputId) {
		midi.toggleInputDisabled(inputId)
	},

	isInputDisabled(inputId) {
		return midi.isInputDisabled(inputId)
	},

	// Validation re-exports
	validateMIDIObject: midi.validateMIDIObject,
	validateTriggerObject: midi.validateTriggerObject,
	validateMIDIValue: midi.validateMIDIValue,
	MIDI_LIMITS: midi.MIDI_LIMITS,
	VALID_MIDI_COMMANDS: midi.VALID_MIDI_COMMANDS,
}
