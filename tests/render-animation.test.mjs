import test from 'node:test'
import assert from 'node:assert/strict'
import { createFrameQueue, patternKeyFor } from '../src/scratch-hologram-render.js'
import { encodeSignatureAnimation, signatureFrameCount, signatureTimeline } from '../src/scratch-hologram-animation.js'

const stroke = (glyph, kind = 'letter', length = 100) => ({ glyph, kind, length, points: [[-0.3, 0.1, -0.46], [0.3, 0.1, -0.46]] })
const strokes = [stroke(1), stroke(2), stroke(10), ...[2, 5, 9, 12].map(glyph => stroke(glyph, 'dot', 10)), stroke(1, 'cross-stroke', 200)]

test('continuous input coalesces without delaying the scheduled frame', () => {
  let frame
  let requests = 0
  let renders = 0
  const queue = createFrameQueue(() => renders++, callback => { requests++; frame = callback; return requests }, () => {})
  for (let i = 0; i < 100; i++) queue.request()
  assert.equal(requests, 1)
  frame()
  assert.equal(renders, 1)
  queue.request()
  assert.equal(requests, 2)
})

test('pending frames can be cancelled and requested again', () => {
  let cancelled
  let requests = 0
  const queue = createFrameQueue(() => {}, () => { requests++; return 7 }, id => { cancelled = id })
  queue.request()
  queue.cancel()
  assert.equal(cancelled, 7)
  queue.request()
  assert.equal(requests, 2)
})

test('geometry cache ignores viewing changes and invalidates changed encoding', () => {
  const p = { shape: 0, depth: 1, samplingDensity: 1 }
  assert.equal(patternKeyFor(p), patternKeyFor({ ...p, width: 1920, cameraAz: 20 }))
  assert.notEqual(patternKeyFor(p), patternKeyFor({ ...p, samplingDensity: 2 }))
  assert.notEqual(patternKeyFor({ ...p, rotary: true, animationId: 1 }), patternKeyFor({ ...p, rotary: true, animationId: 2 }))
})

test('signature timeline preserves deferred dots and final cross stroke', () => {
  const timeline = signatureTimeline(strokes)
  assert.deepEqual(timeline.map(entry => entry.stroke.kind), ['letter', 'letter', 'letter', 'dot', 'dot', 'dot', 'dot', 'cross-stroke'])
  assert.ok(Math.abs(timeline.at(-1).start + timeline.at(-1).duration - 6000) < 0.001)
  assert.ok(timeline[0].duration < timeline[1].duration)
  assert.ok(Math.abs(timeline[3].start - timeline[2].start - timeline[2].duration - 120) < 0.001)
})

test('rotary encoding has fixed angle tuples, empty start and completed hold', () => {
  const points = encodeSignatureAnimation(strokes)
  const counts = new Map()
  for (let i = 0; i < points.length; i += 4) {
    const angle = points[i + 3]
    assert.ok([...points.slice(i, i + 4)].every(Number.isFinite))
    assert.ok(points[i + 1] > 0)
    const index = angle / (360 / signatureFrameCount)
    assert.ok(Math.abs(index - Math.round(index)) < 0.001)
    counts.set(angle, (counts.get(angle) || 0) + 1)
  }
  assert.equal(counts.has(0), false)
  assert.ok(counts.get(7.5) < counts.get(285))
  assert.equal(counts.get(285), counts.get(352.5))
})

test('density increases etched sampling without changing angle sequence', () => {
  const sparse = encodeSignatureAnimation(strokes, 0.5)
  const dense = encodeSignatureAnimation(strokes, 1.5)
  assert.ok(dense.length > sparse.length * 2)
  assert.equal(dense.at(-1), sparse.at(-1))
})
