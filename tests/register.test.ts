import { describe, expect, test } from 'claude-code/testing'

import { FRAME_COLOR, FRAME_MS, poseFor, toCells } from '../hooks/mascot'
import {
  SUGGEST_DELAY_MS,
  THINKING_TIMEOUT_MS,
  TOAST,
  placedLine,
} from '../hooks/steps'
import {
  LONG_ANSWER,
  SESSION,
  START,
  STEPS,
  SUBMIT,
  TURN,
  USAGE,
  answered,
  isAway,
  mountBand,
  replyOf,
  world,
} from './fixtures'

const CLEAR = { reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as const

// The three step buttons only: the band has controls of its own now (Voce, Stop, Talk it over).
const stepsOf = async (band: Awaited<ReturnType<typeof mountBand>>) =>
  (await band.findAll({ type: 'Button' })).filter(button => /^[123]$/.test(String(button.props.hotkey)))

const cellsOf = async (band: Awaited<ReturnType<typeof mountBand>>) =>
  (await band.find({ type: 'Raster' }))?.props.cells

describe('register', () => {
  test('a long answer makes the model suggest three steps, drawn as buttons with hotkeys', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')
    const buttons = await stepsOf(band)

    expect(buttons.map(button => button.props.label)).toEqual([...STEPS])
    expect(buttons.map(button => button.props.hotkey)).toEqual(['1', '2', '3'])
    expect(await band.find({ type: 'Text', text: 'How do you want to continue?' })).toBeDefined()
    expect(w.seen.prompts).toHaveLength(1)
    expect(w.seen.prompts[0]).toContain(LONG_ANSWER)
  })

  test('the mascot goes under what the other mods draw in the band, never over it', async ($, on) => {
    on('ui.render', { component: 'AbovePrompt' }, () => ({
      type: 'Box',
      props: { key: 'other-row' },
      children: [{ type: 'Text', props: {}, children: ['Contesto al 34%.'] }],
    }))
    const w = world(on)

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await mountBand($, surface)
      const root = await band.find({ type: 'Box' })

      const mascots = [...(await band.findAll({ type: 'Raster' })), ...(await band.findAll({ type: 'Svg' }))]

      expect(await band.find({ key: 'other-row' })).toBeDefined()
      expect(mascots).toHaveLength(1)
      expect((root?.children[0] as { props?: { key?: string } } | undefined)?.props?.key).toBe('other-row')
      await band.unmount()
    }
  })

  test('while the model thinks the band shows the mascot and no buttons', async ($, on) => {
    const w = world(on)
    const release = w.hold()

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    expect(await band.find({ type: 'Raster' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /Thinking about how to continue/ })).toBeDefined()
    expect(await stepsOf(band)).toHaveLength(0)

    release()
    await w.advance(0)

    expect(await stepsOf(band)).toHaveLength(3)
  })

  test('a short answer still gets suggestions; a subagent turn and an interrupted turn get none', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.turn.complete({ ...TURN, answer: 'Done.' })
    await $.turn.complete({ ...TURN, agentId: 'agent-1' })
    await $.turn.complete({ ...TURN, reason: 'aborted', isAborted: true })
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    expect(w.seen.prompts).toHaveLength(1)
    expect(await stepsOf(band)).toHaveLength(3)
  })

  test('the support link points at PayPal', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')
    const hrefs = (await band.findAll({ type: 'Link' })).map(link => link.props.href)

    expect(hrefs).toContain('https://paypal.me/bside777')
  })

  test('a session that draws no band does not pay for suggestions', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)

    for (const surfaces of [[], ['vscode']] as const) {
      w.setSurfaces(surfaces)
      await $.turn.complete(TURN)
      await w.advance(SUGGEST_DELAY_MS)
    }

    expect(w.seen.prompts).toHaveLength(0)
  })

  test('the band yields while a turn runs or a survey holds it', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    for (const overrides of [{ isWorking: true }, { hasSurvey: true }]) {
      const band = await mountBand($, 'terminal', overrides)

      expect(await isAway(band)).toBe(true)
    }
  })

  test('choosing a step fills the prompt box and keeps the band, with the step marked', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    await band.press({ key: 'step-2' })

    expect(w.seen.fills).toEqual([{ text: STEPS[1], mode: 'replace' }])
    expect(await stepsOf(band)).toHaveLength(3)
    expect((await stepsOf(band)).map(button => button.props.label)).toEqual([STEPS[0], `✓ ${STEPS[1]}`, STEPS[2]])
  })

  test('a draft already in the box is kept: the step is appended on a new line', async ($, on) => {
    const w = world(on)

    w.setDraft('fix the')
    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    await band.press({ key: 'step-3' })

    expect(w.seen.fills).toEqual([{ text: `\n${STEPS[2]}`, mode: 'append' }])
  })

  test('a refused fill keeps the buttons so the choice can be repeated', async ($, on) => {
    const w = world(on)

    w.setFillable(false)
    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    await band.press({ key: 'step-1' })

    expect(await stepsOf(band)).toHaveLength(3)
    expect(w.seen.toasts).toEqual([TOAST.refused])
    expect(w.seen.runs).toHaveLength(0)
  })

  test('when the app draws its own composer the step goes to the clipboard and the mascot says so', async ($, on) => {
    const w = world(on)

    w.setSurfaces(['desktop'])
    w.setFillable(false)
    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'desktop')

    await band.press({ key: 'step-2' })

    expect(w.seen.runs).toHaveLength(1)
    expect(w.seen.runs[0]?.argv.slice(0, 3)).toEqual(['powershell', '-NoProfile', '-NonInteractive'])
    expect(w.seen.runs[0]?.stdin).toBe(STEPS[1])
    expect(w.seen.toasts).toEqual([TOAST.copied])
    expect(await band.find({ type: 'Text', text: /Ctrl\+V/ })).toBeDefined()
    expect(await stepsOf(band)).toHaveLength(3)
  })

  test('if the clipboard cannot be written the buttons stay and the user is told', async ($, on) => {
    const w = world(on)

    w.setSurfaces(['desktop'])
    w.setFillable(false)
    w.setClipboardExit(1)
    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'desktop')

    await band.press({ key: 'step-3' })

    expect(w.seen.toasts).toEqual([TOAST.clipboardFailed])
    expect(await stepsOf(band)).toHaveLength(3)
  })

  test('a step too long for the band is drawn whole, wrapped onto more rows, and filled whole', async ($, on) => {
    const w = world(on)
    const longStep =
      'Scrivi un test per ogni caso limite del filtro e poi eseguili tutti mostrandomi il risultato completo'

    w.setReply(replyOf([longStep, 'B', 'C']))
    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal', { bodyColumns: 60 })
    const labels = (await stepsOf(band)).map(button => String(button.props.label))

    expect(labels).toEqual([longStep, 'B', 'C'])

    await band.press({ key: 'step-1' })

    expect(w.seen.fills).toEqual([{ text: longStep, mode: 'replace' }])
  })

  test('a new prompt takes the steps away', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    expect(await stepsOf(band)).toHaveLength(3)

    await $.prompt.submit(SUBMIT)

    expect(await isAway(band)).toBe(true)
  })

  test('a clear takes the steps away too', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    await $.session.end(CLEAR)

    expect(await isAway(band)).toBe(true)
  })

  test('a session start clears a band left over, as after a hot reload', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    expect(await stepsOf(band)).toHaveLength(3)

    await $.session.start(SESSION)

    expect(await isAway(band)).toBe(true)
  })

  test('a result that arrives after a new prompt is dropped', async ($, on) => {
    const w = world(on)
    const release = w.hold()

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)
    await $.prompt.submit(SUBMIT)
    release()
    await w.advance(0)

    const band = await mountBand($, 'terminal')

    expect(w.seen.prompts).toHaveLength(1)
    expect(await isAway(band)).toBe(true)
  })

  test('a clear while the model is being asked drops the result', async ($, on) => {
    const w = world(on)
    const release = w.hold()

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)
    await $.session.end(CLEAR)
    release()
    await w.advance(0)

    const band = await mountBand($, 'terminal')

    expect(await isAway(band)).toBe(true)
  })

  test('the next turn starting right after an answer supersedes its suggestion', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await $.turn.start(START)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    expect(w.seen.prompts).toHaveLength(0)
    expect(await isAway(band)).toBe(true)
  })

  test('a second answer supersedes the first one, whichever reply comes back last', async ($, on) => {
    const w = world(on)
    const first = w.hold()
    const second = w.hold()

    await $.session.start(SESSION)
    w.setReply(replyOf(['A1', 'A2', 'A3']))
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)
    w.setReply(replyOf(['B1', 'B2', 'B3']))
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)
    second()
    await w.advance(0)
    first()
    await w.advance(0)

    const band = await mountBand($, 'terminal')
    const buttons = await stepsOf(band)

    expect(buttons.map(button => button.props.label)).toEqual(['B1', 'B2', 'B3'])
  })

  test('an unreadable or failed reply shows nothing and is logged for debugging', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    w.setReply(answered('no tags here'))
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)
    w.setReply({ isAnswered: false, reason: 'empty-reply', usage: USAGE })
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    expect(await isAway(band)).toBe(true)
    expect(w.seen.logs).toEqual([
      { text: 'next-steps: no steps (unreadable reply)', to: 'debug' },
      { text: 'next-steps: no steps (empty-reply)', to: 'debug' },
    ])
  })

  test('a model call that throws is caught, logged for debugging, and the band goes away', async ($, on) => {
    const w = world(on)

    w.setForkFailing(true)
    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    expect(await isAway(band)).toBe(true)
    expect(w.seen.logs).toHaveLength(1)
    expect(w.seen.logs[0]?.text).toMatch(/^next-steps: /)
    expect(w.seen.logs[0]?.to).toBe('debug')
  })

  test('a model call that never returns is given up, and its late reply is dropped', async ($, on) => {
    const w = world(on)
    const release = w.hold()

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    expect(await band.find({ type: 'Text', text: /Thinking about how to continue/ })).toBeDefined()

    await w.advance(THINKING_TIMEOUT_MS)

    expect(await isAway(band)).toBe(true)

    release()
    await w.advance(0)

    expect(await isAway(band)).toBe(true)
  })

  test('the band draws a Raster on the terminal and an Svg on the desktop', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const terminal = await mountBand($, 'terminal')
    const desktop = await mountBand($, 'desktop')

    expect(await terminal.findAll({ type: 'Raster' })).toHaveLength(1)
    expect(await terminal.findAll({ type: 'Svg' })).toHaveLength(0)
    expect(await desktop.findAll({ type: 'Svg' })).toHaveLength(1)
    expect(await desktop.findAll({ type: 'Raster' })).toHaveLength(0)
    expect(await stepsOf(terminal)).toHaveLength(3)
    expect(await stepsOf(desktop)).toHaveLength(3)
  })

  test('the mascot moves with the clock while it thinks', async ($, on) => {
    const w = world(on)
    const release = w.hold()

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')
    const before = (await band.find({ type: 'Raster' }))?.props.cells

    await w.advance(FRAME_MS * 6)

    const after = (await band.find({ type: 'Raster' }))?.props.cells

    expect(typeof before).toBe('string')
    expect(after).not.toBe(before)

    release()
    await w.advance(0)
  })

  test('on the desktop the clock never redraws the band: a redraw resets the hover under the pointer', async ($, on) => {
    const w = world(on)

    w.setSurfaces(['desktop'])
    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'desktop')

    await band.drawn()

    const before = w.draws()

    await w.advance(FRAME_MS * 100)
    await band.drawn()

    expect(before).toBeGreaterThan(0)
    expect(w.draws()).toBe(before)
    expect(await stepsOf(band)).toHaveLength(3)
  })

  // The test above samples the draws only after the writes were made, and the kit coalesces writes: it could never
  // fail. This one looks at the cause instead: which atoms the desktop band reads while it is drawn.
  test('the desktop band reads only the phase, the steps, the placed steps, the way, the voice and the daemon: never the clock, the chat or the draft', async ($, on) => {
    const w = world(on)
    const reads: string[] = []
    let isCounting = false

    on('state.get', async (_$, e, next) => {
      if (isCounting) {
        reads.push(String((e as { key?: string }).key))
      }

      return next(e)
    })

    w.setSurfaces(['desktop'])
    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)
    isCounting = true

    const band = await mountBand($, 'desktop')

    await band.drawn()
    isCounting = false

    expect([...new Set(reads)].sort()).toEqual(['daemon', 'phase', 'placed', 'steps', 'via', 'voice'])
  })

  test('a session with a terminal and a desktop animates the terminal and leaves the desktop band alone', async ($, on) => {
    const w = world(on)

    w.setSurfaces(['terminal', 'desktop'])
    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const terminal = await mountBand($, 'terminal')
    const desktop = await mountBand($, 'desktop')
    const before = (await terminal.find({ type: 'Raster' }))?.props.cells
    const drawn = w.draws()

    await w.advance(FRAME_MS * 6)
    await desktop.drawn()

    expect((await terminal.find({ type: 'Raster' }))?.props.cells).not.toBe(before)
    expect(drawn).toBeGreaterThan(0)
    expect(w.draws()).toBe(drawn)
  })

  test('no clock runs where no terminal draws: nothing is written seven times a second for nobody', async ($, on) => {
    const w = world(on)

    w.setSurfaces(['desktop'])
    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')
    const before = (await band.find({ type: 'Raster' }))?.props.cells

    await w.advance(FRAME_MS * 6)

    expect((await band.find({ type: 'Raster' }))?.props.cells).toBe(before)
  })

  test('the terminal line counts its dots with the clock while it thinks', async ($, on) => {
    const w = world(on)
    const release = w.hold()

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    expect(await band.find({ type: 'Text', text: /^Thinking about how to continue\.$/ })).toBeDefined()

    await w.advance(FRAME_MS * 4)

    expect(await band.find({ type: 'Text', text: /^Thinking about how to continue\.\.$/ })).toBeDefined()

    release()
    await w.advance(0)
  })

  test('the frame timer counts once per tick however many phases it has crossed, and each phase starts from zero', async ($, on) => {
    const w = world(on)
    const release = w.hold()

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    await w.advance(FRAME_MS * 5)

    expect(await cellsOf(band)).toBe(toCells(poseFor('thinking', 5)).cells)

    release()
    await w.advance(0)

    expect(await cellsOf(band)).toBe(toCells(poseFor('asking', 0)).cells)

    await w.advance(FRAME_MS)

    expect(await cellsOf(band)).toBe(toCells(poseFor('asking', 1)).cells)
  })

  test('every band starts its own clock: nothing moves sooner than a full tick after it appears', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const first = await mountBand($, 'terminal')

    await first.press({ key: 'step-1' })
    await $.prompt.submit(SUBMIT)

    expect(await isAway(first)).toBe(true)

    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const second = await mountBand($, 'terminal')

    await w.advance(FRAME_MS * 2 - 1)

    expect(await cellsOf(second)).toBe(toCells(poseFor('asking', 1)).cells)
  })

  test('the desktop mascot animates itself while it thinks and while it asks', async ($, on) => {
    const w = world(on)
    const release = w.hold()

    w.setSurfaces(['desktop'])
    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'desktop')
    const thinking = String((await band.find({ type: 'Svg' }))?.props.source)

    expect(thinking).toContain('<animate')

    release()
    await w.advance(0)

    const asking = String((await band.find({ type: 'Svg' }))?.props.source)

    expect(asking).toContain('<animate')
    expect(asking).not.toBe(thinking)
  })

  test('the desktop line holds still: its dots do not count with the clock', async ($, on) => {
    const w = world(on)
    const release = w.hold()

    w.setSurfaces(['desktop'])
    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'desktop')

    expect(await band.find({ type: 'Text', text: /^Thinking about how to continue\.\.\.$/ })).toBeDefined()

    await w.advance(FRAME_MS * 12)

    expect(await band.find({ type: 'Text', text: /^Thinking about how to continue\.\.\.$/ })).toBeDefined()

    release()
    await w.advance(0)
  })

  test('choosing the three steps one after another puts each into the prompt once, and the band stays', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    await band.press({ key: 'step-3' })
    await band.press({ key: 'step-1' })
    await band.press({ key: 'step-3' })
    await band.press({ key: 'step-2' })

    expect(w.seen.fills).toEqual([
      { text: STEPS[2], mode: 'replace' },
      { text: `\n${STEPS[0]}`, mode: 'append' },
      { text: `\n${STEPS[1]}`, mode: 'append' },
    ])
    expect(await isAway(band)).toBe(false)
    expect((await stepsOf(band)).map(button => button.props.label)).toEqual(STEPS.map(step => `✓ ${step}`))
    expect(await band.find({ type: 'Text', text: placedLine(3, 3, 'prompt') })).toBeDefined()
  })

  test('the band goes away when the prompt is sent, and not before', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    await band.press({ key: 'step-1' })
    await band.press({ key: 'step-2' })

    expect(await isAway(band)).toBe(false)

    await $.prompt.submit(SUBMIT)

    expect(await isAway(band)).toBe(true)
  })

  test('on the desktop the chosen steps go to the clipboard together, one per line, and the band stays until the prompt is sent', async ($, on) => {
    const w = world(on)

    w.setSurfaces(['desktop'])
    w.setFillable(false)
    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'desktop')

    await band.press({ key: 'step-1' })
    await band.press({ key: 'step-3' })

    expect(w.seen.runs.map(run => run.stdin)).toEqual([STEPS[0], `${STEPS[0]}\n${STEPS[2]}`])
    expect(w.seen.toasts).toEqual([TOAST.copied, TOAST.copied])
    expect(await band.find({ type: 'Text', text: placedLine(2, 3, 'clipboard') })).toBeDefined()
    expect(await isAway(band)).toBe(false)

    await $.prompt.submit(SUBMIT)

    expect(await isAway(band)).toBe(true)
  })

  test('a new answer starts with no step marked as placed', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    const band = await mountBand($, 'terminal')

    await band.press({ key: 'step-1' })

    expect((await stepsOf(band)).map(button => button.props.label)).toContain(`✓ ${STEPS[0]}`)

    await $.turn.start(START)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    expect(await stepsOf(band)).toHaveLength(3)
    expect((await stepsOf(band)).map(button => button.props.label)).not.toContain(`✓ ${STEPS[0]}`)
  })

  test('the band is framed in dark teal, the complement of Claude\'s orange, on both surfaces', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await $.turn.complete(TURN)
    await w.advance(SUGGEST_DELAY_MS)

    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await mountBand($, surface)
      const frames = (await band.findAll({ type: 'Box' })).filter(box => box.props.borderStyle !== undefined)

      expect(frames.map(box => [box.props.borderStyle, box.props.borderColor])).toEqual([['round', FRAME_COLOR]])
      await band.unmount()
    }
  })
})
