// Every sentence the mod shows or says, in each language. English is the default; the plugin option `language`
// picks the other one. Both tables have the same keys: a test holds them to that.

export const LANGUAGES = ['en', 'it'] as const

export type Language = (typeof LANGUAGES)[number]

export const DEFAULT_LANGUAGE: Language = 'en'

export type Strings = {
  // The Piper voice file of the language, in the voice folder: the one the mod starts for it.
  voiceModel: string
  // The slash command that switches the voice: its name and what it says back.
  command: { name: string; description: string; switchedOn: string; switchedOff: string }
  // The mascot's question, and the three steps numbered for the voice.
  ask: string
  ordinals: readonly [string, string, string]
  // The mascot's line for each phase. The dots of the thinking lines are added by the caller.
  line: { reading: string; thinking: string; replying: string; chatting: string; copied: string; written: string }
  voice: { off: string; on: string; starting: string; unavailable: string }
  placed: { prompt: (count: number, total: number) => string; clipboard: (count: number, total: number) => string }
  button: { talk: string; stop: string }
  pane: {
    title: string
    you: string
    assistant: string
    write: string
    placeholder: string
    thinking: string
    cancel: string
    proposal: string
    copy: string
    send: string
    close: string
  }
  toast: {
    copied: string
    dialog: string
    clipboardFailed: string
    refused: string
    sent: string
    sendFailed: string
    notAccepted: string
    stillAnswering: string
    voiceFailed: string
    voiceLost: string
    voiceSkipped: string
  }
  replyFailed: { limit: string; network: string; empty: string; slow: string; other: string }
  // The assistant's first words when the panel opens.
  opening: string
  // What the voice says in place of what it cannot read out.
  spoken: { code: string; table: string; link: string; path: string; id: string; rest: string }
}

const EN: Strings = {
  voiceModel: 'en_US-ljspeech-high.onnx',
  command: {
    name: 'voice',
    description: 'Turn the voice that reads the answers on or off',
    switchedOn: 'Voice on: it starts in a few seconds.',
    switchedOff: 'Voice off.',
  },
  ask: 'How do you want to continue?',
  ordinals: ['One', 'Two', 'Three'],
  line: {
    reading: 'Reading the answer to you',
    thinking: 'Thinking about how to continue',
    replying: 'Thinking it over',
    chatting: 'Talking it over: write in the panel',
    copied: 'Copied: paste it with Ctrl+V',
    written: 'Okay, I will write it into the prompt',
  },
  voice: { off: 'Voice: off', on: 'Voice: on', starting: 'Voice: starting…', unavailable: 'Voice: unavailable' },
  placed: {
    prompt: (count, total) => `In the prompt: ${count} of ${total}. Press Enter in the prompt to send them.`,
    clipboard: (count, total) =>
      `On the clipboard: ${count} of ${total}. Paste them into the prompt with Ctrl+V, then press Enter.`,
  },
  button: { talk: 'Talk it over', stop: 'Stop' },
  pane: {
    title: 'Assistant',
    you: 'You',
    assistant: 'Assistant',
    write: 'Write:',
    placeholder: 'then press Enter',
    thinking: 'The assistant is thinking…',
    cancel: 'Cancel',
    proposal: 'Request for the project (you can edit it):',
    copy: 'Copy',
    send: 'Send to the project',
    close: 'Close',
  },
  toast: {
    copied: 'Copied to the clipboard: paste it into the prompt with Ctrl+V',
    dialog: 'Close the dialog and try again',
    clipboardFailed: 'Cannot copy to the clipboard',
    refused: 'Cannot write into the prompt',
    sent: 'Sent to the project',
    sendFailed: 'Cannot send it to the project',
    notAccepted: 'The project did not accept the request: it is still here, try again or copy it',
    stillAnswering: 'The assistant is still answering: wait or press Cancel',
    voiceFailed: 'The voice does not start',
    voiceLost: 'The voice stopped: switch it on again with the Voice button',
    voiceSkipped: 'The voice could not read this answer',
  },
  replyFailed: {
    limit: 'Too many requests right now: wait a moment and try again.',
    network: 'I cannot reach the model right now. Try again shortly.',
    empty: 'I did not get a reply. Try again.',
    slow: 'The reply is taking too long: try again.',
    other: 'I cannot reply right now.',
  },
  opening: 'Tell me what you think, or what does not add up: let us talk it over and decide how to continue.',
  spoken: {
    code: 'Code block.',
    table: 'Table.',
    link: 'a link',
    path: 'a path',
    id: 'an identifier',
    rest: 'The rest of the answer is in the text.',
  },
}

const IT: Strings = {
  voiceModel: 'it_IT-serena-high.onnx',
  command: {
    name: 'voce',
    description: 'Accende o spegne la voce che legge le risposte',
    switchedOn: 'Voce attivata: parte tra qualche secondo.',
    switchedOff: 'Voce spenta.',
  },
  ask: 'Come vuoi proseguire?',
  ordinals: ['Uno', 'Due', 'Tre'],
  line: {
    reading: 'Ti leggo la risposta',
    thinking: 'Sto pensando a come proseguire',
    replying: 'Ci penso',
    chatting: 'Ne parliamo: scrivi nel pannello',
    copied: 'Copiato: incollalo con Ctrl+V',
    written: 'Ok, te lo scrivo nel prompt',
  },
  voice: { off: 'Voce: spenta', on: 'Voce: attiva', starting: 'Voce: avvio…', unavailable: 'Voce: non disponibile' },
  placed: {
    prompt: (count, total) => `Nel prompt: ${count} di ${total}. Premi Invio nel prompt per mandarli.`,
    clipboard: (count, total) => `Negli appunti: ${count} di ${total}. Incollali nel prompt con Ctrl+V, poi premi Invio.`,
  },
  button: { talk: 'Discutiamone', stop: 'Stop' },
  pane: {
    title: 'Assistente',
    you: 'Tu',
    assistant: 'Assistente',
    write: 'Scrivi:',
    placeholder: 'poi premi Invio',
    thinking: "L'assistente sta pensando…",
    cancel: 'Annulla',
    proposal: 'Richiesta per il progetto (puoi modificarla):',
    copy: 'Copia',
    send: 'Manda al progetto',
    close: 'Chiudi',
  },
  toast: {
    copied: 'Copiato negli appunti: incollalo nel prompt con Ctrl+V',
    dialog: 'Chiudi la finestra di dialogo e riprova',
    clipboardFailed: 'Non riesco a copiare negli appunti',
    refused: 'Non riesco a scrivere nel prompt',
    sent: 'Mandato al progetto',
    sendFailed: 'Non riesco a mandarlo al progetto',
    notAccepted: 'Il progetto non ha accettato la richiesta: è ancora qui, riprova o copiala',
    stillAnswering: "L'assistente sta ancora rispondendo: aspetta o premi Annulla",
    voiceFailed: 'La voce non parte',
    voiceLost: 'La voce si è fermata: riaccendila dal pulsante Voce',
    voiceSkipped: 'La voce non è riuscita a leggere questa risposta',
  },
  replyFailed: {
    limit: 'Troppe richieste in questo momento: aspetta un attimo e riprova.',
    network: 'Non riesco a raggiungere il modello adesso. Riprova tra poco.',
    empty: 'Non ho ricevuto una risposta. Riprova.',
    slow: 'La risposta sta impiegando troppo: riprova.',
    other: 'Non riesco a rispondere adesso.',
  },
  opening: 'Dimmi cosa ne pensi, o cosa non ti torna: ne parliamo e decidiamo come proseguire.',
  spoken: {
    code: 'Blocco di codice.',
    table: 'Tabella.',
    link: 'un link',
    path: 'un percorso',
    id: 'un identificatore',
    rest: 'Il resto della risposta è nel testo.',
  },
}

export const STRINGS: Record<Language, Strings> = { en: EN, it: IT }

// The option's value, or the default when it names no language the mod has.
export const languageFrom = (value: unknown): Language =>
  LANGUAGES.find(language => language === value) ?? DEFAULT_LANGUAGE
