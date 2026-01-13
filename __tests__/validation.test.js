'use strict'

require('./setup')

const midi = require('../midi.js')

describe('MIDI Validation', () => {
	describe('validateMIDIValue', () => {
		test('validates channel 0-15', () => {
			expect(midi.validateMIDIValue('channel', 0).valid).toBe(true)
			expect(midi.validateMIDIValue('channel', 15).valid).toBe(true)
			expect(midi.validateMIDIValue('channel', 7).value).toBe(7)
		})

		test('rejects invalid channel values', () => {
			expect(midi.validateMIDIValue('channel', 16).valid).toBe(false)
			expect(midi.validateMIDIValue('channel', -1).valid).toBe(false)
			expect(midi.validateMIDIValue('channel', 'abc').valid).toBe(false)
		})

		test('validates note 0-127', () => {
			expect(midi.validateMIDIValue('note', 0).valid).toBe(true)
			expect(midi.validateMIDIValue('note', 60).valid).toBe(true)
			expect(midi.validateMIDIValue('note', 127).valid).toBe(true)
		})

		test('rejects invalid note values', () => {
			expect(midi.validateMIDIValue('note', 128).valid).toBe(false)
			expect(midi.validateMIDIValue('note', -1).valid).toBe(false)
		})

		test('validates velocity 0-127', () => {
			expect(midi.validateMIDIValue('velocity', 0).valid).toBe(true)
			expect(midi.validateMIDIValue('velocity', 127).valid).toBe(true)
		})

		test('validates controller 0-127', () => {
			expect(midi.validateMIDIValue('controller', 0).valid).toBe(true)
			expect(midi.validateMIDIValue('controller', 127).valid).toBe(true)
		})

		test('validates pitchbend 0-16383', () => {
			expect(midi.validateMIDIValue('pitchbend', 0).valid).toBe(true)
			expect(midi.validateMIDIValue('pitchbend', 8192).valid).toBe(true)
			expect(midi.validateMIDIValue('pitchbend', 16383).valid).toBe(true)
			expect(midi.validateMIDIValue('pitchbend', 16384).valid).toBe(false)
		})

		test('allows wildcard when specified', () => {
			expect(midi.validateMIDIValue('channel', '*', true).valid).toBe(true)
			expect(midi.validateMIDIValue('channel', '*', true).value).toBe('*')
			expect(midi.validateMIDIValue('channel', '*', false).valid).toBe(false)
		})

		test('returns error for unknown parameter', () => {
			const result = midi.validateMIDIValue('unknown', 5)
			expect(result.valid).toBe(false)
			expect(result.error).toContain('Unknown MIDI parameter')
		})
	})

	describe('validateMIDIObject', () => {
		test('validates a complete noteon object', () => {
			const midiObj = {
				midicommand: 'noteon',
				midiport: 'Test Port',
				channel: 0,
				note: 60,
				velocity: 127,
			}
			const result = midi.validateMIDIObject(midiObj)
			expect(result.valid).toBe(true)
		})

		test('requires midicommand', () => {
			const midiObj = {
				midiport: 'Test Port',
				channel: 0,
				note: 60,
			}
			const result = midi.validateMIDIObject(midiObj)
			expect(result.valid).toBe(false)
			expect(result.errors).toContain('midicommand is required')
		})

		test('requires midiport', () => {
			const midiObj = {
				midicommand: 'noteon',
				channel: 0,
				note: 60,
			}
			const result = midi.validateMIDIObject(midiObj)
			expect(result.valid).toBe(false)
			expect(result.errors).toContain('midiport is required')
		})

		test('rejects invalid midicommand', () => {
			const midiObj = {
				midicommand: 'invalid',
				midiport: 'Test Port',
				channel: 0,
			}
			const result = midi.validateMIDIObject(midiObj)
			expect(result.valid).toBe(false)
			expect(result.errors[0]).toContain('Invalid midicommand')
		})

		test('validates CC requires controller', () => {
			const midiObj = {
				midicommand: 'cc',
				midiport: 'Test Port',
				channel: 0,
			}
			const result = midi.validateMIDIObject(midiObj)
			expect(result.valid).toBe(false)
			expect(result.errors).toContain('controller is required for cc')
		})

		test('validates complete CC object', () => {
			const midiObj = {
				midicommand: 'cc',
				midiport: 'Test Port',
				channel: 0,
				controller: 7,
				value: 100,
			}
			const result = midi.validateMIDIObject(midiObj)
			expect(result.valid).toBe(true)
		})

		test('handles null input', () => {
			const result = midi.validateMIDIObject(null)
			expect(result.valid).toBe(false)
			expect(result.errors).toContain('MIDI object is required')
		})
	})

	describe('MIDI_LIMITS constants', () => {
		test('exports MIDI_LIMITS', () => {
			expect(midi.MIDI_LIMITS).toBeDefined()
			expect(midi.MIDI_LIMITS.channel).toEqual({ min: 0, max: 15, name: 'Channel' })
			expect(midi.MIDI_LIMITS.note).toEqual({ min: 0, max: 127, name: 'Note' })
		})

		test('exports VALID_MIDI_COMMANDS', () => {
			expect(midi.VALID_MIDI_COMMANDS).toBeDefined()
			expect(midi.VALID_MIDI_COMMANDS).toContain('noteon')
			expect(midi.VALID_MIDI_COMMANDS).toContain('noteoff')
			expect(midi.VALID_MIDI_COMMANDS).toContain('cc')
			expect(midi.VALID_MIDI_COMMANDS).toContain('pc')
		})
	})
})

describe('Trigger Validation', () => {
	describe('validateTriggerObject', () => {
		test('validates a complete HTTP trigger', () => {
			const trigger = {
				midicommand: 'noteon',
				channel: 0,
				note: 60,
				actiontype: 'http',
				url: 'http://example.com/webhook',
			}
			const result = midi.validateTriggerObject(trigger)
			expect(result.valid).toBe(true)
		})

		test('requires midicommand for trigger', () => {
			const trigger = {
				channel: 0,
				note: 60,
				actiontype: 'http',
				url: 'http://example.com/webhook',
			}
			const result = midi.validateTriggerObject(trigger)
			expect(result.valid).toBe(false)
			expect(result.errors).toContain('midicommand is required')
		})

		test('allows wildcard channel in triggers', () => {
			const trigger = {
				midicommand: 'noteon',
				channel: '*',
				note: 60,
				actiontype: 'http',
				url: 'http://example.com/webhook',
			}
			const result = midi.validateTriggerObject(trigger)
			expect(result.valid).toBe(true)
		})

		test('validates HTTP trigger requires URL', () => {
			const trigger = {
				midicommand: 'noteon',
				channel: 0,
				note: 60,
				actiontype: 'http',
			}
			const result = midi.validateTriggerObject(trigger)
			expect(result.valid).toBe(false)
			expect(result.errors).toContain('url is required for http action')
		})
	})
})
