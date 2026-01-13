'use strict'

const path = require('path')
const fs = require('fs')
const Store = require('electron-store')

function loadIconDataUrl() {
    try {
        const iconPath = path.join(__dirname, 'static', 'icon.png')
        const buf = fs.readFileSync(iconPath)
        return `data:image/png;base64,${buf.toString('base64')}`
    } catch (_) {
        // 1x1 transparent PNG
        return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6X9nGQAAAAASUVORK5CYII='
    }
}

module.exports = new Store({
    name: 'midi-relay-hub',
    defaults: {
        apiPort: 8090,
        allowControl: true,
        allowRescan: true,
        allowNotifications: true,
        allowedEvents: [],
        showLicense: false,
        logLevel: 'info',
        httpTimeout: 5000,

        disabledInputs: [],
        profiles: {},
        triggers: [],

        appUserModelId: 'com.radicaldo.midi-relay-hub',
        supportUrl: 'https://www.github.com/radicaldo',
        icon: loadIconDataUrl(),

        screenDeck: {
            companionHost: '127.0.0.1',
            companionPort: 16622,
            emulatorUrl: '',
            devices: [],
        },
    },
})
