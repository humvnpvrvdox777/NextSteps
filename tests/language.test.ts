import { describe, expect, test } from 'claude-code/testing'

import { lineFor } from '../hooks/mascot'
import { placedLine, voiceLabel, SUGGEST_DELAY_MS } from '../hooks/steps'
import { speakable } from '../hooks/speakable'
import { detectLanguage } from '../hooks/language'
import {
  STRINGS,
  flatten,
  languageFrom,
  languageKeyFor,
  languageOptionFrom,
  rebuild,
  translatableKeys,
  translationFrom,
} from '../hooks/strings'
import { SESSION, SUBMIT, TURN, completed, mountBand, world } from './fixtures'

// Every key of a nested table, as dotted paths, so that two tables can be compared key by key.
const keysOf = (value: unknown): string[] =>
  value !== null && typeof value === 'object'
    ? Object.keys(value).flatMap(key => [key, ...keysOf((value as Record<string, unknown>)[key]).map(inner => `${key}.${inner}`)])
    : []

describe('language', () => {
  test('the English and the Italian texts have the same keys, so no sentence is missing in either', () => {
    expect(keysOf(STRINGS.it)).toEqual(keysOf(STRINGS.en))
    expect(keysOf(STRINGS.ro)).toEqual(keysOf(STRINGS.en))
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

  test('auto starts in English: the band says it in English, and both command names are registered', { options: { language: 'auto' } }, async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    expect(await band.find({ type: 'Text', text: 'How do you want to continue?' })).toBeDefined()
    expect((await band.find({ type: 'Button', key: 'discuss' }))?.props.label).toBe('Talk it over')
    expect(w.seen.commands).toEqual(['voice', 'voce'])
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

  test('auto is the default, a fixed language is kept, and any other value means auto', () => {
    expect([languageOptionFrom('it'), languageOptionFrom('en'), languageOptionFrom('auto'), languageOptionFrom('fr'), languageOptionFrom(undefined)]).toEqual([
      'it',
      'en',
      'auto',
      'auto',
      'auto',
    ])
  })

  test('English and Italian function words settle a message; anything else is left to the model', () => {
    expect(detectLanguage('Can you explain this error to me?')).toBe('en')
    expect(detectLanguage('Non so cosa fare, ma ho un dubbio')).toBe('it')
    expect(detectLanguage('Puoi spiegarmi come funziona questo errore?')).toBe('it')
    expect(detectLanguage('Ciao, ti serve una mano?')).toBe('it')
    expect(detectLanguage('ok')).toBeNull()
    expect(detectLanguage('Poți să-mi explici asta?')).toBeNull()
  })

  test('a translated sentence that drops a placeholder is replaced by the English one', () => {
    const english = flatten(STRINGS.en)
    const flat = translationFrom(english, {
      'placed.prompt': 'Dans le prompt : sans nombre.',
      ask: 'Comment voulez-vous continuer ?',
    })

    expect(flat['placed.prompt']).toBe(english['placed.prompt'])
    expect(rebuild(flat).ask).toBe('Comment voulez-vous continuer ?')
  })

  test('the name the model gives becomes the language key: a built-in code when there is one, else the lowercase name', () => {
    expect([languageKeyFor('Romanian.'), languageKeyFor('Italian'), languageKeyFor('French'), languageKeyFor('Unknown')]).toEqual([
      'ro',
      'it',
      'french',
      null,
    ])
  })

  test('under auto an Italian message makes the band Italian, and the next answer is written in Italian', { options: { language: 'auto' } }, async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.prompt.submit({ ...SUBMIT, text: 'Puoi spiegarmi come funziona questo errore?' })
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    expect(await band.find({ type: 'Text', text: 'Come vuoi proseguire?' })).toBeDefined()
    expect((await band.find({ type: 'Button', key: 'discuss' }))?.props.label).toBe('Discutiamone')
  })

  test('a fixed language ignores what the person writes: Italian under an English option keeps the band English', { options: { language: 'en' } }, async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.prompt.submit({ ...SUBMIT, text: 'Puoi spiegarmi come funziona questo errore?' })
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    expect(await band.find({ type: 'Text', text: 'How do you want to continue?' })).toBeDefined()
  })

  test('under auto a new session starts in the language the last one ended in', { options: { language: 'auto' } }, async ($, on) => {
    const w = world(on, { uiLanguage: 'it' })

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    expect(await band.find({ type: 'Text', text: 'Come vuoi proseguire?' })).toBeDefined()
  })

  // What the model answers to a request for a translation: every sentence of the English table, marked with a prefix.
  const translated = (prefix: string): string => {
    const english = flatten(STRINGS.en)

    return JSON.stringify(Object.fromEntries(translatableKeys().map(key => [key, `${prefix} ${english[key] ?? ''}`])))
  }

  test('the Romanian option gives the Romanian texts; the voice keeps the English file, as there is no Romanian voice', { options: { language: 'ro' } }, async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    expect(await band.find({ type: 'Text', text: 'Cum vrei să continui?' })).toBeDefined()
    expect((await band.find({ type: 'Button', key: 'discuss' }))?.props.label).toBe('Discutăm')
    expect(w.seen.commands).toEqual(['voce'])
  })

  test('a language with no table is named by the model and translated once; its texts are then kept', { options: { language: 'auto' } }, async ($, on) => {
    const w = world(on)

    w.queueComplete(completed('French'), completed(translated('FR')), completed('French'))
    await $.session.start(SESSION)
    await $.prompt.submit({ ...SUBMIT, text: 'Pouvez-vous m expliquer cette erreur ?' })
    await w.advance(0)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    expect(await band.find({ type: 'Text', text: 'FR How do you want to continue?' })).toBeDefined()

    // Back to English, then French again: the kept translation serves, and nothing is asked for a second one.
    await $.prompt.submit({ ...SUBMIT, text: 'Can you explain this error to me?' })
    await $.prompt.submit({ ...SUBMIT, text: 'Pouvez-vous m expliquer encore cette erreur ?' })
    await w.advance(0)

    expect(w.seen.completes).toHaveLength(3)
  })

  test('when the model cannot name or translate a language, the mod keeps the language it had', { options: { language: 'auto' } }, async ($, on) => {
    const w = world(on)

    w.queueComplete(completed('Klingon'), completed('not a translation'))
    await $.session.start(SESSION)
    await $.prompt.submit({ ...SUBMIT, text: 'Nuqneh qapla nuqDaq yIlo tlhIngan' })
    await w.advance(0)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    expect(await band.find({ type: 'Text', text: 'How do you want to continue?' })).toBeDefined()
    expect(w.seen.completes).toHaveLength(2)
  })
})
