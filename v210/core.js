(() => {
  'use strict'

  const K = window.KozuV210 = window.KozuV210 || {}
  const WEB_APP_VERSION_FALLBACK = '2.1.0-alpha.10'
  const desktopVersion = typeof window.kozuDesktop?.version === 'string' ? window.kozuDesktop.version.trim() : ''
  const APP_VERSION = desktopVersion || WEB_APP_VERSION_FALLBACK
  const SCHEMA_VERSION = 7
  const TSUBO_M2 = 3.3057851239669422
  const EPS = 1e-7
  const HISTORY_LIMIT = 120

  const SHAPE_KINDS = new Set(['lot', 'road', 'water', 'cutout'])
  const ENTITY_KINDS = new Set([
    'distance', 'polyline', 'area', 'line', 'arrow', 'text', 'callout',
    'north', 'house', 'parking', 'lot-table', 'parallel', 'guide', 'dimension'
  ])

  const COMMANDS = Object.freeze({
    underlay: ['underlay-open', 'underlay-replace', 'underlay-page', 'underlay-transform', 'calibrate', 'paper-blank'],
    select: ['select', 'move', 'move-all', 'vertex-edit', 'label-move', 'dimension-edit', 'copy', 'delete'],
    lot: ['lot-draw', 'lot-style'],
    road: ['road-draw', 'road-style'],
    process: ['split', 'split-all', 'merge', 'corner-cut', 'division-guide', 'lot-division-guide', 'parallel-guide', 'edge-hide'],
    measure: ['distance', 'polyline', 'area'],
    annotate: ['line', 'arrow', 'text', 'callout', 'north', 'house', 'parking', 'lot-table']
  })

  const DEFAULTS = Object.freeze({
    lotStyle: Object.freeze({ fill: '#f4dfa1', stroke: '#987722', opacity: 0.46, lineWidth: 1.25, lineStyle: 'solid' }),
    roadStyle: Object.freeze({ fill: '#d8dde5', stroke: '#596579', opacity: 0.68, lineWidth: 1.2, lineStyle: 'solid' }),
    waterStyle: Object.freeze({ fill: '#bfe7f8', stroke: '#2f7898', opacity: 0.64, lineWidth: 1.2, lineStyle: 'solid' }),
    cutoutStyle: Object.freeze({ fill: '#e5e7eb', stroke: '#6b7280', opacity: 0.72, lineWidth: 1, lineStyle: 'dash' }),
    labelStyle: Object.freeze({ fontFamily: 'gothic', size: 14, fontSize: 14, color: '#172033', rotation: 0, vertical: false, scale: 1, background: 'transparent', boxStyle: 'none' }),
    dimensionStyle: Object.freeze({ visible: true, color: '#334155', fontFamily: 'gothic', size: 10, fontSize: 10, rotation: 'auto', offset: 14, decimals: 2, approximate: false, rounding: 'round', adjustment: 0, scale: 1 }),
    lineStyle: Object.freeze({ color: '#253858', lineWidth: 1.4, lineStyle: 'solid' }),
    textStyle: Object.freeze({ fontFamily: 'gothic', size: 14, fontSize: 14, color: '#172033', background: 'transparent', boxStyle: 'none', vertical: false, rotation: 0 }),
    typography: Object.freeze({ lot: 14, metric: 12, dimension: 10, road: 14, text: 14 }),
    snap: Object.freeze({ vertex: true, intersection: true, edge: true, grid: false, gridSize: 10 })
  })

  function nowIso() { return new Date().toISOString() }
  function clone(value) {
    if (value == null) return value
    if (typeof structuredClone === 'function') return structuredClone(value)
    return JSON.parse(JSON.stringify(value))
  }
  function finite(value, fallback = 0) {
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
  }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)) }
  function isPoint(point) { return !!point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)) }
  function point(value) { return { x: finite(value?.x), y: finite(value?.y) } }
  function nearly(a, b, tolerance = EPS) { return Math.abs(a - b) <= tolerance }
  function samePoint(a, b, tolerance = EPS) { return isPoint(a) && isPoint(b) && distance(a, b) <= tolerance }
  function add(a, b) { return { x: a.x + b.x, y: a.y + b.y } }
  function subtract(a, b) { return { x: a.x - b.x, y: a.y - b.y } }
  function multiply(a, scalar) { return { x: a.x * scalar, y: a.y * scalar } }
  function dot(a, b) { return a.x * b.x + a.y * b.y }
  function cross(a, b) { return a.x * b.y - a.y * b.x }
  function length(vector) { return Math.hypot(vector.x, vector.y) }
  function distance(a, b) { return Math.hypot(b.x - a.x, b.y - a.y) }
  function unit(vector) {
    const d = length(vector)
    return d > EPS ? { x: vector.x / d, y: vector.y / d } : { x: 0, y: 0 }
  }
  function interpolate(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } }
  function normalizeAngle(degrees) {
    let value = finite(degrees) % 360
    if (value > 180) value -= 360
    if (value <= -180) value += 360
    return value
  }
  function rotatePoint(p, origin, degrees) {
    const radians = finite(degrees) * Math.PI / 180
    const c = Math.cos(radians)
    const s = Math.sin(radians)
    const dx = p.x - origin.x
    const dy = p.y - origin.y
    return { x: origin.x + dx * c - dy * s, y: origin.y + dx * s + dy * c }
  }

  function cleanPoints(points, close = false, tolerance = EPS) {
    const result = []
    for (const raw of Array.isArray(points) ? points : []) {
      if (!isPoint(raw)) continue
      const p = point(raw)
      if (!result.length || !samePoint(result[result.length - 1], p, tolerance)) result.push(p)
    }
    if (result.length > 1 && samePoint(result[0], result[result.length - 1], tolerance)) result.pop()
    if (close && result.length > 2) result.push(clone(result[0]))
    return result
  }

  function polygonSignedArea(points) {
    const p = cleanPoints(points)
    if (p.length < 3) return 0
    let sum = 0
    for (let i = 0; i < p.length; i += 1) {
      const a = p[i]
      const b = p[(i + 1) % p.length]
      sum += a.x * b.y - b.x * a.y
    }
    return sum / 2
  }
  function polygonArea(points) { return Math.abs(polygonSignedArea(points)) }
  function polygonCentroid(points) {
    const p = cleanPoints(points)
    if (!p.length) return { x: 0, y: 0 }
    const signed = polygonSignedArea(p)
    if (Math.abs(signed) <= EPS) {
      const total = p.reduce((acc, v) => add(acc, v), { x: 0, y: 0 })
      return multiply(total, 1 / p.length)
    }
    let x = 0
    let y = 0
    for (let i = 0; i < p.length; i += 1) {
      const a = p[i]
      const b = p[(i + 1) % p.length]
      const f = a.x * b.y - b.x * a.y
      x += (a.x + b.x) * f
      y += (a.y + b.y) * f
    }
    const factor = 1 / (6 * signed)
    return { x: x * factor, y: y * factor }
  }
  function polylineLength(points) {
    const p = cleanPoints(points)
    let total = 0
    for (let i = 1; i < p.length; i += 1) total += distance(p[i - 1], p[i])
    return total
  }
  function pointOnSegment(p, a, b, tolerance = EPS) {
    const ab = subtract(b, a)
    const ap = subtract(p, a)
    if (Math.abs(cross(ab, ap)) > tolerance * Math.max(1, length(ab))) return false
    const projection = dot(ap, ab)
    return projection >= -tolerance && projection <= dot(ab, ab) + tolerance
  }
  function pointInPolygon(p, polygon, includeBoundary = true) {
    const points = cleanPoints(polygon)
    if (points.length < 3 || !isPoint(p)) return false
    let inside = false
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      const a = points[j]
      const b = points[i]
      if (pointOnSegment(p, a, b, EPS * 10)) return includeBoundary
      const crosses = ((a.y > p.y) !== (b.y > p.y)) &&
        (p.x < (b.x - a.x) * (p.y - a.y) / ((b.y - a.y) || EPS) + a.x)
      if (crosses) inside = !inside
    }
    return inside
  }
  function nearestPointOnSegment(p, a, b) {
    const ab = subtract(b, a)
    const denom = dot(ab, ab)
    const t = denom <= EPS ? 0 : clamp(dot(subtract(p, a), ab) / denom, 0, 1)
    const projected = interpolate(a, b, t)
    return { point: projected, t, distance: distance(p, projected) }
  }
  function segmentIntersection(a, b, c, d, tolerance = EPS) {
    const r = subtract(b, a)
    const s = subtract(d, c)
    const denominator = cross(r, s)
    const ca = subtract(c, a)
    if (Math.abs(denominator) <= tolerance) {
      if (Math.abs(cross(ca, r)) > tolerance) return null
      const rr = dot(r, r)
      if (rr <= tolerance) return samePoint(a, c, tolerance) ? { point: point(a), t: 0, u: 0, collinear: true } : null
      const t0 = dot(ca, r) / rr
      const t1 = t0 + dot(s, r) / rr
      const lo = Math.max(0, Math.min(t0, t1))
      const hi = Math.min(1, Math.max(t0, t1))
      if (hi < lo - tolerance) return null
      const t = clamp((lo + hi) / 2, 0, 1)
      return { point: interpolate(a, b, t), t, u: null, collinear: true, overlap: hi - lo > tolerance }
    }
    const t = cross(ca, s) / denominator
    const u = cross(ca, r) / denominator
    if (t < -tolerance || t > 1 + tolerance || u < -tolerance || u > 1 + tolerance) return null
    return { point: interpolate(a, b, clamp(t, 0, 1)), t, u, collinear: false }
  }
  function polygonSelfIntersects(points, tolerance = EPS) {
    const p = cleanPoints(points)
    if (p.length < 4) return false
    for (let i = 0; i < p.length; i += 1) {
      const a = p[i]
      const b = p[(i + 1) % p.length]
      for (let j = i + 1; j < p.length; j += 1) {
        if (j === i || j === (i + 1) % p.length || (j + 1) % p.length === i) continue
        const c = p[j]
        const d = p[(j + 1) % p.length]
        const hit = segmentIntersection(a, b, c, d, tolerance)
        if (hit && (!samePoint(hit.point, a, tolerance) || !samePoint(hit.point, d, tolerance))) return true
      }
    }
    return false
  }
  function simplifyPolygon(points, tolerance = EPS) {
    let p = cleanPoints(points, false, tolerance)
    if (p.length < 3) return p
    let changed = true
    while (changed && p.length >= 3) {
      changed = false
      const next = []
      for (let i = 0; i < p.length; i += 1) {
        const prev = p[(i - 1 + p.length) % p.length]
        const cur = p[i]
        const after = p[(i + 1) % p.length]
        const v1 = subtract(cur, prev)
        const v2 = subtract(after, cur)
        if (length(v1) <= tolerance || length(v2) <= tolerance || Math.abs(cross(v1, v2)) <= tolerance * Math.max(1, length(v1), length(v2))) {
          changed = true
          continue
        }
        next.push(cur)
      }
      if (!next.length) break
      p = next
    }
    return p
  }
  function validPolygon(points, minArea = EPS) {
    const p = cleanPoints(points)
    return p.length >= 3 && polygonArea(p) > minArea && !polygonSelfIntersects(p)
  }
  function clipHalfPlane(points, lineA, lineB, keepPositive) {
    const polygon = cleanPoints(points)
    const direction = subtract(lineB, lineA)
    if (polygon.length < 3 || length(direction) <= EPS) return []
    const side = p => cross(direction, subtract(p, lineA))
    const inside = p => keepPositive ? side(p) >= -EPS : side(p) <= EPS
    const output = []
    for (let i = 0; i < polygon.length; i += 1) {
      const current = polygon[i]
      const next = polygon[(i + 1) % polygon.length]
      const currentInside = inside(current)
      const nextInside = inside(next)
      if (currentInside) output.push(point(current))
      if (currentInside !== nextInside) {
        const s1 = side(current)
        const s2 = side(next)
        const t = Math.abs(s1 - s2) <= EPS ? 0 : s1 / (s1 - s2)
        output.push(interpolate(current, next, clamp(t, 0, 1)))
      }
    }
    return simplifyPolygon(output)
  }
  function splitPolygonByLine(points, lineA, lineB) {
    const positive = clipHalfPlane(points, lineA, lineB, true)
    const negative = clipHalfPlane(points, lineA, lineB, false)
    if (!validPolygon(positive) || !validPolygon(negative)) return null
    const originalArea = polygonArea(points)
    const splitArea = polygonArea(positive) + polygonArea(negative)
    if (Math.abs(originalArea - splitArea) > Math.max(1, originalArea) * 1e-5) return null
    return [positive, negative]
  }

  function cleanOpenPolyline(points, tolerance = 1e-5) {
    const result = []
    for (const raw of Array.isArray(points) ? points : []) {
      if (!isPoint(raw)) continue
      const value = point(raw)
      if (!result.length || !samePoint(result[result.length - 1], value, tolerance)) result.push(value)
    }
    return result
  }

  function simpleOpenPolyline(points, tolerance = 1e-5) {
    const line = cleanOpenPolyline(points, tolerance)
    if (line.length < 2 || samePoint(line[0], line[line.length - 1], tolerance)) return false
    for (let index = 1; index < line.length - 1; index += 1) {
      const incoming = subtract(line[index], line[index - 1])
      const outgoing = subtract(line[index + 1], line[index])
      const scale = Math.max(1, length(incoming), length(outgoing))
      if (Math.abs(cross(incoming, outgoing)) <= tolerance * scale && dot(incoming, outgoing) < 0) return false
    }
    for (let first = 0; first < line.length - 1; first += 1) {
      for (let second = first + 2; second < line.length - 1; second += 1) {
        if (segmentIntersection(line[first], line[first + 1], line[second], line[second + 1], tolerance)) return false
      }
    }
    return true
  }

  function pointOnPolygonBoundary(value, polygon, tolerance = 1e-5) {
    const vertices = cleanPoints(polygon)
    for (let index = 0; index < vertices.length; index += 1) {
      if (nearestPointOnSegment(value, vertices[index], vertices[(index + 1) % vertices.length]).distance <= tolerance) return true
    }
    return false
  }

  function rayPolygonBoundaryHit(origin, direction, polygon, tolerance = 1e-5) {
    const vertices = cleanPoints(polygon)
    const ray = unit(direction)
    if (length(ray) <= EPS) return null
    let nearest = null
    for (let index = 0; index < vertices.length; index += 1) {
      const a = vertices[index]
      const b = vertices[(index + 1) % vertices.length]
      const edge = subtract(b, a)
      const denominator = cross(ray, edge)
      if (Math.abs(denominator) <= tolerance) continue
      const delta = subtract(a, origin)
      const rayDistance = cross(delta, edge) / denominator
      const edgePosition = cross(delta, ray) / denominator
      if (rayDistance <= tolerance || edgePosition < -tolerance || edgePosition > 1 + tolerance) continue
      if (!nearest || rayDistance < nearest.distance) nearest = { point: add(origin, multiply(ray, rayDistance)), distance: rayDistance }
    }
    return nearest?.point || null
  }

  function preparePolylineCut(polygon, cutPoints, tolerance = 1e-5) {
    const cut = cleanOpenPolyline(cutPoints, tolerance)
    if (!simpleOpenPolyline(cut, tolerance)) return null
    const first = cut[0]
    const last = cut[cut.length - 1]
    if (pointInPolygon(first, polygon, false) && !pointOnPolygonBoundary(first, polygon, tolerance)) {
      const hit = rayPolygonBoundaryHit(first, subtract(first, cut[1]), polygon, tolerance)
      if (!hit) return null
      cut[0] = hit
    }
    if (pointInPolygon(last, polygon, false) && !pointOnPolygonBoundary(last, polygon, tolerance)) {
      const hit = rayPolygonBoundaryHit(last, subtract(last, cut[cut.length - 2]), polygon, tolerance)
      if (!hit) return null
      cut[cut.length - 1] = hit
    }
    return simpleOpenPolyline(cut, tolerance) ? cut : null
  }

  function canonicalBoundaryHit(rawHit, polygon, tolerance = 1e-5) {
    const count = polygon.length
    let edgeIndex = rawHit.edgeIndex
    let edgePosition = clamp(finite(rawHit.edgePosition), 0, 1)
    if (edgePosition >= 1 - tolerance) {
      edgeIndex = (edgeIndex + 1) % count
      edgePosition = 0
    } else if (edgePosition <= tolerance) edgePosition = 0
    const from = polygon[edgeIndex]
    const to = polygon[(edgeIndex + 1) % count]
    const hitPoint = edgePosition === 0 ? point(from) : interpolate(from, to, edgePosition)
    return {
      point: hitPoint,
      cutSegment: rawHit.cutSegment,
      cutPosition: clamp(finite(rawHit.cutPosition), 0, 1),
      pathPosition: rawHit.cutSegment + clamp(finite(rawHit.cutPosition), 0, 1),
      edgeIndex,
      edgePosition,
      boundaryPosition: edgeIndex + edgePosition
    }
  }

  function polylinePolygonBoundaryHits(polygon, cut, tolerance = 1e-5) {
    const rawHits = []
    let overlapping = false
    for (let cutSegment = 0; cutSegment < cut.length - 1; cutSegment += 1) {
      for (let edgeIndex = 0; edgeIndex < polygon.length; edgeIndex += 1) {
        const hit = segmentIntersection(cut[cutSegment], cut[cutSegment + 1], polygon[edgeIndex], polygon[(edgeIndex + 1) % polygon.length], tolerance)
        if (!hit) continue
        if (hit.overlap || hit.u == null) { overlapping = true; continue }
        rawHits.push(canonicalBoundaryHit({ cutSegment, cutPosition: hit.t, edgeIndex, edgePosition: hit.u }, polygon, tolerance))
      }
    }
    rawHits.sort((a, b) => a.pathPosition - b.pathPosition)
    const hits = []
    for (const hit of rawHits) {
      const previous = hits[hits.length - 1]
      if (previous && samePoint(previous.point, hit.point, tolerance * 4) && Math.abs(previous.pathPosition - hit.pathPosition) <= tolerance * 4) continue
      hits.push(hit)
    }
    return { hits, overlapping }
  }

  function polygonBoundaryPath(polygon, start, end, tolerance = 1e-5) {
    const count = polygon.length
    const path = [point(start.point)]
    let target = end.boundaryPosition
    while (target <= start.boundaryPosition + tolerance) target += count
    for (let vertex = Math.floor(start.boundaryPosition + tolerance) + 1; vertex < target - tolerance; vertex += 1) {
      path.push(point(polygon[vertex % count]))
    }
    path.push(point(end.point))
    return path
  }

  function polylinePathBetween(cut, entry, exit, tolerance = 1e-5) {
    const path = [point(entry.point)]
    for (let vertex = entry.cutSegment + 1; vertex <= exit.cutSegment; vertex += 1) {
      const pathPosition = vertex
      if (pathPosition > entry.pathPosition + tolerance && pathPosition < exit.pathPosition - tolerance) path.push(point(cut[vertex]))
    }
    path.push(point(exit.point))
    return cleanOpenPolyline(path, tolerance)
  }

  function analyzePolygonSplitByPolyline(points, cutPoints, options = {}) {
    const tolerance = Math.max(EPS * 10, finite(options.tolerance, 1e-5))
    const polygon = cleanPoints(points, false, tolerance)
    if (!validPolygon(polygon)) return { status: 'invalid', reason: 'invalid-polygon' }
    const cut = preparePolylineCut(polygon, cutPoints, tolerance)
    if (!cut) return { status: 'invalid', reason: 'invalid-polyline' }
    const intersections = polylinePolygonBoundaryHits(polygon, cut, tolerance)
    if (intersections.overlapping) return { status: 'invalid', reason: 'boundary-overlap' }
    if (intersections.hits.length < 2) return { status: 'none', reason: 'insufficient-intersections' }
    if (intersections.hits.length !== 2) return { status: 'invalid', reason: 'multiple-crossings', hits: intersections.hits }
    const [entry, exit] = intersections.hits
    if (samePoint(entry.point, exit.point, tolerance)) return { status: 'none', reason: 'same-intersection' }
    const cutPath = polylinePathBetween(cut, entry, exit, tolerance)
    if (cutPath.length < 2) return { status: 'invalid', reason: 'empty-cut-path' }
    for (let index = 1; index < cutPath.length; index += 1) {
      const midpoint = interpolate(cutPath[index - 1], cutPath[index], 0.5)
      if (!pointInPolygon(midpoint, polygon, true)) return { status: 'invalid', reason: 'cut-leaves-polygon' }
    }
    const firstBoundary = polygonBoundaryPath(polygon, entry, exit, tolerance)
    const secondBoundary = polygonBoundaryPath(polygon, exit, entry, tolerance)
    const first = simplifyPolygon(firstBoundary.concat(cutPath.slice(1, -1).reverse()), tolerance)
    const second = simplifyPolygon(secondBoundary.concat(cutPath.slice(1, -1)), tolerance)
    if (!validPolygon(first) || !validPolygon(second)) return { status: 'invalid', reason: 'invalid-result' }
    const originalArea = polygonArea(polygon)
    const resultArea = polygonArea(first) + polygonArea(second)
    if (Math.abs(originalArea - resultArea) > Math.max(1, originalArea) * 1e-5) return { status: 'invalid', reason: 'area-mismatch' }
    return { status: 'split', polygons: [first, second], cut, hits: intersections.hits }
  }

  function splitPolygonByPolyline(points, cutPoints, options = {}) {
    const result = analyzePolygonSplitByPolyline(points, cutPoints, options)
    return result.status === 'split' ? result.polygons : null
  }
  function ensureCounterClockwise(points) {
    const p = cleanPoints(points)
    return polygonSignedArea(p) < 0 ? p.reverse() : p
  }
  function pathWithoutEdge(points, edgeIndex) {
    const path = []
    for (let step = 1; step <= points.length; step += 1) path.push(points[(edgeIndex + step) % points.length])
    return path
  }
  function mergeAdjacentPolygons(first, second, tolerance = 1e-4) {
    const a = ensureCounterClockwise(first)
    const b = ensureCounterClockwise(second)
    for (let i = 0; i < a.length; i += 1) {
      const a0 = a[i]
      const a1 = a[(i + 1) % a.length]
      for (let j = 0; j < b.length; j += 1) {
        const b0 = b[j]
        const b1 = b[(j + 1) % b.length]
        if (!samePoint(a0, b1, tolerance) || !samePoint(a1, b0, tolerance)) continue
        const pathA = pathWithoutEdge(a, i)
        const pathB = pathWithoutEdge(b, j)
        const merged = simplifyPolygon(pathA.concat(pathB.slice(1, -1)), tolerance)
        if (validPolygon(merged) && nearly(polygonArea(merged), polygonArea(a) + polygonArea(b), Math.max(1, polygonArea(merged)) * 1e-5)) return merged
      }
    }
    return null
  }
  function cornerCut(points, vertexIndex, distanceAlongEdges) {
    const p = cleanPoints(points)
    if (p.length < 3 || !Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= p.length) return null
    const vertex = p[vertexIndex]
    const prev = p[(vertexIndex - 1 + p.length) % p.length]
    const next = p[(vertexIndex + 1) % p.length]
    const cut = finite(distanceAlongEdges, 0)
    const prevLength = distance(vertex, prev)
    const nextLength = distance(vertex, next)
    if (!(cut > EPS && cut < prevLength - EPS && cut < nextLength - EPS)) return null
    const towardPrev = interpolate(vertex, prev, cut / prevLength)
    const towardNext = interpolate(vertex, next, cut / nextLength)
    const main = p.slice(0, vertexIndex).concat([towardPrev, towardNext], p.slice(vertexIndex + 1))
    const removed = [point(vertex), towardNext, towardPrev]
    if (!validPolygon(main) || !validPolygon(removed)) return null
    return { polygon: main, cutout: removed, cutLength: distance(towardPrev, towardNext) }
  }
  function parallelLine(a, b, offset) {
    const direction = unit(subtract(b, a))
    if (length(direction) <= EPS) return null
    const normal = { x: -direction.y, y: direction.x }
    const shift = multiply(normal, finite(offset))
    return [add(a, shift), add(b, shift)]
  }

  function boundsOfPoints(points) {
    const p = (Array.isArray(points) ? points : []).filter(isPoint)
    if (!p.length) return null
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    p.forEach(v => {
      minX = Math.min(minX, Number(v.x)); minY = Math.min(minY, Number(v.y))
      maxX = Math.max(maxX, Number(v.x)); maxY = Math.max(maxY, Number(v.y))
    })
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
  }
  function unionBounds(...bounds) {
    const present = bounds.flat().filter(Boolean)
    if (!present.length) return null
    const result = {
      minX: Math.min(...present.map(b => b.minX)), minY: Math.min(...present.map(b => b.minY)),
      maxX: Math.max(...present.map(b => b.maxX)), maxY: Math.max(...present.map(b => b.maxY))
    }
    result.width = result.maxX - result.minX
    result.height = result.maxY - result.minY
    return result
  }

  function createCalibration(source = {}) {
    const hasTwoPoint = Array.isArray(source.points) && source.points.length === 2 && source.points.every(isPoint) && Number(source.realDistanceM) > 0
    const hasScaleValue = Number(source.mapScale) > 0
    const method = source.method === 'two-point' || source.method === 'scale'
      ? source.method
      : hasTwoPoint ? 'two-point' : hasScaleValue ? 'scale' : null
    return {
      method,
      mpp: Number.isFinite(Number(source.mpp)) && Number(source.mpp) > 0 ? Number(source.mpp) : null,
      mapScale: Number.isFinite(Number(source.mapScale)) && Number(source.mapScale) > 0 ? Number(source.mapScale) : null,
      points: Array.isArray(source.points) && source.points.length === 2 && source.points.every(isPoint) ? source.points.map(point) : null,
      realDistanceM: Number.isFinite(Number(source.realDistanceM)) && Number(source.realDistanceM) > 0 ? Number(source.realDistanceM) : null
    }
  }
  function createOutputLayout(source = {}, paper = {}) {
    const requestedSize = source.paperSize ?? source.size
    const size = requestedSize === 'A3' ? 'A3' : requestedSize === 'A4' ? 'A4' : paper.size === 'A3' ? 'A3' : 'A4'
    const orientation = source.orientation === 'portrait' ? 'portrait' : source.orientation === 'landscape' ? 'landscape' : paper.orientation === 'portrait' ? 'portrait' : 'landscape'
    const printScale = Number(source.printScale)
    return {
      paperSize: size,
      orientation,
      printScale: Number.isFinite(printScale) && printScale > 0 ? printScale : null,
      offsetMmX: finite(source.offsetMmX, 0),
      offsetMmY: finite(source.offsetMmY, 0),
      showFrame: typeof source.showFrame === 'boolean' ? source.showFrame : paper.showFrame !== false,
      showTitleFrame: typeof source.showTitleFrame === 'boolean' ? source.showTitleFrame : paper.showTitleFrame !== false,
      includeUnderlay: typeof source.includeUnderlay === 'boolean' ? source.includeUnderlay : paper.includeUnderlay !== false,
      includeGuides: source.includeGuides === true,
      initialized: source.initialized === true
    }
  }
  function createPage(number = 1) {
    return { id: `page-${number}`, name: `${number}ページ`, sourcePage: number, calibration: createCalibration(), outputLayout: createOutputLayout(), shapes: [], entities: [] }
  }
  function createDocument() {
    const timestamp = nowIso()
    return {
      format: 'kozu-measure', schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION,
      id: `project-${Date.now().toString(36)}`, title: '無題の図面', createdAt: timestamp, updatedAt: timestamp,
      background: {
        type: null, name: '', mimeType: '', source: null, size: 0, metadata: {}, pages: [], pageCount: 0, currentPage: 1,
        width: 0, height: 0, opacity: 1, x: 0, y: 0, scale: 1, rotation: 0,
        imageRotation: 0, visible: true, locked: false
      },
      calibration: createCalibration(),
      paper: {
        enabled: false, size: 'A4', orientation: 'landscape', widthMm: 297, heightMm: 210,
        title: '', date: new Date().toISOString().slice(0, 10), author: '', note: '',
        showFrame: true, showTitleFrame: true, includeUnderlay: true
      },
      outputDefaults: createOutputLayout(),
      preferences: {
        typography: clone(DEFAULTS.typography),
        lot: { style: clone(DEFAULTS.lotStyle), labelStyle: clone(DEFAULTS.labelStyle), dimensionStyle: clone(DEFAULTS.dimensionStyle) },
        road: {
          style: clone(DEFAULTS.roadStyle), labelStyle: clone(DEFAULTS.labelStyle),
          widthLabelStyle: clone(DEFAULTS.dimensionStyle), dimensionStyle: clone(DEFAULTS.dimensionStyle),
          type: '道路', name: '道路', widthM: 4, vertical: false,
          showArea: false, showTsubo: false, showLengths: false
        },
        water: {
          style: clone(DEFAULTS.waterStyle), labelStyle: clone(DEFAULTS.labelStyle),
          widthLabelStyle: clone(DEFAULTS.dimensionStyle), dimensionStyle: clone(DEFAULTS.dimensionStyle),
          type: '水路', name: '水路', widthM: null, vertical: false,
          showArea: false, showTsubo: false, showLengths: false
        },
        text: clone(DEFAULTS.textStyle), line: clone(DEFAULTS.lineStyle), measurement: { dimensionStyle: clone(DEFAULTS.dimensionStyle) }, snap: clone(DEFAULTS.snap),
        stamp: {
          house: { widthM: 10, heightM: 8, label: '家屋', showDimensions: true, scale: 1 },
          parking: { widthM: 2.5, heightM: 5, label: 'P', showDimensions: true, scale: 1 },
          north: { size: 54, label: 'N', scale: 1 }
        }
      },
      pages: [createPage(1)], activePageId: 'page-1', nextId: 1
    }
  }
  function activePage(document) {
    if (!document || !Array.isArray(document.pages)) return null
    return document.pages.find(pageValue => pageValue.id === document.activePageId) || document.pages[0] || null
  }
  function ensurePage(document, sourcePage) {
    const pageNumber = Math.max(1, Math.trunc(finite(sourcePage, 1)))
    let pageValue = document.pages.find(value => value.sourcePage === pageNumber)
    if (!pageValue) {
      const usedIds = new Set(document.pages.map(value => value.id))
      let id = `page-${pageNumber}`
      let suffix = 2
      while (usedIds.has(id)) { id = `page-${pageNumber}-${suffix}`; suffix += 1 }
      pageValue = { ...createPage(pageNumber), id, outputLayout: createOutputLayout(document.outputDefaults, document.paper) }
      document.pages.push(pageValue)
      document.pages.sort((a, b) => a.sourcePage - b.sourcePage)
    }
    return pageValue
  }
  function setActivePage(document, sourcePage) {
    const current = activePage(document)
    // 縮尺はPDFのページごとに独立させる。別ページの縮尺を自動で
    // 引き継ぐと、異なる縮尺の図面を誤った寸法で作図してしまう。
    if (current) current.calibration = clone(document.calibration || createCalibration())
    const pageValue = ensurePage(document, sourcePage)
    if (!pageValue.calibration) pageValue.calibration = createCalibration()
    document.activePageId = pageValue.id
    document.background.currentPage = pageValue.sourcePage
    document.calibration = clone(pageValue.calibration)
    return pageValue
  }
  function allocId(document, prefix = 'obj') {
    const next = Math.max(1, Math.trunc(finite(document.nextId, 1)))
    document.nextId = next + 1
    return `${prefix}-${next}`
  }
  function normalizeFontToken(value) {
    const text = String(value || '').trim().toLowerCase()
    if (!text) return 'gothic'
    if (['gothic', 'sans', 'sans-serif'].includes(text) || /gothic|ゴシック|meiryo|メイリオ/.test(text)) return 'gothic'
    if (['mincho', 'serif'].includes(text) || /mincho|明朝/.test(text)) return 'mincho'
    // v2.1 の「均等」はフォント名ではなく、ゴシック体の各文字を
    // 同じ送り幅で配置する文字レイアウトである。旧版の mono/等幅も
    // 同じ見た目へ移行し、select が未選択になる状態を防ぐ。
    if (['even', 'justify', 'mono', 'monospace'].includes(text) || /均等|consolas|courier|等幅|mono/.test(text)) return 'even'
    return 'gothic'
  }
  function normalizeStyle(style, fallback) {
    const source = style && typeof style === 'object' ? clone(style) : {}
    const result = { ...clone(fallback), ...source }
    if (source.fontSize != null && source.size == null) result.size = finite(source.fontSize)
    if (source.size != null && source.fontSize == null) result.fontSize = finite(source.size)
    if (source.rotation != null && source.angle == null) result.angle = source.rotation === 'auto' ? 'auto' : finite(source.rotation)
    if (source.angle != null && source.rotation == null) result.rotation = source.angle === 'auto' ? 'auto' : finite(source.angle)
    if (source.decimals != null && source.digits == null) result.digits = clamp(Math.trunc(finite(source.decimals, 2)), 0, 6)
    if (source.digits != null && source.decimals == null) result.decimals = clamp(Math.trunc(finite(source.digits, 2)), 0, 6)
    if ('fontFamily' in result || 'fontFamily' in source) result.fontFamily = normalizeFontToken(result.fontFamily)
    if ('opacity' in result) result.opacity = clamp(finite(result.opacity, fallback.opacity ?? 1), 0, 1)
    if ('lineWidth' in result) result.lineWidth = clamp(finite(result.lineWidth, fallback.lineWidth ?? 1), 0.1, 20)
    return result
  }
  function normalizeIndependentLabel(source, legacyText, legacyPosition, fallbackStyle, fallbackVisible) {
    const value = source && typeof source === 'object' ? source : {}
    const hasText = Object.prototype.hasOwnProperty.call(value, 'text')
    const resolvedText = hasText ? value.text : legacyText
    const style = normalizeStyle(value.style, fallbackStyle)
    // Materialize compatible style aliases on the first normalization so a
    // save/load cycle is idempotent (fontSize/size, rotation/angle, etc.).
    const canonicalStyle = normalizeStyle(style, fallbackStyle)
    return {
      text: resolvedText == null ? null : String(resolvedText),
      position: isPoint(value.position) ? point(value.position) : (isPoint(legacyPosition) ? point(legacyPosition) : null),
      style: canonicalStyle,
      visible: typeof value.visible === 'boolean' ? value.visible : fallbackVisible !== false
    }
  }
  function edgeCollinearOverlap(oldEdge, from, to, tolerance = 1e-4) {
    if (!isPoint(oldEdge?.from) || !isPoint(oldEdge?.to)) return 0
    const oldVector = subtract(oldEdge.to, oldEdge.from)
    const newVector = subtract(to, from)
    const oldLength = length(oldVector)
    const newLength = length(newVector)
    if (oldLength <= tolerance || newLength <= tolerance) return 0
    if (Math.abs(cross(oldVector, subtract(from, oldEdge.from))) > tolerance * Math.max(1, oldLength)) return 0
    if (Math.abs(cross(oldVector, subtract(to, oldEdge.from))) > tolerance * Math.max(1, oldLength)) return 0
    const oldUnit = multiply(oldVector, 1 / oldLength)
    const start = dot(subtract(from, oldEdge.from), oldUnit)
    const end = dot(subtract(to, oldEdge.from), oldUnit)
    return Math.max(0, Math.min(oldLength, Math.max(start, end)) - Math.max(0, Math.min(start, end)))
  }
  function edgeMetadataMatches(old, polygon, tolerance = 1e-4) {
    const newEdges = polygon.map((from, index, all) => ({ from, to: all[(index + 1) % all.length], index }))
    const matched = new Array(newEdges.length).fill(null)
    const used = new Set()
    const assignCandidates = candidates => {
      candidates.sort((a, b) => b.score - a.score || a.newIndex - b.newIndex || a.oldIndex - b.oldIndex)
      candidates.forEach(candidate => {
        if (matched[candidate.newIndex] || used.has(candidate.oldIndex)) return
        matched[candidate.newIndex] = old[candidate.oldIndex]
        used.add(candidate.oldIndex)
      })
    }

    // Exact geometry is always authoritative, independent of polygon winding.
    const exact = []
    newEdges.forEach(newEdge => old.forEach((oldEdge, oldIndex) => {
      if (samePoint(oldEdge?.from, newEdge.from, tolerance) && samePoint(oldEdge?.to, newEdge.to, tolerance)) {
        exact.push({ newIndex: newEdge.index, oldIndex, score: 2 })
      } else if (samePoint(oldEdge?.from, newEdge.to, tolerance) && samePoint(oldEdge?.to, newEdge.from, tolerance)) {
        exact.push({ newIndex: newEdge.index, oldIndex, score: 1 })
      }
    }))
    assignCandidates(exact)

    // Corner cuts shorten the two adjoining edges. Match those remaining,
    // collinear portions by the greatest geometric overlap so hidden/style and
    // the stable edge id stay with the physical edge rather than its old index.
    const overlaps = []
    newEdges.forEach(newEdge => {
      if (matched[newEdge.index]) return
      const newLength = distance(newEdge.from, newEdge.to)
      old.forEach((oldEdge, oldIndex) => {
        if (used.has(oldIndex)) return
        const overlap = edgeCollinearOverlap(oldEdge, newEdge.from, newEdge.to, tolerance)
        if (overlap <= tolerance) return
        const oldLength = distance(oldEdge.from, oldEdge.to)
        const coverage = overlap / Math.max(tolerance, Math.max(oldLength, newLength))
        overlaps.push({ newIndex: newEdge.index, oldIndex, score: coverage * 1e6 + overlap })
      })
    })
    assignCandidates(overlaps)

    // A moved vertex changes the direction of its two incident edges, but each
    // keeps its opposite endpoint. Prefer endpoint role and direction before
    // using the final topological compatibility fallback.
    const endpoints = []
    newEdges.forEach(newEdge => {
      if (matched[newEdge.index]) return
      const newUnit = unit(subtract(newEdge.to, newEdge.from))
      old.forEach((oldEdge, oldIndex) => {
        if (used.has(oldIndex) || !isPoint(oldEdge?.from) || !isPoint(oldEdge?.to)) return
        const sameRole = Number(samePoint(oldEdge.from, newEdge.from, tolerance)) + Number(samePoint(oldEdge.to, newEdge.to, tolerance))
        const reverseRole = Number(samePoint(oldEdge.from, newEdge.to, tolerance)) + Number(samePoint(oldEdge.to, newEdge.from, tolerance))
        if (!sameRole && !reverseRole) return
        const oldUnit = unit(subtract(oldEdge.to, oldEdge.from))
        const alignment = Math.abs(dot(oldUnit, newUnit))
        endpoints.push({ newIndex: newEdge.index, oldIndex, score: sameRole * 1e4 + reverseRole * 5e3 + alignment * 1e3 })
      })
    })
    assignCandidates(endpoints)

    // Preserve API compatibility for old metadata without usable geometry.
    // This is only a last resort when the polygon topology did not change.
    if (old.length === newEdges.length) newEdges.forEach(newEdge => {
      if (!matched[newEdge.index] && !used.has(newEdge.index)) {
        matched[newEdge.index] = old[newEdge.index]
        used.add(newEdge.index)
      }
    })
    return matched
  }
  function edgeMetadata(document, points, existing = [], options = {}) {
    const old = Array.isArray(existing) ? existing : []
    const polygon = cleanPoints(points)
    const outputIds = new Set()
    const freshIds = options.freshIds === true
    const matches = edgeMetadataMatches(old, polygon)
    return polygon.map((p, index, all) => {
      const q = all[(index + 1) % all.length]
      const found = matches[index]
      const metadata = found ? clone(found) : {
        hidden: false,
        customText: null, labelOffset: { x: 0, y: 0 }, rotationOffset: 0, style: null
      }
      let id = !freshIds && typeof metadata.id === 'string' && metadata.id && !outputIds.has(metadata.id)
        ? metadata.id
        : allocId(document, 'edge')
      while (outputIds.has(id)) id = allocId(document, 'edge')
      outputIds.add(id)
      return { ...metadata, id, from: point(p), to: point(q) }
    })
  }
  const CONVERTIBLE_SHAPE_KINDS = Object.freeze(['lot', 'road', 'water'])
  const KIND_STATE_EXCLUDED_KEYS = new Set([
    'id', 'kind', 'points', 'edges', 'kindStates',
    'parentShapeId', 'parentOriginalPoints', 'parentOriginalEdges'
  ])
  function normalizeKindStateEdge(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const edge = {}
    for (const [key, value] of Object.entries(raw)) {
      if (key === 'id') continue
      if (key === 'from' || key === 'to') {
        if (isPoint(value)) edge[key] = point(value)
        continue
      }
      edge[key] = clone(value)
    }
    return edge
  }
  function normalizeKindState(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const state = {}
    for (const [key, value] of Object.entries(raw)) {
      if (KIND_STATE_EXCLUDED_KEYS.has(key)) continue
      state[key] = clone(value)
    }
    state.edges = (Array.isArray(raw.edges) ? raw.edges : []).map(normalizeKindStateEdge).filter(Boolean)
    return state
  }
  function normalizeKindStates(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    return Object.fromEntries(CONVERTIBLE_SHAPE_KINDS.map(kind => [kind, normalizeKindState(source[kind])]))
  }
  function captureShapeKindState(shape) {
    const state = {}
    for (const [key, value] of Object.entries(shape || {})) {
      if (KIND_STATE_EXCLUDED_KEYS.has(key)) continue
      state[key] = clone(value)
    }
    state.edges = (Array.isArray(shape?.edges) ? shape.edges : []).map(normalizeKindStateEdge).filter(Boolean)
    return state
  }
  function kindConversionEdges(document, source, targetState) {
    const polygon = cleanPoints(source?.points)
    const current = edgeMetadata(document, polygon, source?.edges)
    const stored = Array.isArray(targetState?.edges) ? targetState.edges : []
    const matches = stored.length ? edgeMetadataMatches(stored, polygon) : []
    return polygon.map((from, index, all) => {
      const to = all[(index + 1) % all.length]
      const metadata = matches[index] ? normalizeKindStateEdge(matches[index]) : {
        hidden: false,
        customText: null,
        labelOffset: { x: 0, y: 0 },
        rotationOffset: 0,
        style: null
      }
      return {
        ...metadata,
        id: current[index].id,
        from: point(from),
        to: point(to)
      }
    })
  }
  function identifierKey(value) {
    return `${typeof value}:${String(value)}`
  }
  function documentIdentifierCounts(document) {
    const counts = new Map()
    const add = value => {
      if (!(typeof value === 'string' && value) && !(typeof value === 'number' && Number.isSafeInteger(value))) return
      const key = identifierKey(value)
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    for (const pageValue of Array.isArray(document?.pages) ? document.pages : []) {
      add(pageValue?.id)
      for (const shape of Array.isArray(pageValue?.shapes) ? pageValue.shapes : []) {
        add(shape?.id)
        for (const edge of Array.isArray(shape?.edges) ? shape.edges : []) add(edge?.id)
      }
      for (const entity of Array.isArray(pageValue?.entities) ? pageValue.entities : []) {
        add(entity?.id)
        for (const segment of Array.isArray(entity?.segments) ? entity.segments : []) add(segment?.id)
      }
    }
    return counts
  }
  function splitSourceEdges(shape) {
    const polygon = cleanPoints(shape?.points)
    const existing = Array.isArray(shape?.edges) ? shape.edges : []
    const matches = edgeMetadataMatches(existing, polygon)
    return polygon.map((from, index, all) => ({
      ...(matches[index] ? clone(matches[index]) : {}),
      from: point(from),
      to: point(all[(index + 1) % all.length])
    }))
  }
  function splitSourceEdgeMatch(sourceEdges, from, to, tolerance) {
    const edgeLength = distance(from, to)
    if (edgeLength <= tolerance) return null
    let best = null
    sourceEdges.forEach((source, sourceIndex) => {
      const overlap = edgeCollinearOverlap(source, from, to, tolerance)
      const sourceLength = distance(source.from, source.to)
      const allowance = tolerance * Math.max(1, edgeLength, sourceLength)
      // A split boundary edge must be wholly contained in an original outer
      // edge. Interior cut edges may touch the outline at an endpoint, but do
      // not have full collinear overlap and therefore never inherit metadata.
      if (overlap <= tolerance || overlap + allowance < edgeLength) return
      const candidate = { sourceIndex, overlap, edgeLength }
      if (!best || candidate.overlap > best.overlap + tolerance ||
        (Math.abs(candidate.overlap - best.overlap) <= tolerance && candidate.sourceIndex < best.sourceIndex)) best = candidate
    })
    return best
  }
  function assignSplitEdgeMetadata(document, original, children, claimedIdentifiers = new Set(), options = {}) {
    const tolerance = Math.max(EPS * 10, finite(options.tolerance, 1e-4))
    const counts = documentIdentifierCounts(document)
    for (const edge of Array.isArray(original?.edges) ? original.edges : []) {
      const key = identifierKey(edge?.id)
      const count = counts.get(key) || 0
      if (count <= 1) counts.delete(key)
      else counts.set(key, count - 1)
    }
    const used = new Set([...counts.keys(), ...claimedIdentifiers])
    for (const child of children) {
      if (child?.id != null) {
        const key = identifierKey(child.id)
        used.add(key)
        claimedIdentifiers.add(key)
      }
    }

    const sourceEdges = splitSourceEdges(original)
    const sourceIdentifierKeys = new Set(sourceEdges
      .filter(edge => typeof edge.id === 'string' && edge.id)
      .map(edge => identifierKey(edge.id)))
    const descriptors = []
    children.forEach((child, childIndex) => {
      const polygon = cleanPoints(child?.points)
      polygon.forEach((from, edgeIndex, all) => {
        const to = all[(edgeIndex + 1) % all.length]
        descriptors.push({
          childIndex,
          edgeIndex,
          from: point(from),
          to: point(to),
          freshId: child?.edges?.[edgeIndex]?.id,
          match: splitSourceEdgeMatch(sourceEdges, from, to, tolerance)
        })
      })
    })

    // When an original outer edge is divided between both children, preserve
    // its stable id on the longest fragment. Other matching fragments retain
    // the same visual/text metadata but receive fresh ids.
    const keepers = new Map()
    for (const descriptor of descriptors) {
      if (!descriptor.match) continue
      const current = keepers.get(descriptor.match.sourceIndex)
      if (!current || descriptor.match.overlap > current.match.overlap + tolerance ||
        (Math.abs(descriptor.match.overlap - current.match.overlap) <= tolerance &&
          (descriptor.childIndex < current.childIndex ||
            (descriptor.childIndex === current.childIndex && descriptor.edgeIndex < current.edgeIndex)))) {
        keepers.set(descriptor.match.sourceIndex, descriptor)
      }
    }

    const claimFreshEdgeId = preferred => {
      let id = typeof preferred === 'string' && preferred ? preferred : null
      while (!id || used.has(identifierKey(id)) || sourceIdentifierKeys.has(identifierKey(id))) id = allocId(document, 'edge')
      const key = identifierKey(id)
      used.add(key)
      claimedIdentifiers.add(key)
      return id
    }
    const output = children.map(() => [])
    for (const descriptor of descriptors) {
      const source = descriptor.match ? sourceEdges[descriptor.match.sourceIndex] : null
      const stableId = source && keepers.get(descriptor.match.sourceIndex) === descriptor && typeof source.id === 'string' && source.id
        ? source.id
        : null
      let id = stableId && !used.has(identifierKey(stableId)) ? stableId : null
      if (id) {
        const key = identifierKey(id)
        used.add(key)
        claimedIdentifiers.add(key)
      } else id = claimFreshEdgeId(descriptor.freshId)
      const metadata = source ? clone(source) : {
        hidden: false,
        customText: null,
        labelOffset: { x: 0, y: 0 },
        rotationOffset: 0,
        style: null
      }
      output[descriptor.childIndex][descriptor.edgeIndex] = {
        ...metadata,
        id,
        from: descriptor.from,
        to: descriptor.to
      }
    }
    children.forEach((child, index) => { child.edges = output[index] })
    return children
  }
  function segmentMetadata(document, points, closed = false, existing = [], options = {}) {
    const vertices = cleanPoints(points)
    const old = Array.isArray(existing) ? existing : []
    const limit = closed && vertices.length > 2 ? vertices.length : Math.max(0, vertices.length - 1)
    const result = []
    const used = new Set()
    const outputIds = new Set()
    const freshIds = options.freshIds === true
    const take = predicate => {
      const candidateIndex = old.findIndex((segment, index) => !used.has(index) && predicate(segment, index))
      if (candidateIndex < 0) return null
      used.add(candidateIndex)
      return old[candidateIndex]
    }
    for (let index = 0; index < limit; index += 1) {
      const from = vertices[index]
      const to = vertices[(index + 1) % vertices.length]
      let found = take(segment => samePoint(segment?.from, from, 1e-4) && samePoint(segment?.to, to, 1e-4))
      if (!found) found = take(segment => samePoint(segment?.from, to, 1e-4) && samePoint(segment?.to, from, 1e-4))
      if (!found && old.length === limit && !used.has(index)) {
        found = old[index]
        used.add(index)
      }
      const metadata = found ? clone(found) : {
        hidden: false,
        customText: null, labelOffset: { x: 0, y: 0 }, rotationOffset: 0, style: null
      }
      let id = !freshIds && typeof metadata.id === 'string' && metadata.id && !outputIds.has(metadata.id)
        ? metadata.id
        : allocId(document, 'segment')
      while (outputIds.has(id)) id = allocId(document, 'segment')
      outputIds.add(id)
      result.push({ ...metadata, id, from: point(from), to: point(to) })
    }
    return result
  }
  function createShape(document, kind, points, attributes = {}, options = {}) {
    if (!SHAPE_KINDS.has(kind)) throw new Error(`未対応の図形種別です: ${kind}`)
    const polygon = cleanPoints(points)
    if (!validPolygon(polygon)) throw new Error('3点以上で交差しない図形を指定してください')
    const styleDefault = kind === 'lot' ? DEFAULTS.lotStyle : kind === 'road' ? DEFAULTS.roadStyle : kind === 'water' ? DEFAULTS.waterStyle : DEFAULTS.cutoutStyle
    const preference = document.preferences?.[kind] || document.preferences?.road || {}
    const shape = {
      id: allocId(document, kind), kind, points: polygon,
      visible: attributes.visible !== false,
      style: normalizeStyle(attributes.style || preference.style, styleDefault),
      labelStyle: normalizeStyle(attributes.labelStyle || preference.labelStyle, DEFAULTS.labelStyle),
      dimensionStyle: normalizeStyle(attributes.dimensionStyle || preference.dimensionStyle, DEFAULTS.dimensionStyle),
      visibility: {
        label: true, number: kind === 'lot', topLabel: kind === 'lot', area: kind === 'lot', tsubo: kind === 'lot',
        price: kind === 'lot', memo: kind === 'lot', dimensions: kind === 'lot', approximate: false,
        ...(attributes.visibility || {})
      },
      labelPosition: attributes.labelPosition && isPoint(attributes.labelPosition) ? point(attributes.labelPosition) : null,
      edges: [], memo: String(attributes.memo || '')
    }
    if (typeof attributes.parentShapeId === 'string' && attributes.parentShapeId) shape.parentShapeId = attributes.parentShapeId
    if (Array.isArray(attributes.parentOriginalPoints)) shape.parentOriginalPoints = cleanPoints(attributes.parentOriginalPoints)
    if (Array.isArray(attributes.parentOriginalEdges)) shape.parentOriginalEdges = clone(attributes.parentOriginalEdges)
    if (kind === 'lot') {
      const hasNumber = Object.prototype.hasOwnProperty.call(attributes, 'number')
      const blankNumber = attributes.number === null || attributes.number === undefined || attributes.number === ''
      shape.number = hasNumber && blankNumber
        ? null
        : Number.isFinite(Number(attributes.number))
          ? Number(attributes.number)
          : nextLotNumber(document)
      shape.label = String(attributes.label || '')
      const normalizedLabel = shape.label.replace(/[\s　]+/g, '')
      const generatedNumberLabel = shape.number != null && normalizedLabel === `区画${shape.number}`
      const generatedNumberPrefix = shape.number != null ? new RegExp(`^区画\\s*${shape.number}(?:[\\s　]+|$)`) : null
      if (generatedNumberPrefix?.test(shape.label)) shape.label = shape.label.replace(generatedNumberPrefix, '').trim()
      const generatedMetricLabel = shape.label.split(/[\r\n]+/).map(value => value.trim()).filter(Boolean)
        .every(value => /^(?:約)?[\d,.]+\s*(?:㎡|m²|m2|坪)$/i.test(value))
      if (generatedNumberLabel || (shape.label && generatedMetricLabel)) shape.label = ''
      shape.topLabel = String(attributes.topLabel || '')
      shape.price = attributes.price !== null && attributes.price !== undefined && attributes.price !== '' && Number.isFinite(Number(attributes.price))
        ? Number(attributes.price)
        : null
      shape.areaLabel = normalizeIndependentLabel(
        attributes.areaLabel,
        attributes.customAreaLabel,
        attributes.areaLabelPosition,
        { ...shape.labelStyle, size: finite(document.preferences?.typography?.metric, 12), fontSize: finite(document.preferences?.typography?.metric, 12), scale: 1 },
        shape.visibility.area !== false
      )
      shape.tsuboLabel = normalizeIndependentLabel(
        attributes.tsuboLabel,
        attributes.customTsuboLabel,
        attributes.tsuboLabelPosition,
        { ...shape.labelStyle, size: finite(document.preferences?.typography?.metric, 12), fontSize: finite(document.preferences?.typography?.metric, 12), scale: 1 },
        shape.visibility.tsubo !== false
      )
      // Older projects may carry both the aggregate visibility flag and the
      // independent label flag. Treat either explicit false as authoritative.
      shape.areaLabel.visible = shape.visibility.area !== false && shape.areaLabel.visible !== false
      shape.tsuboLabel.visible = shape.visibility.tsubo !== false && shape.tsuboLabel.visible !== false
      shape.areaLabelPosition = isPoint(attributes.areaLabelPosition)
        ? point(attributes.areaLabelPosition)
        : (isPoint(shape.areaLabel.position) ? point(shape.areaLabel.position) : null)
      shape.tsuboLabelPosition = isPoint(attributes.tsuboLabelPosition)
        ? point(attributes.tsuboLabelPosition)
        : (isPoint(shape.tsuboLabel.position) ? point(shape.tsuboLabel.position) : null)
      shape.customAreaLabel = Object.prototype.hasOwnProperty.call(attributes, 'customAreaLabel')
        ? (attributes.customAreaLabel == null ? null : String(attributes.customAreaLabel))
        : shape.areaLabel.text
      shape.customTsuboLabel = Object.prototype.hasOwnProperty.call(attributes, 'customTsuboLabel')
        ? (attributes.customTsuboLabel == null ? null : String(attributes.customTsuboLabel))
        : shape.tsuboLabel.text
      shape.visibility.area = shape.areaLabel.visible !== false
      shape.visibility.tsubo = shape.tsuboLabel.visible !== false
    } else if (kind === 'road' || kind === 'water') {
      const roadAttributes = attributes.road && typeof attributes.road === 'object' ? attributes.road : {}
      const defaultName = kind === 'water' ? '水路' : '道路'
      const rawName = String(roadAttributes.name ?? attributes.label ?? preference.name ?? defaultName).trim()
      const localizedName = /^(?:road|street)$/i.test(rawName) ? '道路' : /^(?:water|waterway)$/i.test(rawName) ? '水路' : (rawName || defaultName)
      shape.label = localizedName
      shape.road = {
        type: kind === 'water' ? 'water' : String(roadAttributes.type || 'road'),
        name: localizedName,
        widthM: Number.isFinite(Number(roadAttributes.widthM ?? roadAttributes.width ?? attributes.widthM ?? preference.widthM)) ? Number(roadAttributes.widthM ?? roadAttributes.width ?? attributes.widthM ?? preference.widthM) : null,
        vertical: Boolean(roadAttributes.vertical ?? attributes.vertical ?? preference.vertical),
        namePosition: roadAttributes.namePosition && isPoint(roadAttributes.namePosition) ? point(roadAttributes.namePosition) : null,
        widthLabelPosition: roadAttributes.widthLabelPosition && isPoint(roadAttributes.widthLabelPosition) ? point(roadAttributes.widthLabelPosition) : null,
        widthLabelOffset: roadAttributes.widthLabelOffset && isPoint(roadAttributes.widthLabelOffset) ? point(roadAttributes.widthLabelOffset) : null,
        nameStyle: roadAttributes.nameStyle && typeof roadAttributes.nameStyle === 'object'
          ? normalizeStyle(roadAttributes.nameStyle, shape.labelStyle)
          : null,
        widthLabelStyle: roadAttributes.widthLabelStyle && typeof roadAttributes.widthLabelStyle === 'object'
          ? normalizeStyle(roadAttributes.widthLabelStyle, DEFAULTS.dimensionStyle)
          : normalizeStyle(preference.widthLabelStyle, DEFAULTS.dimensionStyle),
        widthText: typeof roadAttributes.widthText === 'string' ? roadAttributes.widthText : null,
        widthPrefix: typeof roadAttributes.widthPrefix === 'string'
          ? (kind === 'water' && /^\s*幅員/.test(roadAttributes.widthPrefix) ? '水路幅 ' : roadAttributes.widthPrefix)
          : (kind === 'water' ? '水路幅 ' : '幅員 '),
        widthUnit: roadAttributes.widthUnit === false ? false : (typeof roadAttributes.widthUnit === 'string' ? roadAttributes.widthUnit : 'm'),
        widthDigits: clamp(Math.trunc(finite(roadAttributes.widthDigits, 1)), 0, 3)
      }
      shape.areaLabel = normalizeIndependentLabel(
        attributes.areaLabel,
        attributes.customAreaLabel,
        attributes.areaLabelPosition,
        { ...shape.labelStyle, size: finite(document.preferences?.typography?.metric, 12), fontSize: finite(document.preferences?.typography?.metric, 12), scale: 1 },
        shape.visibility.area !== false
      )
      shape.tsuboLabel = normalizeIndependentLabel(
        attributes.tsuboLabel,
        attributes.customTsuboLabel,
        attributes.tsuboLabelPosition,
        { ...shape.labelStyle, size: finite(document.preferences?.typography?.metric, 12), fontSize: finite(document.preferences?.typography?.metric, 12), scale: 1 },
        shape.visibility.tsubo !== false
      )
      shape.areaLabel.visible = shape.visibility.area !== false && shape.areaLabel.visible !== false
      shape.tsuboLabel.visible = shape.visibility.tsubo !== false && shape.tsuboLabel.visible !== false
      shape.areaLabelPosition = isPoint(attributes.areaLabelPosition)
        ? point(attributes.areaLabelPosition)
        : (isPoint(shape.areaLabel.position) ? point(shape.areaLabel.position) : null)
      shape.tsuboLabelPosition = isPoint(attributes.tsuboLabelPosition)
        ? point(attributes.tsuboLabelPosition)
        : (isPoint(shape.tsuboLabel.position) ? point(shape.tsuboLabel.position) : null)
      shape.customAreaLabel = Object.prototype.hasOwnProperty.call(attributes, 'customAreaLabel')
        ? (attributes.customAreaLabel == null ? null : String(attributes.customAreaLabel))
        : shape.areaLabel.text
      shape.customTsuboLabel = Object.prototype.hasOwnProperty.call(attributes, 'customTsuboLabel')
        ? (attributes.customTsuboLabel == null ? null : String(attributes.customTsuboLabel))
        : shape.tsuboLabel.text
      shape.visibility.area = shape.areaLabel.visible !== false
      shape.visibility.tsubo = shape.tsuboLabel.visible !== false
    } else {
      shape.label = String(attributes.label || '隅切り')
    }
    shape.edges = edgeMetadata(document, polygon, attributes.edges, { freshIds: options.freshEdgeIds === true })
    if (CONVERTIBLE_SHAPE_KINDS.includes(kind)) {
      shape.kindStates = normalizeKindStates(attributes.kindStates)
      shape.kindStates[kind] = captureShapeKindState(shape)
    }
    return shape
  }
  function createEntity(document, kind, attributes = {}, options = {}) {
    if (!ENTITY_KINDS.has(kind)) throw new Error(`未対応の要素種別です: ${kind}`)
    const entity = {
      id: allocId(document, kind), kind,
      points: cleanPoints(attributes.points),
      text: typeof attributes.text === 'string' ? attributes.text : '',
      style: normalizeStyle(attributes.style, kind === 'text' || kind === 'callout' ? DEFAULTS.textStyle : DEFAULTS.lineStyle),
      labelStyle: normalizeStyle(attributes.labelStyle, DEFAULTS.labelStyle),
      labelPosition: attributes.labelPosition && isPoint(attributes.labelPosition) ? point(attributes.labelPosition) : null,
      options: attributes.options && typeof attributes.options === 'object' ? clone(attributes.options) : {}
    }
    if (isPoint(attributes.position)) entity.position = point(attributes.position)
    if (isPoint(attributes.tip)) entity.tip = point(attributes.tip)
    if (Number.isFinite(Number(attributes.rotation))) entity.rotation = normalizeAngle(attributes.rotation)
    const numericFields = [
      'x', 'y', 'angle', 'size', 'width', 'height', 'depth', 'widthM', 'heightM',
      'worldWidth', 'worldHeight', 'worldSize', 'worldScale', 'scale', 'stampScale', 'stampTextScale', 'fontSize', 'lineWidth',
      'borderWidth', 'headSize', 'padding', 'rowHeight', 'headerHeight', 'titleHeight',
      'offset', 'decimals', 'digits', 'labelOffsetX', 'labelOffsetY', 'textAngle'
    ]
    const stringFields = [
      'label', 'fontFamily', 'fontWeight', 'color', 'background', 'borderColor',
      'fill', 'fillColor', 'headerFill', 'lineStyle', 'strokeColor', 'title', 'type',
      'units', 'metric', 'align', 'memo'
    ]
    const booleanFields = [
      'vertical', 'visible', 'closed', 'doubleHead', 'showDimensions', 'showDims',
      'showPrice', 'approximate', 'yaku', 'dynamic', 'snapshot'
    ]
    const structuredFields = ['dimensionStyle', 'textStyle', 'dimensions', 'columns', 'rows', 'anchor', 'segmentLabels', 'segmentLabelPositions', 'measurementVisibility']
    numericFields.forEach(key => { if (Number.isFinite(Number(attributes[key]))) entity[key] = Number(attributes[key]) })
    stringFields.forEach(key => {
      if (typeof attributes[key] !== 'string') return
      entity[key] = key === 'fontFamily' ? normalizeFontToken(attributes[key]) : attributes[key]
    })
    booleanFields.forEach(key => { if (typeof attributes[key] === 'boolean') entity[key] = attributes[key] })
    structuredFields.forEach(key => { if (attributes[key] != null) entity[key] = clone(attributes[key]) })
    if (entity.dimensionStyle && typeof entity.dimensionStyle === 'object') entity.dimensionStyle = normalizeStyle(entity.dimensionStyle, DEFAULTS.dimensionStyle)
    if (entity.textStyle && typeof entity.textStyle === 'object') entity.textStyle = normalizeStyle(entity.textStyle, DEFAULTS.textStyle)
    if (['distance', 'polyline', 'area', 'dimension'].includes(kind)) {
      const closed = kind === 'area' || attributes.closed === true || attributes.options?.closed === true
      entity.segments = segmentMetadata(document, entity.points, closed, attributes.segments, { freshIds: options.freshSegmentIds === true })
      entity.measurementVisibility = {
        total: true,
        segments: kind === 'polyline' || kind === 'area',
        area: kind === 'area',
        tsubo: kind === 'area',
        ...(attributes.measurementVisibility && typeof attributes.measurementVisibility === 'object' ? clone(attributes.measurementVisibility) : {})
      }
    }
    return entity
  }
  function normalizeShape(document, raw) {
    if (!raw || !SHAPE_KINDS.has(raw.kind)) return null
    try {
      const shape = createShape(document, raw.kind, raw.points, raw)
      if (typeof raw.id === 'string' && raw.id) shape.id = raw.id
      return shape
    } catch (_) { return null }
  }
  function normalizeEntity(document, raw) {
    if (!raw || !ENTITY_KINDS.has(raw.kind)) return null
    const entity = createEntity(document, raw.kind, raw)
    if (typeof raw.id === 'string' && raw.id) entity.id = raw.id
    if (raw.position && isPoint(raw.position)) entity.position = point(raw.position)
    if (raw.tip && isPoint(raw.tip)) entity.tip = point(raw.tip)
    return entity
  }
  function normalizeDocument(input) {
    const fresh = createDocument()
    if (!input || typeof input !== 'object') return fresh
    const source = clone(input)
    fresh.id = typeof source.id === 'string' && source.id ? source.id : fresh.id
    fresh.title = typeof source.title === 'string' ? source.title : fresh.title
    fresh.createdAt = typeof source.createdAt === 'string' ? source.createdAt : fresh.createdAt
    fresh.updatedAt = typeof source.updatedAt === 'string' ? source.updatedAt : fresh.updatedAt
    if (source.background && typeof source.background === 'object') {
      const b = source.background
      fresh.background = {
        ...fresh.background,
        type: ['pdf', 'image', null].includes(b.type) ? b.type : null,
        name: typeof b.name === 'string' ? b.name : '', mimeType: typeof b.mimeType === 'string' ? b.mimeType : '',
        source: typeof b.source === 'string' ? b.source : null,
        size: Math.max(0, Math.trunc(finite(b.size, 0))), metadata: b.metadata && typeof b.metadata === 'object' ? clone(b.metadata) : {},
        pages: Array.isArray(b.pages) ? clone(b.pages) : [], pageCount: Math.max(0, Math.trunc(finite(b.pageCount, Array.isArray(b.pages) ? b.pages.length : 0))),
        currentPage: Math.max(1, Math.trunc(finite(b.currentPage, 1))),
        width: Math.max(0, finite(b.width)), height: Math.max(0, finite(b.height)), opacity: clamp(finite(b.opacity, 1), 0, 1),
        x: finite(b.x), y: finite(b.y), scale: Math.max(EPS, finite(b.scale, 1)), rotation: normalizeAngle(b.rotation),
        imageRotation: [0, 90, 180, 270].includes(Number(b.imageRotation)) ? Number(b.imageRotation) : 0,
        visible: b.visible !== false, locked: Boolean(b.locked)
      }
    }
    if (source.calibration && typeof source.calibration === 'object') {
      fresh.calibration = createCalibration(source.calibration)
    }
    if (source.paper && typeof source.paper === 'object') {
      const size = source.paper.size === 'A3' ? 'A3' : 'A4'
      const orientation = source.paper.orientation === 'portrait' ? 'portrait' : 'landscape'
      const dimensions = size === 'A3' ? [420, 297] : [297, 210]
      fresh.paper = {
        enabled: Boolean(source.paper.enabled), size, orientation,
        widthMm: orientation === 'landscape' ? dimensions[0] : dimensions[1],
        heightMm: orientation === 'landscape' ? dimensions[1] : dimensions[0],
        title: typeof source.paper.title === 'string' ? source.paper.title : '',
        date: typeof source.paper.date === 'string' ? source.paper.date : fresh.paper.date,
        author: typeof source.paper.author === 'string' ? source.paper.author : '',
        note: typeof source.paper.note === 'string' ? source.paper.note : '',
        showFrame: source.paper.showFrame !== false,
        showTitleFrame: source.paper.showTitleFrame !== false,
        includeUnderlay: source.paper.includeUnderlay !== false
      }
    }
    fresh.outputDefaults = createOutputLayout(source.outputDefaults, fresh.paper)
    if (source.preferences && typeof source.preferences === 'object') {
      const p = source.preferences
      if (p.typography && typeof p.typography === 'object') {
        for (const key of Object.keys(DEFAULTS.typography)) {
          fresh.preferences.typography[key] = clamp(finite(p.typography[key], DEFAULTS.typography[key]), 6, 48)
        }
      }
      for (const kind of ['lot', 'road', 'water']) {
        if (!p[kind]) continue
        fresh.preferences[kind] = { ...fresh.preferences[kind], ...clone(p[kind]) }
        fresh.preferences[kind].style = normalizeStyle(p[kind].style, fresh.preferences[kind].style)
        fresh.preferences[kind].labelStyle = normalizeStyle(p[kind].labelStyle, DEFAULTS.labelStyle)
        fresh.preferences[kind].dimensionStyle = normalizeStyle(p[kind].dimensionStyle, DEFAULTS.dimensionStyle)
      }
      if (p.text) fresh.preferences.text = normalizeStyle(p.text, DEFAULTS.textStyle)
      if (p.line) fresh.preferences.line = normalizeStyle(p.line, DEFAULTS.lineStyle)
      if (p.measurement?.dimensionStyle) fresh.preferences.measurement.dimensionStyle = normalizeStyle(p.measurement.dimensionStyle, DEFAULTS.dimensionStyle)
      if (p.snap) fresh.preferences.snap = { ...fresh.preferences.snap, ...clone(p.snap), grid: false }
      if (p.stamp) fresh.preferences.stamp = { ...fresh.preferences.stamp, ...clone(p.stamp) }
    }
    fresh.pages = []
    const pages = Array.isArray(source.pages) && source.pages.length ? source.pages : [createPage(1)]
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      const rawPage = pages[pageIndex] || {}
      const pageValue = {
        id: typeof rawPage.id === 'string' && rawPage.id ? rawPage.id : `page-${pageIndex + 1}`,
        name: typeof rawPage.name === 'string' ? rawPage.name : `${pageIndex + 1}ページ`,
        sourcePage: Math.max(1, Math.trunc(finite(rawPage.sourcePage, pageIndex + 1))),
        calibration: createCalibration(rawPage.calibration),
        outputLayout: createOutputLayout(rawPage.outputLayout || fresh.outputDefaults, fresh.paper),
        shapes: [], entities: []
      }
      pageValue.shapes = (Array.isArray(rawPage.shapes) ? rawPage.shapes : []).map(raw => normalizeShape(fresh, raw)).filter(Boolean)
      pageValue.entities = (Array.isArray(rawPage.entities) ? rawPage.entities : []).map(raw => normalizeEntity(fresh, raw)).filter(Boolean)
      fresh.pages.push(pageValue)
    }
    fresh.activePageId = fresh.pages.some(pageValue => pageValue.id === source.activePageId) ? source.activePageId : fresh.pages[0].id
    // document.calibration is the live value for activePageId. Synchronizing it
    // here makes direct calibration edits safe across undo, save and reload.
    const normalizedActivePage = activePage(fresh)
    if (normalizedActivePage) normalizedActivePage.calibration = clone(fresh.calibration)
    const allIds = fresh.pages.flatMap(pageValue => [
      ...pageValue.shapes,
      ...pageValue.entities,
      ...pageValue.shapes.flatMap(shape => shape.edges || []),
      ...pageValue.entities.flatMap(entity => entity.segments || [])
    ]).map(item => String(item.id || ''))
    const largestNumericId = allIds.reduce((max, id) => Math.max(max, Number(id.match(/(\d+)$/)?.[1]) || 0), 0)
    fresh.nextId = Math.max(largestNumericId + 1, Math.trunc(finite(source.nextId, 1)), 1)
    return fresh
  }

  function objectById(document, id) {
    for (const pageValue of document.pages || []) {
      const shape = pageValue.shapes.find(value => value.id === id)
      if (shape) return { object: shape, collection: pageValue.shapes, page: pageValue, type: 'shape' }
      const entity = pageValue.entities.find(value => value.id === id)
      if (entity) return { object: entity, collection: pageValue.entities, page: pageValue, type: 'entity' }
    }
    return null
  }
  function addShape(document, kind, points, attributes, options = {}) {
    const pageValue = activePage(document)
    if (!pageValue) throw new Error('作図ページがありません')
    const shape = createShape(document, kind, points, attributes, options)
    pageValue.shapes.push(shape)
    return shape
  }
  function addEntity(document, kind, attributes, options = {}) {
    const pageValue = activePage(document)
    if (!pageValue) throw new Error('作図ページがありません')
    const entity = createEntity(document, kind, attributes, options)
    pageValue.entities.push(entity)
    return entity
  }
  function removeObjects(document, ids) {
    const idSet = new Set(Array.isArray(ids) ? ids : [ids])
    let removed = 0
    document.pages.forEach(pageValue => {
      const beforeShapes = pageValue.shapes.length
      const beforeEntities = pageValue.entities.length
      pageValue.shapes = pageValue.shapes.filter(value => !idSet.has(value.id))
      pageValue.entities = pageValue.entities.filter(value => !idSet.has(value.id))
      removed += beforeShapes - pageValue.shapes.length + beforeEntities - pageValue.entities.length
    })
    return removed
  }
  function translateObject(object, dx, dy) {
    const shift = { x: finite(dx), y: finite(dy) }
    if (Array.isArray(object.points)) object.points = object.points.map(p => add(p, shift))
    for (const key of ['position', 'tip', 'labelPosition', 'areaLabelPosition', 'tsuboLabelPosition']) if (isPoint(object[key])) object[key] = add(object[key], shift)
    for (const key of ['areaLabel', 'tsuboLabel']) {
      if (object[key] && typeof object[key] === 'object' && isPoint(object[key].position)) object[key].position = add(object[key].position, shift)
    }
    if (object.road?.namePosition && isPoint(object.road.namePosition)) object.road.namePosition = add(object.road.namePosition, shift)
    if (object.road?.widthLabelPosition && isPoint(object.road.widthLabelPosition)) object.road.widthLabelPosition = add(object.road.widthLabelPosition, shift)
    if (Array.isArray(object.edges)) object.edges.forEach(edge => {
      if (isPoint(edge.from)) edge.from = add(edge.from, shift)
      if (isPoint(edge.to)) edge.to = add(edge.to, shift)
    })
    if (Array.isArray(object.segments)) object.segments.forEach(segment => {
      if (isPoint(segment.from)) segment.from = add(segment.from, shift)
      if (isPoint(segment.to)) segment.to = add(segment.to, shift)
    })
    return object
  }
  function updateObjectVertex(document, id, vertexIndex, newPoint) {
    const found = objectById(document, id)
    if (!found || !Array.isArray(found.object.points) || !isPoint(newPoint)) return false
    if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= found.object.points.length) return false
    const points = found.object.points.map(point)
    points[vertexIndex] = point(newPoint)
    if (found.type === 'shape' && !validPolygon(points)) return false
    found.object.points = points
    if (found.type === 'shape') found.object.edges = edgeMetadata(document, points, found.object.edges)
    else if (['distance', 'polyline', 'area', 'dimension'].includes(found.object.kind)) {
      found.object.segments = segmentMetadata(document, points, found.object.kind === 'area' || found.object.closed === true, found.object.segments)
    }
    return true
  }
  function copyObjectToActivePage(document, source, offset = { x: 24, y: 24 }) {
    const pageValue = activePage(document)
    if (!pageValue || !source || typeof source !== 'object') return null
    let copy = null
    if (SHAPE_KINDS.has(source.kind)) {
      copy = createShape(document, source.kind, source.points, source, { freshEdgeIds: true })
      if (copy.kind === 'lot') copy.number = nextLotNumber(document)
      pageValue.shapes.push(copy)
    } else if (ENTITY_KINDS.has(source.kind)) {
      copy = createEntity(document, source.kind, source, { freshSegmentIds: true })
      pageValue.entities.push(copy)
    }
    if (!copy) return null
    translateObject(copy, finite(offset?.x, 24), finite(offset?.y, 24))
    return copy
  }
  function duplicateObjects(document, ids, offset = { x: 24, y: 24 }) {
    const pageValue = activePage(document)
    const copies = []
    for (const id of Array.isArray(ids) ? ids : [ids]) {
      const found = objectById(document, id)
      if (!found || found.page.id !== pageValue.id) continue
      const copy = copyObjectToActivePage(document, found.object, offset)
      if (copy) copies.push(copy)
    }
    return copies
  }
  function nextLotNumber(document, pageId = document.activePageId) {
    const pageValue = (document.pages || []).find(value => value.id === pageId) || activePage(document)
    const used = (pageValue?.shapes || [])
      .filter(shape => shape.kind === 'lot')
      .map(shape => Number(shape.number))
      .filter(Number.isFinite)
    return (used.length ? Math.max(...used) : 0) + 1
  }
  function lotRenumberOrder(pageValue) {
    return (pageValue?.shapes || [])
      .map((shape, index) => ({ shape, index }))
      .filter(entry => entry.shape.kind === 'lot')
      .sort((a, b) => {
        const aBlank = a.shape.number === null || a.shape.number === undefined || a.shape.number === ''
        const bBlank = b.shape.number === null || b.shape.number === undefined || b.shape.number === ''
        const aNumber = !aBlank && Number.isFinite(Number(a.shape.number)) ? Number(a.shape.number) : Number.POSITIVE_INFINITY
        const bNumber = !bBlank && Number.isFinite(Number(b.shape.number)) ? Number(b.shape.number) : Number.POSITIVE_INFINITY
        return aNumber - bNumber || a.index - b.index
      })
  }
  function lotNumbersNeedRenumber(document, pageId = document.activePageId) {
    const pageValue = (document.pages || []).find(value => value.id === pageId)
    if (!pageValue) return false
    const ordered = lotRenumberOrder(pageValue)
    return ordered.some((entry, index) => Number(entry.shape.number) !== index + 1)
  }
  function renumberLots(document, pageId = document.activePageId) {
    const pageValue = (document.pages || []).find(value => value.id === pageId)
    if (!pageValue) return 0
    let changed = 0
    lotRenumberOrder(pageValue).forEach((entry, index) => {
      const next = index + 1
      if (Number(entry.shape.number) === next) return
      entry.shape.number = next
      changed += 1
    })
    return changed
  }
  function resetShapeLabelLayout(shape) {
    if (!shape || !SHAPE_KINDS.has(shape.kind)) return shape
    shape.labelPosition = null
    shape.areaLabelPosition = null
    shape.tsuboLabelPosition = null
    if (shape.labelStyle) {
      delete shape.labelStyle.x
      delete shape.labelStyle.y
      delete shape.labelStyle.offsetX
      delete shape.labelStyle.offsetY
    }
    for (const key of ['areaLabel', 'tsuboLabel']) {
      if (shape[key] && typeof shape[key] === 'object') shape[key].position = null
    }
    if (shape.road && typeof shape.road === 'object') {
      shape.road.namePosition = null
      shape.road.widthLabelPosition = null
      shape.road.widthLabelOffset = null
    }
    return shape
  }
  function splitShape(document, id, a, b, options = {}) {
    const found = objectById(document, id)
    if (!found || found.type !== 'shape' || !['lot', 'road', 'water'].includes(found.object.kind)) return null
    const split = splitPolygonByLine(found.object.points, a, b)
    if (!split) return null
    const [firstPoints, secondPoints] = split
    const original = found.object
    const first = createShape(document, original.kind, firstPoints, {
      ...original,
      number: original.kind === 'lot' ? original.number : undefined,
      price: original.kind === 'lot' && options.copyPrice === true ? original.price : null,
      memo: original.memo
    }, { freshEdgeIds: true })
    resetShapeLabelLayout(first)
    first.id = original.id
    const second = createShape(document, original.kind, secondPoints, {
      ...original,
      number: original.kind === 'lot' ? nextLotNumber(document) : undefined,
      price: original.kind === 'lot' && options.copyPrice === true ? original.price : null,
      memo: original.memo
    }, { freshEdgeIds: true })
    resetShapeLabelLayout(second)
    assignSplitEdgeMetadata(document, original, [first, second], new Set(), options)
    const index = found.collection.indexOf(original)
    found.collection.splice(index, 1, first, second)
    return [first, second]
  }
  function splitAllLots(document, a, b, options = {}) {
    const pageValue = activePage(document)
    const candidates = pageValue.shapes.filter(shape => shape.kind === 'lot').map(shape => ({ shape, split: splitPolygonByLine(shape.points, a, b) })).filter(value => value.split)
    if (!candidates.length) return []
    const replacements = []
    const claimedIdentifiers = new Set()
    for (const { shape, split } of candidates) {
      const first = createShape(document, 'lot', split[0], { ...shape, number: shape.number, price: options.copyPrice === true ? shape.price : null }, { freshEdgeIds: true })
      resetShapeLabelLayout(first)
      first.id = shape.id
      const second = createShape(document, 'lot', split[1], { ...shape, number: pageValue.shapes.filter(s => s.kind === 'lot').length + replacements.length + 1, price: options.copyPrice === true ? shape.price : null }, { freshEdgeIds: true })
      resetShapeLabelLayout(second)
      assignSplitEdgeMetadata(document, shape, [first, second], claimedIdentifiers, options)
      replacements.push({ shape, first, second })
    }
    for (const replacement of replacements) {
      const index = pageValue.shapes.indexOf(replacement.shape)
      pageValue.shapes.splice(index, 1, replacement.first, replacement.second)
    }
    renumberLots(document)
    return replacements.flatMap(value => [value.first, value.second])
  }
  function applyShapePolylineSplit(document, id, polygons, options = {}) {
    const found = objectById(document, id)
    if (!found || found.type !== 'shape' || !['lot', 'road', 'water'].includes(found.object.kind) || !Array.isArray(polygons) || polygons.length !== 2) return null
    const original = found.object
    const price = original.kind === 'lot' && options.copyPrice === true ? original.price : null
    const first = createShape(document, original.kind, polygons[0], {
      ...original,
      number: original.kind === 'lot' ? original.number : undefined,
      price,
      memo: original.memo
    }, { freshEdgeIds: true })
    resetShapeLabelLayout(first)
    first.id = original.id
    const second = createShape(document, original.kind, polygons[1], {
      ...original,
      number: original.kind === 'lot' ? nextLotNumber(document) : undefined,
      price,
      memo: original.memo
    }, { freshEdgeIds: true })
    resetShapeLabelLayout(second)
    assignSplitEdgeMetadata(document, original, [first, second], new Set(), options)
    const index = found.collection.indexOf(original)
    if (index < 0) return null
    found.collection.splice(index, 1, first, second)
    return [first, second]
  }
  function splitShapeByPolyline(document, id, cutPoints, options = {}) {
    const found = objectById(document, id)
    if (!found || found.type !== 'shape' || !['lot', 'road', 'water'].includes(found.object.kind)) return null
    const analysis = analyzePolygonSplitByPolyline(found.object.points, cutPoints, options)
    if (analysis.status !== 'split') return null
    return applyShapePolylineSplit(document, id, analysis.polygons, options)
  }
  function splitAllLotsByPolyline(document, cutPoints, options = {}) {
    const pageValue = activePage(document)
    if (!pageValue) return null
    const cut = cleanOpenPolyline(cutPoints, Math.max(EPS * 10, finite(options.tolerance, 1e-5)))
    if (!simpleOpenPolyline(cut, Math.max(EPS * 10, finite(options.tolerance, 1e-5)))) return null
    const requestedKinds = Array.isArray(options.kinds) && options.kinds.length ? options.kinds : ['lot']
    const allowedKinds = new Set(requestedKinds.filter(kind => ['lot', 'road', 'water'].includes(kind)))
    const plans = []
    for (const shape of pageValue.shapes.filter(value => allowedKinds.has(value.kind))) {
      const analysis = analyzePolygonSplitByPolyline(shape.points, cut, options)
      if (analysis.status === 'invalid') return null
      if (analysis.status === 'split') plans.push({ id: shape.id, polygons: analysis.polygons })
    }
    if (!plans.length) return []

    // Build every replacement on a detached document first. The caller's
    // document is changed only after all shapes and IDs were created safely.
    // Avoid duplicating a potentially very large embedded PDF. Only page/shape
    // state participates in splitting and numbering.
    const draft = {
      ...document,
      pages: document.pages.map(pageValue => ({
        ...pageValue,
        shapes: pageValue.shapes.map(shape => clone(shape)),
        entities: pageValue.entities
      }))
    }
    const replacements = []
    try {
      for (const plan of plans) {
        const pair = applyShapePolylineSplit(draft, plan.id, plan.polygons, options)
        if (!pair) return null
        replacements.push(pair)
      }
      renumberLots(draft)
    } catch (_) {
      return null
    }
    document.pages = draft.pages
    document.nextId = draft.nextId
    return replacements.flat()
  }
  function convertShapeKind(document, id, targetKind) {
    if (!CONVERTIBLE_SHAPE_KINDS.includes(targetKind)) return null
    const found = objectById(document, id)
    if (!found || found.type !== 'shape' || !CONVERTIBLE_SHAPE_KINDS.includes(found.object.kind)) return null
    const source = found.object
    if (source.kind === targetKind) return source
    const preference = document.preferences?.[targetKind] || {}
    const kindStates = normalizeKindStates(source.kindStates)
    kindStates[source.kind] = captureShapeKindState(source)
    const targetState = kindStates[targetKind]
    const common = {
      memo: source.memo,
      visible: source.visible,
      // 初めて別種類へ切り替える時は、変更先の標準書式を使う。
      // 以前その種類だった図形は targetState が後段で上書きし、当時の
      // 書式・位置・番号等を正確に復元する。
      labelStyle: preference.labelStyle,
      dimensionStyle: preference.dimensionStyle,
      style: preference.style,
      labelPosition: null,
      kindStates
    }
    const defaults = targetKind === 'lot'
      ? {
          ...common,
          number: nextLotNumber(document), label: '', topLabel: '', price: null,
          visibility: {
            label: true, number: true, topLabel: true,
            area: preference.showArea !== false, tsubo: preference.showTsubo !== false,
            price: true, memo: true, dimensions: preference.showLengths !== false,
            approximate: false
          }
        }
      : {
          ...common,
          label: targetKind === 'water' ? '水路' : '道路',
          road: {
            type: targetKind === 'water' ? 'water' : 'road',
            name: targetKind === 'water' ? '水路' : '道路',
            widthM: Number.isFinite(Number(preference.widthM)) ? Number(preference.widthM) : (targetKind === 'water' ? 0 : 4),
            widthPrefix: targetKind === 'water' ? '水路幅 ' : '幅員 ',
            widthLabelStyle: preference.widthLabelStyle
          },
          visibility: { label: true, number: false, topLabel: false, area: false, tsubo: false, price: false, memo: true, dimensions: false, width: true, approximate: false }
        }
    const attributes = {
      ...defaults,
      ...(targetState ? clone(targetState) : {}),
      kindStates,
      edges: kindConversionEdges(document, source, targetState)
    }
    const converted = createShape(document, targetKind, source.points, attributes)
    converted.id = source.id
    const index = found.collection.indexOf(source)
    if (index < 0) return null
    found.collection.splice(index, 1, converted)
    return converted
  }
  function mergeLotShapes(document, firstId, secondId, options = {}) {
    const first = objectById(document, firstId)
    const second = objectById(document, secondId)
    if (!first || !second || first.page.id !== second.page.id || first.type !== 'shape' || second.type !== 'shape') return null
    const mergeKinds = new Set([first.object.kind, second.object.kind])
    const sameKind = mergeKinds.size === 1 && ['lot', 'road', 'water'].includes(first.object.kind)
    const lotCutout = mergeKinds.size === 2 && mergeKinds.has('lot') && mergeKinds.has('cutout')
    if (!sameKind && !lotCutout) return null
    if (lotCutout) {
      const cutout = first.object.kind === 'cutout' ? first.object : second.object
      const lot = first.object.kind === 'lot' ? first.object : second.object
      if (cutout.parentShapeId === lot.id && Array.isArray(cutout.parentOriginalPoints) && cutout.parentOriginalPoints.length >= 3) {
        return restoreCutout(document, cutout.id)
      }
    }
    const points = mergeAdjacentPolygons(first.object.points, second.object.points, finite(options.tolerance, 1e-3))
    if (!points) return null
    const primary = lotCutout
      ? (first.object.kind === 'lot' ? first.object : second.object)
      : (options.primaryId === second.object.id ? second.object : first.object)
    const secondary = primary === first.object ? second.object : first.object
    const merged = createShape(document, primary.kind, points, {
      ...primary,
      number: primary.kind === 'lot' && secondary.kind === 'lot'
        ? Math.min(finite(primary.number, 1), finite(secondary.number, 1))
        : (primary.kind === 'lot' ? finite(primary.number, 1) : undefined),
      price: primary.kind === 'lot' && secondary.kind === 'lot'
        ? (options.price === 'sum' ? finite(primary.price) + finite(secondary.price) : null)
        : (primary.kind === 'lot' ? (primary.price ?? null) : null),
      memo: secondary.kind === primary.kind ? [primary.memo, secondary.memo].filter(Boolean).join(' / ') : primary.memo
    })
    resetShapeLabelLayout(merged)
    merged.id = primary.id
    first.page.shapes = first.page.shapes.filter(shape => shape.id !== firstId && shape.id !== secondId)
    first.page.shapes.push(merged)
    if (primary.kind === 'lot') renumberLots(document)
    return merged
  }
  function cutShapeCorner(document, id, vertexIndex, distanceWorld) {
    const found = objectById(document, id)
    if (!found || found.type !== 'shape' || found.object.kind !== 'lot') return null
    const originalPoints = clone(found.object.points)
    const originalEdges = clone(found.object.edges || [])
    const result = cornerCut(found.object.points, vertexIndex, distanceWorld)
    if (!result) return null
    found.object.points = result.polygon
    found.object.edges = edgeMetadata(document, result.polygon, found.object.edges)
    const cutout = createShape(document, 'cutout', result.cutout, {
      label: '隅切り',
      parentShapeId: found.object.id,
      parentOriginalPoints: originalPoints,
      parentOriginalEdges: originalEdges,
      visibility: { label: true, number: false, area: false, tsubo: false, price: false, memo: false, dimensions: true }
    })
    found.page.shapes.push(cutout)
    return { lot: found.object, cutout, cutLength: result.cutLength }
  }

  function restoreCutout(document, cutoutId) {
    const cutoutFound = objectById(document, cutoutId)
    if (!cutoutFound || cutoutFound.type !== 'shape' || cutoutFound.object.kind !== 'cutout') return null
    const cutout = cutoutFound.object
    const parentFound = cutout.parentShapeId ? objectById(document, cutout.parentShapeId) : null
    if (!parentFound || parentFound.type !== 'shape' || parentFound.page.id !== cutoutFound.page.id || parentFound.object.kind !== 'lot') return null
    if (!Array.isArray(cutout.parentOriginalPoints) || !validPolygon(cutout.parentOriginalPoints)) return null
    parentFound.object.points = cleanPoints(cutout.parentOriginalPoints)
    parentFound.object.edges = edgeMetadata(document, parentFound.object.points, cutout.parentOriginalEdges || parentFound.object.edges)
    cutoutFound.page.shapes = cutoutFound.page.shapes.filter(shape => shape.id !== cutout.id)
    return parentFound.object
  }

  function objectSegments(object) {
    const points = cleanPoints(object?.points)
    const segments = []
    for (let i = 1; i < points.length; i += 1) segments.push({ a: points[i - 1], b: points[i], index: i - 1 })
    if (object && (SHAPE_KINDS.has(object.kind) || object.kind === 'area' || object.closed === true || object.options?.closed === true) && points.length > 2) segments.push({ a: points[points.length - 1], b: points[0], index: points.length - 1 })
    return segments
  }
  function snapPoint(document, rawPoint, settings = {}, tolerance = 8) {
    const p = point(rawPoint)
    const pageValue = activePage(document)
    const options = { ...DEFAULTS.snap, ...(document.preferences?.snap || {}), ...settings }
    const excludedIds = new Set((settings.excludeObjectIds || settings.excludeIds || []).map(String))
    const objects = [...(pageValue?.shapes || []), ...(pageValue?.entities || [])]
      .filter(object => object.visible !== false && !excludedIds.has(String(object.id)))
    if (options.vertex) {
      let best = null
      objects.forEach(object => (object.points || []).forEach((vertex, index) => {
        const d = distance(p, vertex)
        if (d <= tolerance && (!best || d < best.distance)) best = { point: point(vertex), type: 'vertex', objectId: object.id, index, distance: d }
      }))
      if (best) return best
    }
    const segments = objects.flatMap(object => objectSegments(object).map(segment => ({ ...segment, objectId: object.id })))
    if (options.intersection) {
      let best = null
      for (let i = 0; i < segments.length; i += 1) for (let j = i + 1; j < segments.length; j += 1) {
        if (segments[i].objectId === segments[j].objectId) continue
        const hit = segmentIntersection(segments[i].a, segments[i].b, segments[j].a, segments[j].b)
        if (!hit || hit.collinear) continue
        const d = distance(p, hit.point)
        if (d <= tolerance && (!best || d < best.distance)) best = { point: hit.point, type: 'intersection', objectIds: [segments[i].objectId, segments[j].objectId], distance: d }
      }
      if (best) return best
    }
    if (options.edge) {
      let best = null
      objects.forEach(object => {
        if (object.kind !== 'guide' || object.options?.mode !== 'segment' || (object.points || []).length < 2) return
        const start = object.points[0]
        const end = object.points[1]
        const divisions = clamp(Math.round(finite(object.options?.divisions, 2)), 2, 20)
        for (let index = 1; index < divisions; index += 1) {
          const guidePoint = interpolate(start, end, index / divisions)
          const d = distance(p, guidePoint)
          if (d <= tolerance && (!best || d < best.distance)) {
            best = { point: guidePoint, type: 'guide-point', objectId: object.id, index, divisions, distance: d }
          }
        }
      })
      // A guide division is an intentional construction point. Resolve it
      // before the arbitrary nearest projection onto an ordinary edge.
      if (best) return best
    }
    if (options.edge) {
      let best = null
      segments.forEach(segment => {
        const candidate = nearestPointOnSegment(p, segment.a, segment.b)
        if (candidate.distance <= tolerance && (!best || candidate.distance < best.distance)) best = { ...candidate, type: 'edge', objectId: segment.objectId, index: segment.index }
      })
      if (best) return best
    }
    if (options.grid) {
      const gridSize = Math.max(EPS, finite(options.gridSize, 10))
      const gridPoint = { x: Math.round(p.x / gridSize) * gridSize, y: Math.round(p.y / gridSize) * gridSize }
      if (distance(p, gridPoint) <= tolerance) return { point: gridPoint, type: 'grid', distance: distance(p, gridPoint) }
    }
    return { point: p, type: 'free', distance: 0 }
  }
  function hitTestDocument(document, p, tolerance = 6) {
    const pageValue = activePage(document)
    if (!pageValue) return null
    for (let i = pageValue.shapes.length - 1; i >= 0; i -= 1) {
      const shape = pageValue.shapes[i]
      for (let vertexIndex = 0; vertexIndex < shape.points.length; vertexIndex += 1) {
        if (distance(p, shape.points[vertexIndex]) <= tolerance) return { id: shape.id, type: 'shape', part: 'vertex', index: vertexIndex, object: shape }
      }
      const segments = objectSegments(shape)
      for (const segment of segments) if (nearestPointOnSegment(p, segment.a, segment.b).distance <= tolerance) return { id: shape.id, type: 'shape', part: 'edge', index: segment.index, object: shape }
      if (pointInPolygon(p, shape.points)) return { id: shape.id, type: 'shape', part: 'body', object: shape }
    }
    for (let i = pageValue.entities.length - 1; i >= 0; i -= 1) {
      const entity = pageValue.entities[i]
      if (isPoint(entity.position)) {
        const stampScale = clamp(finite(entity.stampScale ?? entity.options?.scale, 1), 0.2, 5)
        const positionTolerance = entity.kind === 'north'
          ? Math.max(tolerance * 2, finite(entity.worldSize, finite(entity.size, 54)) * stampScale * 0.78)
          : tolerance * 2
        if (entity.kind === 'house' || entity.kind === 'parking') {
          const mpp = Math.max(EPS, finite(document.calibration?.mpp, 0))
          const metric = entity.units !== 'world' && entity.metric !== false
          const factor = metric && mpp > EPS ? 1 / mpp : finite(entity.worldScale, metric ? 10 : 1)
          const halfWidth = Math.max(tolerance, Math.max(0.01, finite(entity.width, entity.kind === 'parking' ? 2.5 : 10)) * factor * stampScale / 2)
          const halfHeight = Math.max(tolerance, Math.max(0.01, finite(entity.height ?? entity.depth, entity.kind === 'parking' ? 5 : 8)) * factor * stampScale / 2)
          const angle = -normalizeAngle(entity.rotation ?? entity.angle) * Math.PI / 180
          const dx = p.x - entity.position.x
          const dy = p.y - entity.position.y
          const localX = dx * Math.cos(angle) - dy * Math.sin(angle)
          const localY = dx * Math.sin(angle) + dy * Math.cos(angle)
          if (Math.abs(localX) <= halfWidth + tolerance && Math.abs(localY) <= halfHeight + tolerance) {
            return { id: entity.id, type: 'entity', part: 'body', object: entity }
          }
        }
        if (distance(p, entity.position) <= positionTolerance) return { id: entity.id, type: 'entity', part: 'position', object: entity }
      }
      for (let vertexIndex = 0; vertexIndex < (entity.points || []).length; vertexIndex += 1) if (distance(p, entity.points[vertexIndex]) <= tolerance) return { id: entity.id, type: 'entity', part: 'vertex', index: vertexIndex, object: entity }
      for (const segment of objectSegments(entity)) if (nearestPointOnSegment(p, segment.a, segment.b).distance <= tolerance) return { id: entity.id, type: 'entity', part: 'body', object: entity }
    }
    return null
  }

  function metersFromPixels(pixels, mpp) { return Number.isFinite(Number(mpp)) && Number(mpp) > 0 ? pixels * Number(mpp) : null }
  function squareMetersFromPixels(areaPixels, mpp) { return Number.isFinite(Number(mpp)) && Number(mpp) > 0 ? areaPixels * Number(mpp) * Number(mpp) : null }
  function squareMetersToTsubo(squareMeters) { return Number.isFinite(Number(squareMeters)) ? Number(squareMeters) / TSUBO_M2 : null }
  function applyRounding(value, decimals = 2, mode = 'round', adjustment = 0) {
    if (!Number.isFinite(Number(value))) return null
    const factor = 10 ** clamp(Math.trunc(finite(decimals, 2)), 0, 6)
    const adjusted = Math.max(0, Number(value) + finite(adjustment))
    const operation = mode === 'floor' ? Math.floor : mode === 'ceil' ? Math.ceil : Math.round
    return operation((adjusted + Number.EPSILON) * factor) / factor
  }
  function formatMeasurement(value, options = {}, suffix = '') {
    if (!Number.isFinite(Number(value))) return '縮尺未設定'
    const decimals = clamp(Math.trunc(finite(options.decimals, 2)), 0, 6)
    const rounded = applyRounding(value, decimals, options.rounding || 'round', options.adjustment)
    const prefix = options.approximate ? '約' : ''
    return `${prefix}${rounded.toFixed(decimals)}${suffix}`
  }
  function shapeMetrics(shape, mpp) {
    const areaPx = polygonArea(shape.points)
    const areaM2 = squareMetersFromPixels(areaPx, mpp)
    return {
      areaPx, areaM2, tsubo: squareMetersToTsubo(areaM2), centroid: polygonCentroid(shape.points),
      edges: objectSegments(shape).map(segment => ({ index: segment.index, pixels: distance(segment.a, segment.b), meters: metersFromPixels(distance(segment.a, segment.b), mpp) }))
    }
  }
  function entityMetrics(entity, mpp) {
    if (entity.kind === 'area') {
      const areaM2 = squareMetersFromPixels(polygonArea(entity.points), mpp)
      const segments = objectSegments(entity).map(segment => ({
        index: segment.index,
        pixels: distance(segment.a, segment.b),
        meters: metersFromPixels(distance(segment.a, segment.b), mpp)
      }))
      return { areaM2, tsubo: squareMetersToTsubo(areaM2), meters: segments.every(item => Number.isFinite(item.meters)) ? segments.reduce((sum, item) => sum + item.meters, 0) : null, segments }
    }
    const segments = objectSegments(entity).map(segment => ({
      index: segment.index,
      pixels: distance(segment.a, segment.b),
      meters: metersFromPixels(distance(segment.a, segment.b), mpp)
    }))
    return { meters: segments.every(item => Number.isFinite(item.meters)) ? segments.reduce((sum, item) => sum + item.meters, 0) : null, segments }
  }
  function registrySummary(document, pageId = document.activePageId) {
    const pageValue = document.pages.find(value => value.id === pageId) || activePage(document)
    const mpp = document.calibration.mpp
    const rows = (pageValue?.shapes || []).map(shape => {
      const metrics = shapeMetrics(shape, mpp)
      return {
        id: shape.id, kind: shape.kind, number: shape.number ?? '', label: shape.label || '',
        areaM2: metrics.areaM2, tsubo: metrics.tsubo, price: Number.isFinite(shape.price) ? shape.price : null, memo: shape.memo || ''
      }
    })
    const lots = rows.filter(row => row.kind === 'lot')
    const roads = rows.filter(row => row.kind === 'road')
    const waters = rows.filter(row => row.kind === 'water')
    const included = [...lots, ...roads, ...waters]
    const sum = (values, key) => values.reduce((total, row) => total + (row[key] || 0), 0)
    return {
      rows,
      totals: {
        lotCount: lots.length,
        roadCount: roads.length,
        waterCount: waters.length,
        includedCount: included.length,
        lotAreaM2: sum(lots, 'areaM2'),
        lotTsubo: sum(lots, 'tsubo'),
        price: lots.reduce((sum, row) => sum + (row.price || 0), 0),
        roadAreaM2: sum(roads, 'areaM2'),
        roadTsubo: sum(roads, 'tsubo'),
        waterAreaM2: sum(waters, 'areaM2'),
        waterTsubo: sum(waters, 'tsubo'),
        includedAreaM2: sum(included, 'areaM2'),
        includedTsubo: sum(included, 'tsubo'),
        cutoutAreaM2: rows.filter(row => row.kind === 'cutout').reduce((sum, row) => sum + (row.areaM2 || 0), 0)
      }
    }
  }
  function documentBounds(document, pageId = document.activePageId) {
    const pageValue = document.pages.find(value => value.id === pageId) || activePage(document)
    const bounds = []
    if (document.paper.enabled) bounds.push({ minX: 0, minY: 0, maxX: document.paper.widthMm * 3, maxY: document.paper.heightMm * 3, width: document.paper.widthMm * 3, height: document.paper.heightMm * 3 })
    if (document.background.visible && document.background.width > 0 && document.background.height > 0) {
      const b = document.background
      const corners = [{ x: b.x, y: b.y }, { x: b.x + b.width * b.scale, y: b.y }, { x: b.x + b.width * b.scale, y: b.y + b.height * b.scale }, { x: b.x, y: b.y + b.height * b.scale }]
      const center = polygonCentroid(corners)
      bounds.push(boundsOfPoints(corners.map(p => rotatePoint(p, center, b.rotation + b.imageRotation))))
    }
    for (const object of [...(pageValue?.shapes || []), ...(pageValue?.entities || [])]) {
      bounds.push(boundsOfPoints([...(object.points || []), object.position, object.tip, object.labelPosition].filter(isPoint)))
    }
    return unionBounds(bounds)
  }

  function documentContentFingerprint(document) {
    if (!document || typeof document !== 'object') return JSON.stringify(document)
    // updatedAt records when a change was made, not what was saved. Excluding
    // only the root timestamp lets Undo/Redo recognize an exact saved content
    // state even when that state was reached at a different time.
    const { updatedAt: _updatedAt, ...content } = document
    return JSON.stringify(content)
  }

  class DocumentStore {
    constructor(document = createDocument()) {
      this.document = normalizeDocument(document)
      this.undoStack = []
      this.redoStack = []
      this.listeners = new Set()
      this.savedFingerprint = documentContentFingerprint(this.document)
      this.dirty = false
    }
    subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
    emit(event) { this.listeners.forEach(listener => listener({ ...event, document: this.document, dirty: this.dirty })) }
    refreshDirty() {
      this.dirty = this.savedFingerprint == null || documentContentFingerprint(this.document) !== this.savedFingerprint
      return this.dirty
    }
    commit(label, mutator) {
      const before = clone(this.document)
      const draft = clone(this.document)
      const result = mutator(draft)
      const after = normalizeDocument(draft)
      if (documentContentFingerprint(before) === documentContentFingerprint(after)) {
        this.refreshDirty()
        return result
      }
      this.undoStack.push({ label: String(label || '変更'), document: before })
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift()
      this.redoStack = []
      this.document = after
      this.document.updatedAt = nowIso()
      this.refreshDirty()
      this.emit({ type: 'commit', label, result })
      return result
    }
    replace(document, options = {}) {
      this.document = normalizeDocument(document)
      this.undoStack = []
      this.redoStack = []
      const clean = options.clean !== false
      this.savedFingerprint = clean ? documentContentFingerprint(this.document) : null
      this.dirty = !clean
      this.emit({ type: 'replace' })
      return this.document
    }
    undo() {
      const entry = this.undoStack.pop()
      if (!entry) return false
      this.redoStack.push({ label: entry.label, document: clone(this.document) })
      this.document = normalizeDocument(entry.document)
      this.refreshDirty()
      this.emit({ type: 'undo', label: entry.label })
      return true
    }
    redo() {
      const entry = this.redoStack.pop()
      if (!entry) return false
      this.undoStack.push({ label: entry.label, document: clone(this.document) })
      this.document = normalizeDocument(entry.document)
      this.refreshDirty()
      this.emit({ type: 'redo', label: entry.label })
      return true
    }
    markSaved() {
      this.savedFingerprint = documentContentFingerprint(this.document)
      this.dirty = false
      this.emit({ type: 'saved' })
    }
    clearHistory() { this.undoStack = []; this.redoStack = []; this.emit({ type: 'history-clear' }) }
    get canUndo() { return this.undoStack.length > 0 }
    get canRedo() { return this.redoStack.length > 0 }
  }

  class CommandSession {
    constructor() {
      this.category = 'select'
      this.command = 'select'
      this.serial = 0
      this.reset()
    }
    reset() {
      this.step = 0
      this.points = []
      this.targetIds = []
      this.vertexIndex = null
      this.preview = null
      this.form = {}
      this.message = ''
      this.startedAt = Date.now()
    }
    activate(command, form = {}) {
      const category = Object.entries(COMMANDS).find(([, commands]) => commands.includes(command))?.[0] || 'select'
      this.category = category
      this.command = command
      this.serial += 1
      this.reset()
      this.form = clone(form)
      return this
    }
    addPoint(value) { if (isPoint(value)) { this.points.push(point(value)); this.step = this.points.length }; return this.points.length }
    back() { const removed = this.points.pop() || null; this.step = this.points.length; return removed }
    cancel() { const command = this.command; const category = this.category; this.serial += 1; this.reset(); this.command = command; this.category = category }
    complete() { const payload = { command: this.command, points: clone(this.points), targetIds: [...this.targetIds], form: clone(this.form) }; this.cancel(); return payload }
  }

  Object.assign(K, {
    APP_VERSION, SCHEMA_VERSION, TSUBO_M2, EPS, DEFAULTS, COMMANDS, SHAPE_KINDS, ENTITY_KINDS,
    clone, finite, clamp, isPoint, point, nearly, samePoint, add, subtract, multiply, dot, cross, length, distance, unit,
    interpolate, normalizeAngle, rotatePoint, cleanPoints, polygonSignedArea, polygonArea, polygonCentroid, polylineLength,
    pointOnSegment, pointInPolygon, nearestPointOnSegment, segmentIntersection, polygonSelfIntersects, simplifyPolygon,
    validPolygon, splitPolygonByLine, splitPolygonByPolyline, analyzePolygonSplitByPolyline, mergeAdjacentPolygons, cornerCut, parallelLine, boundsOfPoints, unionBounds,
    createCalibration, createOutputLayout, createPage, createDocument, normalizeDocument, normalizeFontToken, activePage, ensurePage, setActivePage, allocId, edgeMetadata, createShape, createEntity, segmentMetadata, objectById,
    addShape, addEntity, removeObjects, translateObject, updateObjectVertex, copyObjectToActivePage, duplicateObjects, nextLotNumber, lotNumbersNeedRenumber, renumberLots,
    splitShape, splitAllLots, splitShapeByPolyline, splitAllLotsByPolyline, convertShapeKind, mergeLotShapes, cutShapeCorner, restoreCutout, objectSegments, snapPoint, hitTestDocument,
    metersFromPixels, squareMetersFromPixels, squareMetersToTsubo, applyRounding, formatMeasurement,
    shapeMetrics, entityMetrics, registrySummary, documentBounds, DocumentStore, CommandSession
  })

  if (window.document) {
    window.document.title = `土地区画作成工房 v${APP_VERSION}`
    window.document.querySelectorAll?.('[data-app-version]').forEach(node => { node.textContent = `v${APP_VERSION}` })
  }
})()
