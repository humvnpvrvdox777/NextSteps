// Cutting text for a model or a voice. A string is a list of UTF-16 units and an emoji outside the basic plane is
// two of them, so a cut at a fixed length can leave half of one: not text, and the API may refuse it.

const isHigh = (unit: number) => unit >= 0xd800 && unit <= 0xdbff
const isLow = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff

// Whether a cut before the unit at `at` would fall between the two halves of one character.
export const splitsPair = (text: string, at: number): boolean =>
  at > 0 && at < text.length && isHigh(text.charCodeAt(at - 1)) && isLow(text.charCodeAt(at))

// The first `count` units, never ending in the middle of a character.
export const headOf = (text: string, count: number): string => text.slice(0, splitsPair(text, count) ? count - 1 : count)

// The last `count` units, never starting in the middle of a character.
export const tailOf = (text: string, count: number): string => {
  if (text.length <= count) {
    return text
  }

  const start = text.length - count

  return text.slice(splitsPair(text, start) ? start + 1 : start)
}
