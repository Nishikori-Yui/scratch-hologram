/* eslint-disable style/max-statements-per-line */
const NS = 'http://www.w3.org/2000/svg'
const GEOMETRY = new Set(['path', 'line', 'polyline', 'polygon', 'circle', 'ellipse', 'rect'])
const ATTRIBUTES = ['d', 'points', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'transform', 'id', 'data-kind']

// Reconstruct only geometry/groups, so an imported SVG remains local data.
function copyGeometry(source, destination) {
  for (const child of source.children) {
    const tag = child.localName
    if (tag !== 'g' && !GEOMETRY.has(tag))
      continue
    const element = document.createElementNS(NS, tag)
    for (const attribute of ATTRIBUTES) {
      if (child.hasAttribute(attribute))
        element.setAttribute(attribute, child.getAttribute(attribute))
    }
    destination.appendChild(element)
    if (tag === 'g')
      copyGeometry(child, element)
  }
}

export function sampleSvg(svgText, density = 1) {
  return sampleSvgData(svgText, density).points
}

export function sampleSvgData(svgText, density = 1) {
  if (svgText.length > 2_000_000)
    throw new Error('SVG 文件过大，请使用小于 2 MB 的路径文件。')
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') {
    throw new Error('SVG 解析失败，请检查文件是否完整。')
  }
  const source = doc.documentElement
  const vb = source.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
  const width = vb?.[2] || Number.parseFloat(source.getAttribute('width')) || 100
  const height = vb?.[3] || Number.parseFloat(source.getAttribute('height')) || 100
  if (!(width > 0 && height > 0))
    throw new Error('SVG 的尺寸无效。')
  const holder = document.createElementNS(NS, 'svg')
  holder.setAttribute('viewBox', `${vb?.[0] || 0} ${vb?.[1] || 0} ${width} ${height}`)
  holder.style.cssText = 'position:fixed;width:100px;height:100px;left:-10000px;top:0;opacity:0;pointer-events:none'
  if (source.hasAttribute('transform'))
    holder.setAttribute('transform', source.getAttribute('transform'))
  copyGeometry(source, holder)
  document.body.appendChild(holder)
  try {
    const rootMatrix = holder.getScreenCTM().inverse()
    const curves = []
    for (const element of holder.querySelectorAll([...GEOMETRY].join(','))) {
      try {
        const length = element.getTotalLength()
        if (!Number.isFinite(length) || length <= 0)
          continue
        // Cancel viewport scaling; retain local and ancestor SVG transforms.
        const matrix = rootMatrix.multiply(element.getScreenCTM())
        const scale = Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d))
        curves.push({ element, length, matrix, weight: length * scale })
      }
      catch { /* skip individual invalid geometry */ }
    }
    if (!curves.length)
      throw new Error('未找到有效的 SVG 路径。文字请先转换为路径。')
    if (curves.length > 200)
      throw new Error('SVG 路径过多，请先简化到 200 条以内。')
    const totalWeight = curves.reduce((sum, curve) => sum + curve.weight, 0)
    const raw = []
    const sourceCurves = []
    // Allocate the sample budget across ALL strokes; never truncate suffixes.
    const sampleBudget = Math.round(1100 * Math.max(0.25, Math.min(2.2, density)))
    const budget = Math.max(curves.length * 3 + 4, sampleBudget) - curves.length * 3
    for (const { element, length, matrix, weight } of curves) {
      // A separate dense trace preserves the source curve when sample density
      // changes. Both use this SAME normalization and projection in the viewer.
      const source = []
      const traceSteps = Math.max(32, Math.ceil(6000 * weight / totalWeight))
      for (let i = 0; i <= traceSteps; i++) {
        const p = element.getPointAtLength(length * i / traceSteps)
        source.push([matrix.a * p.x + matrix.c * p.y + matrix.e, matrix.b * p.x + matrix.d * p.y + matrix.f])
      }
      sourceCurves.push(source)
      const steps = Math.max(2, Math.floor(budget * weight / totalWeight) + 2)
      for (let i = 0; i <= steps; i++) {
        const p = element.getPointAtLength(length * i / steps)
        const x = matrix.a * p.x + matrix.c * p.y + matrix.e
        const y = matrix.b * p.x + matrix.d * p.y + matrix.f
        if (Number.isFinite(x) && Number.isFinite(y))
          raw.push([x, y])
      }
    }
    if (raw.length < 2)
      throw new Error('SVG 没有可采样的轮廓。')
    const outline = sourceCurves.flat()
    const xs = outline.map(p => p[0]); const ys = outline.map(p => p[1])
    const minX = Math.min(...xs); const maxX = Math.max(...xs)
    const minY = Math.min(...ys); const maxY = Math.max(...ys)
    const extent = Math.max(maxX - minX, maxY - minY)
    if (extent < 1e-8)
      throw new Error('SVG 路径没有有效尺寸。')
    const centerX = (minX + maxX) / 2; const centerY = (minY + maxY) / 2
    const result = []
    for (const [x, y] of raw) {
      // Uniform scale preserves the signature's proportions. SVG provides 2D
      // curves, so assign a constant virtual plane behind the host disc.
      result.push((x - centerX) / extent * 1.38, (centerY - y) / extent * 1.38 - 0.12, -0.46)
    }
    const normalizedCurves = sourceCurves.map(curve => curve.map(([x, y]) => [(x - centerX) / extent * 1.38, (centerY - y) / extent * 1.38 - 0.12, -0.46]))
    const strokes = curves.map(({ element, length }, index) => ({
      points: normalizedCurves[index],
      length,
      glyph: Number(element.id.match(/^glyph-(\d+)-/)?.[1] || 0),
      kind: element.getAttribute('data-kind') || 'letter',
    }))
    return { points: new Float32Array(result), curves: normalizedCurves, strokes }
  }
  finally {
    holder.remove()
  }
}
