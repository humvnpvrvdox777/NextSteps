import { describe, expect, test } from 'claude-code/testing'

import { headOf, splitsPair, tailOf } from '../hooks/text'

// An emoji outside the basic plane is two UTF-16 units: a high one and a low one.
const SMILE = '😀'

describe('text', () => {
  test('a text that fits is returned whole', () => {
    expect(headOf('abc', 3)).toBe('abc')
    expect(tailOf('abc', 3)).toBe('abc')
    expect(headOf('', 5)).toBe('')
    expect(tailOf('', 5)).toBe('')
  })

  test('headOf keeps the first units and tailOf the last ones', () => {
    expect(headOf('abcdef', 4)).toBe('abcd')
    expect(tailOf('abcdef', 4)).toBe('cdef')
    expect(headOf('abcdef', 0)).toBe('')
  })

  test('a cut that would split an emoji drops the whole emoji instead of keeping half of it', () => {
    // a b [high low] c d: units 0 to 5
    expect(headOf(`ab${SMILE}cd`, 3)).toBe('ab')
    expect(headOf(`ab${SMILE}cd`, 4)).toBe(`ab${SMILE}`)
    expect(tailOf(`ab${SMILE}cd`, 3)).toBe('cd')
    expect(tailOf(`ab${SMILE}cd`, 4)).toBe(`${SMILE}cd`)
  })

  test('splitsPair says when a position falls between the two halves of an emoji', () => {
    expect(splitsPair(`ab${SMILE}`, 3)).toBe(true)
    expect(splitsPair(`ab${SMILE}`, 2)).toBe(false)
    expect(splitsPair(`ab${SMILE}`, 4)).toBe(false)
    expect(splitsPair('abc', 1)).toBe(false)
    expect(splitsPair('abc', 0)).toBe(false)
  })

  test('the first and the last pair of the range are pairs, and the units just outside it are not', () => {
    // U+10000 is d800 dc00, the first pair; U+10FFFF is dbff dfff, the last one.
    expect(splitsPair('a𐀀', 2)).toBe(true)
    expect(splitsPair('a􏿿', 2)).toBe(true)
    expect(splitsPair('a퟿\udc00', 2)).toBe(false)
    expect(splitsPair('a\ud800', 2)).toBe(false)
    expect(splitsPair('a\udc00\udc00', 2)).toBe(false)
  })

  test('a lone high or lone low unit is not a pair', () => {
    expect(splitsPair('a\ud83d', 2)).toBe(false)
    expect(splitsPair('\ude00a', 1)).toBe(false)
    expect(splitsPair('\ud83d\ud83d', 1)).toBe(false)
  })
})
