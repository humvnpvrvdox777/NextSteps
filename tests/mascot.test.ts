import { describe, expect, test } from 'claude-code/testing'

import type { Phase } from '../types'
import {
  CHOSEN_TICKS,
  COLORS,
  FRAME_COLOR,
  FRAME_MS,
  PIXEL_ASPECT,
  PIXEL_COLUMNS,
  PIXEL_ROWS,
  lineFor,
  packCells,
  pixelsOf,
  poseFor,
  timelineFor,
  toCells,
  toSvg,
} from '../hooks/mascot'
import type { Eyes, Pose, RasterSprite } from '../hooks/mascot'

const REST = poseFor('idle', 0)
const DEFAULT = 0x01000000
const ANIMATED: readonly Phase[] = ['reading', 'thinking', 'asking', 'chatting', 'replying', 'chosen']
const LOOPING: readonly Phase[] = ['reading', 'thinking', 'asking', 'chatting', 'replying']

const hex = (color: number) => `#${color.toString(16).toUpperCase().padStart(6, '0')}`

// The sixteen glyphs by their Unicode names, as [upper left, upper right, lower left, lower right]: an
// oracle written from the standard, not read back from the code under test.
const QUARTERS: Record<number, readonly [boolean, boolean, boolean, boolean]> = {
  0x20: [false, false, false, false],
  0x2598: [true, false, false, false], // QUADRANT UPPER LEFT
  0x259d: [false, true, false, false], // QUADRANT UPPER RIGHT
  0x2596: [false, false, true, false], // QUADRANT LOWER LEFT
  0x2597: [false, false, false, true], // QUADRANT LOWER RIGHT
  0x2580: [true, true, false, false], // UPPER HALF BLOCK
  0x2584: [false, false, true, true], // LOWER HALF BLOCK
  0x258c: [true, false, true, false], // LEFT HALF BLOCK
  0x2590: [false, true, false, true], // RIGHT HALF BLOCK
  0x259a: [true, false, false, true], // QUADRANT UPPER LEFT AND LOWER RIGHT
  0x259e: [false, true, true, false], // QUADRANT UPPER RIGHT AND LOWER LEFT
  0x259b: [true, true, true, false], // QUADRANT UPPER LEFT AND UPPER RIGHT AND LOWER LEFT
  0x259c: [true, true, false, true], // QUADRANT UPPER LEFT AND UPPER RIGHT AND LOWER RIGHT
  0x2599: [true, false, true, true], // QUADRANT UPPER LEFT AND LOWER LEFT AND LOWER RIGHT
  0x259f: [false, true, true, true], // QUADRANT UPPER RIGHT AND LOWER LEFT AND LOWER RIGHT
  0x2588: [true, true, true, true], // FULL BLOCK
}

const EVERY_POSE: Pose[] = ([0, 1, 2] as const).flatMap(top =>
  (['open', 'left', 'right', 'up', 'closed', 'happy'] as const).flatMap(eyes =>
    [false, true].flatMap(isArmUp => [false, true].map(isTapping => ({ top, eyes, isArmUp, isTapping }))),
  ),
)

const cellAt = (cells: string, columns: number, row: number, column: number) => {
  const words = new Uint32Array(Uint8Array.fromBase64(cells).buffer)
  const at = (row * columns + column) * 3

  return [words[at], words[at + 1], words[at + 2]]
}

const rectsOf = (source: string) =>
  [...source.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"\/>/g)].map(match => ({
    x: Number(match[1]),
    y: Number(match[2]),
    width: Number(match[3]),
    height: Number(match[4]),
  }))

const attributesOf = (tag: string) =>
  Object.fromEntries([...tag.matchAll(/([A-Za-z]+)="([^"]*)"/g)].map(match => [match[1], match[2]]))

type Animation = {
  name: string
  type: string | undefined
  values: string[]
  keyTimes: number[]
  begin: number
  ticks: number
  isLooping: boolean
}

// Reads back what the markup animates for one part: the value it holds without animation, the
// animation played once at the start (the intro) and the one that repeats after it (the loop).
const partOf = (source: string, id: string) => {
  const open = new RegExp(`<g id="${id}"([^>]*)>((?:<animate(?:Transform)? [^>]*/>)*)`).exec(source)

  if (open === null) {
    throw new Error(`no part ${id}`)
  }

  const own = attributesOf(open[1] ?? '')
  const base = own.visibility ?? (own.transform ?? '').replace(/^translate\(|\)$/g, '')
  const animations = [...(open[2] ?? '').matchAll(/<animate(?:Transform)? ([^>]*)\/>/g)].map(match => {
    const attributes = attributesOf(match[1] ?? '')

    return {
      name: String(attributes.attributeName),
      type: attributes.type,
      values: String(attributes.values).split(';'),
      keyTimes: String(attributes.keyTimes).split(';').map(Number),
      begin: Math.round(parseFloat(String(attributes.begin)) * 1000 / FRAME_MS),
      ticks: Math.round(parseFloat(String(attributes.dur)) * 1000 / FRAME_MS),
      isLooping: attributes.repeatCount === 'indefinite',
    } satisfies Animation
  })

  const valueIn = (animation: Animation, local: number) => {
    let held = animation.values[0]

    animation.keyTimes.forEach((time, index) => {
      if (Math.round(time * animation.ticks) <= local) {
        held = animation.values[index]
      }
    })

    return held
  }

  return {
    base,
    animations,
    at: (tick: number) => {
      const active = animations.find(
        animation => tick >= animation.begin && (animation.isLooping || tick < animation.begin + animation.ticks),
      )

      if (active === undefined) {
        return base
      }

      const local = tick - active.begin

      return valueIn(active, active.isLooping ? local % active.ticks : local)
    },
  }
}

const EYE_PARTS: readonly (readonly [Exclude<Eyes, 'closed'>, string])[] = [
  ['open', 'eyesOpen'],
  ['left', 'eyesLeft'],
  ['right', 'eyesRight'],
  ['up', 'eyesUp'],
  ['happy', 'eyesHappy'],
]

const BODY_PARTS = ['armDown', 'armUp', 'feet', 'feetTap'] as const
const EVERY_PART = [...BODY_PARTS, ...EYE_PARTS.map(([, id]) => id)]

// What the packed cells show at one art pixel: body, eye, or the terminal's own background.
const shownAt = (sprite: RasterSprite, row: number, column: number): 'B' | 'E' | '.' => {
  const [glyph, foreground, background] = cellAt(sprite.cells, sprite.columns, Math.floor(row / 2), Math.floor(column / 2))
  const quarters = QUARTERS[glyph ?? -1]

  if (quarters === undefined) {
    throw new Error(`glyph U+${(glyph ?? 0).toString(16)} is not a quarter block`)
  }

  const color = quarters[(row % 2) * 2 + (column % 2)] ? foreground : background

  if (color === COLORS.body) {
    return 'B'
  }

  return color === COLORS.eye ? 'E' : '.'
}

// The groups of the markup in document order, each with the ids of the groups it sits inside.
const groupsOf = (source: string) => {
  const stack: string[] = []
  const found: { id: string; inside: string[] }[] = []

  for (const tag of source.matchAll(/<g\b([^>]*)>|<\/g>/g)) {
    if (tag[0] === '</g>') {
      stack.pop()
      continue
    }

    const id = attributesOf(tag[1] ?? '').id ?? ''

    found.push({ id, inside: [...stack] })
    stack.push(id)
  }

  return found
}

const runsIn = (source: string, id: string) =>
  rectsOf(new RegExp(`<g id="${id}"[^>]*>(.*?)</g>`).exec(source)?.[1] ?? '')

// The sprite the markup draws at one tick: visible parts only, moved by what the bob says.
const drawnAt = (source: string, tick: number) => {
  const grid = Array.from({ length: PIXEL_ROWS }, () => Array<string>(PIXEL_COLUMNS).fill('.'))
  const shift = Number(String(partOf(source, 'bob').at(tick)).split(' ')[1]) / PIXEL_ASPECT

  const paint = (id: string, cell: string) => {
    for (const rect of runsIn(source, id)) {
      for (let column = rect.x; column < rect.x + rect.width; column += 1) {
        grid[rect.y / PIXEL_ASPECT + shift]![column] = cell
      }
    }
  }

  paint('torso', 'B')

  for (const id of BODY_PARTS) {
    if (partOf(source, id).at(tick) === 'visible') {
      paint(id, 'B')
    }
  }

  for (const [, id] of EYE_PARTS) {
    if (partOf(source, id).at(tick) === 'visible') {
      paint(id, 'E')
    }
  }

  return grid.map(row => row.join(''))
}

describe('mascot', () => {
  test('the idle pose is the resting sprite one row below the top', () => {
    expect(REST).toEqual({ top: 1, eyes: 'open', isArmUp: false, isTapping: false })
  })

  test('thinking glances up, left, up, right and taps its feet', () => {
    const eyes = [0, 6, 12, 18].map(tick => poseFor('thinking', tick).eyes)

    expect(eyes).toEqual(['up', 'left', 'up', 'right'])
    expect(poseFor('thinking', 2).isTapping).toBe(false)
    expect(poseFor('thinking', 3).isTapping).toBe(true)
  })

  test('asking hops and waves, then rests with a breath, a blink and a glance at the options', () => {
    expect(poseFor('asking', 0).top).toBe(0)
    expect(poseFor('asking', 2).isArmUp).toBe(true)
    expect(poseFor('asking', 4).isArmUp).toBe(false)
    expect(poseFor('asking', 10).top).toBe(1)
    expect(poseFor('asking', 16).top).toBe(2)
    expect(poseFor('asking', 30).eyes).toBe('closed')
    expect(poseFor('asking', 31).eyes).toBe('closed')
    expect(poseFor('asking', 32).eyes).toBe('open')
    expect(poseFor('asking', 40).eyes).toBe('right')
  })

  test('reading talks: a quick bob, one wave of the arm and a blink, every twelve ticks', () => {
    expect([0, 1, 2, 3, 4, 5].map(tick => poseFor('reading', tick).top)).toEqual([1, 1, 2, 2, 1, 1])
    expect([3, 4, 5, 6].map(tick => poseFor('reading', tick).isArmUp)).toEqual([false, true, true, false])
    expect(poseFor('reading', 9).eyes).toBe('closed')
    expect(poseFor('reading', 8).eyes).toBe('open')
    expect(poseFor('reading', 12)).toEqual(poseFor('reading', 0))
    expect(poseFor('reading', 21)).toEqual(poseFor('reading', 9))
  })

  test('chatting listens: eyes toward the panel, a slow breath and a blink', () => {
    expect([0, 11, 12, 23].map(tick => poseFor('chatting', tick).top)).toEqual([1, 1, 2, 2])
    expect(poseFor('chatting', 3).eyes).toBe('right')
    expect(poseFor('chatting', 18).eyes).toBe('closed')
    expect(poseFor('chatting', 19).eyes).toBe('closed')
    expect(poseFor('chatting', 20).eyes).toBe('right')
    expect(poseFor('chatting', 24)).toEqual(poseFor('chatting', 0))
  })

  test('replying is thinking: the mascot does not look away while the assistant works', () => {
    for (let tick = 0; tick < 30; tick += 1) {
      expect(poseFor('replying', tick)).toEqual(poseFor('thinking', tick))
    }
  })

  test('every phase has its own loop length, and an idle mascot has none', () => {
    expect([timelineFor('reading').loop.length, timelineFor('chatting').loop.length, timelineFor('replying').loop.length]).toEqual([12, 24, 24])
    expect(timelineFor('reading').intro).toHaveLength(0)
    expect(timelineFor('idle')).toEqual({ intro: [], loop: [] })
  })

  test('chosen hops with happy eyes and then settles', () => {
    expect(poseFor('chosen', 0)).toMatchObject({ top: 0, eyes: 'happy' })
    expect(poseFor('chosen', 4).top).toBe(0)
    expect(poseFor('chosen', 5).top).toBe(1)
    expect(CHOSEN_TICKS >= 6).toBe(true)
  })

  test('pixelsOf draws a 7 by 18 grid with the eyes on the second body row', () => {
    const grid = pixelsOf(REST)

    expect(grid).toHaveLength(PIXEL_ROWS)
    expect(grid.every(row => row.length === PIXEL_COLUMNS)).toBe(true)
    expect(grid[0]).toBe('.'.repeat(PIXEL_COLUMNS))
    expect(grid[2]).toBe('...BBEBBBBBBEBB...')
    expect(grid[5]).toBe('....B.B....B.B....')
  })

  test('a hop lifts the whole sprite by one row', () => {
    const hop = pixelsOf(poseFor('asking', 0))

    expect(hop[0]).toBe('...BBBBBBBBBBBB...')
    expect(hop[4]).toBe('....B.B....B.B....')
    expect(hop[5]).toBe('.'.repeat(PIXEL_COLUMNS))
  })

  test('a raised arm moves from the side to above it', () => {
    const wave = pixelsOf(poseFor('asking', 2))

    expect(wave[2]).toBe('...BBEBBBBBBEBBBB.')
    expect(wave[3]).toBe('.BBBBBBBBBBBBBB...')
  })

  test('tapping feet move one column inwards', () => {
    expect(pixelsOf(poseFor('thinking', 3))[5]).toBe('.....B.B..B.B.....')
  })

  test('the art pixel is twice as tall as it is wide, as in the terminal mascot it comes from', () => {
    const sprite = toSvg('asking')

    expect(PIXEL_ASPECT).toBe(2)
    expect(sprite.height / PIXEL_ROWS / (sprite.width / PIXEL_COLUMNS)).toBe(PIXEL_ASPECT)
    expect(sprite.source).toContain(`viewBox="0 0 ${PIXEL_COLUMNS} ${PIXEL_ROWS * PIXEL_ASPECT}"`)
    expect(rectsOf(sprite.source).length).toBeGreaterThan(0)
    expect(rectsOf(sprite.source).every(rect => rect.height === PIXEL_ASPECT)).toBe(true)
  })

  test('the silhouette is a stocky 16 by 10 box, not the 16 by 5 strip it was drawn as', () => {
    const rects = rectsOf(toSvg('asking').source)
    const width = Math.max(...rects.map(rect => rect.x + rect.width)) - Math.min(...rects.map(rect => rect.x))
    const height = Math.max(...rects.map(rect => rect.y + rect.height)) - Math.min(...rects.map(rect => rect.y))

    expect(width).toBe(16)
    expect(height).toBe(10)
    expect(width / height).toBeGreaterThan(1.4)
    expect(width / height).toBeLessThan(1.9)
  })

  test('the desktop mascot is 60% of its former 90 by 70 CSS px', () => {
    const sprite = toSvg('asking')

    expect([sprite.width, sprite.height]).toEqual([54, 42])
  })

  // The red, green and blue of a hex color, each 0 to 1.
  const channelsOf = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ]

  // Hue in degrees: the complement of Claude's orange sits about 180 degrees away.
  const hueOf = (hex: string) => {
    const [r, g, b] = channelsOf(hex)
    const high = Math.max(r, g, b)
    const span = high - Math.min(r, g, b)
    const sector = high === r ? (g - b) / span : high === g ? (b - r) / span + 2 : (r - g) / span + 4

    return (sector * 60 + 360) % 360
  }

  test('the band frame is a dark teal that complements the orange body: about 180 degrees apart', () => {
    const body = `#${COLORS.body.toString(16).padStart(6, '0')}`
    const apart = Math.abs(hueOf(FRAME_COLOR) - hueOf(body))

    expect(Math.abs(apart - 180)).toBeLessThan(15)

    const [r, g, b] = channelsOf(FRAME_COLOR)
    const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 2

    expect(lightness).toBeLessThan(0.3)
  })

  test('the svg is a film strip: it animates itself, so nothing has to redraw it', () => {
    for (const phase of ANIMATED) {
      const { source } = toSvg(phase)

      expect(source).toContain('<animate')
      expect(source).toContain('calcMode="discrete"')
      expect(source).not.toContain('<script')
      expect(source.length).toBeLessThan(20000)
    }

    expect(toSvg('idle').source).not.toContain('<animate')
  })

  test('every animation is well formed: one key time per value, from 0 and rising, in a closed group', () => {
    for (const phase of ANIMATED) {
      const { source } = toSvg(phase)
      const tags = [...source.matchAll(/<animate(?:Transform)? ([^>]*)\/>/g)].map(match => attributesOf(match[1] ?? ''))

      expect(tags.length).toBeGreaterThan(0)

      for (const tag of tags) {
        const values = String(tag.values).split(';')
        const times = String(tag.keyTimes).split(';').map(Number)
        const ticks = (parseFloat(String(tag.dur)) * 1000) / FRAME_MS

        // Each key time must fall on a tick, not near it: a rounded 0.21 for 10/48 would move a pose by 30 ms.
        expect(times.every(time => Math.abs(time * ticks - Math.round(time * ticks)) < 0.01)).toBe(true)
        expect(times).toHaveLength(values.length)
        expect(times[0]).toBe(0)
        expect(times.every((time, at) => at === 0 || time > (times[at - 1] ?? 0))).toBe(true)
        expect(times.every(time => time >= 0 && time < 1)).toBe(true)
        expect(tag.calcMode).toBe('discrete')
        expect(String(tag.dur)).toMatch(/^\d+(\.\d+)?s$/)
        expect(String(tag.begin)).toMatch(/^\d+(\.\d+)?s$/)
      }

      expect(source.match(/<g[ >]/g)?.length).toBe(source.match(/<\/g>/g)?.length)
      expect(source.startsWith('<svg ')).toBe(true)
      expect(source.endsWith('</svg>')).toBe(true)
    }
  })

  test('every part is drawn inside the one group that bobs, and only the bob moves', () => {
    for (const phase of ANIMATED) {
      const groups = groupsOf(toSvg(phase).source)

      expect(groups.find(group => group.id === 'bob')?.inside).toEqual([])

      for (const id of ['torso', ...EVERY_PART]) {
        expect([phase, id, groups.find(group => group.id === id)?.inside]).toEqual([phase, id, ['bob']])
      }
    }
  })

  test('each animation drives the attribute its element is drawn with: visibility for a part, a translation for the bob', () => {
    for (const phase of ANIMATED) {
      const { source } = toSvg(phase)
      const bob = partOf(source, 'bob').animations

      // Thinking never moves up or down: its bob track is constant, so it has no animation at all.
      expect([phase, bob.length > 0]).toEqual([phase, phase !== 'thinking' && phase !== 'replying'])
      expect(bob.every(animation => animation.name === 'transform' && animation.type === 'translate')).toBe(true)

      for (const id of EVERY_PART) {
        const names = partOf(source, id).animations.map(animation => `${animation.name}/${animation.type}`)

        expect([phase, id, names.every(name => name === 'visibility/undefined')]).toEqual([phase, id, true])
      }
    }
  })

  test('the body parts are the body colour and the eyes the eye colour, in the svg as on the terminal', () => {
    const { source } = toSvg('asking')

    expect(source).toContain(`<g id="torso" fill="${hex(COLORS.body)}"`)

    for (const id of BODY_PARTS) {
      expect([id, source.includes(`<g id="${id}" fill="${hex(COLORS.body)}"`)]).toEqual([id, true])
    }

    for (const [, id] of EYE_PARTS) {
      expect([id, source.includes(`<g id="${id}" fill="${hex(COLORS.eye)}"`)]).toEqual([id, true])
    }
  })

  test('at every tick the markup draws exactly the pixels of the art: the same geometry as the terminal', () => {
    for (const phase of ANIMATED) {
      const { source } = toSvg(phase)
      const { intro, loop } = timelineFor(phase)

      for (let tick = 0; tick < intro.length + loop.length * 2 + 4; tick += 1) {
        const where = `${phase} tick ${tick}`

        expect([where, drawnAt(source, tick)]).toEqual([where, pixelsOf(poseFor(phase, tick))])
      }
    }
  })

  test('the film strip of every phase plays exactly the poses the terminal draws tick by tick', () => {
    for (const phase of ANIMATED) {
      const { source } = toSvg(phase)
      const timeline = timelineFor(phase)
      const bob = partOf(source, 'bob')
      const parts = {
        armDown: partOf(source, 'armDown'),
        armUp: partOf(source, 'armUp'),
        feet: partOf(source, 'feet'),
        feetTap: partOf(source, 'feetTap'),
        ...Object.fromEntries(EYE_PARTS.map(([, id]) => [id, partOf(source, id)])),
      } as Record<string, ReturnType<typeof partOf>>
      const last = timeline.intro.length + timeline.loop.length * 2 + 5

      for (let tick = 0; tick < last; tick += 1) {
        const pose = poseFor(phase, tick)
        const where = `${phase} tick ${tick}`

        expect([where, bob.at(tick)]).toEqual([where, `0 ${pose.top * PIXEL_ASPECT}`])
        expect([where, parts.armUp?.at(tick)]).toEqual([where, pose.isArmUp ? 'visible' : 'hidden'])
        expect([where, parts.armDown?.at(tick)]).toEqual([where, pose.isArmUp ? 'hidden' : 'visible'])
        expect([where, parts.feetTap?.at(tick)]).toEqual([where, pose.isTapping ? 'visible' : 'hidden'])
        expect([where, parts.feet?.at(tick)]).toEqual([where, pose.isTapping ? 'hidden' : 'visible'])

        for (const [eyes, id] of EYE_PARTS) {
          expect([where, id, parts[id]?.at(tick)]).toEqual([where, id, pose.eyes === eyes ? 'visible' : 'hidden'])
        }
      }
    }
  })

  test('a loop really repeats: the poses after the intro come round again, tick for tick', () => {
    for (const phase of LOOPING) {
      const { intro, loop } = timelineFor(phase)

      for (let at = 0; at < loop.length * 2; at += 1) {
        expect([phase, at, poseFor(phase, intro.length + at)]).toEqual([phase, at, loop[at % loop.length]])
      }
    }
  })

  test('chosen plays once and holds its last pose; idle has nothing to play', () => {
    expect(timelineFor('chosen').loop).toHaveLength(0)
    expect(timelineFor('chosen').intro).toHaveLength(CHOSEN_TICKS)
    expect(timelineFor('idle')).toEqual({ intro: [], loop: [] })
  })

  test('toCells packs quadrant glyphs: nine cells across, each holding two by two art pixels', () => {
    const sprite = toCells(REST)

    expect(sprite.columns).toBe(PIXEL_COLUMNS / 2)
    expect(sprite.rows).toBe(Math.ceil(PIXEL_ROWS / 2))
    expect(cellAt(sprite.cells, sprite.columns, 0, 0)).toEqual([0x20, DEFAULT, DEFAULT])
    expect(cellAt(sprite.cells, sprite.columns, 0, 1)).toEqual([0x2597, COLORS.body, DEFAULT])
    expect(cellAt(sprite.cells, sprite.columns, 0, 2)).toEqual([0x2584, COLORS.body, DEFAULT])
    expect(cellAt(sprite.cells, sprite.columns, 1, 1)).toEqual([0x259f, COLORS.body, DEFAULT])
    expect(cellAt(sprite.cells, sprite.columns, 1, 3)).toEqual([0x2588, COLORS.body, DEFAULT])
  })

  test('an eye is the dark quarter of a cell whose other quarters are body', () => {
    const sprite = toCells(REST)

    expect(cellAt(sprite.cells, sprite.columns, 1, 2)).toEqual([0x2599, COLORS.body, COLORS.eye])
    expect(cellAt(sprite.cells, sprite.columns, 1, 6)).toEqual([0x259f, COLORS.body, COLORS.eye])
  })

  test('a cell that would need three colours keeps its dominant colour and lets the background show for the rest', () => {
    const sprite = packCells(['BE', 'B.'])

    expect(sprite.columns).toBe(1)
    expect(sprite.rows).toBe(1)
    expect(cellAt(sprite.cells, 1, 0, 0)).toEqual([0x258c, COLORS.body, DEFAULT])
  })

  test('every pose reaches the terminal whole: no body pixel lost, nothing painted where there is none, an eye lost only on the edge', () => {
    const lost = new Set<string>()

    for (const pose of EVERY_POSE) {
      const grid = pixelsOf(pose)
      const sprite = toCells(pose)

      grid.forEach((line, row) => {
        ;[...line].forEach((pixel, column) => {
          const shown = shownAt(sprite, row, column)
          const where = `${pose.eyes}@${pose.top}/${pose.isArmUp}/${pose.isTapping} row ${row} column ${column}`

          if (pixel === 'E' && shown === '.') {
            // The cell holds the body, the eye and an empty quarter: a third colour it has no room for.
            const cell = [0, 1].flatMap(down =>
              [0, 1].map(across => grid[Math.floor(row / 2) * 2 + down]?.[Math.floor(column / 2) * 2 + across] ?? '.'),
            )

            expect([where, cell.includes('.')]).toEqual([where, true])
            lost.add(`${pose.eyes}@${pose.top}`)

            return
          }

          expect([where, shown]).toEqual([where, pixel])
        })
      })
    }

    expect([...lost]).toEqual(['up@1'])
  })

  test('glancing up on the terminal leaves two gaps in the top edge, where the desktop draws two dark eyes', () => {
    const sprite = toCells(poseFor('thinking', 0))

    expect(cellAt(sprite.cells, sprite.columns, 0, 2)).toEqual([0x2596, COLORS.body, DEFAULT])
    expect(cellAt(sprite.cells, sprite.columns, 0, 6)).toEqual([0x2597, COLORS.body, DEFAULT])
    expect(cellAt(sprite.cells, sprite.columns, 0, 3)).toEqual([0x2584, COLORS.body, DEFAULT])
  })

  test('two colours that split a cell evenly give the body the glyph and the eye the background', () => {
    const sprite = packCells(['BB', 'EE'])

    expect(cellAt(sprite.cells, 1, 0, 0)).toEqual([0x2580, COLORS.body, COLORS.eye])
  })

  test('lineFor says what the mascot is doing', () => {
    expect(lineFor('thinking', 0)).toBe('Sto pensando a come proseguire.')
    expect(lineFor('thinking', 4)).toBe('Sto pensando a come proseguire..')
    expect(lineFor('thinking', 8)).toBe('Sto pensando a come proseguire...')
    expect(lineFor('thinking', 12)).toBe('Sto pensando a come proseguire.')
    expect(lineFor('asking', 0)).toBe('Come vuoi proseguire?')
    expect(lineFor('chosen', 0)).toBe('Ok, te lo scrivo nel prompt')
    expect(lineFor('chosen', 0, 'prompt')).toBe('Ok, te lo scrivo nel prompt')
    expect(lineFor('chosen', 0, 'clipboard')).toBe('Copiato: incollalo con Ctrl+V')
    expect(lineFor('idle', 0)).toBe('')
  })

  test('without a clock the thinking line keeps its three dots', () => {
    expect(lineFor('thinking', undefined)).toBe('Sto pensando a come proseguire...')
  })

  test('the new phases say what the mascot is doing', () => {
    expect(lineFor('reading', 0)).toBe('Ti leggo la risposta')
    expect(lineFor('chatting', 0)).toBe('Ne parliamo: scrivi nel pannello')
    expect(lineFor('replying', 0)).toBe('Ci penso.')
    expect(lineFor('replying', 4)).toBe('Ci penso..')
    expect(lineFor('replying', 8)).toBe('Ci penso...')
    expect(lineFor('replying', undefined)).toBe('Ci penso...')
  })
})
