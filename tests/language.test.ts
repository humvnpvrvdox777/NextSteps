import { describe, expect, test } from 'claude-code/testing'

import { lineFor } from '../hooks/mascot'
import { placedLine, voiceLabel, SUGGEST_DELAY_MS } from '../hooks/steps'
import { speakable } from '../hooks/speakable'
import { STRINGS, languageFrom } from '../hooks/strings'
import { SESSION, TURN, mountBand, world } from './fixtures'

// Every key of a nested table, as dotted paths, so that two tables can be compared key by key.
const keysOf = (value: unknown): string[] =>
  value !== null && typeof value === 'object'
    ? Object.keys(value).flatMap(key => [key, ...keysOf((value as Record<string, unknown>)[key]).map(inner => `${key}.${inner}`)])
    : []

describe('language', () => {
  test('the English and the Italian texts have the same keys, so no sentence is missing in either', () => {
    expect(keysOf(STRINGS.it)).toEqual(keysOf(STRINGS.en))
  })

  test('the option picks a language the mod has, and any other value means English', () => {
    expect([languageFrom('it'), languageFrom('en'), languageFrom('fr'), languageFrom(undefined)]).toEqual([
      'it',
      'en',
      'en',
      'en',
    ])
  })

  test('the lines and labels come in the language they are asked for, English by default', () => {
    expect(lineFor('asking', 0)).toBe('How do you want to continue?')
    expect(lineFor('asking', 0, 'prompt', STRINGS.it)).toBe('Come vuoi proseguire?')
    expect(voiceLabel(true, 'ready')).toBe('Voice:')
    expect(voiceLabel(true, 'ready', STRINGS.it.voice)).toBe('Voce:')
    expect(placedLine(1, 3, 'clipboard', STRINGS.it.placed)).toBe(
      'Negli appunti: 1 di 3. Incollali nel prompt con Ctrl+V, poi premi Invio.',
    )
  })

  test('the voice says the phrases of its language, in place of what it cannot read out', () => {
    const text = '```\nx\n```'

    expect(speakable(text).join(' ')).toContain('Code block.')
    expect(speakable(text, STRINGS.it.spoken).join(' ')).toContain('Blocco di codice.')
  })

  test('English is the default: the band says it in English, and the command is /voice', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    expect(await band.find({ type: 'Text', text: 'How do you want to continue?' })).toBeDefined()
    expect((await band.find({ type: 'Button', key: 'discuss' }))?.props.label).toBe('Talk it over')
    expect(w.seen.commands).toEqual(['voice'])
  })

  test('the language option picks Italian: the band says it in Italian, and the command is /voce', { options: { language: 'it' } }, async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    expect(await band.find({ type: 'Text', text: 'Come vuoi proseguire?' })).toBeDefined()
    expect((await band.find({ type: 'Button', key: 'discuss' }))?.props.label).toBe('Discutiamone')
    expect(w.seen.commands).toEqual(['voce'])
  })
})
