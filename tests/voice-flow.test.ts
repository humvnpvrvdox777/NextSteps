import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { speakable } from '../hooks/speakable'
import { SUGGEST_DELAY_MS, TOAST, VOICE_START_TIMEOUT_MS } from '../hooks/steps'
import { COMMAND, LONG_ANSWER, SESSION, START, STEPS, SUBMIT, TURN, isAway, mountBand, world } from './fixtures'

const CLEAR = { reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as const
const EXIT = { reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } } as const
const HOME = 'C:\\Users\\tester\\.claude\\voice'
const TOKEN = /^[0-9a-f]{32}$/

type World = ReturnType<typeof world>
type Band = Awaited<ReturnType<typeof mountBand>>

// A session whose stored choice is the voice on, with the daemon already up.
const withVoice = async ($: Engine, w: World) => {
  await $.session.start(SESSION)
  await w.advance(0)
}

const answer = async ($: Engine, w: World) => {
  await $.turn.complete(TURN)
  await w.advance(SUGGEST_DELAY_MS)
}

const labelOf = async (band: Band, key: string) => (await band.find({ type: 'Button', key }))?.props.label

const stepButtons = async (band: Band) =>
  (await band.findAll({ type: 'Button' })).filter(button => /^[123]$/.test(String(button.props.hotkey)))

const SAID_ANSWER = speakable(LONG_ANSWER)
const SAID_STEPS = ['Come vuoi proseguire?', ...STEPS.map((step, index) => `${['Uno', 'Due', 'Tre'][index]}. ${step}`)]

describe('voice flow', () => {
  test('with the voice off nothing is started, nothing is said and the band is as it was', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await answer($, w)

    const band = await mountBand($, 'terminal')

    expect(w.daemon.spawns).toHaveLength(0)
    expect(w.daemon.requests).toHaveLength(0)
    expect(await stepButtons(band)).toHaveLength(3)
    expect(await labelOf(band, 'voice')).toBe('Voce: spenta')
  })

  test('a stored choice starts the daemon at session start: no shell, the port left to the system, the secret in its environment', async ($, on) => {
    const w = world(on, { voice: true })

    await withVoice($, w)

    expect(w.daemon.spawns).toHaveLength(1)

    const spawn = w.daemon.spawns[0]!

    expect(spawn.argv).toEqual([`${HOME}\\venv\\Scripts\\python.exe`, '-m', 'voiced', '--port', '0', '--voice', `${HOME}\\voices\\it_IT-serena-high.onnx`])
    expect(spawn.env?.VOICED_TOKEN).toMatch(TOKEN)
    expect(spawn.argv.join(' ')).not.toContain(spawn.env!.VOICED_TOKEN!)
    expect(spawn.cwd).toBeTruthy()
  })

  test('a long answer is read aloud while the steps are prepared, and the band says it is reading', async ($, on) => {
    const w = world(on, { voice: true })

    await withVoice($, w)
    await answer($, w)

    const band = await mountBand($, 'terminal')

    expect(w.daemon.spoken).toEqual(SAID_ANSWER)
    expect(w.seen.prompts).toHaveLength(1)
    expect(await band.find({ type: 'Text', text: 'Ti leggo la risposta' })).toBeDefined()
    expect(await stepButtons(band)).toHaveLength(0)
    expect(await labelOf(band, 'voice')).toBe('Voce: attiva')
  })

  test('when the reading ends the mascot asks aloud, reads the three options and shows the buttons', async ($, on) => {
    const w = world(on, { voice: true })

    await withVoice($, w)
    await answer($, w)

    const band = await mountBand($, 'terminal')

    w.daemon.speaking = false
    await w.advance(1000)

    expect(await band.find({ type: 'Text', text: 'Come vuoi proseguire?' })).toBeDefined()
    expect((await stepButtons(band)).map(button => button.props.label)).toEqual([...STEPS])
    expect(w.daemon.spoken.slice(0, SAID_ANSWER.length)).toEqual(SAID_ANSWER)

    const asked = w.daemon.spoken.slice(SAID_ANSWER.length).join(' ')

    for (const phrase of SAID_STEPS) {
      expect([phrase, asked.includes(phrase)]).toEqual([phrase, true])
    }
  })

  test('steps that come back while the voice still reads wait for it, so the buttons never appear mid-sentence', async ($, on) => {
    const w = world(on, { voice: true })

    await withVoice($, w)
    await answer($, w)
    await w.advance(5000)

    const band = await mountBand($, 'terminal')

    expect(await band.find({ type: 'Text', text: 'Ti leggo la risposta' })).toBeDefined()
    expect(await stepButtons(band)).toHaveLength(0)
  })

  test('when the reading ends before the steps do, the mascot thinks until they arrive', async ($, on) => {
    const w = world(on, { voice: true })
    const release = w.hold()

    await withVoice($, w)
    await answer($, w)
    w.daemon.speaking = false
    await w.advance(1000)

    const band = await mountBand($, 'terminal')

    expect(await band.find({ type: 'Text', text: /Sto pensando/ })).toBeDefined()
    expect(await stepButtons(band)).toHaveLength(0)

    release()
    await w.advance(1000)

    expect(await stepButtons(band)).toHaveLength(3)
  })

  test('the Stop button silences the voice at once, and the options are shown but not read', async ($, on) => {
    const w = world(on, { voice: true })

    await withVoice($, w)
    await answer($, w)

    const band = await mountBand($, 'terminal')

    await band.press({ key: 'stop' })

    expect(w.daemon.stops).toBe(1)

    await w.advance(1000)

    expect(await stepButtons(band)).toHaveLength(3)
    expect(w.daemon.spoken).toEqual(SAID_ANSWER)
  })

  const INTERRUPTIONS = [
    ['a turn that starts', ($: Engine) => $.turn.start(START)],
    ['a prompt that is sent', ($: Engine) => $.prompt.submit(SUBMIT)],
    ['a clear', ($: Engine) => $.session.end(CLEAR)],
  ] as const

  for (const [name, interrupt] of INTERRUPTIONS) {
    test(`reading stops at once on ${name}, and the band goes away`, async ($, on) => {
      const w = world(on, { voice: true })

      await withVoice($, w)
      await answer($, w)

      const band = await mountBand($, 'terminal')

      expect(await band.find({ type: 'Text', text: 'Ti leggo la risposta' })).toBeDefined()

      await interrupt($)

      expect(w.daemon.stops).toBeGreaterThanOrEqual(1)
      expect(await isAway(band)).toBe(true)
    })
  }

  test('a clear leaves the daemon running', async ($, on) => {
    const w = world(on, { voice: true })

    await withVoice($, w)
    await $.session.end(CLEAR)
    await w.advance(0)

    expect(w.daemon.quits).toBe(0)
  })

  test('ending the session quits the daemon', async ($, on) => {
    const w = world(on, { voice: true })

    await withVoice($, w)
    await $.session.end(EXIT)
    await w.advance(0)

    expect(w.daemon.quits).toBe(1)
  })
  test('the Voce button turns the voice on and starts the daemon, and again off and quits it, remembering each choice', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await answer($, w)

    const band = await mountBand($, 'terminal')

    expect(await labelOf(band, 'voice')).toBe('Voce: spenta')

    await band.press({ key: 'voice' })
    await w.advance(0)

    expect(w.daemon.spawns).toHaveLength(1)
    expect(await labelOf(band, 'voice')).toBe('Voce: attiva')
    expect(w.store.get('voice')).toBe(true)

    await band.press({ key: 'voice' })
    await w.advance(0)

    expect(w.daemon.quits).toBe(1)
    expect(await labelOf(band, 'voice')).toBe('Voce: spenta')
    expect(w.store.get('voice')).toBe(false)
  })

  test('the Voce button says the daemon is starting until it is ready', async ($, on) => {
    const w = world(on)

    w.daemon.isSilent = true
    await $.session.start(SESSION)
    await answer($, w)

    const band = await mountBand($, 'terminal')

    await band.press({ key: 'voice' })
    await w.advance(0)

    expect(await labelOf(band, 'voice')).toBe('Voce: avvio…')
  })

  test('a daemon that cannot start turns the voice back off, and a toast says why without the secret', async ($, on) => {
    const w = world(on)

    w.daemon.failure = 'cannot load the voice: no such file'
    await $.session.start(SESSION)
    await answer($, w)

    const band = await mountBand($, 'terminal')

    await band.press({ key: 'voice' })
    await w.advance(0)

    const token = w.daemon.spawns[0]!.env!.VOICED_TOKEN!

    expect(await labelOf(band, 'voice')).toBe('Voce: spenta')
    expect(w.seen.toasts.some(toast => toast.includes(TOAST.voiceFailed) && toast.includes('cannot load the voice: no such file'))).toBe(true)
    expect(w.seen.toasts.join(' ')).not.toContain(token)
    expect(w.store.get('voice')).toBe(false)
  })

  // The silent daemon is a hook of the kit, and a hook that holds its stream for 10 s of the clock raises an error each
  // time (about 0.3 s of real time per 10 s advanced), so this test is given more than the default 5 s.
  test('a daemon that never says ready is given up at the start limit and the voice goes back off', { timeoutMs: 30000 }, async ($, on) => {
    const w = world(on)

    // On the desktop no frame timer runs, so advancing the whole limit costs only that.
    w.setSurfaces(['desktop'])
    w.daemon.isSilent = true
    await $.session.start(SESSION)
    await answer($, w)

    const band = await mountBand($, 'desktop')

    await band.press({ key: 'voice' })
    await w.advance(VOICE_START_TIMEOUT_MS - 1)

    expect(await labelOf(band, 'voice')).toBe('Voce: avvio…')

    await w.advance(1)

    expect(await labelOf(band, 'voice')).toBe('Voce: spenta')
    expect(w.seen.toasts.some(toast => toast.includes(`not ready in ${VOICE_START_TIMEOUT_MS / 1000} s`))).toBe(true)
  })

  test('with the voice on but the daemon not ready, an answer is not read and the steps come as before', async ($, on) => {
    const w = world(on, { voice: true })
    const release = w.hold()

    w.daemon.isSilent = true
    await withVoice($, w)
    await answer($, w)

    const band = await mountBand($, 'terminal')

    // While the steps are made the mascot thinks: it does not say it reads when there is no voice to read with.
    expect(await band.find({ type: 'Text', text: /^Sto pensando/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /Ti leggo/ })).toBeUndefined()

    release()
    await w.advance(0)

    expect(w.daemon.spoken).toHaveLength(0)
    expect(await stepButtons(band)).toHaveLength(3)
    expect(await labelOf(band, 'voice')).toBe('Voce: avvio…')
    // Nothing even tried to speak through a voice that was not ready.
    expect(w.seen.logs.filter(line => line.text.includes('could not speak'))).toEqual([])
    expect(w.seen.toasts).toEqual([])
  })

  test('the slash command voce toggles the voice too, and says so', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)

    expect(w.seen.commands).toEqual(['voce'])

    const on1 = await $.command.run({ command: 'voce', ...COMMAND })

    await w.advance(0)

    expect(on1.text).toMatch(/attivata/i)
    expect(w.store.get('voice')).toBe(true)
    expect(w.daemon.spawns).toHaveLength(1)

    const off = await $.command.run({ command: 'voce', ...COMMAND })

    await w.advance(0)

    expect(off.text).toMatch(/spenta/i)
    expect(w.store.get('voice')).toBe(false)
  })

  test('the Stop button is only there while the voice is on and ready', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await answer($, w)

    const band = await mountBand($, 'terminal')

    expect(await band.find({ type: 'Button', key: 'stop' })).toBeUndefined()

    await band.press({ key: 'voice' })
    await w.advance(0)

    expect(await band.find({ type: 'Button', key: 'stop' })).toBeDefined()
  })

  test('on the desktop the reading band plays its mascot by itself and is not redrawn while it reads', async ($, on) => {
    const w = world(on, { voice: true })

    w.setSurfaces(['desktop'])
    await withVoice($, w)
    await answer($, w)

    const band = await mountBand($, 'desktop')
    const source = String((await band.find({ type: 'Svg' }))?.props.source)

    await band.drawn()

    const drawn = w.draws()

    await w.advance(20000)
    await band.drawn()

    expect(source).toContain('<animate')
    expect(drawn).toBeGreaterThan(0)
    expect(w.draws()).toBe(drawn)
  })

  test('the voice is never asked to speak an answer that is too short to suggest anything', async ($, on) => {
    const w = world(on, { voice: true })

    await withVoice($, w)
    await $.turn.complete({ ...TURN, answer: 'Too short.' })
    await w.advance(SUGGEST_DELAY_MS)

    expect(w.daemon.spoken).toHaveLength(0)
  })

  test('a daemon that dies after it was ready is shown as unavailable, with a toast, and nothing is read', async ($, on) => {
    const w = world(on, { voice: true })

    await withVoice($, w)
    w.killDaemon()
    await w.advance(0)
    await answer($, w)

    const band = await mountBand($, 'terminal')

    expect(await labelOf(band, 'voice')).toBe('Voce: non disponibile')
    expect(await band.find({ type: 'Button', key: 'stop' })).toBeUndefined()
    expect(w.seen.toasts).toEqual([TOAST.voiceLost])
    expect(w.daemon.spoken).toHaveLength(0)
    expect(await stepButtons(band)).toHaveLength(3)
  })

  test('a chunk the daemon refuses does not mark the voice unavailable, and the next answer is read', async ($, on) => {
    const w = world(on, { voice: true })

    await withVoice($, w)
    w.daemon.speakStatus = 500
    await answer($, w)
    w.daemon.speakStatus = 200

    const band = await mountBand($, 'terminal')

    expect(await labelOf(band, 'voice')).toBe('Voce: attiva')
    expect(await band.find({ type: 'Button', key: 'stop' })).toBeDefined()
    expect(w.seen.toasts).toEqual([TOAST.voiceSkipped])

    await $.turn.start(START)
    await answer($, w)
    w.daemon.speaking = false
    await w.advance(1000)

    expect(w.daemon.spoken.length).toBeGreaterThan(0)
  })

  test('each answer the voice cannot read gets its own toast, however many of its parts fail', async ($, on) => {
    const w = world(on, { voice: true })

    await withVoice($, w)
    w.daemon.speakStatus = 500
    await answer($, w)
    await $.turn.start(START)
    await answer($, w)

    expect(w.seen.toasts).toEqual([TOAST.voiceSkipped, TOAST.voiceSkipped])
  })

  test('switching the voice off while it is still starting is not reported as a failure', async ($, on) => {
    const w = world(on)

    w.daemon.isSilent = true
    await $.session.start(SESSION)
    await answer($, w)

    const band = await mountBand($, 'terminal')

    await band.press({ key: 'voice' })
    await w.advance(0)

    // The daemon is told to quit before it is ready: the kit's fake child ends only when it is made to.
    const off = band.press({ key: 'voice' })

    await w.advance(0)
    w.killDaemon()
    await w.advance(3000)
    await off
    await w.advance(0)

    expect(w.seen.toasts).toEqual([])
    expect(await labelOf(band, 'voice')).toBe('Voce: spenta')
    expect(w.store.get('voice')).toBe(false)
  })

  test('a session that ends while the voice is still starting keeps the stored choice and shows no failure', async ($, on) => {
    const w = world(on, { voice: true })

    w.daemon.isSilent = true
    await $.session.start(SESSION)
    await w.advance(0)
    await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
    w.killDaemon()
    await w.advance(3000)

    expect(w.store.get('voice')).toBe(true)
    expect(w.seen.toasts).toEqual([])
  })

  test('two switches in a row are applied in order: off and then on leaves the voice on and working', async ($, on) => {
    const w = world(on, { voice: true })

    await withVoice($, w)

    const first = $.command.run({ command: 'voce', ...COMMAND })
    const second = $.command.run({ command: 'voce', ...COMMAND })
    const [off, again] = await Promise.all([first, second])

    await w.advance(0)
    await answer($, w)

    const band = await mountBand($, 'terminal')

    expect(off.text).toMatch(/spenta/i)
    expect(again.text).toMatch(/attivata/i)
    expect(w.store.get('voice')).toBe(true)
    expect(w.seen.toasts).toEqual([])
    expect(w.daemon.spawns).toHaveLength(2)
    expect(await labelOf(band, 'voice')).toBe('Voce: attiva')
  })

  test('a daemon that dies in the same breath as its ready line is shown as unavailable, not as active', async ($, on) => {
    const w = world(on, { voice: true })

    w.daemon.diesAfterReady = true
    await withVoice($, w)
    await w.advance(0)
    await answer($, w)

    const band = await mountBand($, 'terminal')

    expect(await labelOf(band, 'voice')).toBe('Voce: non disponibile')
    expect(w.seen.toasts).toEqual([TOAST.voiceLost])
    expect(w.daemon.spoken).toHaveLength(0)
  })

  for (const reason of ['prompt_input_exit', 'logout', 'other'] as const) {
    test(`a session that ends with the reason ${reason} quits the daemon`, async ($, on) => {
      const w = world(on, { voice: true })

      await withVoice($, w)
      await $.session.end({ reason, sessionId: 's1', resume: { id: 's1' } })
      await w.advance(0)

      expect(w.daemon.quits).toBe(1)
    })
  }

  test('a session that ends because another one takes its place leaves the daemon running for that one', async ($, on) => {
    const w = world(on, { voice: true })

    await withVoice($, w)
    await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's2' } })
    await w.advance(0)
    await answer($, w)
    w.daemon.speaking = false
    await w.advance(1000)

    const band = await mountBand($, 'terminal')

    expect(w.daemon.quits).toBe(0)
    expect(w.daemon.spawns).toHaveLength(1)
    expect(await labelOf(band, 'voice')).toBe('Voce: attiva')
    expect(w.daemon.spoken.length).toBeGreaterThan(0)
  })

  test('a session that draws no band does not start the voice', async ($, on) => {
    const w = world(on, { voice: true })

    w.setSurfaces([])
    await $.session.start(SESSION)
    await w.advance(0)

    expect(w.daemon.spawns).toHaveLength(0)
  })

  test('a voice that could not start for lack of a band starts with the first answer that has one', async ($, on) => {
    const w = world(on, { voice: true })

    w.setSurfaces([])
    await $.session.start(SESSION)
    await w.advance(0)
    w.setSurfaces(['terminal'])
    await answer($, w)
    await w.advance(0)

    expect(w.daemon.spawns).toHaveLength(1)
  })

  test('choosing an option while the mascot reads the options aloud silences it', async ($, on) => {
    const w = world(on, { voice: true })

    await withVoice($, w)
    await answer($, w)
    w.daemon.speaking = false
    await w.advance(1000)

    const band = await mountBand($, 'terminal')
    const before = w.daemon.stops

    expect(await stepButtons(band)).toHaveLength(3)
    await band.press({ key: 'step-1' })

    expect(w.daemon.stops).toBeGreaterThan(before)
  })

  test('after a Stop the next answer is read again, and its options too', async ($, on) => {
    const w = world(on, { voice: true })

    await withVoice($, w)
    await answer($, w)

    const band = await mountBand($, 'terminal')

    await band.press({ key: 'stop' })
    await $.turn.start(START)
    w.daemon.spoken.length = 0
    await answer($, w)
    w.daemon.speaking = false
    await w.advance(1000)

    expect(w.daemon.spoken.join(' ')).toContain('Come vuoi proseguire?')
  })

  test('each start of the daemon has a random secret of its own', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await answer($, w)

    const band = await mountBand($, 'terminal')

    for (let press = 0; press < 3; press += 1) {
      await band.press({ key: 'voice' })
      await w.advance(0)
    }

    const [first, second] = w.daemon.spawns.map(spawn => spawn.env!.VOICED_TOKEN!)

    expect(w.daemon.spawns).toHaveLength(2)
    expect(first).toMatch(TOKEN)
    expect(second).toMatch(TOKEN)
    expect(first).not.toBe(second)
    expect(first).not.toMatch(/^0+$/)
  })

  test('every request to the daemon goes to loopback with the secret in x-token and the right method', async ($, on) => {
    const w = world(on, { voice: true })

    await withVoice($, w)
    await answer($, w)

    const token = w.daemon.spawns[0]!.env!.VOICED_TOKEN

    expect(w.daemon.requests.length).toBeGreaterThan(0)
    expect(w.daemon.requests.every(request => request.host === '127.0.0.1' && request.token === token)).toBe(true)
    expect(w.daemon.requests.filter(request => request.path === '/speak').every(request => request.method === 'POST' && typeof request.body?.text === 'string')).toBe(true)
    expect(w.daemon.requests.filter(request => request.path === '/status').every(request => request.method === 'GET')).toBe(true)
  })
})
