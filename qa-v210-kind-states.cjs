const assert = require('node:assert/strict')

global.window = global
require('./v210/core.js')
require('./v210/io.js')

const K = global.KozuV210
const IO = K.IO
const clone = value => JSON.parse(JSON.stringify(value))

function pageOf(document) {
  return K.activePage(document)
}

function rectangle(document, kind, attributes = {}) {
  return K.addShape(document, kind, [
    { x: 0, y: 0 }, { x: 120, y: 0 },
    { x: 120, y: 80 }, { x: 0, y: 80 }
  ], attributes)
}

function identifiers(document) {
  return document.pages.flatMap(page => [
    page.id,
    ...page.shapes.flatMap(shape => [shape.id, ...(shape.edges || []).map(edge => edge.id)]),
    ...page.entities.flatMap(entity => [entity.id, ...(entity.segments || []).map(segment => segment.id)])
  ]).map(value => `${typeof value}:${String(value)}`)
}

function assertSaveable(document, label) {
  const ids = identifiers(document)
  assert.equal(new Set(ids).size, ids.length, `${label}: IDs must remain globally unique`)
  const check = IO.validateDocument(document)
  assert.equal(check.valid, true, `${label}: ${check.errors.join(' / ')}`)
  assert.doesNotThrow(() => IO.serializeProject(document), `${label}: project must serialize`)
}

function assertStateEdgesHaveNoIds(shape) {
  for (const state of Object.values(shape.kindStates)) {
    if (!state) continue
    assert.ok(state.edges.every(edge => !Object.prototype.hasOwnProperty.call(edge, 'id')))
  }
}

function testLotRoadWaterRoundtripAndSave() {
  const document = K.createDocument()
  const lot = rectangle(document, 'lot', {
    number: 7,
    label: '南側区画',
    topLabel: '販売地',
    price: 12800000,
    memo: '区画だけのメモ',
    visible: false,
    style: { fill: '#f0cc66', stroke: '#765400', opacity: 0.52, lineWidth: 2 },
    labelStyle: { color: '#112233', fontFamily: 'mincho', fontSize: 17, rotation: 8 },
    dimensionStyle: { color: '#334455', fontSize: 11, offset: 19, decimals: 1 },
    visibility: { number: false, topLabel: true, area: false, tsubo: true, price: false, memo: true, dimensions: false },
    labelPosition: { x: 31, y: 27 },
    areaLabelPosition: { x: 42, y: 35 },
    tsuboLabelPosition: { x: 48, y: 49 },
    areaLabel: { text: '実測 96.00㎡', position: { x: 42, y: 35 }, visible: false, style: { color: '#005500', fontSize: 13 } },
    tsuboLabel: { text: '29.04坪', position: { x: 48, y: 49 }, visible: true, style: { color: '#550055', fontSize: 12 } }
  })
  Object.assign(lot.edges[0], {
    hidden: true,
    customText: '区画北辺',
    labelOffset: { x: 6, y: -3 },
    rotationOffset: 14,
    style: { color: '#aa1100', fontFamily: 'mincho', fontSize: 15 }
  })
  const shapeId = lot.id
  const edgeIds = lot.edges.map(edge => edge.id)
  const points = clone(lot.points)

  const road = K.convertShapeKind(document, shapeId, 'road')
  assert.deepEqual(road.edges.map(edge => edge.id), edgeIds, 'edge IDs stay stable on conversion')
  assert.equal(road.edges[0].customText, null, 'a new kind starts with independent edge formatting')
  road.label = '県道一号線'
  road.memo = '道路だけのメモ'
  road.visible = true
  road.labelPosition = { x: 60, y: 18 }
  road.visibility.width = false
  road.style = { ...road.style, fill: '#c0c8d0', stroke: '#223344' }
  road.road = {
    ...road.road,
    type: 'public',
    name: '県道一号線',
    widthM: 5.75,
    width: 5.75,
    vertical: true,
    namePosition: { x: 63, y: 21 },
    widthLabelPosition: { x: 75, y: 54 },
    widthLabelOffset: { x: 4, y: 9 },
    nameStyle: { color: '#3344aa', fontFamily: 'gothic', fontSize: 16 },
    widthLabelStyle: { color: '#aa3344', fontFamily: 'mono', fontSize: 12, rotation: 21 },
    widthText: '五・七五',
    widthPrefix: '道路幅 ',
    widthUnit: false,
    widthDigits: 2
  }
  Object.assign(road.edges[1], {
    hidden: true,
    customText: '道路東辺',
    labelOffset: { x: 8, y: 2 },
    rotationOffset: -11,
    style: { color: '#2266cc', fontSize: 13 }
  })

  const water = K.convertShapeKind(document, shapeId, 'water')
  assert.deepEqual(water.edges.map(edge => edge.id), edgeIds)
  water.label = '東側水路'
  water.memo = '水路だけのメモ'
  water.labelPosition = { x: 58, y: 24 }
  water.visibility.width = true
  water.road = {
    ...water.road,
    type: 'water',
    name: '東側水路',
    widthM: 1.35,
    width: 1.35,
    vertical: false,
    namePosition: { x: 57, y: 25 },
    widthLabelPosition: { x: 81, y: 61 },
    widthLabelOffset: null,
    widthText: '一・三五',
    widthPrefix: '水路幅 ',
    widthUnit: 'm',
    widthDigits: 2
  }
  Object.assign(water.edges[2], {
    hidden: true,
    customText: '水路南辺',
    labelOffset: { x: -4, y: 7 },
    rotationOffset: 6,
    style: { color: '#0088aa', fontSize: 10 }
  })

  const restoredLot = K.convertShapeKind(document, shapeId, 'lot')
  assert.equal(restoredLot.id, shapeId)
  assert.deepEqual(restoredLot.points, points)
  assert.deepEqual(restoredLot.edges.map(edge => edge.id), edgeIds)
  assert.equal(restoredLot.number, 7)
  assert.equal(restoredLot.label, '南側区画')
  assert.equal(restoredLot.topLabel, '販売地')
  assert.equal(restoredLot.price, 12800000)
  assert.equal(restoredLot.memo, '区画だけのメモ')
  assert.equal(restoredLot.visible, false)
  assert.deepEqual(restoredLot.labelPosition, { x: 31, y: 27 })
  assert.deepEqual(restoredLot.areaLabelPosition, { x: 42, y: 35 })
  assert.deepEqual(restoredLot.tsuboLabelPosition, { x: 48, y: 49 })
  assert.equal(restoredLot.areaLabel.text, '実測 96.00㎡')
  assert.equal(restoredLot.areaLabel.visible, false)
  assert.equal(restoredLot.tsuboLabel.text, '29.04坪')
  assert.equal(restoredLot.tsuboLabel.visible, true)
  assert.equal(restoredLot.visibility.number, false)
  assert.equal(restoredLot.visibility.price, false)
  assert.equal(restoredLot.edges[0].customText, '区画北辺')
  assert.equal(restoredLot.edges[0].style.color, '#aa1100')
  assert.equal(restoredLot.edges[1].customText, null)
  assert.equal(restoredLot.kindStates.road.memo, '道路だけのメモ')
  assert.equal(restoredLot.kindStates.water.memo, '水路だけのメモ')
  assertStateEdgesHaveNoIds(restoredLot)
  assertSaveable(document, 'lot-road-water-lot')

  const serialized = IO.serializeProject(document, { view: { x: 3, y: 4, zoom: 1.25 } })
  const raw = JSON.parse(serialized)
  assert.equal(raw.version, 7)
  assert.equal(raw.document.schemaVersion, 7)
  const loaded = IO.deserializeProject(serialized).document
  let loadedShape = pageOf(loaded).shapes[0]
  assertStateEdgesHaveNoIds(loadedShape)

  loadedShape = K.convertShapeKind(loaded, shapeId, 'road')
  assert.equal(loadedShape.label, '県道一号線')
  assert.equal(loadedShape.memo, '道路だけのメモ')
  assert.equal(loadedShape.road.type, 'public')
  assert.equal(loadedShape.road.widthM, 5.75)
  assert.deepEqual(loadedShape.road.namePosition, { x: 63, y: 21 })
  assert.deepEqual(loadedShape.road.widthLabelPosition, { x: 75, y: 54 })
  assert.equal(loadedShape.road.widthText, '五・七五')
  assert.equal(loadedShape.visibility.width, false)
  assert.equal(loadedShape.edges[1].customText, '道路東辺')

  loadedShape = K.convertShapeKind(loaded, shapeId, 'water')
  assert.equal(loadedShape.label, '東側水路')
  assert.equal(loadedShape.memo, '水路だけのメモ')
  assert.equal(loadedShape.road.widthM, 1.35)
  assert.deepEqual(loadedShape.road.widthLabelPosition, { x: 81, y: 61 })
  assert.equal(loadedShape.edges[2].customText, '水路南辺')

  loadedShape = K.convertShapeKind(loaded, shapeId, 'lot')
  assert.equal(loadedShape.number, 7)
  assert.equal(loadedShape.price, 12800000)
  assert.equal(loadedShape.edges[0].customText, '区画北辺')
  assert.deepEqual(loadedShape.edges.map(edge => edge.id), edgeIds)
  assertSaveable(loaded, 'saved roundtrip')
}

function oldDocument(version, kind = 'road') {
  const document = K.createDocument()
  const shape = rectangle(document, kind, kind === 'lot'
    ? { number: 19, label: '旧区画', price: 9000, memo: '旧区画メモ' }
    : { label: kind === 'water' ? '旧水路' : '旧道路', memo: '旧道路メモ', road: { type: kind === 'water' ? 'water' : 'private', name: kind === 'water' ? '旧水路' : '旧道路', widthM: 3.25 } })
  shape.edges[0].customText = '旧辺書式'
  delete shape.kindStates
  document.schemaVersion = version
  return document
}

function testV6Migration() {
  const document = oldDocument(6)
  const wrapper = { format: 'kozu-measure', version: 6, document, view: { x: 9, y: -2, zoom: 1.4 }, meta: { name: 'v6案件' } }
  const migrated = IO.deserializeProject(JSON.stringify(wrapper))
  const shape = pageOf(migrated.document).shapes[0]
  assert.equal(migrated.migratedFrom, 6)
  assert.equal(migrated.document.schemaVersion, 7)
  assert.equal(migrated.view.x, 9)
  assert.equal(migrated.meta.name, 'v6案件')
  assert.deepEqual(Object.keys(shape.kindStates), ['lot', 'road', 'water'])
  assert.equal(shape.kindStates.lot, null)
  assert.equal(shape.kindStates.road.memo, '旧道路メモ')
  assert.equal(shape.kindStates.road.road.widthM, 3.25)
  assert.equal(shape.kindStates.road.edges[0].customText, '旧辺書式')
  assertStateEdgesHaveNoIds(shape)
  assertSaveable(migrated.document, 'v6 wrapper migration')

  const naked = IO.deserializeProject(JSON.stringify(oldDocument(6, 'lot')))
  assert.equal(naked.migratedFrom, 6)
  assert.equal(pageOf(naked.document).shapes[0].kindStates.lot.number, 19)
  assertSaveable(naked.document, 'v6 naked migration')
  assert.throws(() => IO.deserializeProject(JSON.stringify(wrapper), { allowLegacy: false }), /v6形式の読込は無効/)
}

function testOlderMigrationsStillReachV7() {
  const v5Document = oldDocument(5, 'lot')
  const v5 = IO.deserializeProject(JSON.stringify({ format: 'kozu-measure', version: 5, document: v5Document }))
  assert.equal(v5.migratedFrom, 5)
  assert.equal(v5.document.schemaVersion, 7)
  assert.equal(pageOf(v5.document).shapes[0].kindStates.lot.number, 19)
  assertSaveable(v5.document, 'v5 migration')

  for (const version of [3, 4]) {
    const legacy = {
      version,
      mpp: 0.1,
      lots: [{
        id: version * 10 + 1,
        type: 'lot',
        number: version,
        label: `v${version}区画`,
        price: '4,500',
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 70 }, { x: 0, y: 70 }]
      }]
    }
    const migrated = IO.deserializeProject(JSON.stringify(legacy))
    const shape = pageOf(migrated.document).shapes[0]
    assert.equal(migrated.migratedFrom, version)
    assert.equal(migrated.document.schemaVersion, 7)
    assert.equal(shape.kindStates.lot.number, version)
    assertSaveable(migrated.document, `v${version} migration`)
  }
}

function testKindStateValidationAndIdSafety() {
  const document = K.createDocument()
  const shape = rectangle(document, 'lot', { number: 1 })

  const missing = clone(document)
  delete pageOf(missing).shapes[0].kindStates
  assert.equal(IO.validateDocument(missing).valid, false)

  const stateId = clone(document)
  pageOf(stateId).shapes[0].kindStates.lot.edges[0].id = 'cached-edge-id'
  const stateIdCheck = IO.validateDocument(stateId)
  assert.equal(stateIdCheck.valid, false)
  assert.ok(stateIdCheck.errors.some(error => /kindStates\.lot\.edges\[0\]\.id/.test(error)))

  const duplicateActiveId = clone(document)
  pageOf(duplicateActiveId).shapes[0].edges[1].id = pageOf(duplicateActiveId).shapes[0].edges[0].id
  assert.equal(IO.validateDocument(duplicateActiveId).valid, false)

  const badPoint = clone(document)
  pageOf(badPoint).shapes[0].kindStates.lot.edges[0].from.x = Number.POSITIVE_INFINITY
  assert.equal(IO.validateDocument(badPoint).valid, false)

  assert.equal(shape.kindStates.road, null)
  assertSaveable(document, 'kind state validation baseline')

  const blankNumberDocument = K.createDocument()
  const blankNumberLot = rectangle(blankNumberDocument, 'lot', { number: null, label: '番号なし' })
  K.convertShapeKind(blankNumberDocument, blankNumberLot.id, 'road')
  const restoredBlankNumberLot = K.convertShapeKind(blankNumberDocument, blankNumberLot.id, 'lot')
  assert.equal(restoredBlankNumberLot.number, null, 'an intentionally blank lot number is restored as blank')
  assertSaveable(blankNumberDocument, 'blank lot number roundtrip')
}

testLotRoadWaterRoundtripAndSave()
testV6Migration()
testOlderMigrationsStillReachV7()
testKindStateValidationAndIdSafety()

console.log('v210 kindStates v7 regression: PASS')
