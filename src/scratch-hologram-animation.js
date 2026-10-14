export const signatureFrameCount = 48

// The exported signature preserves the writer's stroke order, deferred dots,
// capital/lowercase speeds and final cross stroke.
export function signatureTimeline(strokes) {
  const body = strokes.filter(stroke => stroke.kind !== 'dot')
  const dots = strokes.filter(stroke => stroke.kind === 'dot')
  const speedFor = stroke => stroke.kind === 'cross-stroke' ? 2.5 : [1, 10].includes(stroke.glyph) ? 1.5 : 0.75
  const weight = body.reduce((sum, stroke) => sum + stroke.length / speedFor(stroke), 0)
  const duration = 6000
  const dotDuration = 120
  const bodyDuration = duration - (dots.length ? 120 + dots.length * dotDuration + (dots.length - 1) * 160 : 0) - 180
  const timeline = []
  let cursor = 0
  for (const stroke of body.filter(stroke => stroke.kind !== 'cross-stroke')) {
    const time = bodyDuration * stroke.length / speedFor(stroke) / weight
    timeline.push({ stroke, start: cursor, duration: time })
    cursor += time
  }
  cursor += 120
  for (const stroke of dots) {
    timeline.push({ stroke, start: cursor, duration: dotDuration })
    cursor += dotDuration + 160
  }
  cursor -= dots.length ? 160 : 0
  cursor += 180
  for (const stroke of body.filter(stroke => stroke.kind === 'cross-stroke')) {
    const time = bodyDuration * stroke.length / speedFor(stroke) / weight
    timeline.push({ stroke, start: cursor, duration: time })
    cursor += time
  }
  return timeline
}

export function encodeSignatureAnimation(strokes, density = 1) {
  const timeline = signatureTimeline(strokes)
  const values = []
  const totalLength = strokes.reduce((sum, stroke) => sum + stroke.length, 0)
  const sampleBudget = 520 * density
  for (let frame = 0; frame < signatureFrameCount; frame++) {
    // Write for most of a turn, then hold the completed signature.
    const elapsed = Math.min(6000, frame / (signatureFrameCount - 1) * 7500)
    for (const { stroke, start, duration } of timeline) {
      const progress = Math.max(0, Math.min(1, (elapsed - start) / duration))
      if (!progress)
        continue
      const steps = Math.max(2, Math.ceil(sampleBudget * stroke.length / totalLength))
      for (let step = 0; step <= Math.ceil(steps * progress); step++) {
        const position = Math.min(step / steps, progress) * (stroke.points.length - 1)
        const index = Math.min(Math.floor(position), stroke.points.length - 2)
        const amount = position - index
        const point = stroke.points[index].map((value, axis) => value + (stroke.points[index + 1][axis] - value) * amount)
        // Keep the writing above the spindle in the cropped upper-disc view.
        values.push(point[0], point[1] + 0.67, point[2], frame * 360 / signatureFrameCount)
      }
    }
  }
  return new Float32Array(values)
}
