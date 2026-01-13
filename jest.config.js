'use strict'

module.exports = {
	testEnvironment: 'node',
	testMatch: ['**/__tests__/**/*.test.js'],
	collectCoverageFrom: ['*.js', '!jest.config.js', '!index.js', '!contextmenu.js', '!menu.js', '!notifications.js'],
	coveragePathIgnorePatterns: ['/node_modules/', '/build/', '/static/', '/__tests__/'],
	modulePathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/build/'],
	testPathIgnorePatterns: ['/node_modules/', '/build/'],
	verbose: true,
}
