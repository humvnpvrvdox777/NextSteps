export type DaemonState = 'off' | 'starting' | 'ready' | 'failed'

export type Piece = {
  stream: 'stdout' | 'stderr'
  text: string
}

export type SpawnRequest = {
  argv: readonly string[]
  cwd: string
  env: Record<string, string>
}

export type CallRequest = {
  port: number
  token: string
  method: 'GET' | 'POST'
  path: string
  body?: unknown
}

export type VoicePorts = {
  random: (bytes: number) => Uint8Array
  spawn: (request: SpawnRequest) => { pieces: AsyncIterable<Piece>; kill: () => void }
  call: (request: CallRequest) => Promise<{ status: number; text: string }>
}

export type VoiceConfig = {
  python: string
  voice: string
  cwd: string
  startTimeoutMs: number
  quitTimeoutMs: number
  recheckMs: number
}

export type VoiceClock = {
  sleep: (ms: number) => Promise<void>
}

export type VoiceListener = {
  // The daemon ended on its own after it was ready (it crashed, or something killed it): `why` is its last word.
  // A quit asked for, and a start that never got ready, are not reported here.
  onLost: (why: string) => void
}

export type Voice = {
  state: () => DaemonState
  lastError: () => string | null
  start: () => Promise<void>
  speak: (chunks: readonly string[]) => Promise<void>
  stop: () => Promise<void>
  isSpeaking: () => Promise<boolean>
  quit: () => Promise<void>
}

type Running = {
  token: string
  port: number | null
  kill: () => void
  starting: Promise<void>
  ended: Promise<void>
}

const TOKEN_BYTES = 16
const ERROR_TAIL = 600
const READY_LINE = /(?:^|\n)ready (\d+)\r?\n/

const hex = (bytes: Uint8Array) => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')

// The voice's lifecycle behind three ports (random bytes, a child process, a loopback call), so that it is
// testable with no process and no network. The secret travels only in the child's environment and is masked in
// every message that leaves this module.
export const createVoice = (ports: VoicePorts, config: VoiceConfig, clock: VoiceClock, listener?: VoiceListener): Voice => {
  let state: DaemonState = 'off'
  let error: string | null = null
  let current: Running | null = null
  let sequence = 0
  let generation = 0

  const mask = (text: string, token: string) => (token === '' ? text : text.split(token).join('***'))
  const seconds = (ms: number) => Math.round(ms / 1000)

  const launch = (token: string): Running => {
    const child = ports.spawn({
      argv: [config.python, '-m', 'voiced', '--port', '0', '--voice', config.voice],
      cwd: config.cwd,
      env: { VOICED_TOKEN: token, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' },
    })
    let becomeReady: () => void = () => {}
    let fail: (reason: Error) => void = () => {}
    let isReady = false

    const running: Running = {
      token,
      port: null,
      kill: child.kill,
      starting: new Promise<void>((resolve, reject) => {
        becomeReady = resolve
        fail = reject
      }),
      ended: Promise.resolve(),
    }

    // Whoever does not wait for the start must not see its failure as an unhandled rejection.
    running.starting.catch(() => {})

    running.ended = (async () => {
      let out = ''
      let written = ''

      try {
        for await (const piece of child.pieces) {
          if (piece.stream === 'stderr') {
            written = (written + piece.text).slice(-ERROR_TAIL)
            continue
          }

          if (isReady) {
            continue
          }

          out += piece.text

          const found = READY_LINE.exec(out)

          if (found !== null) {
            running.port = Number(found[1])
            isReady = true
            out = ''

            if (current === running) {
              state = 'ready'
            }

            becomeReady()
          } else {
            out = out.slice(out.lastIndexOf('\n') + 1)
          }
        }
      } catch (thrown) {
        written = `${written}${String(thrown)}`.slice(-ERROR_TAIL)
      }

      const last = written.trim().split(/\r?\n/).filter(line => line.trim() !== '').pop()
      const why = mask(last ?? (isReady ? 'the voice process ended' : 'the voice process ended before it was ready'), token)

      if (!isReady) {
        fail(new Error(why))
      }

      if (current === running && (state === 'starting' || state === 'ready')) {
        state = 'failed'
        error = why

        if (isReady) {
          listener?.onLost(why)
        }
      }
    })()

    void clock.sleep(config.startTimeoutMs).then(() => {
      if (!isReady && current === running && state === 'starting') {
        const why = `the voice was not ready in ${seconds(config.startTimeoutMs)} s`

        state = 'failed'
        error = why
        fail(new Error(why))
        running.kill()
      }
    })

    return running
  }

  const readyDaemon = (): Running & { port: number } => {
    if (current === null || state !== 'ready' || current.port === null) {
      throw new Error('the voice is not ready')
    }

    return current as Running & { port: number }
  }

  const call = (running: Running & { port: number }, method: 'GET' | 'POST', path: string, body?: unknown) =>
    ports.call({ port: running.port, token: running.token, method, path, ...(body === undefined ? {} : { body }) })

  const isSpeakingNow = async (): Promise<boolean> => {
    try {
      const result = await call(readyDaemon(), 'GET', '/status')

      if (result.status !== 200) {
        return false
      }

      const status = JSON.parse(result.text) as { speaking?: unknown; queued?: unknown }

      return status.speaking === true || (typeof status.queued === 'number' && status.queued > 0)
    } catch {
      return false
    }
  }

  return {
    state: () => state,

    lastError: () => error,

    start: () => {
      if (current !== null && (state === 'starting' || state === 'ready')) {
        return current.starting
      }

      state = 'starting'
      error = null

      const running = launch(hex(ports.random(TOKEN_BYTES)))

      current = running

      return running.starting
    },

    speak: async chunks => {
      const running = readyDaemon()
      const mine = generation

      for (const text of chunks) {
        if (generation !== mine || current !== running || state !== 'ready') {
          return
        }

        sequence += 1

        const result = await call(running, 'POST', '/speak', { id: `c${sequence}`, text })

        if (result.status !== 200) {
          throw new Error(`the voice refused a chunk (status ${result.status})`)
        }
      }
    },

    stop: async () => {
      generation += 1

      if (current === null || state !== 'ready' || current.port === null) {
        return
      }

      try {
        await call(current as Running & { port: number }, 'POST', '/stop')
      } catch {
        // Best effort: a daemon that cannot be told to stop is reported by its next failure.
      }
    },

    isSpeaking: async () => {
      if (state !== 'ready') {
        return false
      }

      if (await isSpeakingNow()) {
        return true
      }

      await clock.sleep(config.recheckMs)

      return isSpeakingNow()
    },

    quit: async () => {
      const running = current

      if (running === null) {
        return
      }

      generation += 1
      current = null
      state = 'off'
      error = null

      if (running.port !== null) {
        try {
          await ports.call({ port: running.port, token: running.token, method: 'POST', path: '/quit' })
        } catch {
          // The daemon is killed below if it does not end.
        }
      } else {
        running.kill()
      }

      const hasEnded = await Promise.race([running.ended.then(() => true), clock.sleep(config.quitTimeoutMs).then(() => false)])

      if (!hasEnded) {
        running.kill()
      }
    },
  }
}
