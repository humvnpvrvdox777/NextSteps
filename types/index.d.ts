export type Phase = 'idle' | 'reading' | 'thinking' | 'asking' | 'chatting' | 'replying' | 'chosen'
export type Via = 'prompt' | 'clipboard'
export type Daemon = 'off' | 'starting' | 'ready' | 'failed'

export type ChatLine = {
  who: 'user' | 'assistant'
  text: string
  isError?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'next-steps': {
      phase: Phase
      steps: readonly string[]
      placed: readonly string[]
      tick: number
      via: Via
      voice: boolean
      daemon: Daemon
      busy: boolean
      chat: readonly ChatLine[]
      draft: string
      glow: boolean
    }
  }
}
