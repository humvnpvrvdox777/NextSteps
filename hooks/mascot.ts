import type { Phase, Via } from '../types'
import { STRINGS } from './strings'
import type { Strings } from './strings'

export type Eyes = 'open' | 'left' | 'right' | 'up' | 'closed' | 'happy'

export type Pose = {
  top: number
  eyes: Eyes
  isArmUp: boolean
  isTapping: boolean
}

export type Timeline = {
  intro: readonly Pose[]
  loop: readonly Pose[]
}

export type SvgSprite = {
  source: string
  width: number
  height: number
}

export type RasterSprite = {
  columns: number
  rows: number
  cells: string
}

export const PIXEL_COLUMNS = 18
export const PIXEL_ROWS = 7
export const PIXEL_ASPECT = 2
// 3 CSS px per pixel: the desktop mascot is 54 by 42, 60% of the 90 by 70 it was at 5.
export const SVG_SCALE = 3
export const FRAME_MS = 140
export const CHOSEN_TICKS = 6
export const COLORS = { body: 0xd97757, eye: 0x2b1a14 } as const
// The band's outline: a dark teal that complements Claude's orange body (hue about 195 degrees against 15).
export const FRAME_COLOR = '#155A65'

const HEX = { B: '#D97757', E: '#2B1A14' } as const
const DEFAULT_COLOR = 0x01000000
const GLANCES: readonly Eyes[] = ['up', 'left', 'up', 'right']

// Quarter-block glyphs by the quarters they fill: 1 upper left, 2 upper right, 4 lower left, 8 lower right.
const QUARTER_GLYPHS = [
  0x20, 0x2598, 0x259d, 0x2580, 0x2596, 0x258c, 0x259e, 0x259b, 0x2597, 0x259a, 0x2590, 0x259c, 0x2584, 0x2599,
  0x259f, 0x2588,
] as const

type Cell = 'B' | 'E'
type Run = readonly [row: number, column: number, length: number]

// The art is drawn in quarter blocks of a terminal cell, so one of its pixels is as wide as it is
// half a cell and as tall as half a cell, which is twice its width: PIXEL_ASPECT.
const TORSO: readonly Run[] = [
  [0, 3, 12],
  [1, 3, 12],
  [2, 1, 14],
  [3, 3, 12],
]

const ARM_DOWN: readonly Run[] = [[2, 15, 2]]
const ARM_UP: readonly Run[] = [[1, 15, 2]]

const FEET: readonly Run[] = [
  [4, 4, 1],
  [4, 6, 1],
  [4, 11, 1],
  [4, 13, 1],
]

const FEET_TAPPING: readonly Run[] = [
  [4, 5, 1],
  [4, 7, 1],
  [4, 10, 1],
  [4, 12, 1],
]

const EYES: Record<Exclude<Eyes, 'closed'>, readonly Run[]> = {
  open: [
    [1, 5, 1],
    [1, 12, 1],
  ],
  left: [
    [1, 4, 1],
    [1, 11, 1],
  ],
  right: [
    [1, 6, 1],
    [1, 13, 1],
  ],
  up: [
    [0, 5, 1],
    [0, 12, 1],
  ],
  happy: [
    [1, 4, 2],
    [1, 12, 2],
  ],
}

type Part = {
  id: string
  color: Cell
  runs: readonly Run[]
  isOn: (pose: Pose) => boolean
}

const PARTS: readonly Part[] = [
  { id: 'armDown', color: 'B', runs: ARM_DOWN, isOn: pose => !pose.isArmUp },
  { id: 'armUp', color: 'B', runs: ARM_UP, isOn: pose => pose.isArmUp },
  { id: 'feet', color: 'B', runs: FEET, isOn: pose => !pose.isTapping },
  { id: 'feetTap', color: 'B', runs: FEET_TAPPING, isOn: pose => pose.isTapping },
  ...(['open', 'left', 'right', 'up', 'happy'] as const).map(
    (eyes): Part => ({
      id: `eyes${eyes.charAt(0).toUpperCase()}${eyes.slice(1)}`,
      color: 'E',
      runs: EYES[eyes],
      isOn: pose => pose.eyes === eyes,
    }),
  ),
]

const REST: Pose = { top: 1, eyes: 'open', isArmUp: false, isTapping: false }

export const poseFor = (phase: Phase, tick: number): Pose => {
  if (phase === 'replying') {
    return poseFor('thinking', tick)
  }

  if (phase === 'reading') {
    const at = tick % 12

    return { ...REST, top: 1 + (Math.floor(at / 2) % 2), eyes: at === 9 ? 'closed' : 'open', isArmUp: at === 4 || at === 5 }
  }

  if (phase === 'chatting') {
    const at = tick % 24

    return { ...REST, top: at < 12 ? 1 : 2, eyes: at === 18 || at === 19 ? 'closed' : 'right' }
  }

  if (phase === 'thinking') {
    return {
      ...REST,
      eyes: GLANCES[Math.floor(tick / 6) % GLANCES.length] ?? 'open',
      isTapping: Math.floor(tick / 3) % 2 === 1,
    }
  }

  if (phase === 'asking') {
    if (tick < 2) {
      return { ...REST, top: 0 }
    }

    if (tick < 10) {
      return { ...REST, isArmUp: Math.floor((tick - 2) / 2) % 2 === 0 }
    }

    const resting = tick - 10
    const top = 1 + (Math.floor(resting / 6) % 2)

    if (resting % 24 >= 20 && resting % 24 < 22) {
      return { ...REST, top, eyes: 'closed' }
    }

    if (resting % 48 >= 30 && resting % 48 < 36) {
      return { ...REST, top, eyes: 'right' }
    }

    return { ...REST, top }
  }

  if (phase === 'chosen') {
    return { ...REST, top: tick < 5 ? 0 : 1, eyes: 'happy' }
  }

  return REST
}

// How many ticks a phase plays once, and then how many it repeats: the length after which every
// part of poseFor comes round again.
const SHAPES: Record<Phase, { intro: number; loop: number }> = {
  idle: { intro: 0, loop: 0 },
  reading: { intro: 0, loop: 12 },
  thinking: { intro: 0, loop: 24 },
  asking: { intro: 10, loop: 48 },
  chatting: { intro: 0, loop: 24 },
  replying: { intro: 0, loop: 24 },
  chosen: { intro: CHOSEN_TICKS, loop: 0 },
}

export const timelineFor = (phase: Phase): Timeline => {
  const { intro, loop } = SHAPES[phase]
  const sample = (from: number, count: number) =>
    Array.from({ length: count }, (_, at) => poseFor(phase, from + at))

  return { intro: sample(0, intro), loop: sample(intro, loop) }
}

export const pixelsOf = (pose: Pose): string[] => {
  const grid = Array.from({ length: PIXEL_ROWS }, () => Array<string>(PIXEL_COLUMNS).fill('.'))

  const paint = (runs: readonly Run[], cell: Cell) => {
    for (const [row, column, length] of runs) {
      for (let at = column; at < column + length; at += 1) {
        grid[row + pose.top]![at] = cell
      }
    }
  }

  paint(TORSO, 'B')
  paint(pose.isArmUp ? ARM_UP : ARM_DOWN, 'B')
  paint(pose.isTapping ? FEET_TAPPING : FEET, 'B')
  paint(pose.eyes === 'closed' ? [] : EYES[pose.eyes], 'E')

  return grid.map(row => row.join(''))
}

const seconds = (ticks: number) => `${+((ticks * FRAME_MS) / 1000).toFixed(3)}s`
const fraction = (at: number, of: number) => `${+(at / of).toFixed(4)}`

const rect = ([row, column, length]: Run) =>
  `<rect x="${column}" y="${row * PIXEL_ASPECT}" width="${length}" height="${PIXEL_ASPECT}"/>`

// One value per change, as a discrete animation holds it: [{ at: 0, value: 'a' }, { at: 3, value: 'b' }]
const changes = (poses: readonly Pose[], valueOf: (pose: Pose) => string) => {
  const runs: { at: number; value: string }[] = []

  poses.forEach((pose, at) => {
    const value = valueOf(pose)

    if (runs[runs.length - 1]?.value !== value) {
      runs.push({ at, value })
    }
  })

  return runs
}

const animation = (
  name: 'visibility' | 'transform',
  poses: readonly Pose[],
  valueOf: (pose: Pose) => string,
  base: string,
  begin: number,
  isLooping: boolean,
) => {
  const runs = changes(poses, valueOf)

  if (runs.length === 0 || (runs.length === 1 && runs[0]?.value === base)) {
    return ''
  }

  const tag = name === 'transform' ? 'animateTransform' : 'animate'
  const type = name === 'transform' ? ' type="translate"' : ''
  const values = runs.map(run => run.value).join(';')
  const times = runs.map(run => fraction(run.at, poses.length)).join(';')
  const repeat = isLooping ? ' repeatCount="indefinite"' : ''

  return `<${tag} attributeName="${name}"${type} calcMode="discrete" values="${values}" keyTimes="${times}" begin="${seconds(begin)}" dur="${seconds(poses.length)}"${repeat}/>`
}

const animations = (
  timeline: Timeline,
  name: 'visibility' | 'transform',
  valueOf: (pose: Pose) => string,
  base: string,
) =>
  animation(name, timeline.intro, valueOf, base, 0, false) +
  animation(name, timeline.loop, valueOf, base, timeline.intro.length, true)

// The remote surfaces play the sprite themselves: the markup holds every part and a film strip that
// shows or hides each one at the tick poseFor says, so nothing has to redraw it while it plays.
export const toSvg = (phase: Phase): SvgSprite => {
  const timeline = timelineFor(phase)
  const base = timeline.loop[0] ?? timeline.intro[timeline.intro.length - 1] ?? REST
  const offset = (pose: Pose) => `0 ${pose.top * PIXEL_ASPECT}`

  const parts = PARTS.map(part => {
    const state = (pose: Pose) => (part.isOn(pose) ? 'visible' : 'hidden')
    const strip = animations(timeline, 'visibility', state, state(base))

    return `<g id="${part.id}" fill="${HEX[part.color]}" visibility="${state(base)}">${strip}${part.runs.map(rect).join('')}</g>`
  })

  const bob = animations(timeline, 'transform', offset, offset(base))
  const torso = `<g id="torso" fill="${HEX.B}">${TORSO.map(rect).join('')}</g>`

  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PIXEL_COLUMNS} ${PIXEL_ROWS * PIXEL_ASPECT}" shape-rendering="crispEdges"><g id="bob" transform="translate(${offset(base)})">${bob}${torso}${parts.join('')}</g></svg>`,
    width: PIXEL_COLUMNS * SVG_SCALE,
    height: PIXEL_ROWS * PIXEL_ASPECT * SVG_SCALE,
  }
}

const colorOf = (cell: string | undefined): number | null => {
  if (cell === 'B') {
    return COLORS.body
  }

  return cell === 'E' ? COLORS.eye : null
}

// A cell holds two colors at most, a glyph and its background. A quarter of the second color in a
// cell that also has an empty quarter would need a third: the cell keeps its dominant color and the
// other quarter shows the background, so the outline stays whole (an eye on the top edge is a gap).
const cellOf = (quarters: readonly (number | null)[]): readonly [number, number, number] => {
  const filled = quarters.filter((color): color is number => color !== null)

  if (filled.length === 0) {
    return [QUARTER_GLYPHS[0], DEFAULT_COLOR, DEFAULT_COLOR]
  }

  const count = (color: number) => filled.filter(other => other === color).length
  const [main, other] = [...new Set(filled)].sort(
    (a, b) => count(b) - count(a) || (a === COLORS.body ? -1 : 1),
  )

  const maskOf = (isDrawn: (color: number | null) => boolean) =>
    quarters.reduce<number>((mask, color, at) => (isDrawn(color) ? mask | (1 << at) : mask), 0)

  if (other !== undefined && filled.length === 4) {
    return [QUARTER_GLYPHS[maskOf(color => color === main)]!, main!, other]
  }

  return [QUARTER_GLYPHS[maskOf(color => color === main)]!, main!, DEFAULT_COLOR]
}

export const packCells = (grid: readonly string[]): RasterSprite => {
  const columns = Math.ceil((grid[0]?.length ?? 0) / 2)
  const rows = Math.ceil(grid.length / 2)
  const words = new Uint32Array(columns * rows * 3)

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const quarters = [
        colorOf(grid[row * 2]?.[column * 2]),
        colorOf(grid[row * 2]?.[column * 2 + 1]),
        colorOf(grid[row * 2 + 1]?.[column * 2]),
        colorOf(grid[row * 2 + 1]?.[column * 2 + 1]),
      ]

      words.set(cellOf(quarters), (row * columns + column) * 3)
    }
  }

  return { columns, rows, cells: new Uint8Array(words.buffer).toBase64() }
}

export const toCells = (pose: Pose): RasterSprite => packCells(pixelsOf(pose))

// Without a tick the lines that count dots hold still, as on the surfaces that play the sprite themselves.
const dotsFor = (tick: number | undefined) => '.'.repeat(tick === undefined ? 3 : 1 + (Math.floor(tick / 4) % 3))

export const lineFor = (
  phase: Phase,
  tick: number | undefined,
  via: Via = 'prompt',
  strings: Strings = STRINGS.en,
): string => {
  if (phase === 'thinking') {
    return `${strings.line.thinking}${dotsFor(tick)}`
  }

  if (phase === 'replying') {
    return `${strings.line.replying}${dotsFor(tick)}`
  }

  if (phase === 'reading') {
    return strings.line.reading
  }

  if (phase === 'chatting') {
    return strings.line.chatting
  }

  if (phase === 'asking') {
    return strings.ask
  }

  if (phase === 'chosen') {
    return via === 'clipboard' ? strings.line.copied : strings.line.written
  }

  return ''
}
