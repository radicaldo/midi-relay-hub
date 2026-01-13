'use strict'
const path = require('path')
const { app, BrowserWindow, Tray, nativeImage, Menu, ipcMain } = require('electron')
/// const {autoUpdater} = require('electron-updater');
const { is } = require('electron-util')
const unhandled = require('electron-unhandled')
const debug = require('electron-debug')
const contextMenu = require('electron-context-menu')
const config = require('./config.js')
const util = require('./util.js')
const API = require('./api.js')
const { ScreenDeckSatellite } = require('./screendeckSatellite.js')

const notifications = require('./notifications.js')

global.tray = undefined

global.win = undefined

global.MIDI_INPUTS = []
global.MIDI_OUTPUTS = []

global.IncomingMIDIRelayTypes = ['noteon', 'noteoff', 'aftertouch', 'cc', 'pc', 'pressure', 'pitchbend', 'msc', 'sysex']

global.MIDIRelaysLog = [] //global array of MIDI messages and the datetime they were sent

global.MDNS_HOSTS = []

global.sendControlStatus = function () {
	API.sendControlStatus()
}

global.refreshPorts = function () {
	util.refreshPorts()
}

global.toggleInputDisabled = function (inputId) {
	util.toggleInputDisabled(inputId)
}

global.isInputDisabled = function (inputId) {
	return util.isInputDisabled(inputId)
}

global.startRescanInterval = function () {
	util.startRescanInterval()
}

global.RESCAN_INTERVAL = null

global.sendMIDIBack = function (midiObj) {
	API.sendMIDIBack(midiObj)
}

global.sendLog = function (logEntry) {
	API.sendLog(logEntry)
}

unhandled()
//debug();
contextMenu()

// Note: Must match `build.appId` in package.json
app.setAppUserModelId(config.get('appUserModelId'))
if (process.platform === 'darwin') {
	app.dock.hide()
}

// Uncomment this before publishing your first version.
// It's commented out as it throws an error if there are no published versions.
// if (!is.development) {
// 	const FOUR_HOURS = 1000 * 60 * 60 * 4;
// 	setInterval(() => {
// 		autoUpdater.checkForUpdates();
// 	}, FOUR_HOURS);
//
// 	autoUpdater.checkForUpdates();
// }

// Prevent window from being garbage collected
let mainWindow

const screenDeckSatellite = new ScreenDeckSatellite()

const createMainWindow = async () => {
	global.win = new BrowserWindow({
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false,
		},
		title: app.name,
		show: true,
		x: 0,
		y: 0,
		width: 500,
		height: 800,
		frame: true,
		transparent: false,
		shadow: false,
	})

	global.win.on('ready-to-show', () => {
		if (config.get('showLicense') == true) {
			global.win.show()
		} else {
			global.win.hide()
		}
	})

	global.win.on('closed', () => {
		// Dereference the window
		// For multiple windows store them in an array
		mainWindow = undefined
	})

	const dashboardUrl = `http://127.0.0.1:${config.get('apiPort')}/index.html`
	await global.win.loadURL(dashboardUrl)

	return global.win
}

// Prevent multiple instances of the app
if (!app.requestSingleInstanceLock()) {
	app.quit()
}

app.on('second-instance', () => {
	if (mainWindow) {
		if (mainWindow.isMinimized()) {
			mainWindow.restore()
		}

		//mainWindow.show();
	}
})

app.on('window-all-closed', () => {
	if (!is.macos) {
		//app.quit();
	}
})

app.on('activate', async () => {
	if (!mainWindow) {
		mainWindow = await createMainWindow()
	}
})
;(async () => {
	await app.whenReady()

	const icon = nativeImage.createFromDataURL(config.get('icon'))
	global.tray = new Tray(icon.resize({ width: 24, height: 24 }))
	global.tray.setToolTip('Dave Relay')

	const apiPort = config.get('apiPort')
	API.start(apiPort)
	screenDeckSatellite.init({ apiPort })
	global.broadcastTriggers = function () {
		API.broadcastTriggers()
	}
	global.broadcastLogsCleared = function () {
		API.broadcastLogsCleared()
	}

	// IPC: ScreenDeck (Built-in Satellite)
	ipcMain.handle('screendeck:getStatus', async () => {
		return screenDeckSatellite.getStatus()
	})
	ipcMain.handle('screendeck:openAll', async () => {
		screenDeckSatellite.openAllWindows()
		return { success: true }
	})
	ipcMain.handle('screendeck:reconnect', async () => {
		screenDeckSatellite.reconnect()
		return screenDeckSatellite.getStatus()
	})
	ipcMain.handle('screendeck:getDevice', async (_e, { deviceId }) => {
		if (typeof deviceId !== 'string') return null
		return screenDeckSatellite.devices.get(deviceId) || null
	})
	ipcMain.on('screendeck:key', (_e, payload) => {
		try {
			if (!payload) return
			const deviceId = typeof payload.deviceId === 'string' ? payload.deviceId : ''
			const x = payload.x
			const y = payload.y
			const pressed = !!payload.pressed
			if (!deviceId) return
			screenDeckSatellite.keyPress(deviceId, x, y, pressed)
		} catch (_err) {
			// ignore
		}
	})

	mainWindow = await createMainWindow()
	Menu.setApplicationMenu(require('./menu.js'))

})()

process.on('uncaughtException', function (err) {
	notifications.showNotification({
		title: 'Uncaught Exception',
		body: `The following uncaught exception has occured:\n\n${err.toString()}\n\nThe program will exit in 10 seconds.`,
		showNotification: true,
	})

	setTimeout(process.exit(1), 10000)
})
