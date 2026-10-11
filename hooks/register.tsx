import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, Timer } from 'claude-code'

import type { ChatLine, Daemon, Phase, Via } from '../types'
import { digestOf, failureLine, parseReply, renderPrompt, settingsFrom, systemPrompt, trimHistory } from './assistant'
import { CHOSEN_TICKS, FRAME_COLOR, FRAME_MS, lineFor, poseFor, toCells, toSvg } from './mascot'
import { speakable } from './speakable'
import { STRINGS, languageFrom } from './strings'
import type { Strings } from './strings'
import {
  CLIPBOARD_ARGV,
  SUGGEST_DELAY_MS,
  THINKING_TIMEOUT_MS,
  VOICE_START_TIMEOUT_MS,
  buildPrompt,
  fillFor,
  handoffFor,
  parseSteps,
  placedLine,
  shouldSuggest,
  voiceLabel,
} from './steps'
import { createVoice } from './voice'
import type { Voice, VoicePorts } from './voice'

// Reasons for which the process goes on after a session ended: no `session.start` follows, so the daemon stays.
const KEEPS_PROCESS: readonly string[] = ['clear', 'resume']

const phase = atom({ plugin: 'next-steps', key: 'phase' } as const, 'idle')
const steps = atom({ plugin: 'next-steps', key: 'steps' } as const, [])
// The steps already written into the prompt, in the order they were chosen: each one is kept there once.
const placed = atom({ plugin: 'next-steps', key: 'placed' } as const, [])
const tick = atom({ plugin: 'next-steps', key: 'tick' } as const, 0)
const via = atom({ plugin: 'next-steps', key: 'via' } as const, 'prompt')
const voice = atom({ plugin: 'next-steps', key: 'voice' } as const, false)
const daemon = atom({ plugin: 'next-steps', key: 'daemon' } as const, 'off')
const busy = atom({ plugin: 'next-steps', key: 'busy' } as const, false)
const chat = atom({ plugin: 'next-steps', key: 'chat' } as const, [])
const draft = atom({ plugin: 'next-steps', key: 'draft' } as const, '')

// A Select is not on every surface (not on mobile): the column draws the voice dropdown only where it is.
type Basic = Pick<Elements['terminal'], 'Box' | 'Button' | 'Text'> & Partial<Pick<Elements['terminal'], 'Select'>>

const PANE_ID = 'assistant'
const VOICE_KEY = 'voice'
// The store key of the voice file the person picked, and the dropdown's value that switches the voice off.
const VOICE_FILE_KEY = 'voiceFile'
const VOICE_OFF = 'off'
const POLL_MS = 300
const REPLY_TIMEOUT_MS = 300000
const QUIT_TIMEOUT_MS = 3000
const RECHECK_MS = 150

let generation = 0
let current: Phase = 'idle'
let ticks = 0
let timer: Timer | null = null
let dismissal: Timer | null = null
let queue: Promise<void> = Promise.resolve()
let engine: Voice | null = null
let homeOption = ''
let voiceHome = ''
// The voice file the person picked from the Voice dropdown (null: the language's own), and the voice files the folder
// holds, read at the session start.
let chosenVoice: string | null = null
let voiceFiles: string[] = []
const voiceFile = (): string => chosenVoice ?? strings.voiceModel
let settings = settingsFrom({})
// The texts of the language the plugin option picks; set by register, and read by every hook.
let strings: Strings = STRINGS.en
let lastAnswer = ''
let isSilenced = false
let isStepsReady = false
let isAsking = false
let isCancelled = false
let isSkipToasted = false
let isPaneOpen = false
let controller: AbortController | null = null
let asks = 0
let fieldId = 0
let draftId = 0
let startId = 0
// What the user typed in the proposal field since it was drawn; null until they type, so that the proposal
// itself (the `draft` atom) stands in for it, as it must after a reload that forgot the module's variables.
let draftEdit: string | null = null

const stop = () => {
  timer?.cancel()
  timer = null
}

const pause = ($: EngineInterface, ms: number) =>
  new Promise<void>(resolve => {
    $.clock.after(ms, () => resolve())
  })

// Only the terminal draws its mascot frame by frame. A remote surface plays its own sprite, and a
// redraw there would reset the hover under the pointer, so the clock must never reach it.
const hasTerminal = async ($: EngineInterface) => (await $.session.surfaces()).includes('terminal')

const apply = async (
  $: EngineInterface,
  next: Phase,
  shown: readonly string[],
  how: Via,
) => {
  if (current !== next) {
    return
  }

  await update($, tick, () => 0)
  await update($, via, () => how)
  await update($, phase, () => next)
  await update($, steps, () => shown)

  if (next === 'idle' || current !== next) {
    return
  }

  if (timer === null && (await hasTerminal($)) && current === next) {
    timer = $.clock.every(FRAME_MS, () => {
      ticks += 1
      void update($, tick, () => ticks).catch(() => {})
    })
  }

  if (next === 'chosen' && current === next) {
    dismissal?.cancel()
    dismissal = $.clock.after(CHOSEN_TICKS * FRAME_MS, () => {
      void setPhase($, 'idle').catch(() => {})
    })
  }
}

const setPhase = (
  $: EngineInterface,
  next: Phase,
  shown: readonly string[] = [],
  how: Via = 'prompt',
) => {
  current = next
  ticks = 0
  dismissal?.cancel()
  dismissal = null

  if (next === 'idle') {
    stop()
  }

  queue = queue.catch(() => {}).then(() => apply($, next, shown, how))

  return queue
}

const copyToClipboard = async ($: EngineInterface, text: string) => {
  try {
    const run = await $.process.run(CLIPBOARD_ARGV, { stdin: text, timeoutMs: 8000 })

    return run.exitCode === 0
  } catch {
    return false
  }
}

const ownsComposer = async ($: EngineInterface) => {
  const surfaces = await $.session.surfaces()

  return surfaces.includes('desktop') && !surfaces.includes('terminal')
}

const hasBand = async ($: EngineInterface) => {
  const surfaces = await $.session.surfaces()

  return surfaces.includes('terminal') || surfaces.includes('desktop')
}

// The voice daemon, behind the ports of voice.ts. The first caller's `$` is kept for the daemon's life.
const portsFor = ($: EngineInterface): VoicePorts => ({
  random: bytes => crypto.getRandomValues(new Uint8Array(bytes)),
  spawn: request => {
    const iterator = $.process.spawn(request)[Symbol.asyncIterator]()

    return {
      pieces: { [Symbol.asyncIterator]: () => iterator },
      kill: () => {
        void iterator.return?.(undefined as never)
      },
    }
  },
  call: request =>
    $.http.fetch(`http://127.0.0.1:${request.port}${request.path}`, {
      method: request.method,
      headers: { 'x-token': request.token, 'content-type': 'application/json' },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    }),
})

// The daemon ended on its own after it was ready: the band must say so, and nothing may try to read through it.
const loseVoice = async ($: EngineInterface, why: string) => {
  $.ui.log(`next-steps: the voice ended on its own (${why})`, { to: 'debug' })
  $.ui.toast(strings.toast.voiceLost)
  await update($, daemon, () => 'failed')
}

const getVoice = ($: EngineInterface): Voice => {
  if (engine === null) {
    engine = createVoice(
      portsFor($),
      {
        python: `${voiceHome}\\venv\\Scripts\\python.exe`,
        voice: `${voiceHome}\\voices\\${voiceFile()}`,
        cwd: $.plugin.root,
        startTimeoutMs: VOICE_START_TIMEOUT_MS,
        quitTimeoutMs: QUIT_TIMEOUT_MS,
        recheckMs: RECHECK_MS,
      },
      { sleep: ms => pause($, ms) },
      {
        onLost: why => {
          void loseVoice($, why).catch(() => {})
        },
      },
    )
  }

  return engine
}

const isVoiceReady = () => engine !== null && engine.state() === 'ready'

// A chunk the daemon did not take. A daemon that is gone says so itself (loseVoice); one that refused a chunk is
// still there, so only this answer is lost and the voice stays as it is.
// The toast comes once per answer or reply, however many of its parts fail.
const speakFailed = ($: EngineInterface, error: unknown) => {
  $.ui.log(`next-steps: the voice could not speak (${String(error)})`, { to: 'debug' })

  if (isVoiceReady() && !isSkipToasted) {
    isSkipToasted = true
    $.ui.toast(strings.toast.voiceSkipped)
  }
}

const startVoice = async ($: EngineInterface) => {
  const mine = ++startId

  await update($, daemon, () => 'starting')

  try {
    await getVoice($).start()

    // Switched off, or switched off and on again, while it started: that start is not the current one. And a daemon
    // that is already gone again (loseVoice writes 'failed') must not be written over as ready.
    if (mine === startId && (await read($, voice)) && isVoiceReady()) {
      await update($, daemon, () => 'ready')
    }
  } catch (error) {
    // Switching the voice off while it starts kills the child, and that makes the start fail: not news.
    if (mine !== startId || !(await read($, voice))) {
      return
    }

    const why = error instanceof Error ? error.message : String(error)

    $.ui.log(`next-steps: the voice did not start (${why})`, { to: 'debug' })
    $.ui.toast(`${strings.toast.voiceFailed}: ${why}`)
    await update($, daemon, () => 'off')
    await update($, voice, () => false)
    await $.store.set(VOICE_KEY, false)
  }
}

const stopVoice = async ($: EngineInterface) => {
  isSilenced = true

  if (engine !== null) {
    await engine.stop()
  }
}

const applyVoice = async ($: EngineInterface, wanted: boolean) => {
  await update($, voice, () => wanted)
  await $.store.set(VOICE_KEY, wanted)

  if (wanted) {
    void startVoice($).catch(() => {})

    return
  }

  await stopVoice($)

  if (engine !== null) {
    await engine.quit()
  }

  await update($, daemon, () => 'off')
}

// Switches are done one at a time, in the order they were asked: an "on" must not meet an "off" half done (the daemon
// it would start is the one being quit), and the last one asked is the one that stands.
let switching: Promise<unknown> = Promise.resolve()

const inOrder = <T,>(job: () => Promise<T>): Promise<T> => {
  const done = switching.catch(() => {}).then(job)

  switching = done

  return done
}

// Flips the voice and says what it is now.
const toggleVoice = ($: EngineInterface): Promise<boolean> =>
  inOrder(async () => {
    const wanted = !(await read($, voice))

    await applyVoice($, wanted)

    return wanted
  })

// The Voice dropdown: off switches the voice off; a voice file makes it the one read, and switches the voice on. The
// daemon loads one file for its whole life, so a new file means a new daemon.
const chooseVoice = ($: EngineInterface, value: string): Promise<void> =>
  inOrder(async () => {
    if (value === VOICE_OFF) {
      await applyVoice($, false)

      return
    }

    if (!voiceFileNames().includes(value) || ((await read($, voice)) && value === voiceFile())) {
      return
    }

    chosenVoice = value
    await $.store.set(VOICE_FILE_KEY, value)
    await stopVoice($)

    if (engine !== null) {
      await engine.quit()
      engine = null
    }

    await applyVoice($, true)
  })

// The dropdown's options: off, then every voice file the folder holds, shown without its extension.
// The voice files the dropdown offers: the folder's, and the language's own in case the folder cannot be listed.
const voiceFileNames = (): string[] => [...new Set([...voiceFiles, voiceFile()])]

const voiceChoices = (): { value: string; label: string }[] => [
  { value: VOICE_OFF, label: strings.voice.off },
  ...voiceFileNames().map(file => ({ value: file, label: file.replace(/\.onnx$/, '') })),
]

const refreshVoices = async ($: EngineInterface) => {
  try {
    const entries = await $.fs.list(`${voiceHome}\\voices`)

    voiceFiles = entries
      .filter(entry => entry.kind === 'file' && entry.name.endsWith('.onnx'))
      .map(entry => entry.name)
      .sort()
  } catch (error) {
    voiceFiles = []
    $.ui.log(`next-steps: the voice folder cannot be listed (${String(error)})`, { to: 'debug' })
  }
}

// The voice the person picked earlier, kept in the store; null means the language's own.
const storedVoice = async ($: EngineInterface): Promise<string | null> => {
  const stored = await $.store.get(VOICE_FILE_KEY)

  return typeof stored === 'string' && stored.endsWith('.onnx') ? stored : null
}

// A stored choice that could not be acted on at the session start (no band to draw on yet) is acted on with the
// first answer that has one.
const wakeVoice = async ($: EngineInterface) => {
  if ((await read($, voice)) && (await read($, daemon)) === 'off') {
    void startVoice($).catch(() => {})
  }
}

const speakText = async ($: EngineInterface, text: string) => {
  if (!isVoiceReady()) {
    return
  }

  try {
    await getVoice($).speak(speakable(text, strings.spoken))
  } catch (error) {
    speakFailed($, error)
  }
}

const readAloud = async ($: EngineInterface, answer: string, mine: number) => {
  const speaker = getVoice($)

  try {
    await speaker.speak(speakable(answer, strings.spoken))

    while (mine === generation && !isSilenced && (await speaker.isSpeaking())) {
      await pause($, POLL_MS)
    }
  } catch (error) {
    speakFailed($, error)
  }

  if (mine === generation && !isStepsReady && current === 'reading') {
    await setPhase($, 'thinking')
  }
}

const askAloud = async ($: EngineInterface, found: readonly string[], mine: number) => {
  if (mine !== generation || isSilenced || !isVoiceReady()) {
    return
  }

  const lines = [strings.ask, ...found.map((step, index) => `${strings.ordinals[index] ?? index + 1}. ${step}`)]

  await speakText($, lines.join('\n\n'))
}

const endConversation = async ($: EngineInterface) => {
  asks += 1
  fieldId += 1
  draftId += 1
  controller?.abort()
  controller = null
  isAsking = false
  draftEdit = null

  await update($, chat, () => [])
  await update($, draft, () => '')
  await update($, busy, () => false)
  await update($, placed, () => [])

  if (isPaneOpen) {
    isPaneOpen = false
    await $.ui.close({ id: PANE_ID })
  }
}

// The user acted on this episode: whatever is still being prepared for it, steps and speech, is moot.
const finish = async ($: EngineInterface, how: Via) => {
  generation += 1
  await stopVoice($)
  await endConversation($)
  await setPhase($, 'chosen', [], how)
}

// A chosen step goes into the prompt once, and the band stays with it marked, so that the other steps can join it.
// Nothing is sent here: the band goes away when the person sends that prompt (prompt.submit), or with the conversation.
const choose = async ($: EngineInterface, step: string) => {
  if ((await read($, placed)).includes(step)) {
    return
  }

  await stopVoice($)

  const box = await $.prompt.read()
  const filled = await $.prompt.fill(fillFor(box.text, step))

  if (filled.isFilled) {
    await update($, via, () => 'prompt')
    await update($, placed, list => [...list, step])

    return
  }

  const handoff = handoffFor(filled.refusal, await ownsComposer($))

  if (handoff === 'dialog') {
    $.ui.toast(strings.toast.dialog)

    return
  }

  if (handoff === 'refused') {
    $.ui.toast(strings.toast.refused)

    return
  }

  // The composer belongs to the app: every step chosen so far goes to the clipboard, one per line, so one paste holds all.
  const all = [...(await read($, placed)), step]

  if (await copyToClipboard($, all.join('\n'))) {
    await update($, via, () => 'clipboard')
    await update($, placed, () => all)
    $.ui.toast(strings.toast.copied)

    return
  }

  $.ui.toast(strings.toast.clipboardFailed)
}

const openChat = async ($: EngineInterface) => {
  await stopVoice($)

  const found = await read($, steps)
  const isFirst = (await read($, chat)).length === 0

  if (isFirst) {
    const opening: ChatLine = { who: 'assistant', text: strings.opening }

    await update($, chat, () => [opening])
  }

  // The proposal field is drawn again from the proposal, so what the user changed in it before the panel was
  // closed becomes the proposal; a field they emptied goes back to the proposal as it was.
  if (draftEdit !== null) {
    const edit = draftEdit

    draftEdit = null
    draftId += 1

    if (edit.trim() !== '') {
      await update($, draft, () => edit)
    }
  }

  isPaneOpen = true
  await $.ui.open({ id: PANE_ID, title: strings.pane.title, focus: true, closeOnEscape: true })
  await setPhase($, current === 'replying' ? 'replying' : 'chatting', found)

  if (isFirst) {
    isSilenced = false
    await speakText($, strings.opening)
  }
}

// The old field went with its key; the new one takes the keyboard, so that the next line needs no click. A site that
// does not hold the keyboard (the user went elsewhere) denies it, and then the keyboard is rightly left where it is.
const focusField = async ($: EngineInterface, key: string) => {
  try {
    const result = await $.ui.focus({ requestId: PANE_ID, key })

    if (result.deny !== undefined) {
      $.ui.log(`next-steps: ${key} was not focused (${result.deny})`, { to: 'debug' })
    }
  } catch (error) {
    $.ui.log(`next-steps: ${key} was not focused (${String(error)})`, { to: 'debug' })
  }
}

const ask = async ($: EngineInterface, text: string) => {
  const said = text.trim()

  if (said === '') {
    return
  }

  if (isAsking) {
    // A host may clear a field once its line is submitted: a line that is not taken must say why, not vanish.
    $.ui.toast(strings.toast.stillAnswering)

    return
  }

  isAsking = true
  isCancelled = false
  isSkipToasted = false

  // A new key makes the field a new one, empty, for the next message; the host may not clear it on Enter.
  fieldId += 1

  const mine = ++asks
  const before = await read($, chat)
  const found = await read($, steps)

  draftEdit = null
  await update($, draft, () => '')
  await update($, chat, list => trimHistory([...list, { who: 'user', text: said }]))

  void focusField($, `say-${fieldId}`)

  await update($, busy, () => true)
  await setPhase($, 'replying', found)

  const abort = new AbortController()

  controller = abort

  let line: { who: 'assistant'; text: string; isError?: boolean } | null = null
  let proposal: string | null = null

  try {
    const messages = await $.session.messages()
    const rows = Array.isArray(messages) ? messages.map(message => ({ role: message.role, text: message.text })) : []
    const result = await $.model.complete(
      {
        model: settings.model,
        system: systemPrompt(),
        prompt: renderPrompt({ digest: digestOf(rows), answer: lastAnswer, history: before, user: said }),
        effort: settings.effort,
        maxTokens: settings.maxTokens,
        timeoutMs: REPLY_TIMEOUT_MS,
      },
      { signal: abort.signal },
    )

    if (result.isAnswered) {
      const reply = parseReply(result.text)

      if (reply.say === null) {
        $.ui.log('next-steps: the assistant answered without a <say> block', { to: 'debug' })
      }

      line = { who: 'assistant', text: reply.say ?? result.text.trim() }
      proposal = reply.handoff
    } else {
      const failure = failureLine(result, isCancelled, strings.replyFailed)

      line = failure === null ? null : { who: 'assistant', text: failure, isError: true }
    }
  } catch (error) {
    $.ui.log(`next-steps: ${String(error)}`, { to: 'debug' })
    line = {
      who: 'assistant',
      text: failureLine({ reason: 'api-error', status: null, error: 'unknown' }, false, strings.replyFailed)!,
      isError: true,
    }
  }

  if (mine !== asks) {
    return
  }

  isAsking = false
  controller = null

  if (line !== null) {
    const reply = line

    await update($, chat, list => trimHistory([...list, reply]))
  }

  if (proposal !== null) {
    draftEdit = null
    draftId += 1
    await update($, draft, () => proposal!)
  }

  await update($, busy, () => false)

  // The steps may have come while the assistant was answering: the ones shown now are the ones to keep.
  if (current === 'replying') {
    await setPhase($, 'chatting', await read($, steps))
  }

  if (line !== null && line.isError !== true) {
    await speakText($, line.text)
  }
}

// The panel is free at once; the answer still on its way is dropped when it arrives, whether or not the
// engine honors the abort in time.
const cancelAsk = async ($: EngineInterface) => {
  isCancelled = true
  asks += 1
  controller?.abort()
  controller = null
  isAsking = false

  await update($, busy, () => false)

  if (current === 'replying') {
    await setPhase($, 'chatting', await read($, steps))
  }
}

// What the proposal field holds now: the user's edit, or the proposal itself while they have not typed.
const draftNow = async ($: EngineInterface) => (draftEdit ?? (await read($, draft))).trim()

const copyDraft = async ($: EngineInterface) => {
  const text = await draftNow($)

  if (text === '') {
    return
  }

  if (await copyToClipboard($, text)) {
    $.ui.toast(strings.toast.copied)
    await finish($, 'clipboard')

    return
  }

  $.ui.toast(strings.toast.clipboardFailed)
}

// Enter in the proposal field changes nothing in the text, but a host may blank a field after it: a new field that
// shows the text takes its place. A field the user emptied is left as it is, and sends nothing.
const keepDraft = async ($: EngineInterface, value: string) => {
  draftEdit = value

  if (value.trim() === '') {
    return
  }

  draftId += 1
  await update($, draft, () => value)
}

const sendDraft = async ($: EngineInterface) => {
  const text = await draftNow($)

  if (text === '') {
    return
  }

  let result: Awaited<ReturnType<EngineInterface['prompt']['submit']>>

  try {
    result = await $.prompt.submit({ text, asUser: true })
  } catch (error) {
    $.ui.log(`next-steps: ${String(error)}`, { to: 'debug' })
    $.ui.toast(strings.toast.sendFailed)

    return
  }

  // A hook beneath the plugin (a settings hook, another plugin) may refuse the prompt: nothing was sent.
  if (result.drop !== undefined) {
    $.ui.log(`next-steps: the prompt did not enter (${result.drop})`, { to: 'debug' })
    $.ui.toast(strings.toast.notAccepted)

    return
  }

  $.ui.toast(strings.toast.sent)
  generation += 1
  await endConversation($)
  await setPhase($, 'idle')
}

const findSteps = async ($: EngineInterface, answer: string): Promise<string[]> => {
  let giveUp: (reply: null) => void = () => {}
  const waiting = new Promise<null>(resolve => {
    giveUp = resolve
  })
  const timeout = $.clock.after(THINKING_TIMEOUT_MS, () => giveUp(null))

  try {
    const reply = await Promise.race([$.model.fork({ prompt: buildPrompt(answer) }), waiting])

    if (reply === null) {
      return []
    }

    const found = reply.isAnswered ? parseSteps(reply.text) : []

    if (found.length === 0) {
      const why = reply.isAnswered ? 'unreadable reply' : reply.reason

      $.ui.log(`next-steps: no steps (${why})`, { to: 'debug' })
    }

    return found
  } catch (error) {
    $.ui.log(`next-steps: ${String(error)}`, { to: 'debug' })

    return []
  } finally {
    timeout.cancel()
  }
}

const suggest = async ($: EngineInterface, answer: string, mine: number) => {
  lastAnswer = answer
  isSilenced = false
  isStepsReady = false
  isSkipToasted = false

  const isSpoken = (await read($, voice)) && isVoiceReady()

  try {
    if (mine !== generation) {
      return
    }

    await setPhase($, isSpoken ? 'reading' : 'thinking')

    if (mine !== generation) {
      return
    }

    const reading = isSpoken ? readAloud($, answer, mine).catch(() => {}) : Promise.resolve()
    const found = await findSteps($, answer)

    isStepsReady = true

    if (mine !== generation) {
      return
    }

    await reading

    if (mine !== generation) {
      return
    }

    // While the user talks with the assistant the options only add their buttons, and finding none is not an
    // event: the band and the panel stay as they are.
    if (current === 'chatting' || current === 'replying') {
      if (found.length > 0) {
        await update($, steps, () => found)
      }

      return
    }

    if (found.length === 0) {
      await setPhase($, 'idle')

      return
    }

    await setPhase($, 'asking', found)
    void askAloud($, found, mine).catch(() => {})
  } catch (error) {
    $.ui.log(`next-steps: ${String(error)}`, { to: 'debug' })

    if (mine === generation) {
      await setPhase($, 'idle')
    }
  }
}

const column = (
  $: EngineInterface,
  t: Basic,
  now: Phase,
  frame: number | undefined,
  found: readonly string[],
  how: Via,
  placedSteps: readonly string[],
  voiceOn: boolean,
  state: Daemon,
  choices: readonly { value: string; label: string }[] | null,
  picked: string,
  texts: Strings,
) => {
  const { Box, Button, Select, Text } = t
  const shows = now === 'asking' || now === 'chatting' || now === 'replying'

  return (
    <Box flexDirection="column">
      <Text bold>{lineFor(now, frame, how, texts)}</Text>
      {shows &&
        found.map((step, index) => {
          const isPlaced = placedSteps.includes(step)

          // The label is the whole step, never shortened: the band has room for it and the text wraps onto more rows.
          return (
            <Button
              key={`step-${index + 1}`}
              plain
              hotkey={String(index + 1)}
              label={isPlaced ? `✓ ${step}` : step}
              dimColor={isPlaced}
              onPress={() => choose($, step).catch(() => {})}
            />
          )
        })}
      {shows && placedSteps.length > 0 && (
        <Text dimColor>{placedLine(placedSteps.length, found.length, how, texts.placed)}</Text>
      )}
      {now !== 'chosen' && (
        <Box flexDirection="row" gap={2}>
          {choices !== null && Select !== undefined && (
            <Select
              key="voice"
              label={voiceLabel(voiceOn, state, texts.voice)}
              options={choices}
              value={picked}
              onSelect={value => {
                void chooseVoice($, value).catch(() => {})
              }}
            />
          )}
          {voiceOn && state === 'ready' && (
            <Button key="stop" hotkey="s" label={texts.button.stop} onPress={() => stopVoice($).catch(() => {})} />
          )}
          <Button key="discuss" hotkey="d" label={texts.button.talk} onPress={() => openChat($).catch(() => {})} />
        </Box>
      )}
    </Box>
  )
}

export const register: Register = (on, options) => {
  settings = settingsFrom(options)
  strings = STRINGS[languageFrom(options.language)]
  homeOption = typeof options.voiceHome === 'string' ? options.voiceHome.trim() : ''

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: strings.command.name, description: strings.command.description })

    voiceHome = homeOption !== '' ? homeOption : `${(await $.env.get('USERPROFILE')) ?? ''}\\.claude\\voice`
    chosenVoice = await storedVoice($)
    await refreshVoices($)
    await endConversation($)
    await setPhase($, 'idle')

    const wanted = (await $.store.get(VOICE_KEY)) === true

    await update($, voice, () => wanted)
    await update($, daemon, () => 'off')

    // A session that draws no band has nobody to read to; if one appears later, the first answer wakes the voice.
    if (wanted && (await hasBand($))) {
      void startVoice($).catch(() => {})
    }

    return next(e)
  })

  on('command.run', { command: strings.command.name }, async $ => {
    const wanted = await toggleVoice($)

    return { text: wanted ? strings.command.switchedOn : strings.command.switchedOff }
  })

  on('turn.start', async ($, e, next) => {
    generation += 1
    await stopVoice($)
    await endConversation($)
    await setPhase($, 'idle')

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)

    // A prompt that did not enter (a hook beneath dropped it) changes nothing: the voice, the conversation and the
    // steps still in the making are all still current.
    if (result.drop === undefined) {
      generation += 1
      await stopVoice($)
      await endConversation($)
      await setPhase($, 'idle')
    }

    return result
  })

  on('session.end', async ($, e, next) => {
    generation += 1
    await stopVoice($)
    await endConversation($)
    await setPhase($, 'idle')

    if (!KEEPS_PROCESS.includes(e.reason) && engine !== null) {
      // A start still under way is ended by this quit: it must not report that as a failure and forget the choice.
      startId += 1
      void engine.quit().catch(() => {})
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    if (shouldSuggest(e) && (await hasBand($))) {
      await wakeVoice($)

      const mine = ++generation

      $.clock.after(SUGGEST_DELAY_MS, () => {
        void suggest($, e.answer, mine).catch(() => {})
      })
    }

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = await read($, phase)
    const found = await read($, steps)
    const isEmpty = now === 'idle' || (now === 'asking' && found.length === 0)

    if (isEmpty || e.props.hasSurvey || e.props.isWorking) {
      return next(e)
    }

    const how = await read($, via)
    const voiceOn = await read($, voice)
    // The dropdown shows the voice in use, or off.
    const picked = voiceOn ? voiceFile() : VOICE_OFF
    const state = await read($, daemon)
    const placedSteps = await read($, placed)
    // The band is one slot for every mod: what the others draw (the check-handoff-clean-B7 row)
    // stays on top, the mascot goes under it, never over it.
    const below = await next(e)

    if (e.surface === 'terminal') {
      const frame = await read($, tick)
      const { Box, Raster } = $.ui.resolve(e)
      const sprite = toCells(poseFor(now, frame))

      return (
        <Box flexDirection="column">
          {below}
          <Box flexDirection="column" borderStyle="round" borderColor={FRAME_COLOR} paddingX={1}>
            <Box flexDirection="row" gap={2}>
              <Raster
                key="mascot"
                columns={sprite.columns}
                rows={sprite.rows}
                cells={sprite.cells}
              />
              {column($, $.ui.resolve(e), now, frame, found, how, placedSteps, voiceOn, state, voiceChoices(), picked, strings)}
            </Box>
          </Box>
        </Box>
      )
    }

    // The tick is not read here: a write to it must not draw this instance again.
    const { Box, Svg } = $.ui.resolve(e)
    const sprite = toSvg(now)

    $.ui.log(`next-steps: drew ${now} on ${e.surface}`, { to: 'debug' })

    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="column" borderStyle="round" borderColor={FRAME_COLOR} paddingX={1}>
          <Box flexDirection="row" gap={2}>
            <Svg
              key="mascot"
              source={sprite.source}
              alt="Claude"
              width={sprite.width}
              height={sprite.height}
            />
            {column($, $.ui.resolve(e), now, undefined, found, how, placedSteps, voiceOn, state, e.surface === 'mobile' ? null : voiceChoices(), picked, strings)}
          </Box>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    if (e.surface === 'mobile') {
      return next(e)
    }

    const lines = await read($, chat)
    const isBusy = await read($, busy)
    const proposal = await read($, draft)
    const { Box, Button, Input, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {lines.map((line, index) => (
          <Text key={`line-${index}`} bold={line.who === 'assistant' && line.isError !== true} dimColor={line.isError === true}>
            {`${line.who === 'user' ? strings.pane.you : strings.pane.assistant}: ${line.text}`}
          </Text>
        ))}
        <Input
          key={`say-${fieldId}`}
          label={strings.pane.write}
          placeholder={strings.pane.placeholder}
          autoFocus
          onSubmit={value => {
            void ask($, value).catch(() => {})
          }}
        />
        {isBusy && <Text dimColor>{strings.pane.thinking}</Text>}
        {isBusy && <Button key="cancel" label={strings.pane.cancel} onPress={() => cancelAsk($).catch(() => {})} />}
        {proposal !== '' && (
          <Box flexDirection="column">
            <Text bold>{strings.pane.proposal}</Text>
            <Input
              key={`draft-${draftId}`}
              value={proposal}
              onInput={value => {
                draftEdit = value
              }}
              onSubmit={value => {
                void keepDraft($, value).catch(() => {})
              }}
            />
            <Box flexDirection="row" gap={2}>
              <Button key="copy" label={strings.pane.copy} onPress={() => copyDraft($).catch(() => {})} />
              <Button
                key="send"
                variant="primary"
                label={strings.pane.send}
                onPress={() => sendDraft($).catch(() => {})}
              />
            </Box>
          </Box>
        )}
        <Button key="close" label={strings.pane.close} onPress={() => $.ui.close({ id: PANE_ID }).catch(() => {})} />
      </Box>
    )
  })
}
