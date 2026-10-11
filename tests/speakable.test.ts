import { describe, expect, test } from 'claude-code/testing'

import { CHUNK_MAX, FIRST_CHUNK_MAX, MAX_SPOKEN_CHARS, SPOKEN, sentences, speakable } from '../hooks/speakable'
import { isWhole } from './unicode'

const squash = (text: string) => text.replace(/\s+/g, ' ').trim()
const withinLimits = (chunks: readonly string[]) =>
  chunks.every((chunk, index) => chunk.length > 0 && chunk === chunk.trim() && chunk.length <= (index === 0 ? FIRST_CHUNK_MAX : CHUNK_MAX))

const PROSE =
  'Ho aggiornato il filtro, quindi le risposte brevi non vengono più lette, e i test coprono i tre ruoli in ordine. ' +
  'Il passo successivo è la verifica: eseguo la suite completa, controllo i tipi, e poi guardo il risultato insieme a te. ' +
  'Se qualcosa non torna, lo correggo subito e rilancio tutto, senza saltare nessun controllo. Fine.'

const ANSWER = [
  '# Risultato',
  '',
  'Ho **corretto** il filtro in `hooks/steps.ts` e aggiunto i test; vedi [la guida](https://example.com/guida) per i dettagli.',
  '',
  '## Cosa cambia',
  '',
  '- Le risposte sotto 80 caratteri non generano suggerimenti',
  '- Un turno interrotto non genera suggerimenti',
  '1. Esegui la suite',
  '2) Leggi il risultato',
  '',
  '```ts',
  'export const shouldSuggest = (turn: TurnEnd) => turn.answer.length >= 80',
  '```',
  '',
  '| file | stato |',
  '|------|-------|',
  '| steps.ts | ok |',
  '',
  '> Nota: il commit 9f2c1ab7d3e4f5a6b7c8 è locale.',
  '',
  '---',
  '',
  'Il file è in C:\\Users\\alice\\.claude\\dev-mods\\next-steps\\hooks\\steps.ts e funziona. Ecc. altro.',
].join('\n')

describe('speakable', () => {
  test('a plain paragraph becomes sentence chunks, the first short enough to start speech early', () => {
    const text = 'Ho aggiornato il filtro. Ora salta le risposte brevi, e i test coprono i tre ruoli. Tutto passa.'
    const chunks = speakable(text)

    expect(chunks).toEqual(['Ho aggiornato il filtro.', 'Ora salta le risposte brevi, e i test coprono i tre ruoli. Tutto passa.'])
    expect(chunks[0]!.length).toBeLessThanOrEqual(FIRST_CHUNK_MAX)
  })

  test('chunks respect their limits and keep every word, in order', () => {
    const chunks = speakable(PROSE)

    expect(withinLimits(chunks)).toBe(true)
    expect(squash(chunks.join(' '))).toBe(squash(PROSE))
    expect(chunks.length).toBeGreaterThan(2)
  })

  test('a long sentence is split at commas first', () => {
    const sentence =
      'Prima controllo i tipi del modulo, poi eseguo i test della suite completa, quindi rileggo il risultato con calma, ' +
      'e infine ti dico cosa ho trovato, senza saltare nessun passaggio importante.'
    const chunks = speakable(sentence)

    expect(withinLimits(chunks)).toBe(true)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.slice(0, -1).every(chunk => /[,;:]$/.test(chunk))).toBe(true)
    expect(squash(chunks.join(' '))).toBe(sentence)
  })

  test('with no comma to split at, a sentence is split between words', () => {
    const sentence = Array.from({ length: 60 }, (_, index) => `parola${index}`).join(' ')
    const chunks = speakable(sentence)

    expect(withinLimits(chunks)).toBe(true)
    expect(squash(chunks.join(' '))).toBe(`${sentence}.`)
  })

  test('a word longer than a chunk is cut rather than break the limit, and no chunk is only a full stop', () => {
    const word = 'x'.repeat(300)
    const chunks = speakable(word)

    expect(withinLimits(chunks)).toBe(true)
    expect(chunks.join('')).toBe(word)
    expect(chunks.every(chunk => /[a-z0-9]/.test(chunk))).toBe(true)
  })

  test('headings, list items and numbered items become sentences with a full stop', () => {
    const text = '# Piano\n\n- Scrivere i test\n- Eseguire i test\n\n1. Primo\n2) Secondo'

    expect(speakable(text).join(' ')).toBe('Piano. Scrivere i test. Eseguire i test. Primo. Secondo.')
  })

  test('a fenced code block is one phrase however long, and its content is never spoken', () => {
    const text = 'Ecco:\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\nFatto.'
    const spoken = speakable(text).join(' ')

    expect(spoken).toBe(`Ecco: ${SPOKEN.code} Fatto.`)
    expect(spoken).not.toContain('const')
  })

  test('each code block is one phrase, tilde fences and an unclosed fence too', () => {
    const text = 'Uno.\n\n```\na\n```\n\nDue.\n\n~~~\nb\n~~~\n\nTre.\n\n```\nsenza chiusura'
    const spoken = speakable(text).join(' ')

    expect(spoken).toBe(`Uno. ${SPOKEN.code} Due. ${SPOKEN.code} Tre. ${SPOKEN.code}`)
  })

  test('an indented block is code, but an indented continuation of a list item is text', () => {
    expect(speakable('Esempio\n\n    npm install\n    npm test\n\nFine').join(' ')).toBe(`Esempio. ${SPOKEN.code} Fine.`)
    expect(speakable('- primo punto\n\n    che continua qui\n\nFine').join(' ')).toBe('primo punto. che continua qui. Fine.')
  })

  test('a table is one phrase', () => {
    const text = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nDopo.'

    expect(speakable(text).join(' ')).toBe(`${SPOKEN.table} Dopo.`)
  })

  test('a pipe in prose is not a table', () => {
    expect(speakable('Usa a | b come OR logico.\nPoi basta.').join(' ')).toBe('Usa a | b come OR logico. Poi basta.')
  })

  test('a blockquote is read as text and a horizontal rule is dropped', () => {
    expect(speakable('> Nota importante\n> seconda riga').join(' ')).toBe('Nota importante seconda riga.')
    expect(speakable('Uno.\n\n---\n\nDue.\n\n***\n\nTre.').join(' ')).toBe('Uno. Due. Tre.')
  })

  test('a rule under a line of text ends that paragraph', () => {
    expect(speakable('Prima riga\n---\nSeconda riga').join(' ')).toBe('Prima riga. Seconda riga.')
  })

  test('an early comma does not leave a tiny first chunk behind', () => {
    const text = `Sì, ${Array.from({ length: 30 }, (_, index) => `parola${index}`).join(' ')}`
    const chunks = speakable(text)

    expect(withinLimits(chunks)).toBe(true)
    expect(chunks[0]!.length).toBeGreaterThan(20)
  })

  test('a link keeps its text, an image is dropped and a bare url becomes a phrase', () => {
    const text = 'Vedi [la guida](https://x.dev/guida) e ![logo](a.png) qui https://example.com/path?q=1 ok'

    expect(speakable(text).join(' ')).toBe(`Vedi la guida e qui ${SPOKEN.link} ok.`)
    expect(speakable('Apri <https://x.dev> ora').join(' ')).toBe(`Apri ${SPOKEN.link} ora.`)
    expect(speakable('Apri www.example.com/a ora').join(' ')).toBe(`Apri ${SPOKEN.link} ora.`)
  })

  test('a long path or hash is described, a short one is read as it is', () => {
    expect(speakable('Modifica C:\\Users\\alice\\.claude\\dev-mods\\next-steps\\hooks\\register.tsx ora').join(' ')).toBe(
      `Modifica ${SPOKEN.path} ora.`,
    )
    expect(speakable('Modifica src/a.ts ora').join(' ')).toBe('Modifica src/a.ts ora.')
    expect(speakable('Il commit 9f2c1ab7d3e4f5a6b7c8 è locale').join(' ')).toBe(`Il commit ${SPOKEN.id} è locale.`)
    expect(speakable('Id 123e4567-e89b-12d3-a456-426614174000 trovato').join(' ')).toBe(`Id ${SPOKEN.id} trovato.`)
    expect(speakable('Il totale è 1234567890123 euro').join(' ')).toBe('Il totale è 1234567890123 euro.')
  })

  test('a path that holds an identifier is still one path', () => {
    const text = 'Il file è in C:\\Users\\alice\\dev-mods\\0123abcd-0123-4567-89ab-0123456789ab\\next-steps\\speaker.py, ecc.'

    expect(speakable(text).join(' ')).toBe(`Il file è in ${SPOKEN.path}, ecc.`)
  })

  test('inline code, bold, italics and strike-through lose their marks but keep the text', () => {
    expect(speakable('Usa `npm test` e **non** _mai_ il ~~vecchio~~ comando.').join(' ')).toBe('Usa npm test e non mai il vecchio comando.')
    expect(speakable('La variabile my_var_name resta intera e a*b pure.').join(' ')).toBe('La variabile my_var_name resta intera e a*b pure.')
  })

  test('sentences are split at full stops, question and exclamation marks, not after Italian abbreviations or initials', () => {
    expect(sentences('Vedi es. il caso e ecc. altro. Poi basta. Davvero? Sì! Fine…')).toEqual([
      'Vedi es. il caso e ecc. altro.',
      'Poi basta.',
      'Davvero?',
      'Sì!',
      'Fine…',
    ])
    expect(sentences('Ha scritto A. Rossi nel n. 5 del 3.5 percento. Poi basta.')).toEqual([
      'Ha scritto A. Rossi nel n. 5 del 3.5 percento.',
      'Poi basta.',
    ])
    expect(sentences('Disse "va bene." Poi uscì (non so dove). Fine.')).toEqual(['Disse "va bene."', 'Poi uscì (non so dove).', 'Fine.'])
  })

  test('nothing to say gives no chunks', () => {
    for (const text of ['', '  \n  ', '---', '===', '![x](y)', '<!-- nota -->']) {
      expect(speakable(text)).toEqual([])
    }
  })

  test('a long run with no space is cut between characters, never inside an emoji', () => {
    // The first cut falls at 60 units, between the halves of the 30th emoji; letters at the end keep the tail worth saying.
    const word = `x${'😀'.repeat(150)}yz`
    const chunks = speakable(word)

    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.every(isWhole)).toBe(true)
    expect(withinLimits(chunks)).toBe(true)
    // Nothing is lost between the chunks; the text only gains the full stop every spoken unit ends with.
    expect(chunks.join('')).toBe(`${word}.`)
  })

  test('a very long answer is read up to a limit, then the voice says that the rest is in the text', () => {
    const answer = 'Una frase che si legge bene, e che si ripete. '.repeat(1000)
    const chunks = speakable(answer)

    const spoken = chunks.slice(0, -1).join(' ')

    expect(chunks[chunks.length - 1]).toBe(SPOKEN.rest)
    expect(Math.abs(spoken.length - MAX_SPOKEN_CHARS)).toBeLessThan(CHUNK_MAX)
    expect(spoken.length).toBeLessThan(answer.length / 3)
    expect(withinLimits(chunks)).toBe(true)
  })

  test('an answer exactly at the limit is read whole, with no remark about the rest, and one more character is not', () => {
    const answer = `${'Frase. '.repeat(1713)}${'x'.repeat(MAX_SPOKEN_CHARS - 1713 * 7)}`

    expect(answer).toHaveLength(MAX_SPOKEN_CHARS)
    expect(speakable(answer)).not.toContain(SPOKEN.rest)
    expect(speakable(`${answer}x`)).toContain(SPOKEN.rest)
  })

  test('a limit that falls inside an emoji leaves no half of it in what is read', () => {
    // 11,999 units, then an emoji whose two halves are units 11,999 and 12,000.
    const answer = `${'abcde '.repeat(1999)}abcde😀 e poi altre parole`
    const chunks = speakable(answer)

    expect(answer.indexOf('😀')).toBe(MAX_SPOKEN_CHARS - 1)
    expect(chunks.every(isWhole)).toBe(true)
    expect(chunks[chunks.length - 1]).toBe(SPOKEN.rest)
  })

  test('a pathological answer is cut before it is parsed, so it cannot freeze the plugin', () => {
    const started = Date.now()

    for (const text of ['['.repeat(100000), 'es. '.repeat(100000), `${'parola '.repeat(40000)}.`]) {
      speakable(text)
    }

    expect(Date.now() - started).toBeLessThan(5000)
  })

  test('a realistic answer comes out as clean speech within the limits', () => {
    const chunks = speakable(ANSWER)
    const spoken = chunks.join(' ')

    expect(withinLimits(chunks)).toBe(true)
    expect(spoken).toContain('Risultato. Ho corretto il filtro in hooks/steps.ts e aggiunto i test; vedi la guida per i dettagli.')
    expect(spoken).toContain(SPOKEN.code)
    expect(spoken).toContain(SPOKEN.table)
    expect(spoken).toContain(SPOKEN.id)
    expect(spoken).toContain(SPOKEN.path)
    expect(spoken).not.toMatch(/[*`#|>]|\]\(|---|https?:/)
    expect(spoken.match(new RegExp(SPOKEN.code.replace('.', '\\.'), 'g'))).toHaveLength(1)
  })
})
