const assert = require('node:assert/strict')

global.window = global
require('./v210/core.js')
require('./v210/io.js')

const K = global.KozuV210
const IO = K.IO

function pageOf(document) {
  return K.activePage(document)
}

function allIdentifiers(document) {
  return document.pages.flatMap(page => [
    page.id,
    ...page.shapes.flatMap(shape => [shape.id, ...(shape.edges || []).map(edge => edge.id)]),
    ...page.entities.flatMap(entity => [entity.id, ...(entity.segments || []).map(segment => segment.id)])
  ]).map(value => `${typeof value}:${String(value)}`)
}

function assertSerializableWithUniqueIds(document, label) {
  const identifiers = allIdentifiers(document)
  assert.equal(new Set(identifiers).size, identifiers.length, `${label}: identifiers must be globally unique`)
  const validation = IO.validateDocument(document)
  assert.equal(validation.valid, true, `${label}: ${validation.errors.join(' / ')}`)
  assert.doesNotThrow(() => IO.serializeProject(document), `${label}: project must serialize`)
}

function rectangle(document, x1, y1, x2, y2, attributes = {}) {
  return K.addShape(document, 'lot', [
    { x: x1, y: y1 }, { x: x2, y: y1 },
    { x: x2, y: y2 }, { x: x1, y: y2 }
  ], attributes)
}

function testSingleLineSplit() {
  const document = K.createDocument()
  const lot = rectangle(document, 0, 0, 100, 100)
  const top = lot.edges.find(edge => edge.from.y === 0 && edge.to.y === 0)
  Object.assign(top, {
    hidden: true,
    customText: 'TOP',
    labelOffset: { x: 3, y: -2 },
    rotationOffset: 9,
    style: { color: '#aa1122', fontSize: 13 }
  })
  const originalIds = new Set(lot.edges.map(edge => edge.id))
  const children = K.splitShape(document, lot.id, { x: 50, y: -20 }, { x: 50, y: 120 })
  assert.equal(children.length, 2)

  const edges = children.flatMap(child => child.edges)
  const topFragments = edges.filter(edge => edge.from.y === 0 && edge.to.y === 0)
  const cutEdges = edges.filter(edge => edge.from.x === 50 && edge.to.x === 50)
  assert.equal(topFragments.length, 2)
  assert.ok(topFragments.every(edge => edge.hidden === true && edge.customText === 'TOP'))
  assert.ok(topFragments.every(edge => edge.labelOffset.x === 3 && edge.rotationOffset === 9 && edge.style.color === '#aa1122'))
  assert.equal(topFragments.filter(edge => edge.id === top.id).length, 1, 'stable id belongs to exactly one outer fragment')
  assert.equal(cutEdges.length, 2)
  assert.ok(cutEdges.every(edge => !originalIds.has(edge.id)), 'cut edges always receive fresh ids')
  assert.ok(cutEdges.every(edge => edge.hidden === false && edge.customText == null && edge.style == null))
  assertSerializableWithUniqueIds(document, 'single line split')
}

function testSinglePolylineSplit() {
  const document = K.createDocument()
  const lot = rectangle(document, 0, 0, 100, 100)
  lot.edges[3].customText = 'LEFT'
  lot.edges[3].style = { color: '#2255aa' }
  const children = K.splitShapeByPolyline(document, lot.id, [
    { x: 50, y: -20 }, { x: 40, y: 48 }, { x: 70, y: 120 }
  ])
  assert.equal(children.length, 2)
  const leftFragments = children.flatMap(child => child.edges)
    .filter(edge => edge.from.x === 0 && edge.to.x === 0)
  assert.equal(leftFragments.length, 1)
  assert.equal(leftFragments[0].customText, 'LEFT')
  assert.equal(leftFragments[0].style.color, '#2255aa')
  assertSerializableWithUniqueIds(document, 'single polyline split')
}

function testSplitAllByLine() {
  const document = K.createDocument()
  const first = rectangle(document, 0, 0, 80, 100)
  const second = rectangle(document, 100, 0, 180, 100)
  first.edges[0].customText = 'FIRST'
  second.edges[0].customText = 'SECOND'
  const children = K.splitAllLots(document, { x: -20, y: 50 }, { x: 220, y: 50 })
  assert.equal(children.length, 4)
  assert.equal(pageOf(document).shapes.length, 4)
  assertSerializableWithUniqueIds(document, 'split all by line')
}

function testSplitAllByPolyline() {
  const document = K.createDocument()
  rectangle(document, 0, 0, 80, 100)
  rectangle(document, 100, 0, 180, 100)
  const children = K.splitAllLotsByPolyline(document, [
    { x: -20, y: 30 }, { x: 90, y: 62 }, { x: 220, y: 38 }
  ])
  assert.equal(children.length, 4)
  assert.equal(pageOf(document).shapes.length, 4)
  assertSerializableWithUniqueIds(document, 'split all by polyline')
}

testSingleLineSplit()
testSinglePolylineSplit()
testSplitAllByLine()
testSplitAllByPolyline()

console.log('v210 split edge id regression: PASS')
