// Function words that mark a message as English or Italian: a message in one of them uses several, one in the other
// almost none. Words that both languages share are left out.
const WORDS: Record<'en' | 'it', ReadonlySet<string>> = {
  en: new Set([
    'the', 'and', 'is', 'are', 'to', 'of', 'that', 'this', 'with', 'for', 'you', 'not', 'what', 'how', 'can', 'do',
    'my', 'be', 'have', 'please', 'why', 'would', 'should', 'there',
  ]),
  it: new Set([
    'il', 'lo', 'la', 'le', 'gli', 'che', 'non', 'per', 'sono', 'come', 'con', 'di', 'del', 'della', 'questo', 'questa',
    'anche', 'ma', 'perché', 'ho', 'hai', 'è', 'un', 'una', 'mi', 'ti', 'vuoi', 'fare', 'cosa', 'puoi', 'nel', 'sul',
  ]),
}

// Two function words are the least that say a message is in one language.
const MIN_HITS = 2

// The language of a message when its function words say so: 'en' or 'it'. Null when they do not: too short, mixed,
// a tie, or a language that has no words in this list. The model decides those.
export const detectLanguage = (text: string): 'en' | 'it' | null => {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? []
  const hits = (language: 'en' | 'it'): number => words.filter(word => WORDS[language].has(word)).length
  const en = hits('en')
  const it = hits('it')

  if (Math.max(en, it) < MIN_HITS || en === it) {
    return null
  }

  return it > en ? 'it' : 'en'
}
