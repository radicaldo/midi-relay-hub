'use strict'

/**
 * Lightweight logger for Midi-Relay-Hub
 * No dependencies - just a thin wrapper around console with log levels
 */

const config = require('./config.js')

const LEVELS = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
	silent: 4,
}

// Get log level from config or default to 'info'
function getLogLevel() {
	const level = config.get('logLevel') || 'info'
	return LEVELS[level] ?? LEVELS.info
}

function formatMessage(level, context, message, data) {
	const timestamp = new Date().toISOString()
	const prefix = context ? `[${context}]` : ''
	return { timestamp, level, context, message, data }
}

function shouldLog(level) {
	return LEVELS[level] >= getLogLevel()
}

const logger = {
	debug(context, message, data) {
		if (shouldLog('debug')) {
			const formatted = formatMessage('debug', context, message, data)
			console.log(`[DEBUG] ${formatted.timestamp} ${context ? `[${context}]` : ''} ${message}`, data || '')
		}
	},

	info(context, message, data) {
		if (shouldLog('info')) {
			const formatted = formatMessage('info', context, message, data)
			console.log(`[INFO] ${formatted.timestamp} ${context ? `[${context}]` : ''} ${message}`, data || '')
		}
	},

	warn(context, message, data) {
		if (shouldLog('warn')) {
			const formatted = formatMessage('warn', context, message, data)
			console.warn(`[WARN] ${formatted.timestamp} ${context ? `[${context}]` : ''} ${message}`, data || '')
		}
	},

	error(context, message, data) {
		if (shouldLog('error')) {
			const formatted = formatMessage('error', context, message, data)
			console.error(`[ERROR] ${formatted.timestamp} ${context ? `[${context}]` : ''} ${message}`, data || '')
		}
	},

	// Simple console.log passthrough for backward compatibility
	log(...args) {
		if (shouldLog('info')) {
			console.log(...args)
		}
	},

	// Set log level at runtime
	setLevel(level) {
		if (LEVELS[level] !== undefined) {
			config.set('logLevel', level)
		}
	},

	// Get current level
	getLevel() {
		return Object.keys(LEVELS).find((key) => LEVELS[key] === getLogLevel()) || 'info'
	},

	LEVELS,
}

module.exports = logger
