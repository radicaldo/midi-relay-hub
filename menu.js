'use strict'
const path = require('path')
const fs = require('fs')
const { app, Menu, shell, dialog } = require('electron')
const { is, appMenu, aboutMenuItem, openUrlMenuItem, openNewGitHubIssue, debugInfo } = require('electron-util')
const config = require('./config.js')
const util = require('./util.js')

const showPreferences = () => {
	// Show the app's preferences here
}

const getDashboardUrl = () => {
	return `http://127.0.0.1:${config.get('apiPort')}/index.html`
}

const getDashboardProfilesUrl = () => {
	return `${getDashboardUrl()}#panelProfiles`
}

const triggersSubmenu = [
	{
		label: 'Open Dashboard in Browser',
		accelerator: is.macos ? 'Command+O' : 'Control+O',
		click() {
			shell.openExternal(getDashboardUrl())
		},
	},
	{
		label: 'Reload Dashboard',
		accelerator: is.macos ? 'Command+R' : 'Control+R',
		click() {
			if (global.win) {
				global.win.reload()
			}
		},
	},
	{ type: 'separator' },
	{
		label: 'Refresh MIDI Ports',
		accelerator: is.macos ? 'Command+Shift+R' : 'Control+Shift+R',
		click() {
			if (global.refreshPorts) {
				global.refreshPorts()
			}
		},
	},
	{ type: 'separator' },
	{
		label: 'Export Triggers…',
		accelerator: is.macos ? 'Command+E' : 'Control+E',
		async click() {
			const result = await dialog.showSaveDialog({
				title: 'Export Triggers',
				defaultPath: 'dave-relay-triggers.json',
				filters: [{ name: 'JSON', extensions: ['json'] }],
			})
			if (result.canceled || !result.filePath) return
			const triggers = util.getTriggers()
			await fs.promises.writeFile(result.filePath, JSON.stringify(triggers, null, 2), 'utf8')
		},
	},
	{
		label: 'Import Triggers…',
		accelerator: is.macos ? 'Command+I' : 'Control+I',
		async click() {
			const result = await dialog.showOpenDialog({
				title: 'Import Triggers',
				properties: ['openFile'],
				filters: [{ name: 'JSON', extensions: ['json'] }],
			})
			if (result.canceled || !result.filePaths || result.filePaths.length === 0) return

			const raw = await fs.promises.readFile(result.filePaths[0], 'utf8')
			let imported
			try {
				imported = JSON.parse(raw)
			} catch {
				dialog.showErrorBox('Import Failed', 'That file does not contain valid JSON.')
				return
			}

			if (!Array.isArray(imported)) {
				dialog.showErrorBox('Import Failed', 'Expected a JSON array of triggers.')
				return
			}

			for (const trigger of imported) {
				if (trigger && typeof trigger === 'object') {
					util.addTrigger(trigger)
				}
			}

			if (global.broadcastTriggers) {
				global.broadcastTriggers()
			}
		},
	},
	{ type: 'separator' },
	{
		label: 'Clear Activity Log',
		click() {
			global.MIDIRelaysLog = []
			if (global.broadcastLogsCleared) {
				global.broadcastLogsCleared()
			}
		},
	},
]

const profilesSubmenu = [
	{
		label: 'Manage Profiles in Dashboard',
		click() {
			shell.openExternal(getDashboardProfilesUrl())
		},
	},
	{ type: 'separator' },
	{
		label: 'Save Current Triggers as “Default”',
		async click() {
			try {
				util.saveProfile('Default')
				dialog.showMessageBox({
					type: 'info',
					title: 'Profile Saved',
					message: 'Saved current triggers as profile “Default”.',
				})
			} catch (err) {
				dialog.showErrorBox('Profile Save Failed', err && err.message ? err.message : String(err))
			}
		},
	},
	{
		label: 'Load Profile “Default”',
		async click() {
			try {
				util.loadProfile('Default')
				if (global.broadcastTriggers) global.broadcastTriggers()
				dialog.showMessageBox({
					type: 'info',
					title: 'Profile Loaded',
					message: 'Loaded profile “Default”.',
				})
			} catch (err) {
				dialog.showErrorBox('Profile Load Failed', err && err.message ? err.message : String(err))
			}
		},
	},
]

const helpSubmenu = [
	openUrlMenuItem({
		label: 'Website',
		url: 'https://github.com/josephdadams/beacon',
	}),
	openUrlMenuItem({
		label: 'Source Code',
		url: 'https://github.com/josephdadams/beacon',
	}),
	{
		label: 'Report an Issue…',
		click() {
			const body = `
<!-- Please succinctly describe your issue and steps to reproduce it. -->


---

${debugInfo()}`

			openNewGitHubIssue({
				user: 'josephdadams',
				repo: 'midi-relay',
				body,
			})
		},
	},
]

if (!is.macos) {
	helpSubmenu.push(
		{
			type: 'separator',
		},
		aboutMenuItem({
			icon: path.join(__dirname, 'static', 'icon.png'),
			text: 'Created by Joseph Adams',
		}),
	)
}

const debugSubmenu = [
	{
		label: 'Show Settings',
		click() {
			config.openInEditor()
		},
	},
	{
		label: 'Show App Data',
		click() {
			shell.openItem(app.getPath('userData'))
		},
	},
	{
		type: 'separator',
	},
	{
		label: 'Delete Settings',
		click() {
			config.clear()
			app.relaunch()
			app.quit()
		},
	},
	{
		label: 'Delete App Data',
		click() {
			shell.moveItemToTrash(app.getPath('userData'))
			app.relaunch()
			app.quit()
		},
	},
]

const macosTemplate = [
	appMenu([
		{
			label: 'Preferences…',
			accelerator: 'Command+,',
			click() {
				showPreferences()
			},
		},
	]),
	{
		role: 'fileMenu',
		submenu: [
			{
				label: 'Custom',
			},
			{
				type: 'separator',
			},
			{
				role: 'close',
			},
		],
	},
	{
		label: 'Triggers',
		submenu: triggersSubmenu,
	},
	{
		label: 'Profiles',
		submenu: profilesSubmenu,
	},
	{
		role: 'editMenu',
	},
	{
		role: 'viewMenu',
	},
	{
		role: 'windowMenu',
	},
	{
		role: 'help',
		submenu: helpSubmenu,
	},
]

// Linux and Windows
const otherTemplate = [
	{
		role: 'fileMenu',
		submenu: [
			{
				label: 'Custom',
			},
			{
				type: 'separator',
			},
			{
				label: 'Settings',
				accelerator: 'Control+,',
				click() {
					showPreferences()
				},
			},
			{
				type: 'separator',
			},
			{
				role: 'quit',
			},
		],
	},
	{
		label: 'Triggers',
		submenu: triggersSubmenu,
	},
	{
		label: 'Profiles',
		submenu: profilesSubmenu,
	},
	{
		role: 'editMenu',
	},
	{
		role: 'viewMenu',
	},
	{
		role: 'help',
		submenu: helpSubmenu,
	},
]

const template = is.macos ? macosTemplate : otherTemplate

if (is.development) {
	template.push({
		label: 'Debug',
		submenu: debugSubmenu,
	})
}

module.exports = Menu.buildFromTemplate(template)
