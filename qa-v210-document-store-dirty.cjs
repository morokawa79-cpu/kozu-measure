const assert = require('node:assert/strict')

global.window = global
require('./v210/core.js')

const K = global.KozuV210

function addLot(document, label = '') {
  return K.addShape(document, 'lot', [
    { x: 0, y: 0 }, { x: 100, y: 0 },
    { x: 100, y: 80 }, { x: 0, y: 80 }
  ], { label })
}

function testSaveEditUndoRedo() {
  const store = new K.DocumentStore()
  store.markSaved()
  assert.equal(store.dirty, false)

  store.commit('区画追加', document => addLot(document, '編集後'))
  assert.equal(store.dirty, true, 'edit after save is dirty')

  assert.equal(store.undo(), true)
  assert.equal(store.dirty, false, 'undo to saved content is clean')

  assert.equal(store.redo(), true)
  assert.equal(store.dirty, true, 'redo away from saved content is dirty')

  store.markSaved()
  assert.equal(store.dirty, false)
  assert.equal(store.undo(), true)
  assert.equal(store.dirty, true, 'undo away from newly saved content is dirty')
  assert.equal(store.redo(), true)
  assert.equal(store.dirty, false, 'redo to newly saved content is clean')
}

function testMultipleEditsReturnToSavedPoint() {
  const document = K.createDocument()
  document.title = '保存地点'
  const store = new K.DocumentStore(document)
  store.markSaved()

  store.commit('名称変更', current => { current.title = '変更1' })
  store.commit('用紙タイトル変更', current => { current.paper.title = '変更2' })
  store.commit('作成者変更', current => { current.paper.author = '変更3' })
  assert.equal(store.dirty, true)

  assert.equal(store.undo(), true)
  assert.equal(store.dirty, true)
  assert.equal(store.undo(), true)
  assert.equal(store.dirty, true)
  assert.equal(store.undo(), true)
  assert.equal(store.document.title, '保存地点')
  assert.equal(store.dirty, false, 'multiple Undo operations recognize the saved point')

  assert.equal(store.redo(), true)
  assert.equal(store.dirty, true, 'redo after the saved point is dirty')
}

function testCommitBackToSavedContent() {
  const document = K.createDocument()
  document.title = '基準'
  const store = new K.DocumentStore(document)
  store.markSaved()

  store.commit('一時変更', current => { current.title = '一時' })
  assert.equal(store.dirty, true)
  store.commit('基準へ戻す', current => { current.title = '基準' })
  assert.equal(store.dirty, false, 'a normal commit can return exactly to the saved content')
}

function testUpdatedAtDoesNotCreateFalseDirtyState() {
  const store = new K.DocumentStore()
  store.markSaved()
  const beforeUpdatedAt = store.document.updatedAt
  const historyLength = store.undoStack.length

  store.commit('時刻だけ変更', document => { document.updatedAt = '2099-12-31T23:59:59.999Z' })
  assert.equal(store.document.updatedAt, beforeUpdatedAt, 'timestamp-only mutation is treated as a content no-op')
  assert.equal(store.undoStack.length, historyLength)
  assert.equal(store.dirty, false)

  store.commit('内容変更', document => { document.paper.note = '内容あり' })
  assert.equal(store.dirty, true)
  store.undo()
  assert.equal(store.dirty, false, 'saved content matches despite commit timestamps')
}

function testReplaceCleanInitialization() {
  const store = new K.DocumentStore()
  const replacement = K.createDocument()
  replacement.title = '読込済み'
  addLot(replacement, '読込区画')

  store.replace(replacement, { clean: true })
  assert.equal(store.dirty, false)
  assert.equal(store.canUndo, false)
  store.commit('読込後編集', document => { document.paper.author = '編集' })
  assert.equal(store.dirty, true)
  store.undo()
  assert.equal(store.dirty, false, 'Undo returns to the clean replacement baseline')

  store.replace(replacement, { clean: false })
  assert.equal(store.dirty, true, 'an explicitly unclean replacement has no saved baseline')
  store.commit('同内容', () => {})
  assert.equal(store.dirty, true)
  store.markSaved()
  assert.equal(store.dirty, false)

  store.replace(K.createDocument())
  assert.equal(store.dirty, false, 'replace defaults to a clean baseline')
}

testSaveEditUndoRedo()
testMultipleEditsReturnToSavedPoint()
testCommitBackToSavedContent()
testUpdatedAtDoesNotCreateFalseDirtyState()
testReplaceCleanInitialization()

console.log('v210 DocumentStore saved fingerprint regression: PASS')
