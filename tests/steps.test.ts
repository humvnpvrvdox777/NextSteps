import { describe, expect, test } from 'claude-code/testing'

import {
  CLIPBOARD_ARGV,
  MAX_ANSWER_CHARS,
  MAX_REQUEST_CHARS,
  MAX_STEP_CHARS,
  STEP_CRITERIA,
  STEPS_MAX_TOKENS,
  STEPS_MODEL,
  VOICE_START_TIMEOUT_MS,
  buildPrompt,
  fillFor,
  handoffFor,
  parseSteps,
  placedLine,
  shouldSuggest,
  voiceLabel,
} from '../hooks/steps'
import { isWhole } from './unicode'

const ANSWER = 'Done.'

describe('steps', () => {
  test('the voice gets at least a minute to start: its first load took 19 s on a busy machine', () => {
    expect(VOICE_START_TIMEOUT_MS).toBeGreaterThanOrEqual(60000)
  })

  test('the Voice button says what the voice is doing', () => {
    expect(voiceLabel(false, 'off')).toBe('Voice:')
    expect(voiceLabel(false, 'ready')).toBe('Voice:')
    expect(voiceLabel(true, 'ready')).toBe('Voice:')
    expect(voiceLabel(true, 'starting')).toBe('Voice: starting…')
    expect(voiceLabel(true, 'off')).toBe('Voice: starting…')
    expect(voiceLabel(true, 'failed')).toBe('Voice: unavailable')
  })

  test('shouldSuggest accepts a main-loop answer, however short', () => {
    expect(shouldSuggest({ reason: 'answer', answer: ANSWER })).toBe(true)
    expect(shouldSuggest({ reason: 'answer', answer: '  Ok.  ' })).toBe(true)
  })

  test('shouldSuggest rejects a subagent turn', () => {
    expect(shouldSuggest({ reason: 'answer', agentId: 'a1', answer: ANSWER })).toBe(false)
  })

  test('shouldSuggest rejects an interrupted or failed turn', () => {
    expect(shouldSuggest({ reason: 'aborted', answer: ANSWER })).toBe(false)
    expect(shouldSuggest({ reason: 'error', answer: ANSWER })).toBe(false)
  })

  test('parseSteps reads exactly three lines inside the tags', () => {
    expect(parseSteps('<steps>\nOne\nTwo\nThree\n</steps>')).toEqual(['One', 'Two', 'Three'])
  })

  test('parseSteps strips numbering, bullets and quotes', () => {
    const reply = '<steps>\n1. One\n- Two\n"Three"\n</steps>'

    expect(parseSteps(reply)).toEqual(['One', 'Two', 'Three'])
  })

  test('parseSteps unwraps a line wrapped in a pair of quotes of any usual kind', () => {
    const reply = "<steps>\n'One'\n`Two`\n“Three”\n</steps>"

    expect(parseSteps(reply)).toEqual(['One', 'Two', 'Three'])
    expect(parseSteps('<steps>\n"Run `npm test`"\n‘Two’\nThree\n</steps>')).toEqual(['Run `npm test`', 'Two', 'Three'])
  })

  test('parseSteps keeps a quote that belongs to the step: a trailing code span, a quoted word, an apostrophe', () => {
    const reply = '<steps>\nRun the suite with `npm test`\nRename it to "final"\nCheck what\'s left\n</steps>'

    expect(parseSteps(reply)).toEqual(['Run the suite with `npm test`', 'Rename it to "final"', "Check what's left"])
  })

  test('parseSteps leaves a line alone when the quote at one end has no partner at the other', () => {
    expect(parseSteps('<steps>\n"Say "hi" now"\n`code` and more\nTwo `x`\n</steps>')).toEqual(['"Say "hi" now"', '`code` and more', 'Two `x`'])
    expect(parseSteps('<steps>\n"Open at the start\nClosed at the end"\nOne\n</steps>')).toEqual(['"Open at the start', 'Closed at the end"', 'One'])
  })

  test('parseSteps trims what a pair of quotes held apart from the words', () => {
    expect(parseSteps('<steps>\n"  One  "\nTwo\nThree\n</steps>')).toEqual(['One', 'Two', 'Three'])
  })

  test('parseSteps ignores text around the tags', () => {
    const reply = 'Sure!\n<steps>\nOne\nTwo\nThree\n</steps>\nHope that helps.'

    expect(parseSteps(reply)).toEqual(['One', 'Two', 'Three'])
  })

  test('parseSteps drops a reply without tags', () => {
    expect(parseSteps('One\nTwo\nThree')).toEqual([])
  })

  test('parseSteps drops a reply with the wrong number of lines', () => {
    expect(parseSteps('<steps>\nOne\nTwo\n</steps>')).toEqual([])
    expect(parseSteps('<steps>\nOne\nTwo\nThree\nFour\n</steps>')).toEqual([])
  })

  test('buildPrompt carries the three roles and the answer', () => {
    const prompt = buildPrompt('The answer text')

    expect(prompt).toContain(STEP_CRITERIA)
    expect(prompt).toContain('<answer>\nThe answer text\n</answer>')
    expect(prompt).toContain('<steps></steps>')
  })

  test('buildPrompt asks for steps of at most MAX_STEP_CHARS characters', () => {
    expect(MAX_STEP_CHARS).toBe(80)
    expect(buildPrompt('The answer text')).toContain(`at most ${MAX_STEP_CHARS} characters.`)
  })

  test('buildPrompt quotes what the person asked, ahead of the answer', () => {
    const prompt = buildPrompt('The answer text', 'Fix the filter so it skips short answers')

    expect(prompt).toContain('<request>\nFix the filter so it skips short answers\n</request>')
    // The tags are named in the instructions too: compare the blocks, which start on their own line.
    expect(prompt.indexOf('\n<request>\n')).toBeLessThan(prompt.indexOf('\n<answer>\n'))
  })

  test('buildPrompt has no request section when there is no request', () => {
    expect(buildPrompt('The answer text')).not.toContain('<request>')
    expect(buildPrompt('The answer text', '   ')).not.toContain('<request>')
  })

  test('buildPrompt keeps only the start of a very long request', () => {
    const prompt = buildPrompt('The answer text', `START${'x'.repeat(MAX_REQUEST_CHARS)}END`)

    expect(prompt).toContain('START')
    expect(prompt).not.toContain('END')
  })

  test('buildPrompt keeps only the tail of a very long answer', () => {
    const prompt = buildPrompt(`HEAD${'x'.repeat(MAX_ANSWER_CHARS)}TAIL`)

    expect(prompt).toContain('TAIL')
    expect(prompt).not.toContain('HEAD')
  })

  test('buildPrompt never starts the tail of a long answer in the middle of an emoji', () => {
    // The tail is the last 6000 units: its first unit would be the low half of the emoji.
    const prompt = buildPrompt(`${'x'.repeat(10)}😀${'y'.repeat(MAX_ANSWER_CHARS - 1)}`)

    expect(isWhole(prompt)).toBe(true)
  })

  test('fillFor replaces an empty draft', () => {
    expect(fillFor('', 'Do it')).toEqual({ text: 'Do it', mode: 'replace' })
    expect(fillFor('  \n', 'Do it')).toEqual({ text: 'Do it', mode: 'replace' })
  })

  test('fillFor appends to a draft on a new line', () => {
    expect(fillFor('fix the', 'Do it')).toEqual({ text: '\nDo it', mode: 'append' })
  })

  test('placedLine says how many steps are in the prompt, and where the person still has to press Enter', () => {
    expect(placedLine(2, 3, 'prompt')).toBe('In the prompt: 2 of 3. Press Enter in the prompt to send them.')
    expect(placedLine(1, 3, 'clipboard')).toBe('On the clipboard: 1 of 3. Paste them into the prompt with Ctrl+V, then press Enter.')
  })

  test('handoffFor copies when the engine says there is no composer, or the app owns it', () => {
    expect(handoffFor('no_composer', false)).toBe('copy')
    expect(handoffFor('no_composer', true)).toBe('copy')
    expect(handoffFor(undefined, true)).toBe('copy')
  })

  test('handoffFor tells the user about a dialog, whoever owns the composer', () => {
    expect(handoffFor('dialog', false)).toBe('dialog')
    expect(handoffFor('dialog', true)).toBe('dialog')
  })

  test('handoffFor only refuses when the cause is unknown and the engine owns the composer', () => {
    expect(handoffFor(undefined, false)).toBe('refused')
  })

  test('the clipboard command reads UTF-8 text from standard input', () => {
    const command = CLIPBOARD_ARGV.join(' ')

    expect(CLIPBOARD_ARGV[0]).toBe('powershell')
    expect(command).toContain('InputEncoding')
    expect(command).toContain('Set-Clipboard')
  })
})
