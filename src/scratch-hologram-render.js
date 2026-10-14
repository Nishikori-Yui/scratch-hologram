export function patternKeyFor(params) {
  if (params.rotary || params.animationPoints)
    return `rotary:${params.animationId}:${params.depth}`
  if (params.customPoints)
    return `custom:${params.customId}:${params.depth}:${params.customPoints.length}`
  return `${params.shape}/${params.depth}/${params.samplingDensity}`
}

// A leading frame request cannot be postponed indefinitely by pointer/orbit updates.
export function createFrameQueue(callback, requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame) {
  let scheduled
  return {
    request() {
      if (scheduled !== undefined)
        return
      scheduled = requestFrame(() => {
        scheduled = undefined
        callback()
      })
    },
    cancel() {
      if (scheduled !== undefined)
        cancelFrame(scheduled)
      scheduled = undefined
    },
  }
}
