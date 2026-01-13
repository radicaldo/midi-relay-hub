;(function () {
	const { ipcRenderer } = window.require('electron')

	const params = new URLSearchParams(window.location.search)
	const deviceId = params.get('deviceId') || ''

	const titleEl = document.getElementById('title')
	const metaEl = document.getElementById('meta')
	const gridEl = document.getElementById('grid')

	function clampInt(v, min, max, fallback) {
		const n = Number.parseInt(String(v), 10)
		if (!Number.isFinite(n)) return fallback
		return Math.max(min, Math.min(max, n))
	}

	function setMeta(dev) {
		if (titleEl) titleEl.textContent = `ScreenDeck: ${dev.id}`
		if (metaEl) metaEl.textContent = `${dev.columns}×${dev.rows} • bitmap ${dev.bitmap}`
	}

	function keyDomId(x, y) {
		return `key_${x}_${y}`
	}

	function makeKey(x, y, size, disableButtonPresses) {
		const el = document.createElement('div')
		el.className = 'key'
		el.id = keyDomId(x, y)
		el.style.width = size + 'px'
		el.style.height = size + 'px'

		const img = document.createElement('img')
		img.draggable = false
		img.style.display = 'none'
		el.appendChild(img)

		const label = document.createElement('div')
		label.className = 'label'
		el.appendChild(label)

		const press = (pressed) => {
			if (disableButtonPresses) return
			ipcRenderer.send('screendeck:key', { deviceId, x, y, pressed })
			if (pressed) el.classList.add('pressed')
			else el.classList.remove('pressed')
		}

		el.addEventListener('mousedown', () => press(true))
		el.addEventListener('mouseup', () => press(false))
		el.addEventListener('mouseleave', () => press(false))

		// Touch
		el.addEventListener('touchstart', (e) => {
			e.preventDefault()
			press(true)
		})
		el.addEventListener('touchend', (e) => {
			e.preventDefault()
			press(false)
		})

		return el
	}

	function applyDraw(x, y, state) {
		const el = document.getElementById(keyDomId(x, y))
		if (!el) return
		const img = el.querySelector('img')
		const label = el.querySelector('.label')

		if (state && state.imageDataUrl) {
			img.src = state.imageDataUrl
			img.style.display = ''
		} else {
			img.removeAttribute('src')
			img.style.display = 'none'
		}

		if (state && typeof state.text === 'string' && state.text.trim()) {
			label.textContent = state.text
		} else {
			label.textContent = ''
		}

		if (state && typeof state.color === 'string' && state.color.trim()) {
			label.style.color = state.color
		} else {
			label.style.color = ''
		}
	}

	function clearAll(dev) {
		for (let y = 0; y < dev.rows; y++) {
			for (let x = 0; x < dev.columns; x++) {
				applyDraw(x, y, {})
			}
		}
	}

	async function init() {
		if (!deviceId) {
			if (titleEl) titleEl.textContent = 'ScreenDeck (missing deviceId)'
			return
		}

		const dev = await ipcRenderer.invoke('screendeck:getDevice', { deviceId })
		if (!dev) {
			if (titleEl) titleEl.textContent = `ScreenDeck: ${deviceId} (not configured)`
			return
		}

		setMeta(dev)

		const columns = clampInt(dev.columns, 1, 32, 8)
		const rows = clampInt(dev.rows, 1, 32, 4)
		const bitmap = clampInt(dev.bitmap, 1, 512, 72)
		const disableButtonPresses = !!dev.disableButtonPresses

		gridEl.style.gridTemplateColumns = `repeat(${columns}, ${bitmap}px)`

		gridEl.innerHTML = ''
		for (let y = 0; y < rows; y++) {
			for (let x = 0; x < columns; x++) {
				gridEl.appendChild(makeKey(x, y, bitmap, disableButtonPresses))
			}
		}

		clearAll({ columns, rows })
	}

	ipcRenderer.on('screendeck:draw', (_e, payload) => {
		if (!payload) return
		applyDraw(payload.x, payload.y, payload.state || {})
	})

	ipcRenderer.on('screendeck:clear', () => {
		ipcRenderer
			.invoke('screendeck:getDevice', { deviceId })
			.then((dev) => {
				if (dev) clearAll(dev)
			})
			.catch(() => null)
	})

	init().catch((e) => {
		if (metaEl) metaEl.textContent = e && e.message ? e.message : String(e)
	})
})()
