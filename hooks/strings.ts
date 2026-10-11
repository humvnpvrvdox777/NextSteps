// Every sentence the mod shows or says. English, Italian and Romanian are built in; any other language is translated by
// the model the first time it is needed, and the translation is kept in the store. Placeholders like {count} stay as
// they are in every language. The built-in tables have the same keys: a test holds them to that.

export const LANGUAGES = ['en', 'it', 'ro'] as const

// The key of the language the mod writes in: a built-in code (en, it, ro), or the lowercase English name of any other
// language, such as "french".
export type Language = string

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
  voice: { label: string; off: string; starting: string; unavailable: string }
  // {count} and {total} are filled in by fill().
  placed: { prompt: string; clipboard: string }
  button: { talk: string; stop: string; support: string }
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
  voice: { label: 'Voice:', off: 'Off', starting: 'Voice: starting…', unavailable: 'Voice: unavailable' },
  placed: {
    prompt: 'In the prompt: {count} of {total}. Press Enter in the prompt to send them.',
    clipboard: 'On the clipboard: {count} of {total}. Paste them into the prompt with Ctrl+V, then press Enter.',
  },
  button: { talk: 'Talk it over', stop: 'Stop', support: 'SUPPORT THE CREATOR' },
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
  voice: { label: 'Voce:', off: 'Spenta', starting: 'Voce: avvio…', unavailable: 'Voce: non disponibile' },
  placed: {
    prompt: 'Nel prompt: {count} di {total}. Premi Invio nel prompt per mandarli.',
    clipboard: 'Negli appunti: {count} di {total}. Incollali nel prompt con Ctrl+V, poi premi Invio.',
  },
  button: { talk: 'Discutiamone', stop: 'Stop', support: "SOSTIENI L'AUTORE" },
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

const RO: Strings = {
  voiceModel: 'en_US-ljspeech-high.onnx',
  command: {
    name: 'voce',
    description: 'Pornește sau oprește vocea care citește răspunsurile',
    switchedOn: 'Voce pornită: începe în câteva secunde.',
    switchedOff: 'Voce oprită.',
  },
  ask: 'Cum vrei să continui?',
  ordinals: ['Unu', 'Doi', 'Trei'],
  line: {
    reading: 'Îți citesc răspunsul',
    thinking: 'Mă gândesc cum să continui',
    replying: 'Mă mai gândesc',
    chatting: 'Discutăm: scrie în panou',
    copied: 'Copiat: lipește-l cu Ctrl+V',
    written: 'Bine, îl scriu în prompt',
  },
  voice: { label: 'Voce:', off: 'Oprită', starting: 'Voce: pornire…', unavailable: 'Voce: indisponibilă' },
  placed: {
    prompt: 'În prompt: {count} din {total}. Apasă Enter în prompt ca să le trimiți.',
    clipboard: 'În clipboard: {count} din {total}. Lipește-le în prompt cu Ctrl+V, apoi apasă Enter.',
  },
  button: { talk: 'Discutăm', stop: 'Stop', support: 'SUSȚINE AUTORUL' },
  pane: {
    title: 'Asistent',
    you: 'Tu',
    assistant: 'Asistent',
    write: 'Scrie:',
    placeholder: 'apoi apasă Enter',
    thinking: 'Asistentul se gândește…',
    cancel: 'Anulează',
    proposal: 'Cerere pentru proiect (o poți modifica):',
    copy: 'Copiază',
    send: 'Trimite la proiect',
    close: 'Închide',
  },
  toast: {
    copied: 'Copiat în clipboard: lipește-l în prompt cu Ctrl+V',
    dialog: 'Închide fereastra de dialog și încearcă din nou',
    clipboardFailed: 'Nu pot copia în clipboard',
    refused: 'Nu pot scrie în prompt',
    sent: 'Trimis la proiect',
    sendFailed: 'Nu pot trimite la proiect',
    notAccepted: 'Proiectul nu a acceptat cererea: este încă aici, încearcă din nou sau copiaz-o',
    stillAnswering: 'Asistentul încă răspunde: așteaptă sau apasă Anulează',
    voiceFailed: 'Vocea nu pornește',
    voiceLost: 'Vocea s-a oprit: pornește-o din nou cu butonul Voce',
    voiceSkipped: 'Vocea nu a putut citi acest răspuns',
  },
  replyFailed: {
    limit: 'Prea multe cereri acum: așteaptă puțin și încearcă din nou.',
    network: 'Nu pot ajunge la model acum. Încearcă din nou în curând.',
    empty: 'Nu am primit un răspuns. Încearcă din nou.',
    slow: 'Răspunsul durează prea mult: încearcă din nou.',
    other: 'Nu pot răspunde acum.',
  },
  opening: 'Spune-mi ce crezi sau ce nu ți se pare în regulă: discutăm și hotărâm cum să continuăm.',
  spoken: {
    code: 'Bloc de cod.',
    table: 'Tabel.',
    link: 'un link',
    path: 'o cale',
    id: 'un identificator',
    rest: 'Restul răspunsului este în text.',
  },
}

// The built-in languages, by key. Any other language has no entry: it is translated, and kept in the store.
export const STRINGS = { en: EN, it: IT, ro: RO } as const

// The built-in table of a language, or undefined for any other. Own keys only: "constructor" is not a language.
export const builtInStrings = (language: string): Strings | undefined =>
  Object.prototype.hasOwnProperty.call(STRINGS, language) ? STRINGS[language as keyof typeof STRINGS] : undefined

// The plugin option: a built-in language, or auto, which follows the language of the person's last message.
export const LANGUAGE_OPTIONS = ['auto', ...LANGUAGES] as const

export type LanguageOption = (typeof LANGUAGE_OPTIONS)[number]

export const languageOptionFrom = (value: unknown): LanguageOption =>
  LANGUAGE_OPTIONS.find(option => option === value) ?? 'auto'

// The language a fixed option names; anything else means English.
export const languageFrom = (value: unknown): Language =>
  LANGUAGES.find(language => language === value) ?? DEFAULT_LANGUAGE

// The key for a language the model named, such as "Italian" or "French": the built-in code when there is one.
const BUILT_IN_NAMES: Readonly<Record<string, Language>> = { english: 'en', italian: 'it', romanian: 'ro' }

export const languageKeyFor = (name: string): Language | null => {
  const word = name.toLowerCase().replace(/[^\p{L}]/gu, '')

  if (word === '' || word === 'unknown') {
    return null
  }

  return BUILT_IN_NAMES[word] ?? word
}

// The sentences of a language as flat keys, such as "pane.send" or "ordinals.0": what the model translates.
export type Flat = Record<string, string>

// Keys that are not sentences: a voice file and a command name must stay what they are in every language.
const NOT_TRANSLATED = ['voiceModel', 'command.name']

export const translatableKeys = (): string[] => Object.keys(flatten(EN)).filter(key => !NOT_TRANSLATED.includes(key))

export const flatten = (strings: Strings): Flat => {
  const flat: Flat = {}

  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      flat[path] = value
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}.${index}`))
    } else if (value !== null && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        walk(inner, path === '' ? key : `${path}.${key}`)
      }
    }
  }

  walk(strings, '')

  return flat
}

// The English table with the given sentences put in place: every key not given keeps its English sentence.
export const rebuild = (flat: Flat): Strings => {
  const english = flatten(EN)
  const strings = JSON.parse(JSON.stringify(EN)) as Record<string, unknown>

  for (const key of translatableKeys()) {
    const path = key.split('.')
    const last = path.pop() as string
    const parent = path.reduce<Record<string, unknown>>((node, step) => node[step] as Record<string, unknown>, strings)

    parent[last] = flat[key] ?? english[key]
  }

  return strings as unknown as Strings
}

const placeholdersOf = (text: string): string[] => [...text.matchAll(/\{\w+\}/g)].map(match => match[0]).sort()

// What the model answered for each key, kept only where it is usable: a sentence that keeps the placeholders of the
// English one. Anything else keeps the English sentence.
export const translationFrom = (english: Flat, answer: unknown): Flat => {
  const given = answer !== null && typeof answer === 'object' ? (answer as Record<string, unknown>) : {}
  const flat: Flat = {}

  for (const key of translatableKeys()) {
    const value = given[key]
    const usable =
      typeof value === 'string' &&
      value.trim() !== '' &&
      JSON.stringify(placeholdersOf(value)) === JSON.stringify(placeholdersOf(english[key] ?? ''))

    flat[key] = usable ? value.trim() : (english[key] ?? '')
  }

  return flat
}

// Puts the values into a template: {name} becomes values.name, and a placeholder with no value stays as it is.
export const fill = (template: string, values: Readonly<Record<string, string | number>>): string =>
  template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match))
