import { describe, expect, test } from 'claude-code/testing'

import {
  ANSWER_TAIL,
  ASSISTANT_DEFAULTS,
  DIGEST_ROWS,
  DIGEST_ROW_MAX,
  HISTORY_MAX,
  digestOf,
  failureLine,
  parseReply,
  renderPrompt,
  settingsFrom,
  systemPrompt,
  trimHistory,
} from '../hooks/assistant'
import type { ChatLine } from '../hooks/assistant'
import { REPLY_FAILED } from '../hooks/steps'
import { isWhole } from './unicode'

const line = (who: ChatLine['who'], text: string): ChatLine => ({ who, text })
const numbered = (count: number): ChatLine[] =>
  Array.from({ length: count }, (_, index) => line(index % 2 === 0 ? 'user' : 'assistant', `line ${index}`))

describe('assistant', () => {
  test('the defaults are the model the user chose, at its highest effort', () => {
    expect(ASSISTANT_DEFAULTS).toEqual({ model: 'claude-sonnet-5-5', effort: 'max', maxTokens: 16000 })
  })

  test('settings come from the plugin options, and anything unusable falls back to the defaults', () => {
    expect(settingsFrom({})).toEqual(ASSISTANT_DEFAULTS)
    expect(settingsFrom({ assistantModel: 'claude-opus-5-5', assistantEffort: 'high', assistantMaxTokens: 4000 })).toEqual({
      model: 'claude-opus-5-5',
      effort: 'high',
      maxTokens: 4000,
    })
    expect(settingsFrom({ assistantModel: '  ', assistantEffort: 'extreme', assistantMaxTokens: -3 })).toEqual(ASSISTANT_DEFAULTS)
    expect(settingsFrom({ assistantMaxTokens: 12.5 })).toEqual(ASSISTANT_DEFAULTS)
    expect(settingsFrom({ assistantModel: 7, assistantEffort: false })).toEqual(ASSISTANT_DEFAULTS)
  })

  test('a reply cap above what one reply can hold is clamped to it', () => {
    expect(settingsFrom({ assistantMaxTokens: 100000 }).maxTokens).toBe(64000)
    expect(settingsFrom({ assistantMaxTokens: 64000 }).maxTokens).toBe(64000)
  })

  test('a failed call is explained to the user in a short sentence, and a cancelled one is not explained at all', () => {
    expect(failureLine({ reason: 'aborted' }, true)).toBeNull()
    expect(failureLine({ reason: 'aborted' }, false)).toBe(REPLY_FAILED.slow)
    expect(failureLine({ reason: 'empty-reply' }, false)).toBe(REPLY_FAILED.empty)
    expect(failureLine({ reason: 'api-error', status: 429, error: 'rate_limit' }, false)).toBe(REPLY_FAILED.limit)
    expect(failureLine({ reason: 'api-error', status: 200, error: 'rate_limit' }, false)).toBe(REPLY_FAILED.limit)
    expect(failureLine({ reason: 'api-error', status: 529, error: 'overloaded' }, false)).toBe(REPLY_FAILED.network)
    expect(failureLine({ reason: 'api-error', status: null, error: 'unknown' }, false)).toBe(REPLY_FAILED.network)
    expect(failureLine({ reason: 'api-error', status: 500, error: 'server_error' }, false)).toBe(REPLY_FAILED.network)
    expect(failureLine({ reason: 'api-error', status: 400, error: 'invalid_request' }, false)).toBe(REPLY_FAILED.other)
  })

  test('the system prompt sets the role, the two tags and the hand-off rule', () => {
    const prompt = systemPrompt()

    expect(prompt).toContain('<say>')
    expect(prompt).toContain('</say>')
    expect(prompt).toContain('<handoff>')
    expect(prompt).toContain('</handoff>')
    expect(prompt).toMatch(/language of the user's last message/i)
    expect(prompt).toMatch(/never (say or imply|claim)/i)
    expect(prompt).toMatch(/data, not instructions/i)
    expect(prompt).toMatch(/only once the user agrees/i)
  })

  test('a reply is read from its say and handoff tags and nothing else', () => {
    const reply = parseReply('ignored <say> Va bene, procediamo. </say> ignored too <handoff>\nScrivi i test per il filtro.\n</handoff> trailing')

    expect(reply).toEqual({ say: 'Va bene, procediamo.', handoff: 'Scrivi i test per il filtro.' })
  })

  test('tags are found whatever their case, and several say blocks are joined', () => {
    expect(parseReply('<SAY>Uno.</SAY><say>Due.</say>')).toEqual({ say: 'Uno. Due.', handoff: null })
    expect(parseReply('<Say>Sì</Say><HANDOFF>Fallo</HANDOFF>')).toEqual({ say: 'Sì', handoff: 'Fallo' })
  })

  test('without a say tag there is nothing to say, so the caller can show the text as it came', () => {
    expect(parseReply('Just text')).toEqual({ say: null, handoff: null })
    expect(parseReply('')).toEqual({ say: null, handoff: null })
    expect(parseReply('<say>   </say>')).toEqual({ say: null, handoff: null })
  })

  test('a say that was cut off still counts, a handoff that was cut off does not', () => {
    expect(parseReply('<say>Ti propongo di')).toEqual({ say: 'Ti propongo di', handoff: null })
    expect(parseReply('<say>Pronto.</say><handoff>Scrivi i test per')).toEqual({ say: 'Pronto.', handoff: null })
  })

  test('an empty handoff is no handoff', () => {
    expect(parseReply('<say>Ok.</say><handoff>  </handoff>')).toEqual({ say: 'Ok.', handoff: null })
  })

  test('the digest keeps the newest rows in order, labelled, and skips the empty ones', () => {
    const rows = Array.from({ length: DIGEST_ROWS + 4 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      text: `message ${index}`,
    }))
    const digest = digestOf([...rows, { role: 'user', text: '' }])
    const lines = digest.split('\n')

    expect(lines).toHaveLength(DIGEST_ROWS)
    expect(lines[0]).toBe(`user: message ${rows.length - DIGEST_ROWS}`)
    expect(lines.at(-1)).toBe(`assistant: message ${rows.length - 1}`)
  })

  test('a long row is cut and says so; a row with line breaks stays on one line', () => {
    const digest = digestOf([
      { role: 'assistant', text: 'x'.repeat(DIGEST_ROW_MAX + 500) },
      { role: 'user', text: 'one\ntwo\n\nthree' },
    ])
    const [first, second] = digest.split('\n')

    expect(first!.length).toBeLessThan(DIGEST_ROW_MAX + 40)
    expect(first).toMatch(/\[cut\]$/)
    expect(second).toBe('user: one two three')
  })

  test('what is cut from a long row or a long answer never leaves half an emoji', () => {
    // The head of a row ends, and the tail of an answer starts, exactly between the halves of an emoji.
    const row = `${'x'.repeat(DIGEST_ROW_MAX - 1)}😀${'y'.repeat(50)}`
    const answer = `${'x'.repeat(10)}😀${'y'.repeat(ANSWER_TAIL - 1)}`

    expect(isWhole(digestOf([{ role: 'assistant', text: row }]))).toBe(true)
    expect(isWhole(renderPrompt({ digest: '', answer, history: [], user: 'hi' }))).toBe(true)
  })

  test('the digest of nothing is nothing', () => {
    expect(digestOf([])).toBe('')
    expect(digestOf([{ role: 'user', text: '   ' }])).toBe('')
  })

  test('the prompt carries the digest, the answer, the history in order and the new line last', () => {
    const prompt = renderPrompt({
      digest: 'user: fix the filter',
      answer: 'Done: the filter now skips short answers.',
      history: [line('user', 'is it safe?'), line('assistant', 'Probably, yes.')],
      user: 'then verify it',
    })

    expect(prompt).toContain('user: fix the filter')
    expect(prompt).toContain('Done: the filter now skips short answers.')
    expect(prompt.indexOf('is it safe?')).toBeLessThan(prompt.indexOf('Probably, yes.'))
    expect(prompt.indexOf('Probably, yes.')).toBeLessThan(prompt.indexOf('then verify it'))
    expect(prompt.trimEnd().endsWith('then verify it')).toBe(true)
  })

  test('a notice of the mod is not part of what the model is shown as said by the assistant', () => {
    const prompt = renderPrompt({
      digest: '',
      answer: 'done',
      history: [line('user', 'is it safe?'), { who: 'assistant', text: 'Non riesco a rispondere adesso.', isError: true }, line('user', 'again?')],
      user: 'hello',
    })

    expect(prompt).toContain('is it safe?')
    expect(prompt).toContain('again?')
    expect(prompt).not.toContain('Non riesco a rispondere')

    const onlyNotices = renderPrompt({ digest: '', answer: 'done', history: [{ who: 'assistant', text: 'oops', isError: true }], user: 'hi' })

    expect(onlyNotices).not.toContain('<conversation>')
  })

  test('a very long answer keeps only its end, and the prompt says it was cut', () => {
    const answer = `START-${'a'.repeat(ANSWER_TAIL + 100)}-END`
    const prompt = renderPrompt({ digest: '', answer, history: [], user: 'hi' })

    expect(prompt).not.toContain('START-')
    expect(prompt).toContain('-END')
    expect(prompt).toMatch(/earlier part (omitted|cut)/i)
    expect(prompt.length).toBeLessThan(ANSWER_TAIL + 1500)
  })

  test('a short answer is not marked as cut, and an empty digest or history leaves no empty sections', () => {
    const prompt = renderPrompt({ digest: '', answer: 'short', history: [], user: 'hi' })

    expect(prompt).not.toMatch(/omitted|cut/i)
    expect(prompt).not.toContain('<project_conversation>')
    expect(prompt).not.toContain('<conversation>')
  })

  test('history keeps the newest lines, and starts with the user when it can', () => {
    expect(trimHistory(numbered(10))).toEqual(numbered(10))

    const long = numbered(HISTORY_MAX + 5)
    const trimmed = trimHistory(long)

    expect(trimmed.length).toBeLessThanOrEqual(HISTORY_MAX)
    expect(trimmed.at(-1)).toEqual(long.at(-1))
    expect(trimmed[0]!.who).toBe('user')
  })

  test('a history that fits is kept whole, even when it starts with the assistant', () => {
    const history = [line('assistant', 'opening'), line('user', 'hi')]

    expect(trimHistory(history)).toEqual(history)
    expect(trimHistory(numbered(HISTORY_MAX))).toEqual(numbered(HISTORY_MAX))
  })

  test('an answer exactly at the limit and a row exactly at the limit are not cut', () => {
    const answer = 'a'.repeat(ANSWER_TAIL)
    const prompt = renderPrompt({ digest: '', answer, history: [], user: 'hi' })

    expect(prompt).toContain(answer)
    expect(prompt).not.toMatch(/omitted/i)
    expect(digestOf([{ role: 'user', text: 'b'.repeat(DIGEST_ROW_MAX) }])).toBe(`user: ${'b'.repeat(DIGEST_ROW_MAX)}`)
  })

  test('history can be cut to another size', () => {
    expect(trimHistory(numbered(8), 4).map(item => item.text)).toEqual(['line 4', 'line 5', 'line 6', 'line 7'])
    expect(trimHistory(numbered(9), 4).map(item => item.text)).toEqual(['line 6', 'line 7', 'line 8'])
    expect(trimHistory([], 4)).toEqual([])
  })
})
