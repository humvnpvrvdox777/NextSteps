import { describe, expect, test } from 'claude-code/testing'

import { createVoice } from '../hooks/voice'
import type { CallRequest, Piece, SpawnRequest, VoiceConfig, VoicePorts } from '../hooks/voice'

const CONFIG: VoiceConfig = {
  python: 'C:\\voice\\venv\\Scripts\\python.exe',
  voice: 'C:\\voice\\voices\\it_IT-serena-high.onnx',
  cwd: 'C:\\mod',
  startTimeoutMs: 40000,
  quitTimeoutMs: 3000,
  recheckMs: 150,
}

const TOKEN = /^[0-9a-f]{32}$/

const settle = async () => {
  for (let turn = 0; turn < 12; turn += 1) {
    await Promise.resolve()
  }
}

// A clock that moves only when the test says so.
const manualClock = () => {
  let now = 0
  const waiting: { at: number; wake: () => void }[] = []

  return {
    sleep: (ms: number) =>
      new Promise<void>(resolve => {
        waiting.push({ at: now + ms, wake: resolve })
      }),
    advance: async (ms: number) => {
      now += ms

      for (const timer of waiting.filter(timer => timer.at <= now)) {
        waiting.splice(waiting.indexOf(timer), 1)
        timer.wake()
      }

      await settle()
    },
  }
}

// A daemon the test drives: it prints what the test emits and exits when told.
const fakeDaemon = () => {
  const queue: Piece[] = []
  let wake: (() => void) | null = null
  let isOver = false

  const pieces: AsyncIterable<Piece> = {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        while (queue.length === 0 && !isOver) {
          await new Promise<void>(resolve => {
            wake = resolve
          })
        }

        const piece = queue.shift()

        return piece === undefined ? { done: true, value: undefined } : { done: false, value: piece }
      },
    }),
  }

  return {
    pieces,
    emit: (stream: Piece['stream'], text: string) => {
      queue.push({ stream, text })
      wake?.()
    },
    exit: () => {
      isOver = true
      wake?.()
    },
  }
}

type Answer = (request: CallRequest) => { status: number; text: string }

const world = (answers: Partial<Record<string, Answer>> = {}) => {
  const clock = manualClock()
  const daemons: ReturnType<typeof fakeDaemon>[] = []
  const spawned: SpawnRequest[] = []
  const calls: CallRequest[] = []
  const lost: string[] = []
  let kills = 0
  let draws = 0

  const ports: VoicePorts = {
    random: bytes => {
      draws += 1

      return Uint8Array.from({ length: bytes }, (_, index) => (draws * 37 + index * 11) % 256)
    },
    spawn: request => {
      const daemon = fakeDaemon()

      spawned.push(request)
      daemons.push(daemon)

      return {
        pieces: daemon.pieces,
        kill: () => {
          kills += 1
          daemon.exit()
        },
      }
    },
    call: async request => {
      calls.push(request)

      const answer = answers[`${request.method} ${request.path}`]

      if (answer !== undefined) {
        return answer(request)
      }

      if (request.path === '/quit') {
        daemons.at(-1)!.exit()

        return { status: 200, text: '{"ok":true}' }
      }

      if (request.path === '/status') {
        return { status: 200, text: '{"ok":true,"ready":true,"speaking":false,"queued":0,"playing":null,"lastError":null}' }
      }

      return { status: 200, text: '{"ok":true}' }
    },
  }

  return {
    voice: createVoice(ports, CONFIG, clock, { onLost: why => lost.push(why) }),
    clock,
    spawned,
    calls,
    lost,
    kills: () => kills,
    daemon: () => daemons.at(-1)!,
  }
}

const started = async (w: ReturnType<typeof world>) => {
  const pending = w.voice.start()

  w.daemon().emit('stdout', 'ready 51234\n')
  await pending
}

const failure = (pending: Promise<unknown>) =>
  pending.then(
    () => '',
    (error: Error) => error.message,
  )

describe('voice', () => {
  test('start waits for the ready line, and only then is the voice ready', async () => {
    const w = world()

    expect(w.voice.state()).toBe('off')

    const pending = w.voice.start()

    await settle()
    expect(w.voice.state()).toBe('starting')

    w.daemon().emit('stdout', 'ready 51234\n')
    await pending

    expect(w.voice.state()).toBe('ready')
    expect(w.voice.lastError()).toBeNull()
  })

  test('the daemon is started with no shell, the port left to the system and the secret in its environment', async () => {
    const w = world()

    await started(w)

    const request = w.spawned[0]!

    expect(request.argv).toEqual([CONFIG.python, '-m', 'voiced', '--port', '0', '--voice', CONFIG.voice])
    expect(request.cwd).toBe(CONFIG.cwd)
    expect(request.env.VOICED_TOKEN).toMatch(TOKEN)
    expect(request.argv.join(' ')).not.toContain(request.env.VOICED_TOKEN!)
  })

  test('every start has a secret of its own', async () => {
    const w = world()

    await started(w)
    await w.voice.quit()
    await started(w)

    expect(w.spawned).toHaveLength(2)
    expect(w.spawned[0]!.env.VOICED_TOKEN).toMatch(TOKEN)
    expect(w.spawned[1]!.env.VOICED_TOKEN).toMatch(TOKEN)
    expect(w.spawned[0]!.env.VOICED_TOKEN).not.toBe(w.spawned[1]!.env.VOICED_TOKEN)
  })

  test('a ready line split across two pieces, or after other output, is still found', async () => {
    const w = world()
    const pending = w.voice.start()

    w.daemon().emit('stdout', 'loading the model\r\n')
    w.daemon().emit('stdout', 'rea')
    w.daemon().emit('stdout', 'dy 4242\r\n')
    await pending

    expect(w.voice.state()).toBe('ready')

    await w.voice.speak(['ciao'])

    expect(w.calls[0]!.port).toBe(4242)
  })

  test('a port number that arrives in two pieces is read whole, never cut at the first piece', async () => {
    const w = world()
    const pending = w.voice.start()

    w.daemon().emit('stdout', 'ready 42')
    await settle()
    expect(w.voice.state()).toBe('starting')

    w.daemon().emit('stdout', '42\n')
    await pending
    await w.voice.speak(['x'])

    expect(w.calls[0]!.port).toBe(4242)
  })

  test('the word ready inside other output is not the ready line', async () => {
    const w = world()
    const pending = w.voice.start()

    w.daemon().emit('stdout', 'not ready 9999\nalready 8888\n')
    await settle()
    expect(w.voice.state()).toBe('starting')

    w.daemon().emit('stdout', 'ready 7777\n')
    await pending
    await w.voice.speak(['x'])

    expect(w.calls[0]!.port).toBe(7777)
  })

  test('a daemon that exits before it is ready fails the start with what it wrote', async () => {
    const w = world()
    const pending = w.voice.start()

    w.daemon().emit('stderr', 'voiced: cannot load the voice: no such file\n')
    w.daemon().exit()

    expect(await failure(pending)).toMatch(/cannot load the voice: no such file/)
    expect(w.voice.state()).toBe('failed')
    expect(w.voice.lastError()).toMatch(/cannot load the voice/)
  })

  test('a daemon that ends on its own after it was ready is reported once, with its last word', async () => {
    const w = world()

    await started(w)
    w.daemon().emit('stderr', 'voiced: the voice crashed\n')
    w.daemon().exit()
    await settle()

    expect(w.lost).toEqual(['voiced: the voice crashed'])
    expect(w.voice.state()).toBe('failed')
    expect(w.voice.lastError()).toBe('voiced: the voice crashed')
  })

  test('a quit that was asked for is not reported as a loss', async () => {
    const w = world()

    await started(w)
    await w.voice.quit()
    await settle()

    expect(w.lost).toEqual([])
    expect(w.voice.state()).toBe('off')
  })

  test('a daemon that ends before it is ready fails the start and is not reported as a loss', async () => {
    const w = world()
    const pending = w.voice.start()

    w.daemon().exit()

    expect(await failure(pending)).toMatch(/before it was ready/)
    expect(w.lost).toEqual([])
  })

  test('the secret is masked in what is reported as lost', async () => {
    const w = world()

    await started(w)

    const token = w.spawned[0]!.env.VOICED_TOKEN!

    w.daemon().emit('stderr', `voiced: it died with ${token} in its hands\n`)
    w.daemon().exit()
    await settle()

    expect(w.lost).toHaveLength(1)
    expect(w.lost[0]).not.toContain(token)
    expect(w.lost[0]).toContain('***')
  })

  test('a daemon that never says ready is given up after the timeout and stopped', async () => {
    const w = world()
    const outcome = failure(w.voice.start())

    await w.clock.advance(CONFIG.startTimeoutMs - 1)
    expect(w.voice.state()).toBe('starting')

    await w.clock.advance(1)

    expect(await outcome).toMatch(/not ready in 40 s/)
    expect(w.voice.state()).toBe('failed')
    expect(w.kills()).toBe(1)
  })

  test('the secret is never in an error message', async () => {
    const w = world()
    const pending = w.voice.start()
    const token = w.spawned[0]!.env.VOICED_TOKEN!

    w.daemon().emit('stderr', `voiced: something with ${token} in it\n`)
    w.daemon().exit()

    const message = await failure(pending)

    expect(message).not.toContain(token)
    expect(message).toContain('***')
    expect(w.voice.lastError()).not.toContain(token)
  })

  test('start twice shares one daemon; after a failure it starts a new one', async () => {
    const w = world()
    const first = w.voice.start()
    const second = w.voice.start()

    expect(w.spawned).toHaveLength(1)

    w.daemon().exit()
    await failure(first)
    await failure(second)
    expect(w.voice.state()).toBe('failed')

    const third = w.voice.start()

    expect(w.spawned).toHaveLength(2)

    w.daemon().emit('stdout', 'ready 1000\n')
    await third
    expect(w.voice.state()).toBe('ready')
  })

  test('start when the voice is already ready does nothing', async () => {
    const w = world()

    await started(w)
    await w.voice.start()

    expect(w.spawned).toHaveLength(1)
  })

  test('speak sends the chunks one after the other with their own ids, the first chunk first', async () => {
    const w = world()

    await started(w)
    await w.voice.speak(['uno', 'due', 'tre'])

    const speaks = w.calls.filter(call => call.path === '/speak')

    expect(speaks.map(call => (call.body as { text: string }).text)).toEqual(['uno', 'due', 'tre'])
    expect(new Set(speaks.map(call => (call.body as { id: string }).id)).size).toBe(3)
    expect(speaks.every(call => call.port === 51234 && call.method === 'POST')).toBe(true)
    expect(speaks.every(call => TOKEN.test(call.token))).toBe(true)
  })

  test('ids keep counting across calls, so two answers never share one', async () => {
    const w = world()

    await started(w)
    await w.voice.speak(['uno'])
    await w.voice.speak(['due'])

    const ids = w.calls.filter(call => call.path === '/speak').map(call => (call.body as { id: string }).id)

    expect(new Set(ids).size).toBe(2)
  })

  test('a daemon that refuses a chunk fails the speak with the status', async () => {
    const w = world({ 'POST /speak': () => ({ status: 400, text: '{"ok":false,"error":"text must be a non-empty string"}' }) })

    await started(w)

    expect(await failure(w.voice.speak(['x']))).toMatch(/400/)
  })

  test('a speak that is cut off by a stop does not send the rest', async () => {
    const w = world()

    await started(w)

    const pending = w.voice.speak(['uno', 'due', 'tre'])

    await w.voice.stop()
    await pending

    expect(w.calls.filter(call => call.path === '/speak').length).toBeLessThan(3)
  })

  test('speak before the daemon is ready is refused without calling it', async () => {
    const w = world()

    expect(await failure(w.voice.speak(['uno']))).toMatch(/not ready/)
    expect(w.calls).toHaveLength(0)
  })

  test('stop tells the daemon to stop; with no daemon it does nothing', async () => {
    const w = world()

    await w.voice.stop()
    expect(w.calls).toHaveLength(0)

    await started(w)
    await w.voice.stop()

    expect(w.calls.at(-1)).toMatchObject({ method: 'POST', path: '/stop' })
  })

  test('the voice is speaking if either of two polls says so, and idle only when both are idle', async () => {
    const replies = [
      { speaking: false, queued: 0 },
      { speaking: true, queued: 0 },
    ]
    const w = world({
      'GET /status': () => ({ status: 200, text: JSON.stringify({ ok: true, ...replies.shift() }) }),
    })

    await started(w)

    const first = w.voice.isSpeaking()

    await settle()
    await w.clock.advance(CONFIG.recheckMs)
    expect(await first).toBe(true)

    replies.push({ speaking: false, queued: 0 }, { speaking: false, queued: 0 })

    const second = w.voice.isSpeaking()

    await settle()
    await w.clock.advance(CONFIG.recheckMs)
    expect(await second).toBe(false)
  })

  test('a voice that is speaking on the first poll needs no second one', async () => {
    const w = world({ 'GET /status': () => ({ status: 200, text: '{"ok":true,"speaking":true,"queued":2}' }) })

    await started(w)

    expect(await w.voice.isSpeaking()).toBe(true)
    expect(w.calls.filter(call => call.path === '/status')).toHaveLength(1)
  })

  test('chunks still waiting count as speaking, whatever the speaking flag says', async () => {
    const w = world({ 'GET /status': () => ({ status: 200, text: '{"ok":true,"speaking":false,"queued":2}' }) })

    await started(w)

    expect(await w.voice.isSpeaking()).toBe(true)
  })

  test('a status the daemon cannot give counts as not speaking, so a broken daemon never holds the band', async () => {
    const w = world({ 'GET /status': () => ({ status: 500, text: 'oops' }) })

    await started(w)

    const pending = w.voice.isSpeaking()

    await settle()
    await w.clock.advance(CONFIG.recheckMs)

    expect(await pending).toBe(false)
  })

  test('with no daemon the voice is not speaking', async () => {
    const w = world()

    expect(await w.voice.isSpeaking()).toBe(false)
    expect(w.calls).toHaveLength(0)
  })

  test('quit asks the daemon to quit and waits for it to end', async () => {
    const w = world()

    await started(w)
    await w.voice.quit()

    expect(w.calls.at(-1)).toMatchObject({ method: 'POST', path: '/quit' })
    expect(w.voice.state()).toBe('off')
    expect(w.kills()).toBe(0)
  })

  test('a daemon that does not end after quit is killed', async () => {
    const w = world({ 'POST /quit': () => ({ status: 200, text: '{"ok":true}' }) })

    await started(w)

    const pending = w.voice.quit()

    await settle()
    await w.clock.advance(CONFIG.quitTimeoutMs)
    await pending

    expect(w.kills()).toBe(1)
    expect(w.voice.state()).toBe('off')
  })

  test('quit with no daemon does nothing', async () => {
    const w = world()

    await w.voice.quit()

    expect(w.calls).toHaveLength(0)
    expect(w.voice.state()).toBe('off')
  })

  test('quit while the daemon is still starting ends it', async () => {
    const w = world()
    const starting = failure(w.voice.start())

    await settle()
    await w.voice.quit()
    await starting

    expect(w.voice.state()).toBe('off')
    expect(w.kills()).toBe(1)
  })

  test('a daemon that dies after it was ready leaves the voice failed, with the reason', async () => {
    const w = world()

    await started(w)
    w.daemon().emit('stderr', 'voiced: the sound card went away\n')
    w.daemon().exit()
    await settle()

    expect(w.voice.state()).toBe('failed')
    expect(w.voice.lastError()).toMatch(/sound card went away/)
    expect(await failure(w.voice.speak(['x']))).toMatch(/not ready/)
  })
})
