'use strict'

/**
 * Mock Electron modules for testing
 * These mocks allow us to test validation logic without loading Electron
 */

// Mock electron-store
jest.mock('electron-store', () => {
	return jest.fn().mockImplementation(() => ({
		get: jest.fn((key) => {
			const defaults = {
				triggers: [],
				profiles: {},
				disabledInputs: [],
			}
			return defaults[key]
		}),
		set: jest.fn(),
	}))
})

// Mock electron
jest.mock('electron', () => ({
	app: {
		getPath: jest.fn(() => '/tmp'),
		setAppUserModelId: jest.fn(),
		dock: { hide: jest.fn() },
	},
	systemPreferences: {
		subscribeNotification: jest.fn(),
	},
	BrowserWindow: jest.fn(),
	Tray: jest.fn(),
	nativeImage: { createFromPath: jest.fn() },
	Menu: { buildFromTemplate: jest.fn(), setApplicationMenu: jest.fn() },
	Notification: jest.fn().mockImplementation(() => ({
		show: jest.fn(),
	})),
}))

// Mock midi
jest.mock(
	'midi',
	() => ({
	Output: jest.fn().mockImplementation(() => ({
		getPortCount: jest.fn(() => 0),
		getPortName: jest.fn(() => 'Test Port'),
		openPort: jest.fn(),
		openVirtualPort: jest.fn(),
		closePort: jest.fn(),
		sendMessage: jest.fn(),
	})),
	Input: jest.fn().mockImplementation(() => ({
		getPortCount: jest.fn(() => 0),
		getPortName: jest.fn(() => 'Test Port'),
		openPort: jest.fn(),
		openVirtualPort: jest.fn(),
		closePort: jest.fn(),
		on: jest.fn(),
		ignoreTypes: jest.fn(),
	})),
	}),
	{ virtual: true }
)

// Mock JZZ (for midi-jzz.js)
jest.mock('jzz', () => {
	const mockEngine = {
		info: jest.fn(() => ({
			inputs: [],
			outputs: [],
		})),
		openMidiIn: jest.fn(() => Promise.resolve({ connect: jest.fn(), close: jest.fn() })),
		openMidiOut: jest.fn(() => Promise.resolve({ send: jest.fn(), close: jest.fn() })),
		close: jest.fn(() => Promise.resolve()),
	}

	const JZZ = jest.fn(() => Promise.resolve(mockEngine))
	JZZ.Widget = jest.fn(() => ({}))
	JZZ.addMidiIn = jest.fn()
	JZZ.addMidiOut = jest.fn()

	return JZZ
})

// Set up globals
global.MIDI_INPUTS = []
global.MIDI_OUTPUTS = []
global.MIDI_TRIGGERS = []
global.MIDIRelaysLog = []
global.sendLog = jest.fn()
global.sendMIDIBack = jest.fn()
