import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { OPENING } from '../hooks/assistant'
import { CHOSEN_TICKS, FRAME_MS } from '../hooks/mascot'
import { REPLY_FAILED, SUGGEST_DELAY_MS, TOAST } from '../hooks/steps'
import {
  LONG_ANSWER,
  PANE,
  SESSION,
  START,
  STEPS,
  SUBMIT,
  USAGE,
  answered,
  completed,
  isAway,
  mountBand,
  mountPane,
  said,
  world,
} from './fixtures'

const CLEAR = { reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as const

type World = ReturnType<typeof world>
type Band = Awaited<ReturnType<typeof mountBand>>
type Pane = Awaited<ReturnType<typeof mountPane>>

const answer = async ($: Engine, w: World) => {
  await $.turn.complete({ reason: 'answer', answer: LONG_ANSWER, durationMs: 1, isAborted: false, turnId: 't1' })
  await w.advance(SUGGEST_DELAY_MS)
}

// The band after an answer, the conversation opened, and its panel.
const talking = async ($: Engine, w: World, surface: 'terminal' | 'desktop' = 'terminal') => {
  await $.session.start(SESSION)
  await answer($, w)

  const band = await mountBand($, surface)

  await band.press({ key: 'discuss' })

  return { band, pane: await mountPane($, surface) }
}

const stepButtons = async (band: Band) =>
  (await band.findAll({ type: 'Button' })).filter(button => /^[123]$/.test(String(button.props.hotkey)))

const fieldOf = async (pane: Pane) =>
  (await pane.findAll({ type: 'Input' })).find(item => String(item.key).startsWith('say'))

// The message field has a new key after each message (so that it comes back empty): find the one drawn now.
const fieldKey = async (pane: Pane) => {
  const field = await fieldOf(pane)

  expect(field).toBeDefined()

  return String(field!.key)
}

const say = async (pane: Pane, text: string) => pane.input({ key: await fieldKey(pane), text })

// For a line whose reply is held and not waited for: the field is found first, so that the line is issued the
// moment the returned function is called, with nothing asynchronous between that call and the line.
const sayLater = async (pane: Pane, text: string) => {
  const key = await fieldKey(pane)

  return () => pane.input({ key, text })
}

// The proposal field is replaced each time it is submitted or a new proposal arrives, so it is found by what it is.
const draftOf = async (pane: Pane) =>
  (await pane.findAll({ type: 'Input' })).find(item => String(item.key).startsWith('draft'))

const editDraft = async (pane: Pane, text: string, kind: 'change' | 'submit' = 'change') => {
  const field = await draftOf(pane)

  expect(field).toBeDefined()

  return pane.input({ key: String(field!.key), text, kind })
}

const lineOf = (pane: Pane, text: string) => pane.find({ type: 'Text', text })

describe('chat', () => {
  test('Talk it over opens the panel, the mascot listens, and the three ways forward stay clickable', async ($, on) => {
    const w = world(on)
    const { band } = await talking($, w)

    expect(w.seen.opened).toEqual(['assistant'])
    expect(await band.find({ type: 'Text', text: 'Talking it over: write in the panel' })).toBeDefined()
    expect(await stepButtons(band)).toHaveLength(3)
  })

  test('the panel opens with the assistant saying hello, once', async ($, on) => {
    const w = world(on)
    const { band, pane } = await talking($, w)

    expect(await lineOf(pane, `Assistant: ${OPENING}`)).toBeDefined()
    expect(await fieldOf(pane)).toBeDefined()

    await band.press({ key: 'discuss' })

    expect((await pane.findAll({ type: 'Text', text: OPENING })).length).toBe(1)
    expect(w.seen.opened).toEqual(['assistant', 'assistant'])
  })

  test('typing to the assistant asks the chosen model at its highest effort, and shows the reply', async ($, on) => {
    const w = world(on)
    const { pane } = await talking($, w)

    w.queueComplete(said('Ti consiglio di verificare prima.'))
    await say(pane, 'cosa ne pensi?')

    expect(w.seen.completes).toHaveLength(1)

    const call = w.seen.completes[0]!

    expect(call).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'max', maxTokens: 16000, timeoutMs: 300000 })
    expect(call.system).toContain('<say>')
    expect(call.prompt).toContain(LONG_ANSWER)
    expect(call.prompt.trimEnd().endsWith('user: cosa ne pensi?')).toBe(true)
    expect(await lineOf(pane, 'You: cosa ne pensi?')).toBeDefined()
    expect(await lineOf(pane, 'Assistant: Ti consiglio di verificare prima.')).toBeDefined()
  })

  test('the message field comes back new and empty after each message and when the conversation ends', async ($, on) => {
    const w = world(on)
    const { pane } = await talking($, w)
    const first = (await fieldOf(pane))!.key

    w.queueComplete(said('Uno.'))
    await say(pane, 'prima')

    const second = (await fieldOf(pane))!.key

    expect(second).not.toBe(first)
    expect(await pane.find({ type: 'Input', key: first })).toBeUndefined()

    await $.turn.start(START)
    await pane.unmount()
    await answer($, w)

    const band = await mountBand($, 'terminal')

    await band.press({ key: 'discuss' })

    const third = (await fieldOf(await mountPane($, 'terminal')))!.key

    expect(third).not.toBe(second)
  })

  test('the plugin options change the model, the effort and the reply cap',{ options: { assistantModel: 'claude-opus-5-5', assistantEffort: 'low', assistantMaxTokens: 500 } }, async ($, on) => {
    const w = world(on)
    const { pane } = await talking($, w)

    await say(pane, 'ciao')

    expect(w.seen.completes[0]).toMatchObject({ model: 'claude-opus-5-5', effort: 'low', maxTokens: 500 })
  })

  test('an option the model cannot take falls back to the default', { options: { assistantModel: '', assistantEffort: 'turbo', assistantMaxTokens: 0 } }, async ($, on) => {
    const w = world(on)
    const { pane } = await talking($, w)

    await say(pane, 'ciao')

    expect(w.seen.completes[0]).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'max', maxTokens: 16000 })
  })

  test('the project conversation reaches the assistant as a digest', async ($, on) => {
    const w = world(on)

    w.setRows([
      { role: 'user', text: 'fix the filter', toolUses: [] },
      { role: 'assistant', text: 'Done: it skips short answers.', toolUses: [] },
      { role: 'user', text: '', toolUses: [] },
    ])

    const { pane } = await talking($, w)

    await say(pane, 'e ora?')

    expect(w.seen.completes[0]!.prompt).toContain('<project_conversation>\nuser: fix the filter\nassistant: Done: it skips short answers.\n</project_conversation>')
  })

  test('the conversation so far goes with every turn, in order', async ($, on) => {
    const w = world(on)
    const { pane } = await talking($, w)

    w.queueComplete(said('Prima risposta.'), said('Seconda risposta.'))
    await say(pane, 'prima domanda')
    await say(pane, 'seconda domanda')

    const second = w.seen.completes[1]!.prompt

    expect(second.indexOf('user: prima domanda')).toBeLessThan(second.indexOf('assistant: Prima risposta.'))
    expect(second.indexOf('assistant: Prima risposta.')).toBeLessThan(second.indexOf('user: seconda domanda'))
    expect(await lineOf(pane, 'Assistant: Seconda risposta.')).toBeDefined()
  })

  test('a reply without a say tag is shown as it came, and logged for debugging', async ($, on) => {
    const w = world(on)
    const { pane } = await talking($, w)

    w.queueComplete(completed('Just plain words'))
    await say(pane, 'ciao')

    expect(await lineOf(pane, 'Assistant: Just plain words')).toBeDefined()
    expect(w.seen.logs).toContainEqual({ text: 'next-steps: the assistant answered without a <say> block', to: 'debug' })
  })

  test('while the assistant works the mascot thinks and the panel offers to cancel; cancelling ends the call without a word', async ($, on) => {
    const w = world(on)
    const { band, pane } = await talking($, w)
    const release = w.holdComplete()
    const send = await sayLater(pane, 'una domanda lunga')
    const pending = send()

    await w.advance(0)

    expect(await band.find({ type: 'Text', text: /^Thinking it over/ })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'cancel' })).toBeDefined()
    expect(await lineOf(pane, "The assistant is thinking…")).toBeDefined()

    await pane.press({ key: 'cancel' })
    await pending
    release()
    await w.advance(0)

    expect(await pane.find({ type: 'Button', key: 'cancel' })).toBeUndefined()
    expect(await band.find({ type: 'Text', text: 'Talking it over: write in the panel' })).toBeDefined()
    expect((await pane.findAll({ type: 'Text' })).map(text => text.text)).toEqual([`Assistant: ${OPENING}`, 'You: una domanda lunga'])

    w.queueComplete(said('Eccomi.'))
    await say(pane, 'di nuovo')

    expect(await lineOf(pane, 'Assistant: Eccomi.')).toBeDefined()
  })

  test('a call that failed is explained in one line, and that line is never sent back to the model', async ($, on) => {
    const w = world(on)
    const { pane } = await talking($, w)

    w.queueComplete({ isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }, said('Ora va.'))
    await say(pane, 'prima')

    expect(await lineOf(pane, `Assistant: ${REPLY_FAILED.network}`)).toBeDefined()

    await say(pane, 'riprovo')

    expect(w.seen.completes[1]!.prompt).toContain('user: prima')
    expect(w.seen.completes[1]!.prompt).not.toContain(REPLY_FAILED.network)
    expect(await lineOf(pane, 'Assistant: Ora va.')).toBeDefined()
  })

  test('an empty line sends nothing, and a second line sent while one is answered is ignored', async ($, on) => {
    const w = world(on)
    const { pane } = await talking($, w)
    const release = w.holdComplete()

    await say(pane, '   ')
    expect(w.seen.completes).toHaveLength(0)
    expect(w.seen.toasts).toEqual([])

    const sendFirst = await sayLater(pane, 'uno')
    const first = sendFirst()

    await w.advance(0)
    await say(pane, 'due')

    // The field is cleared by the host when a line is submitted, so a line that is not taken says why.
    expect(w.seen.toasts).toEqual([TOAST.stillAnswering])

    release()
    await first

    expect(w.seen.completes).toHaveLength(1)
    expect(await pane.find({ type: 'Text', text: 'You: due' })).toBeUndefined()
  })

  test('a hand-off fills an editable field, and nothing is sent or copied until a button is pressed', async ($, on) => {
    const w = world(on)
    const { pane } = await talking($, w)

    w.queueComplete(said('Pronto: la richiesta è qui sotto.', 'Scrivi i test per il filtro e poi eseguili.'))
    await say(pane, 'va bene, procediamo')

    expect((await draftOf(pane))?.text).toBe('Scrivi i test per il filtro e poi eseguili.')
    expect(await pane.find({ type: 'Button', key: 'copy' })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'send' })).toBeDefined()
    expect(w.seen.submits).toHaveLength(0)
    expect(w.seen.runs).toHaveLength(0)
    expect(w.seen.fills).toHaveLength(0)
  })

  test('typing again drops the old proposal until the assistant makes a new one', async ($, on) => {
    const w = world(on)
    const { pane } = await talking($, w)

    w.queueComplete(said('Ecco.', 'Fai la prima cosa.'), said('Ripensiamoci.'))
    await say(pane, 'procediamo')
    expect(await draftOf(pane)).toBeDefined()

    await say(pane, 'aspetta, no')

    expect(await draftOf(pane)).toBeUndefined()
  })

  test('Manda al progetto sends the edited text as the user\'s own words and ends the conversation', async ($, on) => {
    const w = world(on)
    const { pane } = await talking($, w)

    w.queueComplete(said('Ecco.', 'Scrivi i test per il filtro.'))
    await say(pane, 'procediamo')
    await editDraft(pane, 'Scrivi i test e poi eseguili tutti.')
    await pane.press({ key: 'send' })

    expect(w.seen.submits.map(submit => submit.text)).toEqual(['Scrivi i test e poi eseguili tutti.'])
    expect(w.seen.toasts).toContain(TOAST.sent)
    expect(w.seen.closed).toContain('assistant')
    expect(await pane.findAll({ type: 'Text' })).toHaveLength(0)
    expect(await draftOf(pane)).toBeUndefined()
  })

  test('a field the user emptied sends nothing', async ($, on) => {
    const w = world(on)
    const { pane } = await talking($, w)

    w.queueComplete(said('Ecco.', 'Scrivi i test.'))
    await say(pane, 'procediamo')
    await editDraft(pane, '   ')
    await pane.press({ key: 'send' })
    await pane.press({ key: 'copy' })

    expect(w.seen.submits).toHaveLength(0)
    expect(w.seen.runs).toHaveLength(0)
    expect(w.seen.toasts).not.toContain(TOAST.sent)
    expect(w.seen.toasts).not.toContain(TOAST.sendFailed)
    expect(w.seen.toasts).not.toContain(TOAST.copied)
    expect(await draftOf(pane)).toBeDefined()
  })

  test('Copia puts the edited text on the clipboard and ends the conversation', async ($, on) => {
    const w = world(on)
    const { band, pane } = await talking($, w)

    w.queueComplete(said('Ecco.', 'Scrivi i test per il filtro.'))
    await say(pane, 'procediamo')
    await editDraft(pane, 'Scrivi i test e verifica.')
    await pane.press({ key: 'copy' })

    expect(w.seen.runs).toHaveLength(1)
    expect(w.seen.runs[0]!.stdin).toBe('Scrivi i test e verifica.')
    expect(w.seen.toasts).toContain(TOAST.copied)
    expect(await band.find({ type: 'Text', text: /Ctrl\+V/ })).toBeDefined()
    expect(w.seen.closed).toContain('assistant')
    expect(w.seen.submits).toHaveLength(0)
  })

  test('if the clipboard cannot be written the field stays, so the user can try again', async ($, on) => {
    const w = world(on)
    const { pane } = await talking($, w)

    w.setClipboardExit(1)
    w.queueComplete(said('Ecco.', 'Scrivi i test per il filtro.'))
    await say(pane, 'procediamo')
    await pane.press({ key: 'copy' })

    expect(w.seen.toasts).toContain(TOAST.clipboardFailed)
    expect(await draftOf(pane)).toBeDefined()
    expect(w.seen.closed).toHaveLength(0)
  })

  test('the assistant never writes to the project by itself, however long they talk', async ($, on) => {
    const w = world(on)
    const { pane } = await talking($, w)

    w.queueComplete(said('Uno.'), said('Due.', 'Una richiesta.'), said('Tre.'))
    await say(pane, 'a')
    await say(pane, 'b')
    await say(pane, 'c')

    expect(w.seen.fills).toHaveLength(0)
    expect(w.seen.submits).toHaveLength(0)
    expect(w.seen.runs).toHaveLength(0)
  })

  test('choosing one of the three ways forward during the conversation puts it in the prompt and keeps the conversation', async ($, on) => {
    const w = world(on)
    const { band, pane } = await talking($, w)

    w.queueComplete(said('Uno.'))
    await say(pane, 'a')
    await band.press({ key: 'step-2' })

    expect(w.seen.fills).toEqual([{ text: STEPS[1], mode: 'replace' }])
    expect(w.seen.closed).toHaveLength(0)
    expect(await pane.findAll({ type: 'Text' })).not.toHaveLength(0)
    expect(await isAway(band)).toBe(false)
  })

  test('a new turn, a prompt sent in the usual way and a clear each end the conversation', async ($, on) => {
    const turn = world(on)
    const first = await talking($, turn)

    const send = await sayLater(first.pane, 'a')

    send().catch(() => {})
    await turn.advance(0)
    await $.turn.start(START)

    expect(turn.seen.closed).toContain('assistant')
    expect(await first.pane.findAll({ type: 'Text' })).toHaveLength(0)
    expect(await isAway(first.band)).toBe(true)
  })

  test('a clear ends the conversation too', async ($, on) => {
    const w = world(on)
    const { band, pane } = await talking($, w)

    await $.session.end(CLEAR)

    expect(w.seen.closed).toContain('assistant')
    expect(await pane.findAll({ type: 'Text' })).toHaveLength(0)
    expect(await isAway(band)).toBe(true)
  })

  test('the panel can be closed and reopened with the lines kept and no second greeting', async ($, on) => {
    const w = world(on)
    const { band, pane } = await talking($, w)

    w.queueComplete(said('Una risposta.'))
    await say(pane, 'una domanda')
    await pane.press({ key: 'close' })

    expect(w.seen.closed).toEqual(['assistant'])

    await band.press({ key: 'discuss' })

    expect(w.seen.opened).toEqual(['assistant', 'assistant'])
    expect((await pane.findAll({ type: 'Text' })).map(text => text.text)).toEqual([
      `Assistant: ${OPENING}`,
      'You: una domanda',
      'Assistant: Una risposta.',
    ])
  })

  test('steps that arrive while they talk only add the buttons: the conversation is not interrupted', async ($, on) => {
    const w = world(on)
    const release = w.hold()

    await $.session.start(SESSION)
    await answer($, w)

    const band = await mountBand($, 'terminal')

    expect(await stepButtons(band)).toHaveLength(0)

    await band.press({ key: 'discuss' })
    release()
    await w.advance(0)

    expect(await stepButtons(band)).toHaveLength(3)
    expect(await band.find({ type: 'Text', text: 'Talking it over: write in the panel' })).toBeDefined()
  })

  test('with the voice on the opening and the replies are spoken, errors are not', async ($, on) => {
    const w = world(on, { voice: true })

    await $.session.start(SESSION)
    await w.advance(0)
    await answer($, w)

    const band = await mountBand($, 'terminal')

    w.daemon.speaking = false
    await w.advance(1000)
    await band.press({ key: 'discuss' })

    const pane = await mountPane($, 'terminal')

    w.queueComplete(said('Ti consiglio di verificare.'), { isAnswered: false, reason: 'empty-reply', usage: USAGE })
    await say(pane, 'cosa ne pensi?')
    await say(pane, 'e poi?')

    const spoken = w.daemon.spoken.join(' ')

    expect(spoken).toContain(OPENING)
    expect(spoken).toContain('Ti consiglio di verificare.')
    expect(spoken).not.toContain(REPLY_FAILED.empty)
  })

  test('the greeting is said the first time the panel opens, not each time it is reopened', async ($, on) => {
    const w = world(on, { voice: true })

    await $.session.start(SESSION)
    await w.advance(0)
    await answer($, w)

    const band = await mountBand($, 'terminal')

    await band.press({ key: 'discuss' })
    await band.press({ key: 'discuss' })
    await band.press({ key: 'discuss' })

    const greetings = w.daemon.spoken.filter(chunk => OPENING.startsWith(chunk.slice(0, 20)))

    expect(greetings.length).toBeGreaterThan(0)
    expect(w.daemon.spoken.join(' ').split('Tell me what you think').length - 1).toBe(1)
  })

  test('opening the conversation silences a reading that was going on', async ($, on) => {
    const w = world(on, { voice: true })

    await $.session.start(SESSION)
    await w.advance(0)
    await answer($, w)

    const band = await mountBand($, 'terminal')

    await band.press({ key: 'discuss' })

    expect(w.daemon.stops).toBeGreaterThanOrEqual(1)
  })

  test('steps that arrive while the assistant is replying are still there when its reply lands', async ($, on) => {
    const w = world(on)
    const releaseSteps = w.hold()
    const releaseReply = w.holdComplete()
    const { band, pane } = await talking($, w)
    const send = await sayLater(pane, 'cosa ne pensi?')
    const pending = send()

    await w.advance(0)
    releaseSteps()
    await w.advance(0)

    expect(await stepButtons(band)).toHaveLength(3)

    releaseReply()
    await pending
    await w.advance(0)

    expect(await stepButtons(band)).toHaveLength(3)
  })

  test('a steps request that fails while the user talks leaves the band and the panel as they are', async ($, on) => {
    const w = world(on)
    const release = w.hold()

    w.setReply(answered('no tags here'))

    const { band, pane } = await talking($, w)

    release()
    await w.advance(0)

    expect(await isAway(band)).toBe(false)
    expect(await fieldOf(pane)).toBeDefined()
    expect(w.seen.closed).toHaveLength(0)
  })

  test('steps that finish after the hand-off was copied do not bring the band back', async ($, on) => {
    const w = world(on)
    const release = w.hold()
    const { band, pane } = await talking($, w)

    w.queueComplete(said('Ecco.', 'Scrivi i test.'))
    await say(pane, 'procediamo')
    await pane.press({ key: 'copy' })
    await w.advance(FRAME_MS * CHOSEN_TICKS + 10)
    release()
    await w.advance(0)

    expect(await isAway(band)).toBe(true)
    expect(await stepButtons(band)).toHaveLength(0)
  })

  test('a prompt refused beneath the plugin is not reported as sent, and the proposal stays', async ($, on) => {
    const w = world(on)
    const { pane } = await talking($, w)

    w.setSubmitDrop('blocked by a hook')
    w.queueComplete(said('Ecco.', 'Scrivi i test per il filtro.'))
    await say(pane, 'procediamo')
    await pane.press({ key: 'send' })

    expect(w.seen.toasts).not.toContain(TOAST.sent)
    expect(w.seen.toasts).toContain(TOAST.notAccepted)
    expect(w.seen.closed).not.toContain('assistant')
    expect((await draftOf(pane))?.text).toBe('Scrivi i test per il filtro.')
    expect(w.seen.submits).toHaveLength(0)
  })

  test('a prompt sent in the usual way and refused beneath the plugin does not end the conversation', async ($, on) => {
    const w = world(on)
    const { pane } = await talking($, w)

    w.setSubmitDrop('blocked by a hook')
    await $.prompt.submit(SUBMIT)

    expect(w.seen.closed).not.toContain('assistant')
    expect(await fieldOf(pane)).toBeDefined()
  })

  test('the cancel button is drawn after the message field, so the field keeps its place while the assistant works', async ($, on) => {
    const w = world(on)
    const { pane } = await talking($, w)
    const release = w.holdComplete()
    const order = async () =>
      (await pane.findAll({}))
        .filter(item => item.type === 'Button' || item.type === 'Input')
        .map(item => `${item.type}:${String(item.key).replace(/-\d+$/, '')}`)
    const idle = await order()
    const send = await sayLater(pane, 'una domanda')
    const pending = send()

    await w.advance(0)

    const busy = await order()

    release()
    await pending

    expect(idle).toEqual(['Input:say', 'Button:close'])
    expect(busy).toEqual(['Input:say', 'Button:cancel', 'Button:close'])
  })

  // The test kit has no focus ring, so `$.ui.focus` fails there: what the test can see is that the plugin asked for
  // the focus of the new field, because it says so in the debug log when the call does not come back moved.
  test('after a message the plugin asks for the focus of the new, empty field', async ($, on) => {
    const w = world(on)
    const { pane } = await talking($, w)

    w.queueComplete(said('Uno.'))
    await say(pane, 'prima')

    const key = await fieldKey(pane)

    expect(key).toBe('say-2')
    expect(w.seen.logs.some(line => line.to === 'debug' && line.text.startsWith(`next-steps: ${key} was not focused`))).toBe(true)
  })

  test('submitting the proposal field replaces it with one that still shows the edit', async ($, on) => {
    const w = world(on)
    const { pane } = await talking($, w)

    w.queueComplete(said('Ecco.', 'Scrivi i test per il filtro.'))
    await say(pane, 'procediamo')

    const before = (await draftOf(pane))!.key

    await editDraft(pane, 'Scrivi i test e poi eseguili.')
    await editDraft(pane, 'Scrivi i test e poi eseguili.', 'submit')

    const after = await draftOf(pane)

    expect(after?.key).not.toBe(before)
    expect(after?.text).toBe('Scrivi i test e poi eseguili.')

    await pane.press({ key: 'send' })

    expect(w.seen.submits.map(submit => submit.text)).toEqual(['Scrivi i test e poi eseguili.'])
  })

  test('closing the panel and opening it again keeps what the user changed in the proposal', async ($, on) => {
    const w = world(on)
    const { band, pane } = await talking($, w)

    w.queueComplete(said('Ecco.', 'Scrivi i test per il filtro.'))
    await say(pane, 'procediamo')
    await editDraft(pane, 'Scrivi i test e poi eseguili.')
    await pane.press({ key: 'close' })
    await pane.unmount()
    await band.press({ key: 'discuss' })

    const again = await mountPane($, 'terminal')

    expect((await draftOf(again))?.text).toBe('Scrivi i test e poi eseguili.')

    await again.press({ key: 'send' })

    expect(w.seen.submits.map(submit => submit.text)).toEqual(['Scrivi i test e poi eseguili.'])
  })

  test('Manda al progetto without any edit sends the proposal as it is', async ($, on) => {
    const w = world(on)
    const { pane } = await talking($, w)

    w.queueComplete(said('Ecco.', 'Scrivi i test per il filtro.'))
    await say(pane, 'procediamo')
    await pane.press({ key: 'send' })

    expect(w.seen.submits.map(submit => submit.text)).toEqual(['Scrivi i test per il filtro.'])
  })

  test('the panel is opened with the keyboard, and Escape closes it', async ($, on) => {
    const w = world(on)

    await talking($, w)

    expect(w.seen.opens).toHaveLength(1)
    expect(w.seen.opens[0]).toMatchObject({ id: 'assistant', focus: true, closeOnEscape: true })
  })

  test('on a surface with no text field the panel draws nothing', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)

    const pane = await $.ui.mount({ plugin: 'next-steps', surface: 'mobile', component: 'Pane', requestId: 'assistant', props: PANE })

    expect(await pane.findAll({ type: 'Input' })).toHaveLength(0)
    expect(await pane.findAll({ type: 'Button' })).toHaveLength(0)
    expect(w.seen.opened).toHaveLength(0)
  })

  test('opening the panel again while the assistant answers keeps the mascot thinking', async ($, on) => {
    const w = world(on)
    const { band, pane } = await talking($, w)
    const release = w.holdComplete()
    const send = await sayLater(pane, 'una domanda')
    const pending = send()

    await w.advance(0)
    await band.press({ key: 'discuss' })

    expect(await band.find({ type: 'Text', text: /^Thinking it over/ })).toBeDefined()

    release()
    await pending
  })

  test('a session start ends a conversation left over, as after a hot reload', async ($, on) => {
    const w = world(on)
    const { pane } = await talking($, w)

    w.queueComplete(said('Uno.'))
    await say(pane, 'prima')
    await $.session.start(SESSION)

    expect(w.seen.closed).toContain('assistant')
    expect(await pane.findAll({ type: 'Text' })).toHaveLength(0)
  })

  test('Copia silences the voice that is still speaking the assistant, and so does choosing a way forward', async ($, on) => {
    const w = world(on, { voice: true })

    await $.session.start(SESSION)
    await w.advance(0)
    await answer($, w)
    w.daemon.speaking = false
    await w.advance(1000)

    const band = await mountBand($, 'terminal')

    await band.press({ key: 'discuss' })

    const pane = await mountPane($, 'terminal')

    w.queueComplete(said('Ecco.', 'Scrivi i test.'))
    await say(pane, 'procediamo')

    const before = w.daemon.stops

    await pane.press({ key: 'copy' })

    expect(w.daemon.stops).toBeGreaterThan(before)
  })

  test('a reply the voice cannot say gets one toast, and the next reply gets its own', async ($, on) => {
    const w = world(on, { voice: true })

    await $.session.start(SESSION)
    await w.advance(0)
    await answer($, w)
    w.daemon.speaking = false
    await w.advance(1000)

    const band = await mountBand($, 'terminal')

    await band.press({ key: 'discuss' })

    const pane = await mountPane($, 'terminal')

    w.daemon.speakStatus = 500
    w.queueComplete(said('Uno.'), said('Due.'))
    await say(pane, 'prima')
    await say(pane, 'seconda')

    expect(w.seen.toasts).toEqual([TOAST.voiceSkipped, TOAST.voiceSkipped])
  })

  test('a reply that arrives after the conversation ended is dropped', async ($, on) => {
    const w = world(on)
    const { pane } = await talking($, w)
    const release = w.holdComplete()

    w.queueComplete(said('Tardiva.', 'Una richiesta tardiva.'))

    const send = await sayLater(pane, 'una domanda')
    const pending = send()

    await w.advance(0)
    await $.turn.start(START)
    release()
    await pending
    await w.advance(0)

    expect(await pane.find({ type: 'Text', text: 'Tardiva' })).toBeUndefined()
    expect(await draftOf(pane)).toBeUndefined()
  })

  test('cancelling aborts the model call itself, and so does a turn that starts', async ($, on) => {
    const w = world(on)
    const { pane } = await talking($, w)
    const release = w.holdComplete()
    const send = await sayLater(pane, 'una domanda')
    const pending = send()

    await w.advance(0)

    expect(w.signals).toHaveLength(1)
    expect(w.signals[0]!.aborted).toBe(false)

    await pane.press({ key: 'cancel' })

    expect(w.signals[0]!.aborted).toBe(true)
    release()
    await pending

    const releaseAgain = w.holdComplete()
    const sendAgain = await sayLater(pane, 'e adesso?')
    const pendingAgain = sendAgain()

    await w.advance(0)
    await $.turn.start(START)

    expect(w.signals[1]!.aborted).toBe(true)
    releaseAgain()
    await pendingAgain
  })

  test('a prompt sent in the usual way ends the conversation by itself', async ($, on) => {
    const w = world(on)
    const { pane } = await talking($, w)

    await $.prompt.submit(SUBMIT)

    expect(w.seen.closed).toContain('assistant')
    expect(await pane.findAll({ type: 'Text' })).toHaveLength(0)
  })

  test('the panel is drawn on the terminal and on the desktop', async ($, on) => {
    const w = world(on)

    w.setSurfaces(['terminal', 'desktop'])
    await $.session.start(SESSION)
    await answer($, w)

    const band = await mountBand($, 'terminal')

    await band.press({ key: 'discuss' })

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await mountPane($, surface)

      expect([surface, await fieldOf(pane)]).not.toEqual([surface, undefined])
      expect([surface, await pane.find({ type: 'Button', key: 'close' })]).not.toEqual([surface, undefined])
    }
  })

  test('on the desktop the band is not redrawn while the conversation goes on', async ($, on) => {
    const w = world(on)

    w.setSurfaces(['desktop'])

    const { band, pane } = await talking($, w, 'desktop')

    w.queueComplete(said('Una risposta.'))
    await say(pane, 'una domanda')
    await band.drawn()

    const drawn = w.draws()

    await w.advance(30000)
    await band.drawn()

    expect(drawn).toBeGreaterThan(0)
    expect(w.draws()).toBe(drawn)
  })
})
