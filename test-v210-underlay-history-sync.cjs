const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, 'v210', 'app.js'), 'utf8')

function bodyBetween(start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  assert.ok(from >= 0 && to > from, `${start} の検査範囲を取得できません`)
  return source.slice(from, to)
}

const pageRenderer = bodyBetween('async function showUnderlayPage', 'async function loadUnderlay')
assert.doesNotMatch(pageRenderer, /store\.commit\(['"]下絵ページ/, 'ページ移動は履歴へ追加しない')
assert.match(pageRenderer, /updateUnderlayPageWithoutHistory\(nextPage, renderedBackground\)/)

const loader = bodyBetween('async function loadUnderlay', 'function serializeCurrentProject')
assert.doesNotMatch(loader, /store\.clearHistory\(\)/, '下絵追加をUndoできるよう履歴を消さない')
assert.match(loader, /store\.commit\(replace \? ['"]下絵差替['"] : ['"]下絵読込['"]/, '追加と差替は各1コミットにまとめる')

assert.match(source, /backgroundTaskToken:\s*0/)
assert.match(source, /token !== runtime\.backgroundTaskToken/)
assert.match(source, /\['undo', 'redo', 'replace'\]\.includes\(event\?\.type\)/, 'Undo/Redo/replaceを再同期する')
assert.match(source, /case 'remove-underlay':[\s\S]*?store\.commit\('下絵削除'/)
assert.match(source, /case 'rotate-underlay-90':[\s\S]*?store\.commit\('画像を90度回転'/)
assert.match(source, /version:\s*K\.SCHEMA_VERSION/, 'fallback保存も現行スキーマを使う')

console.log('v210 underlay history/runtime synchronization regression: PASS')
