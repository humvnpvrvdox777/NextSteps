import { headOf, splitsPair } from './text'
import { STRINGS } from './strings'
import type { Strings } from './strings'

export const FIRST_CHUNK_MAX = 60
export const CHUNK_MAX = 120
// More than this is not read: twelve thousand characters are already some twelve minutes of speech, and the parsing
// below is not linear on odd inputs (a hundred thousand brackets took twenty seconds), so a huge answer is cut first.
export const MAX_SPOKEN_CHARS = 12000

// The English phrases, the default. The phrases of the other language live in strings.ts, and the caller passes them.
export const SPOKEN = STRINGS.en.spoken

type Spoken = Strings['spoken']

const PATH_MIN_LENGTH = 24
const MIN_HEAD_SHARE = 3
const ABBREVIATIONS = new Set([
  'es', 'ecc', 'etc', 'n', 'nn', 'cfr', 'pag', 'pp', 'sig', 'dott', 'prof', 'ing', 'vs', 'art', 'fig', 'tab', 'ca',
])

const FENCE = /^\s*(`{3,}|~{3,})/
const RULE = /^\s*(?:([-*_])(?:\s*\1){2,}|={3,})\s*$/
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/
const LIST_ITEM = /^\s{0,12}(?:[-*+]|\d{1,3}[.)])\s+(.*)$/
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/
const HEX_ID = /\b(?=[0-9a-fA-F]*\d)(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{12,}\b/g
const UUID = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g
const CLOSERS = /["'”’)\]»]/

const isWord = (char: string | undefined) => char !== undefined && /[A-Za-zÀ-ÿ]/.test(char)

// Paths first: an identifier inside a path must not split it into two tokens.
const describeLongTokens = (text: string, spoken: Spoken): string =>
  text
    .split(/(\s+)/)
    .map(part => {
      const core = part.replace(/^[("'[]+|[)"'\],.;:!?]+$/g, '')

      return core.length >= PATH_MIN_LENGTH && /[\\/]/.test(core) ? part.replace(core, spoken.path) : part
    })
    .join('')
    .replace(UUID, spoken.id)
    .replace(HEX_ID, spoken.id)

// Markdown to plain text: marks go, the words stay, what cannot be read out is described.
const clean = (text: string, spoken: Spoken): string =>
  describeLongTokens(
    text
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(https?:\/\/[^>\s]+)>/g, ` ${spoken.link} `)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[\^[^\]]+\]/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, (_, label: string) => (label.trim() === '' ? spoken.link : label))
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
      .replace(/\bhttps?:\/\/[^\s)>\]]+/g, spoken.link)
      .replace(/\bwww\.[^\s)>\]]+/g, spoken.link)
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1$2')
      .replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s).,;:!?]|$)/g, '$1$2')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1'),
    spoken,
  )
    .replace(/\s+/g, ' ')
    .trim()

const terminate = (text: string): string => (text === '' || /[.!?…:;]$/.test(text) ? text : `${text}.`)

type Open = { kind: 'paragraph' | 'item'; lines: string[] }

// The text to speak, one unit per paragraph, heading, list item or block that is only described.
const unitsOf = (markdown: string, spoken: Spoken): string[] => {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const units: string[] = []
  let open: Open | null = null
  let previous: 'none' | 'blank' | 'list' | 'text' = 'none'
  let index = 0

  const close = () => {
    if (open !== null) {
      units.push(terminate(clean(open.lines.join(' '), spoken)))
      previous = open.kind === 'item' ? 'list' : 'text'
      open = null
    }
  }

  while (index < lines.length) {
    const line = lines[index]!
    const fence = FENCE.exec(line)

    if (fence !== null) {
      close()

      const mark = fence[1]![0]!
      const closing = new RegExp(`^\\s*${mark === '`' ? '`' : '~'}{3,}\\s*$`)

      index += 1

      while (index < lines.length && !closing.test(lines[index]!)) {
        index += 1
      }

      index += 1
      units.push(spoken.code)
      previous = 'text'
      continue
    }

    if (line.trim() === '') {
      close()
      previous = previous === 'none' ? 'none' : previous === 'list' ? 'list' : 'blank'
      index += 1
      continue
    }

    const startsAfterBlank = open === null && (previous === 'none' || previous === 'blank')

    if (/^( {4}|\t)/.test(line) && startsAfterBlank && !LIST_ITEM.test(line)) {
      close()

      while (index < lines.length && (/^( {4}|\t)/.test(lines[index]!) || lines[index]!.trim() === '')) {
        index += 1
      }

      units.push(spoken.code)
      previous = 'text'
      continue
    }

    if (line.includes('|') && TABLE_SEPARATOR.test(lines[index + 1] ?? '') && (lines[index + 1] ?? '').includes('-')) {
      close()

      while (index < lines.length && lines[index]!.trim() !== '' && lines[index]!.includes('|')) {
        index += 1
      }

      units.push(spoken.table)
      previous = 'text'
      continue
    }

    if (RULE.test(line)) {
      close()
      index += 1
      continue
    }

    const heading = HEADING.exec(line)

    if (heading !== null) {
      close()
      units.push(terminate(clean(heading[1]!, spoken)))
      previous = 'text'
      index += 1
      continue
    }

    const item = LIST_ITEM.exec(line)

    if (item !== null) {
      close()
      open = { kind: 'item', lines: [item[1]!.replace(/^\[[ xX]\]\s+/, '')] }
      index += 1
      continue
    }

    const text = line.replace(/^\s*(?:>\s?)+/, '').trim()

    if (open === null) {
      open = { kind: previous === 'list' && /^\s/.test(line) ? 'item' : 'paragraph', lines: [text] }
    } else {
      open.lines.push(text)
    }

    index += 1
  }

  close()

  return units.filter(unit => /[A-Za-zÀ-ÿ0-9]/.test(unit))
}

const endsSentence = (text: string, at: number): boolean => {
  const next = text[at + 1]

  if (next !== undefined && !/\s/.test(next) && !CLOSERS.test(next)) {
    return false
  }

  if (text[at] !== '.') {
    return true
  }

  const word = /([A-Za-zÀ-ÿ]+)$/.exec(text.slice(0, at))?.[1]

  return word === undefined || !(word.length === 1 || ABBREVIATIONS.has(word.toLowerCase()))
}

export const sentences = (text: string): string[] => {
  const found: string[] = []
  let start = 0
  let at = 0

  while (at < text.length) {
    if (/[.!?…]/.test(text[at]!) && endsSentence(text, at)) {
      let end = at

      while (/[.!?…]/.test(text[end + 1] ?? '') || CLOSERS.test(text[end + 1] ?? '')) {
        end += 1
      }

      found.push(text.slice(start, end + 1).trim())
      start = end + 1
      at = end + 1
    } else {
      at += 1
    }
  }

  found.push(text.slice(start).trim())

  return found.filter(sentence => sentence !== '')
}

// Cuts `text` so that the head fits in `limit`: after the last comma, semicolon or colon that leaves a head worth
// saying, else at the last space, else in the middle of a word. A tail that is only punctuation is dropped.
const cut = (text: string, limit: number): [string, string] => {
  const window = text.slice(0, limit + 1)
  const minHead = Math.floor(limit / MIN_HEAD_SHARE)
  let at = -1

  for (let index = window.length - 1; index >= minHead; index -= 1) {
    if (/[,;:]/.test(window[index]!) && index + 1 <= limit && /\s/.test(window[index + 1] ?? ' ')) {
      at = index + 1
      break
    }
  }

  if (at === -1) {
    const space = window.lastIndexOf(' ', limit)

    at = space > 0 ? space : limit
  }

  // A cut in the middle of a word must not fall between the two halves of an emoji.
  if (splitsPair(text, at)) {
    at -= 1
  }

  const head = text.slice(0, at).trim()
  const tail = text.slice(at).trim()

  return [head, /[A-Za-zÀ-ÿ0-9]/.test(tail) ? tail : '']
}

const pack = (all: readonly string[]): string[] => {
  const chunks: string[] = []
  let current = ''

  for (const sentence of all) {
    let rest = sentence

    while (rest !== '') {
      const limit = chunks.length === 0 ? FIRST_CHUNK_MAX : CHUNK_MAX

      if (current === '') {
        if (rest.length <= limit) {
          current = rest
          rest = ''
        } else {
          const [head, tail] = cut(rest, limit)

          chunks.push(head)
          rest = tail
        }
      } else if (current.length + 1 + rest.length <= limit) {
        current = `${current} ${rest}`
        rest = ''
      } else {
        chunks.push(current)
        current = ''
      }
    }
  }

  if (current !== '') {
    chunks.push(current)
  }

  return chunks
}

// The answer as chunks to speak: markdown read as speech, the first chunk short so that sound starts early. An answer
// longer than MAX_SPOKEN_CHARS is read up to there, and the voice says that the rest is in the text.
export const speakable = (markdown: string, spoken: Spoken = STRINGS.en.spoken): string[] => {
  const isLong = markdown.length > MAX_SPOKEN_CHARS
  const chunks = pack(unitsOf(isLong ? headOf(markdown, MAX_SPOKEN_CHARS) : markdown, spoken).flatMap(sentences))

  return isLong ? [...chunks, spoken.rest] : chunks
}
