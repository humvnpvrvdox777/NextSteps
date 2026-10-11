import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type {
  HttpResponse,
  ModelCompleteResult,
  On,
  RenderPropsOf,
  RenderSurface,
  SessionMessage,
} from 'claude-code'

export const LONG_ANSWER =
  'Done: the filter now skips short answers, and the tests cover the three step roles in order.'

export const SESSION = {
  surface: 'terminal',
  isInteractive: true,
  cwd: '/work',
} as const

export const TURN = {
  reason: 'answer',
  answer: LONG_ANSWER,
  durationMs: 1200,
  isAborted: false,
  turnId: 't1',
} as const

export const START = { text: 'go on', turnId: 't2' } as const

export const BAND: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 6,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 6 },
  view: {},
}

export const PANE: RenderPropsOf['Pane'] = {
  title: 'Assistant',
  isFocused: true,
  bodyColumns: 80,
  placement: 'inline',
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
}

export const STEPS = [
  'Write the tests',
  'Run the plugin tests',
  'Try a cheaper model',
] as const

export const REPLY = `Sure.\n<steps>\n1. ${STEPS[0]}\n- ${STEPS[1]}\n"${STEPS[2]}"\n</steps>`

export const USAGE = {
  input_tokens: 10,
  output_tokens: 20,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

export const SUBMIT = {
  text: 'next question',
  wait: false,
  origin: { kind: 'composer' },
} as const

export const PORT = 51234

export const answered = (text: string): ModelCompleteResult => ({
  isAnswered: true,
  text,
  usage: USAGE,
})

export const replyOf = (steps: readonly string[]): ModelCompleteResult =>
  answered(`<steps>\n${steps.join('\n')}\n</steps>`)

export const completed = (text: string): ModelCompleteResult => ({ isAnswered: true, text, usage: USAGE })

export const said = (say: string, handoff?: string): ModelCompleteResult =>
  completed(`<say>${say}</say>${handoff === undefined ? '' : `<handoff>${handoff}</handoff>`}`)

export const mountBand = (
  $: Engine,
  surface: 'terminal' | 'desktop',
  overrides: { hasSurvey?: boolean; isWorking?: boolean; bodyColumns?: number } = {},
) =>
  $.ui.mount({
    plugin: 'next-steps',
    surface,
    component: 'AbovePrompt',
    props: { ...BAND, ...overrides },
  })

export const mountPane = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({
    plugin: 'next-steps',
    surface,
    component: 'Pane',
    requestId: 'assistant',
    props: PANE,
  })

export const isAway = async (band: Awaited<ReturnType<typeof mountBand>>) =>
  (await band.findAll({ type: 'Raster' })).length === 0 &&
  (await band.findAll({ type: 'Svg' })).length === 0 &&
  (await band.findAll({ type: 'Button' })).length === 0 &&
  (await band.find({ type: 'Text', text: /Thinking about how to continue|How do you want|Okay, I will|Ctrl\+V|Reading the answer|Talking it over|Thinking it over|In the prompt|On the clipboard/ })) === undefined

const json = (body: unknown, status = 200): { value: HttpResponse } => ({
  value: { status, ok: status >= 200 && status < 300, headers: {}, text: JSON.stringify(body) },
})

export const COMMAND = {
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

export const world = (on: On, entries: Readonly<Record<string, unknown>> = {}) => {
  const clock = mock.clock(on)
  const store = new Map<string, unknown>(Object.entries(entries))
  let reply: ModelCompleteResult = answered(REPLY)
  let draft = ''
  let isFillable = true
  let clipboardExit = 0
  let isStepsFailing = false
  let surfaces: readonly RenderSurface[] = ['terminal']
  let rows: readonly SessionMessage[] = []
  let submitDrop: string | null = null
  const completes: ModelCompleteResult[] = []
  const gates: Promise<void>[] = []
  const completeGates: Promise<void>[] = []
  // The abort signal of every model call, so that a test can see that a call was really aborted.
  const signals: AbortSignal[] = []
  let endDaemon: () => void = () => {}

  const seen = {
    prompts: [] as string[],
    fills: [] as { text: string; mode: string | undefined }[],
    logs: [] as { text: string; to: string | undefined }[],
    toasts: [] as string[],
    runs: [] as { argv: readonly string[]; stdin: string | undefined }[],
    completes: [] as { model: string; system?: string; prompt: string; effort?: string; maxTokens?: number; timeoutMs?: number }[],
    steps: [] as { model: string; effort?: string; maxTokens?: number }[],
    submits: [] as { text: string; origin: unknown }[],
    opened: [] as string[],
    // Everything a pane was opened with, not only its id.
    opens: [] as { id: string; focus?: boolean; closeOnEscape?: boolean }[],
    closed: [] as string[],
    commands: [] as string[],
  }

  const daemon = {
    spawns: [] as { argv: readonly string[]; cwd: string | undefined; env: Record<string, string> | undefined }[],
    requests: [] as { host: string; path: string; method: string; token: string | undefined; body: { id?: string; text?: string } | undefined }[],
    spoken: [] as string[],
    speaking: false,
    stops: 0,
    quits: 0,
    failure: null as string | null,
    isSilent: false,
    diesAfterReady: false,
    // The status /speak answers with: anything but 200 is a chunk the daemon refused.
    speakStatus: 200,
  }

  // The store is kept here, not by mock.store, so that a test can read what the plugin wrote.
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined }
  })
  // The voice folder as the Voice dropdown lists it: the two voice files of the languages, unless a test names others.
  let voices = ['en_US-ljspeech-high.onnx', 'it_IT-serena-high.onnx']

  on('fs.list', () => ({
    value: voices.map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  mock.env(on, { USERPROFILE: 'C:\\Users\\tester' })

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('prompt.submit', (_$, e) => {
    // A refusal from beneath the plugin, as a settings hook or another plugin may give.
    if (submitDrop !== null) {
      return { drop: submitDrop }
    }

    seen.submits.push({ text: e.text, origin: e.origin })

    return { text: e.text }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))

  on('command.register', (_$, e) => {
    seen.commands.push(e.name)

    return { value: { command: e.name } }
  })

  on('ui.open', (_$, e) => {
    seen.opened.push(e.id)
    seen.opens.push({ id: e.id, focus: e.focus, closeOnEscape: e.closeOnEscape })

    return { value: { isPlaced: true } }
  })

  on('ui.close', (_$, e) => {
    seen.closed.push(e.id)

    return { value: undefined }
  })

  on('session.messages', () => ({ value: rows as never }))

  on('model.complete', async (_$, e, next) => {
    // The steps are one completion over an answer: they get the reply the test set, and they are kept apart from the
    // other completions, which the tests count.
    if (e.prompt.includes('<answer>')) {
      seen.prompts.push(e.prompt)
      seen.steps.push({
        model: e.model,
        ...(e.effort === undefined ? {} : { effort: e.effort }),
        ...(e.maxTokens === undefined ? {} : { maxTokens: e.maxTokens }),
      })

      await (gates.shift() ?? Promise.resolve())

      return isStepsFailing ? { deny: 'steps refused' } : { value: reply }
    }

    signals.push(next.signal)
    seen.completes.push({
      model: e.model,
      ...(e.system === undefined ? {} : { system: e.system }),
      prompt: e.prompt,
      ...(e.effort === undefined ? {} : { effort: e.effort }),
      ...(e.maxTokens === undefined ? {} : { maxTokens: e.maxTokens }),
      ...(e.timeoutMs === undefined ? {} : { timeoutMs: e.timeoutMs }),
    })

    await (completeGates.shift() ?? Promise.resolve())

    return { value: completes.shift() ?? said('Va bene.') }
  })

  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))

  on('prompt.fill', (_$, e) => {
    seen.fills.push({ text: e.text, mode: e.mode })

    // The box takes the text as the host does: a replace sets it, an append adds to what is there.
    if (isFillable) {
      draft = e.mode === 'append' ? draft + e.text : e.text
    }

    return { isFilled: isFillable }
  })

  on('process.run', (_$, e) => {
    seen.runs.push({ argv: e.argv, stdin: e.init?.stdin })

    return {
      value: {
        exitCode: clipboardExit,
        stdout: '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })

  on('process.spawn', async function* (_$, e) {
    daemon.spawns.push({ argv: e.argv, cwd: e.cwd, env: e.env })

    if (daemon.failure !== null) {
      yield { stream: 'stderr' as const, text: `voiced: ${daemon.failure}\n` }

      return { value: { code: 3, signal: null } }
    }

    if (!daemon.isSilent) {
      yield { stream: 'stdout' as const, text: `ready ${PORT}\n` }
    }

    // A daemon that prints ready and is gone in the same breath.
    if (daemon.diesAfterReady) {
      return { value: { code: 1, signal: null } }
    }

    await new Promise<void>(resolve => {
      endDaemon = resolve
    })

    return { value: { code: 0, signal: null } }
  })

  on('http.fetch', (_$, e) => {
    const url = new URL(e.url)
    const body = e.init?.body === undefined ? undefined : (JSON.parse(e.init.body) as { id?: string; text?: string })

    daemon.requests.push({ host: url.hostname, path: url.pathname, method: e.init?.method ?? 'GET', token: e.init?.headers?.['x-token'], body })

    if (url.pathname === '/speak' && daemon.speakStatus !== 200) {
      return json({ ok: false }, daemon.speakStatus)
    }

    if (url.pathname === '/speak') {
      daemon.spoken.push(body?.text ?? '')
      daemon.speaking = true

      return json({ ok: true, queued: daemon.spoken.length })
    }

    if (url.pathname === '/status') {
      return json({ ok: true, ready: true, speaking: daemon.speaking, queued: 0, playing: null, lastError: null })
    }

    if (url.pathname === '/stop') {
      daemon.speaking = false
      daemon.stops += 1

      return json({ ok: true, dropped: 0 })
    }

    if (url.pathname === '/quit') {
      daemon.quits += 1
      endDaemon()

      return json({ ok: true })
    }

    return json({ ok: false }, 404)
  })

  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)

    return { value: undefined }
  })

  on('ui.log', (_$, e) => {
    seen.logs.push({ text: e.text, to: e.to })

    return { value: undefined }
  })

  return {
    seen,
    daemon,
    store,
    signals,
    // The daemon's process ends by itself, as when it crashes or is killed from outside.
    killDaemon: () => endDaemon(),
    setSubmitDrop: (reason: string | null) => {
      submitDrop = reason
    },
    // How many times a remote surface's band was drawn: the hook says so in the debug log each time.
    draws: () => seen.logs.filter(line => line.text.startsWith('next-steps: drew ')).length,
    advance: async (ms: number) => {
      await clock.advance(ms)
      await clock.settle()
    },
    setVoices: (names: string[]) => {
      voices = names
    },
    setReply: (next: ModelCompleteResult) => {
      reply = next
    },
    setDraft: (text: string) => {
      draft = text
    },
    setFillable: (value: boolean) => {
      isFillable = value
    },
    setClipboardExit: (code: number) => {
      clipboardExit = code
    },
    setStepsFailing: (value: boolean) => {
      isStepsFailing = value
    },
    setSurfaces: (next: readonly RenderSurface[]) => {
      surfaces = next
    },
    setRows: (next: readonly SessionMessage[]) => {
      rows = next
    },
    // What the assistant will answer next, in order; once they run out it says "Va bene.".
    queueComplete: (...next: ModelCompleteResult[]) => {
      completes.push(...next)
    },
    hold: () => {
      let release = () => {}

      gates.push(
        new Promise<void>(resolve => {
          release = resolve
        }),
      )

      return release
    },
    holdComplete: () => {
      let release = () => {}

      completeGates.push(
        new Promise<void>(resolve => {
          release = resolve
        }),
      )

      return release
    },
  }
}
