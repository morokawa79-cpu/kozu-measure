'use strict'

const assert = require('node:assert/strict')

global.window = global
require('./v210/core.js')
require('./v210/io.js')

const K = global.KozuV210
const IO = K.IO
const tests = []

function test(name, callback) {
  tests.push({ name, callback })
}

function pageOf(document) {
  return K.activePage(document)
}

function rectangle(document, x1, y1, x2, y2, attributes = {}) {
  return K.addShape(document, 'lot', [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 }
  ], attributes)
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function shapeState(document) {
  return clone(pageOf(document).shapes)
}

function totalArea(shapes) {
  return shapes.reduce((sum, shape) => sum + K.polygonArea(shape.points), 0)
}

function minimumEdgeLength(points) {
  const polygon = K.cleanPoints(points)
  return polygon.reduce((minimum, value, index) => {
    return Math.min(minimum, K.distance(value, polygon[(index + 1) % polygon.length]))
  }, Infinity)
}

function assertValidPolygons(shapes, expectedArea, label) {
  assert.ok(shapes.length > 0, `${label}: polygons are present`)
  for (const shape of shapes) {
    assert.equal(K.validPolygon(shape.points), true, `${label}: ${shape.id} is valid`)
    assert.equal(K.polygonSelfIntersects(shape.points), false, `${label}: ${shape.id} is simple`)
    assert.ok(minimumEdgeLength(shape.points) >= 0.01, `${label}: ${shape.id} has no sub-pixel sliver`)
  }
  assert.ok(Math.abs(totalArea(shapes) - expectedArea) <= Math.max(1, expectedArea) * 1e-8, `${label}: area is conserved`)
}

function allIdentifiers(document) {
  return document.pages.flatMap(page => [
    page.id,
    ...page.shapes.flatMap(shape => [shape.id, ...(shape.edges || []).map(edge => edge.id)]),
    ...page.entities.flatMap(entity => [entity.id, ...(entity.segments || []).map(segment => segment.id)])
  ]).map(value => `${typeof value}:${String(value)}`)
}

function assertUniqueSerializable(document, label) {
  const identifiers = allIdentifiers(document)
  assert.equal(new Set(identifiers).size, identifiers.length, `${label}: IDs are globally unique`)
  const validation = IO.validateDocument(document)
  assert.equal(validation.valid, true, `${label}: ${validation.errors.join(' / ')}`)
  assert.doesNotThrow(() => IO.serializeProject(document), `${label}: project serializes`)
}

function geometrySignature(document) {
  return pageOf(document).shapes.map(shape => ({
    id: shape.id,
    kind: shape.kind,
    number: shape.number,
    label: shape.label,
    memo: shape.memo,
    points: shape.points.map(point => ({
      x: Number(point.x.toFixed(7)),
      y: Number(point.y.toFixed(7))
    }))
  })).sort((left, right) => {
    const leftCenter = K.polygonCentroid(left.points)
    const rightCenter = K.polygonCentroid(right.points)
    return leftCenter.y - rightCenter.y || leftCenter.x - rightCenter.x
  })
}

function documentContent(document) {
  return {
    nextId: document.nextId,
    shapes: shapeState(document)
  }
}

function assertHistoryRoundTrip(store, operation, label) {
  const before = documentContent(store.document)
  const result = operation()
  assert.ok(result, `${label}: operation succeeds`)
  const after = documentContent(store.document)
  assert.notDeepEqual(after, before, `${label}: operation changes geometry`)
  assert.equal(store.undoStack.length, 1, `${label}: one undo entry`)
  assert.equal(store.undo(), true, `${label}: undo succeeds`)
  assert.deepEqual(documentContent(store.document), before, `${label}: undo restores IDs, attributes and geometry`)
  assert.equal(store.redo(), true, `${label}: redo succeeds`)
  assert.deepEqual(documentContent(store.document), after, `${label}: redo restores the exact result`)
}

function mergeGroup(document, ids, options = {}) {
  assert.equal(typeof K.mergeShapeGroup, 'function', 'mergeShapeGroup API must support connected selections')
  return K.mergeShapeGroup(document, ids, options)
}

test('A: vertical split creates two valid parcels', () => {
  const document = K.createDocument()
  const lot = rectangle(document, 0, 0, 100, 100)
  const children = K.splitShapeByPolyline(document, lot.id, [{ x: 50, y: -20 }, { x: 50, y: 120 }])
  assert.equal(children?.length, 2)
  assertValidPolygons(children, 10000, 'vertical split')
  assertUniqueSerializable(document, 'vertical split')
})

test('B: horizontal split creates two valid parcels', () => {
  const document = K.createDocument()
  const lot = rectangle(document, 0, 0, 100, 100)
  const children = K.splitShapeByPolyline(document, lot.id, [{ x: -20, y: 50 }, { x: 120, y: 50 }])
  assert.equal(children?.length, 2)
  assertValidPolygons(children, 10000, 'horizontal split')
})

test('C: split through two vertices is canonicalized once', () => {
  const document = K.createDocument()
  const lot = rectangle(document, 0, 0, 100, 100)
  const children = K.splitShapeByPolyline(document, lot.id, [{ x: -20, y: -20 }, { x: 120, y: 120 }])
  assert.equal(children?.length, 2)
  assertValidPolygons(children, 10000, 'vertex split')
})

test('D: split within floating-point noise of vertices stays stable', () => {
  const document = K.createDocument()
  const lot = rectangle(document, 0, 0, 100, 100)
  const children = K.splitShapeByPolyline(document, lot.id, [
    { x: -20, y: -19.9999999 },
    { x: 120, y: 120.0000001 }
  ])
  assert.equal(children?.length, 2)
  assertValidPolygons(children, 10000, 'near-vertex split')
})

test('E: a nearly parallel cut cannot leave a sub-pixel sliver', () => {
  const document = K.createDocument()
  const lot = rectangle(document, 0, 0, 100, 100)
  const before = clone(documentContent(document))
  const children = K.splitShapeByPolyline(document, lot.id, [{ x: -20, y: 0.002 }, { x: 120, y: 0.002 }])
  assert.equal(children, null)
  assert.deepEqual(documentContent(document), before)
})

test('F: an outside cut leaves the source untouched', () => {
  const document = K.createDocument()
  const lot = rectangle(document, 0, 0, 100, 100)
  const before = clone(documentContent(document))
  const children = K.splitShapeByPolyline(document, lot.id, [{ x: -20, y: -5 }, { x: 120, y: -5 }])
  assert.equal(children, null)
  assert.deepEqual(documentContent(document), before)
})

test('G/H: selected split never changes an adjacent parcel', () => {
  const document = K.createDocument()
  const selected = rectangle(document, 0, 0, 100, 100, { label: 'selected', memo: 'keep source attributes' })
  const neighbor = rectangle(document, 100, 0, 200, 100, { label: 'neighbor', memo: 'must stay exact', price: 2500 })
  const neighborBefore = clone(neighbor)
  const children = K.splitShapeByPolyline(document, selected.id, [{ x: 50, y: -50 }, { x: 50, y: 150 }])
  assert.equal(children?.length, 2)
  assert.deepEqual(K.objectById(document, neighbor.id)?.object, neighborBefore)
  assertValidPolygons(pageOf(document).shapes, 20000, 'adjacent selected split')
})

test('I: two adjacent parcels split in one atomic batch', () => {
  const document = K.createDocument()
  rectangle(document, 0, 0, 100, 100, { label: 'A' })
  rectangle(document, 100, 0, 200, 100, { label: 'B' })
  const children = K.splitAllLotsByPolyline(document, [{ x: -20, y: 50 }, { x: 220, y: 50 }])
  assert.equal(children?.length, 4)
  assert.equal(pageOf(document).shapes.length, 4)
  assertValidPolygons(pageOf(document).shapes, 20000, 'two-parcel batch')
  assertUniqueSerializable(document, 'two-parcel batch')
})

test('J: three adjacent parcels split without order-dependent geometry', () => {
  const makeDocument = reverse => {
    const document = K.createDocument()
    const definitions = [
      [0, 0, 100, 100, 'A'],
      [100, 0, 200, 100, 'B'],
      [200, 0, 300, 100, 'C']
    ]
    for (const [x1, y1, x2, y2, label] of reverse ? definitions.reverse() : definitions) {
      rectangle(document, x1, y1, x2, y2, { label })
    }
    return document
  }
  const first = makeDocument(false)
  const second = makeDocument(true)
  assert.equal(K.splitAllLotsByPolyline(first, [{ x: -20, y: 50 }, { x: 320, y: 50 }])?.length, 6)
  assert.equal(K.splitAllLotsByPolyline(second, [{ x: -20, y: 50 }, { x: 320, y: 50 }])?.length, 6)
  const comparable = document => geometrySignature(document).map(({ id: _id, number: _number, ...shape }) => shape)
  assert.deepEqual(comparable(first), comparable(second))
  assertValidPolygons(pageOf(first).shapes, 30000, 'three-parcel batch')
  assertUniqueSerializable(first, 'three-parcel batch')
})

test('K: a boundary-overlap neighbor is skipped without aborting valid batch splits', () => {
  const document = K.createDocument()
  const splittable = rectangle(document, 0, 0, 100, 100, { label: 'split me' })
  const boundaryOnly = rectangle(document, 100, 50, 200, 150, { label: 'boundary only', memo: 'unchanged' })
  const boundaryBefore = clone(boundaryOnly)
  const children = K.splitAllLotsByPolyline(document, [{ x: -20, y: 50 }, { x: 220, y: 50 }])
  assert.equal(children?.length, 2)
  assert.equal(children?.failures?.length, 1)
  assert.equal(children.failures[0].id, boundaryOnly.id)
  assert.equal(children.failures[0].reason, 'boundary-overlap')
  assert.deepEqual(K.objectById(document, boundaryOnly.id)?.object, boundaryBefore)
  assert.equal(pageOf(document).shapes.filter(shape => shape.id === splittable.id || children.some(child => child.id === shape.id)).length, 2)
  assertValidPolygons(pageOf(document).shapes, 20000, 'partial batch')
})

test('L: partial shared edge merges and removes the internal boundary', () => {
  const document = K.createDocument()
  const first = rectangle(document, 0, 0, 100, 100, { label: 'primary', memo: 'one' })
  const second = rectangle(document, 100, 25, 200, 75, { label: 'secondary', memo: 'two' })
  const result = mergeGroup(document, [first.id, second.id], { primaryId: first.id })
  assert.equal(result.ok, true)
  assert.equal(pageOf(document).shapes.length, 1)
  assert.equal(result.shape.id, first.id)
  assert.equal(result.shape.label, 'primary')
  assertValidPolygons([result.shape], 15000, 'partial-edge merge')
})

test('M: three parcels in a chain merge into one parcel', () => {
  const document = K.createDocument()
  const lots = [
    rectangle(document, 0, 0, 100, 100, { label: 'primary' }),
    rectangle(document, 100, 0, 200, 100),
    rectangle(document, 200, 0, 300, 100)
  ]
  const result = mergeGroup(document, lots.map(shape => shape.id), { primaryId: lots[0].id })
  assert.equal(result.ok, true)
  assert.equal(pageOf(document).shapes.length, 1)
  assertValidPolygons([result.shape], 30000, 'three-parcel merge')
})

test('N: three parcels merge into a valid L shape', () => {
  const document = K.createDocument()
  const lots = [
    rectangle(document, 0, 0, 100, 100, { label: 'primary' }),
    rectangle(document, 100, 0, 200, 100),
    rectangle(document, 0, 100, 100, 200)
  ]
  const result = mergeGroup(document, lots.map(shape => shape.id), { primaryId: lots[0].id })
  assert.equal(result.ok, true)
  assert.equal(pageOf(document).shapes.length, 1)
  assertValidPolygons([result.shape], 30000, 'L-shaped merge')
})

test('O: point contact is rejected with an actionable reason', () => {
  const document = K.createDocument()
  const first = rectangle(document, 0, 0, 100, 100)
  const second = rectangle(document, 100, 100, 200, 200)
  const before = clone(documentContent(document))
  const result = mergeGroup(document, [first.id, second.id], { primaryId: first.id })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'point-contact')
  assert.deepEqual(documentContent(document), before)
})

test('P: separated parcels are rejected without mutation', () => {
  const document = K.createDocument()
  const first = rectangle(document, 0, 0, 100, 100)
  const second = rectangle(document, 200, 0, 300, 100)
  const before = clone(documentContent(document))
  const result = mergeGroup(document, [first.id, second.id], { primaryId: first.id })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'disconnected')
  assert.deepEqual(documentContent(document), before)
})

test('Q: a partly disconnected selection reports the disconnected parcel', () => {
  const document = K.createDocument()
  const first = rectangle(document, 0, 0, 100, 100)
  const second = rectangle(document, 100, 0, 200, 100)
  const third = rectangle(document, 400, 0, 500, 100)
  const before = clone(documentContent(document))
  const result = mergeGroup(document, [first.id, second.id, third.id], { primaryId: first.id })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'disconnected')
  assert.deepEqual(result.disconnectedIds, [third.id])
  assert.deepEqual(documentContent(document), before)
})

test('R: overlapping parcels are not treated as adjacent', () => {
  const document = K.createDocument()
  const first = rectangle(document, 0, 0, 100, 100)
  const second = rectangle(document, 50, 0, 150, 100)
  const before = clone(documentContent(document))
  const result = mergeGroup(document, [first.id, second.id], { primaryId: first.id })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'overlap')
  assert.deepEqual(documentContent(document), before)
})

test('S: split supports one-step undo and exact redo', () => {
  const document = K.createDocument()
  const lot = rectangle(document, 0, 0, 100, 100, { label: 'A', memo: 'split history' })
  const store = new K.DocumentStore(document)
  assertHistoryRoundTrip(store, () => {
    let result = null
    store.commit('図形分割', draft => {
      result = K.splitShapeByPolyline(draft, lot.id, [{ x: 50, y: -20 }, { x: 50, y: 120 }])
    })
    return result
  }, 'split history')
})

test('T: batch split supports one-step undo and exact redo', () => {
  const document = K.createDocument()
  rectangle(document, 0, 0, 100, 100, { label: 'A' })
  rectangle(document, 100, 0, 200, 100, { label: 'B' })
  const store = new K.DocumentStore(document)
  assertHistoryRoundTrip(store, () => {
    let result = null
    store.commit('一括分割', draft => {
      result = K.splitAllLotsByPolyline(draft, [{ x: -20, y: 50 }, { x: 220, y: 50 }])
    })
    return result
  }, 'batch split history')
})

test('U: multi-parcel merge supports one-step undo and exact redo', () => {
  const document = K.createDocument()
  rectangle(document, 0, 0, 100, 100, { label: 'A' })
  rectangle(document, 100, 0, 200, 100, { label: 'B' })
  rectangle(document, 200, 0, 300, 100, { label: 'C' })
  const store = new K.DocumentStore(document)
  const ids = pageOf(store.document).shapes.map(shape => shape.id)
  assertHistoryRoundTrip(store, () => {
    let result = null
    store.commit('合筆', draft => {
      result = mergeGroup(draft, ids, { primaryId: ids[0] })
    })
    return result?.ok && result
  }, 'merge history')
})

let failed = 0
for (const { name, callback } of tests) {
  try {
    callback()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(`  ${error.message}`)
  }
}

console.log(`v210 geometry regression: ${tests.length - failed}/${tests.length} passed`)
if (failed) process.exitCode = 1
