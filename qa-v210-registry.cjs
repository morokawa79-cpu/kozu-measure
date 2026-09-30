/*
 * 右側の一覧・台帳の実操作回帰テスト。
 * 実行: node qa-v210-registry.cjs
 * 内部APIはfixture準備・状態観測だけに使い、編集は実マウス/キー入力で行う。
 * ユーザーの作業ファイルは開かず、一時プロファイルを使用する。
 */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = __dirname
const outputRoot = path.join(root, 'output')
const screenshotRoot = path.join(outputRoot, 'qa-v210-registry-screens')
const reportPath = path.join(outputRoot, 'qa-v210-registry-report.json')
const LONG_NAME = '南東角地・建築条件なし・駅徒歩圏の分譲区画／日当たりと接道を確認する長い名称'
const LONG_MEMO = '現地確認済み。隣接地との境界位置と道路側の出入口を、契約前にもう一度確認する。'

if (!process.versions.electron) {
  const result = spawnSync(require('electron'), [__filename], { cwd: root, stdio: 'inherit', windowsHide: true })
  process.exitCode = result.status ?? 1
} else {
  runSuite().catch(error => { console.error(error.stack || error); process.exit(1) })
}

async function runSuite() {
  const { app, BrowserWindow } = require('electron')
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kozu-registry-qa-'))
  app.setPath('userData', path.join(temporaryRoot, 'userData'))
  app.setPath('sessionData', path.join(temporaryRoot, 'sessionData'))
  fs.mkdirSync(screenshotRoot, { recursive: true })
  const checks = []
  const consoleErrors = []
  let activeCase = 'startup'
  await app.whenReady()
  const win = new BrowserWindow({
    show: false, width: 1440, height: 960, minWidth: 900, minHeight: 600,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: false,
      backgroundThrottling: false, preload: path.join(root, 'preload-v210.js')
    }
  })
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2 && !/Autofill|DevTools|Electron Security Warning/i.test(message)) {
      consoleErrors.push({ case: activeCase, message, line, sourceId })
    }
  })
  win.webContents.on('render-process-gone', (_event, details) => consoleErrors.push({ case: activeCase, details }))

  async function run(name, callback, width = 1440) {
    activeCase = name
    console.log(`START ${name}`)
    try {
      win.setContentSize(width, width === 900 ? 800 : 960)
      await win.loadFile(path.join(root, 'index-v210.html'))
      await evaluate(win, () => Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 800))]))
      await wait(win, 100)
      const ids = await fixture(win)
      const details = await callback(ids)
      checks.push({ name, pass: true, details })
      console.log(`PASS ${name}`)
    } catch (error) {
      checks.push({ name, pass: false, error: error.stack || String(error) })
      console.log(`FAIL ${name}: ${error.message.split('\n')[0]}`)
    }
  }

  try {
    for (const width of [1440, 900]) {
      await run(`registry-${width}-long-names-readable-default-options-closed-and-no-horizontal-clipping`, async ids => {
        const layout = await registryLayout(win, ids.a)
        assert.equal(layout.optionsOpen, false, '補助設定は通常閉じていること')
        assert.equal(layout.searchVisible, true, '検索は補助設定を開かず操作できること')
        assert.equal(layout.optionsOwnFilters, true, '種類・並び・集計を補助設定へまとめること')
        assert.equal(layout.nameText.includes(LONG_NAME), true, '長い名称が省略されずDOMに保持されること')
        assert.ok(layout.nameFont >= 13, `名称の文字が小さすぎます: ${layout.nameFont}px`)
        assert.ok(layout.priceFont >= 12 && layout.memoFont >= 12, `価格/メモの文字が小さすぎます: ${JSON.stringify(layout)}`)
        assert.ok(layout.nameHeight > layout.nameFont * 1.8, '長い名称が複数行で表示されること')
        assert.ok(layout.nameScrollWidth <= layout.nameWidth + 1 && layout.nameScrollHeight <= layout.nameHeight + 1, '名称の全文が枠内に収まること')
        assert.ok(layout.priceTop >= layout.nameBottom - 1, '名称の下に価格を表示すること')
        assert.equal(layout.memoVisible, false, '通常行のメモは閉じて一覧を圧縮すること')
        assert.ok(Math.abs(layout.areaTop - layout.priceTop) <= 3, '面積と価格を同じ段で比較できること')
        assert.ok(layout.rowHeight <= layout.nameHeight + 70, '補助欄による余分な縦幅を作らないこと')
        assert.deepEqual(layout.clipped, [], `台帳の横クリップ: ${JSON.stringify(layout.clipped)}`)
        assert.ok(layout.scrollWidth <= layout.clientWidth + 1, '台帳一覧に横スクロールを作らないこと')
        assert.equal(layout.visibleCheckboxes, 4, '各行の表示checkboxを常時表示すること')
        assert.equal(layout.editablePriceMemo, 0, '未選択行は価格・メモ入力欄を常設しないこと')
        await capture(win, `registry-${width}-default.png`)
        await click(win, nameSelector(ids.a))
        const selected = await rowState(win, ids.a)
        assert.equal(selected.editing, true)
        assert.equal(selected.selected, true)
        assert.equal(selected.priceInput, true)
        assert.equal(selected.memoInput, true)
        const selectedLayout = await registryLayout(win, ids.a)
        assert.deepEqual(selectedLayout.clipped, [], '編集対象行でも横にはみ出さないこと')
        await capture(win, `registry-${width}-selected.png`)
        return { layout, selected, selectedClipped: selectedLayout.clipped }
      }, width)
    }

    await run('registry-unnamed-lot-keeps-number-as-heading-and-edits-real-name', async ids => {
      await evaluate(win, id => {
        const api=window.__KOZU_V210__, K=window.KozuV210;
        api.store.commit('名称未入力のテスト', doc => { const object=K.objectById(doc,id).object; object.label=''; object.topLabel=''; object.number=1; });
      }, ids.b)
      const label=await evaluate(win, id => document.querySelector(`#registry-rows tr[data-object-id="${id}"] .registry-name-button`).textContent, ids.b)
      assert.equal(label,'区画 1')
      await click(win,nameSelector(ids.b))
      const field='#command-controls [data-field="object-label"]'
      assert.equal(await evaluate(win, selector => document.querySelector(selector).value, field),'')
      await replaceText(win,field,'北側区画')
      await pressKey(win,'ENTER',['control'])
      assert.equal(findObject(await state(win),ids.b).label,'北側区画')
      return {label}
    })

    await run('registry-editing-target-batch-target-and-visibility-remain-distinct', async ids => {
      await click(win, nameSelector(ids.a))
      let current = await state(win)
      assert.deepEqual(current.selectedIds, [ids.a])
      assert.deepEqual(current.registryIds, [ids.a])
      await click(win, batchSelector(ids.b))
      current = await state(win)
      assert.deepEqual(current.selectedIds, [ids.a], '一括checkboxで図面の編集対象を変えないこと')
      assert.deepEqual([...current.registryIds].sort(), [ids.a, ids.b].sort())
      await click(win, batchSelector(ids.a))
      const separate = await state(win)
      const rowA = await rowState(win, ids.a)
      const rowB = await rowState(win, ids.b)
      assert.deepEqual(separate.selectedIds, [ids.a])
      assert.deepEqual(separate.registryIds, [ids.b])
      assert.equal(rowA.editing, true)
      assert.equal(rowA.selected, false)
      assert.equal(rowB.editing, false)
      assert.equal(rowB.selected, true)
      assert.equal(rowA.priceInput, false)
      assert.equal(rowA.memoInput, false)
      assert.equal(rowB.priceInput, true)
      assert.equal(rowB.memoInput, true)
      await click(win, visibleSelector(ids.a))
      const hidden = await state(win)
      assert.equal(findObject(hidden, ids.a).visible, false)
      assert.deepEqual(hidden.selectedIds, separate.selectedIds)
      assert.deepEqual(hidden.registryIds, separate.registryIds)
      assert.equal(findObject(hidden, ids.b).visible, true)
      await click(win, '[data-action="undo"]')
      assert.equal(findObject(await state(win), ids.a).visible, true)
      return { rowA, rowB, separate, hidden: { selectedIds: hidden.selectedIds, registryIds: hidden.registryIds } }
    })

    for (const [field, value] of [['price', '2450'], ['memo', '台帳で修正したメモ']]) {
      await run(`registry-${field}-real-input-commit-undo-and-escape`, async ids => {
        await click(win, nameSelector(ids.a))
        const before = await state(win)
        const selector = registryFieldSelector(ids.a, field)
        await replaceText(win, selector, value)
        await pressKey(win, 'ENTER')
        const committed = await state(win)
        assert.equal(findObject(committed, ids.a)[field], field === 'price' ? Number(value) : value)
        assert.deepEqual(findObject(committed, ids.b), findObject(before, ids.b))
        assert.equal(committed.undoDepth, before.undoDepth + 1)
        await click(win, '[data-action="undo"]')
        const undone = await state(win)
        assert.equal(findObject(undone, ids.a)[field], findObject(before, ids.a)[field])
        const undoDepth = undone.undoDepth
        await replaceText(win, selector, field === 'price' ? '9999' : '取り消す入力')
        await pressKey(win, 'ESCAPE')
        const escaped = await state(win)
        assert.equal(findObject(escaped, ids.a)[field], findObject(before, ids.a)[field])
        assert.equal(escaped.undoDepth, undoDepth, 'Escで未確定入力だけを戻し履歴を増やさないこと')
        const displayed = await evaluate(win, selector => document.querySelector(selector)?.value, selector)
        assert.equal(displayed, String(findObject(before, ids.a)[field]))
        const blurValue = field === 'price' ? '2750' : '別の行へ移る前に入力したメモ'
        await replaceText(win, selector, blurValue)
        await click(win, nameSelector(ids.b))
        const blurred = await state(win)
        assert.equal(findObject(blurred, ids.a)[field], field === 'price' ? Number(blurValue) : blurValue, '別行への移動で入力を失わないこと')
        assert.deepEqual(blurred.selectedIds, [ids.b])
        assert.deepEqual(findObject(blurred, ids.b), findObject(before, ids.b))
        assert.equal(blurred.undoDepth, undoDepth + 1)
        await click(win, '[data-action="undo"]')
        assert.equal(findObject(await state(win), ids.a)[field], findObject(before, ids.a)[field])
        return { before: findObject(before, ids.a)[field], committed: findObject(committed, ids.a)[field], displayed, blurCommitted: findObject(blurred, ids.a)[field], undoDepth: escaped.undoDepth }
      })
    }

    for (const move of ['tab', 'click']) {
      await run(`registry-price-to-memo-${move}-preserves-focus-input-and-undo`, async ids => {
        await click(win, nameSelector(ids.a))
        const before = await state(win)
        await replaceText(win, registryFieldSelector(ids.a, 'price'), '1681')
        if (move === 'tab') await pressKey(win, 'TAB')
        else await click(win, registryFieldSelector(ids.a, 'memo'))
        const focused = await evaluate(win, () => ({
          field: document.activeElement?.dataset?.registryField,
          objectId: document.activeElement?.dataset?.objectId
        }))
        assert.deepEqual(focused, { field: 'memo', objectId: ids.a }, '価格の確定後も次のメモ欄にフォーカスを保持すること')
        await pressKey(win, 'A', ['control'])
        win.webContents.insertText('価格から続けて変更したメモ')
        await wait(win, 50)
        await pressKey(win, 'TAB')
        const committed = await state(win)
        assert.equal(findObject(committed, ids.a).price, 1681)
        assert.equal(findObject(committed, ids.a).memo, '価格から続けて変更したメモ')
        assert.equal(committed.undoDepth, before.undoDepth + 2, '価格とメモをそれぞれ一度だけ確定すること')
        assert.deepEqual(findObject(committed, ids.b), findObject(before, ids.b))
        await click(win, batchSelector(ids.a))
        const unselected = await state(win)
        assert.deepEqual(unselected.registryIds, [])
        assert.deepEqual(unselected.selectedIds, [ids.a])
        assert.equal(findObject(unselected, ids.a).memo, '価格から続けて変更したメモ')
        await click(win, '[data-action="undo"]')
        const firstUndo = await state(win)
        assert.equal(findObject(firstUndo, ids.a).memo, findObject(before, ids.a).memo)
        assert.equal(findObject(firstUndo, ids.a).price, 1681)
        await click(win, '[data-action="undo"]')
        assert.equal(findObject(await state(win), ids.a).price, findObject(before, ids.a).price)
        return { move, focused, price: 1681, memo: findObject(committed, ids.a).memo, historyEntries: committed.undoDepth - before.undoDepth }
      })
    }

    await run('registry-search-hidden-editing-target-is-explained-and-revealed', async ids => {
      await click(win, nameSelector(ids.a))
      await replaceText(win, '#registry-search', '一致しない検索文字列')
      const hidden = await state(win)
      assert.deepEqual(hidden.selectedIds, [ids.a])
      assert.equal(hidden.rowIds.includes(ids.a), false)
      assert.match(hidden.selectionStatus, /一覧外/)
      assert.match(hidden.selectionStatus, /1/)
      assert.equal(hidden.revealVisible, true)
      await click(win, '[data-action="registry-reveal-selection"]')
      const revealed = await state(win)
      assert.equal(revealed.search, '')
      assert.equal(revealed.filter, 'all')
      assert.equal(revealed.tab, 'lots')
      assert.equal(revealed.rowIds.includes(ids.a), true)
      assert.deepEqual(revealed.selectedIds, [ids.a])
      assert.equal(revealed.revealVisible, false)
      return { hidden: hidden.selectionStatus, revealed: revealed.selectionStatus, selectedIds: revealed.selectedIds }
    })

    await run('registry-kind-filter-hidden-selection-is-revealed-without-geometry-change', async ids => {
      await click(win, nameSelector(ids.a))
      const before = await state(win)
      await click(win, '#registry-options > summary')
      await chooseSelect(win, '#registry-filter', 'road')
      const filtered = await state(win)
      assert.deepEqual(filtered.rowIds, [ids.road])
      assert.deepEqual(filtered.selectedIds, [ids.a])
      assert.equal(filtered.revealVisible, true)
      await click(win, '[data-action="registry-reveal-selection"]')
      const revealed = await state(win)
      assert.equal(revealed.filter, 'all')
      assert.equal(revealed.rowIds.includes(ids.a), true)
      assert.deepEqual(revealed.objects, before.objects)
      assert.equal(revealed.undoDepth, before.undoDepth)
      return { filteredRows: filtered.rowIds, status: filtered.selectionStatus, revealedRows: revealed.rowIds }
    })

    for (const target of ['lot', 'note']) {
      await run(`registry-tab-hidden-${target}-editing-target-returns-to-correct-tab`, async ids => {
        const id = target === 'lot' ? ids.a : ids.note
        const targetTab = target === 'lot' ? 'lots' : 'notes'
        const otherTab = target === 'lot' ? 'notes' : 'lots'
        if (targetTab !== 'lots') await click(win, `[data-registry-tab="${targetTab}"]`)
        await click(win, nameSelector(id))
        await click(win, `[data-registry-tab="${otherTab}"]`)
        const hidden = await state(win)
        assert.equal(hidden.tab, otherTab)
        assert.deepEqual(hidden.selectedIds, [id])
        assert.equal(hidden.revealVisible, true)
        assert.match(hidden.selectionStatus, /一覧外/)
        await click(win, '[data-action="registry-reveal-selection"]')
        const revealed = await state(win)
        assert.equal(revealed.tab, targetTab)
        assert.equal(revealed.rowIds.includes(id), true)
        assert.equal((await rowState(win, id)).editing, true)
        return { hidden: hidden.selectionStatus, revealedTab: revealed.tab, id }
      })
    }

    await run('registry-filtered-select-all-and-display-checkbox-have-separate-effects', async ids => {
      await click(win, nameSelector(ids.road))
      await click(win, '#registry-options > summary')
      await chooseSelect(win, '#registry-filter', 'lot')
      await click(win, '#registry-check-all')
      const selected = await state(win)
      assert.deepEqual([...selected.registryIds].sort(), [ids.a, ids.b].sort())
      assert.deepEqual(selected.selectedIds, [ids.road])
      assert.equal(findObject(selected, ids.road).visible, true)
      await click(win, visibleSelector(ids.b))
      const hidden = await state(win)
      assert.deepEqual([...hidden.registryIds].sort(), [ids.a, ids.b].sort())
      assert.deepEqual(hidden.selectedIds, [ids.road])
      assert.equal(findObject(hidden, ids.b).visible, false)
      assert.equal(findObject(hidden, ids.a).visible, true)
      assert.equal(findObject(hidden, ids.road).visible, true)
      return { selectedIds: hidden.selectedIds, registryIds: hidden.registryIds }
    })

    await run('registry-name-button-is-reachable-and-activates-with-keyboard', async ids => {
      await click(win, '#registry-search')
      let focusedName = null
      for (let index = 0; index < 40; index++) {
        await pressKey(win, 'TAB')
        focusedName = await evaluate(win, () => {
          const node = document.activeElement
          return node?.matches('.registry-name-button') ? { id: node.dataset.objectId, label: node.getAttribute('aria-label') || node.textContent } : null
        })
        if (focusedName) break
      }
      assert.ok(focusedName, 'Tabで台帳の名称ボタンに到達できること')
      assert.ok(focusedName.label.trim(), '名前ボタンに理解できるラベルがあること')
      // Chromium's native button activation uses the Enter character event;
      // keyDown/keyUp alone only exercise the application's key handlers.
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ENTER' })
      win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ENTER' })
      await wait(win, 80)
      const after = await state(win)
      assert.deepEqual(after.selectedIds, [focusedName.id])
      assert.equal((await rowState(win, focusedName.id)).editing, true)
      assert.equal(await evaluate(win, () => document.activeElement?.dataset?.field), 'object-label', 'Enter後に本文へフォーカスすること')
      assert.ok([ids.a, ids.b, ids.road, ids.water].includes(focusedName.id))
      return { focusedName, selectedIds: after.selectedIds }
    })

    checks.push({ name: 'registry-runtime-console-clean', pass: consoleErrors.length === 0, details: consoleErrors })
  } finally {
    const failed = checks.filter(check => !check.pass)
    const report = {
      generatedAt: new Date().toISOString(),
      target: { version: require('./package.json').version, entry: 'index-v210.html', mode: 'real-dom-input' },
      summary: { pass: failed.length === 0, total: checks.length, passed: checks.length - failed.length, failed: failed.length, failedNames: failed.map(check => check.name) },
      checks, consoleErrors,
      screenshots: ['registry-1440-default.png', 'registry-1440-selected.png', 'registry-900-default.png', 'registry-900-selected.png'].map(name => path.join(screenshotRoot, name))
    }
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
    console.log(JSON.stringify(report.summary))
    if (!win.isDestroyed()) win.destroy()
    process.exit(failed.length ? 1 : 0)
  }
}

async function fixture(win) {
  const ids = await evaluate(win, (longName, longMemo) => {
    const api = window.__KOZU_V210__, K = window.KozuV210
    const doc = K.createDocument()
    doc.calibration = { ...doc.calibration, mpp: 0.1, mapScale: 500 }
    K.activePage(doc).calibration = { ...doc.calibration }
    const rectangle = (kind, x, attributes) => K.addShape(doc, kind, [
      { x, y: 50 }, { x: x + 160, y: 50 }, { x: x + 160, y: 170 }, { x, y: 170 }
    ], attributes)
    const a = rectangle('lot', 30, { number: 1, label: longName, price: 1800, memo: longMemo })
    const b = rectangle('lot', 230, { number: 2, label: '北側の分譲区画B', price: 2200, memo: '現況渡し' })
    const road = rectangle('road', 430, { label: '東側の公道', road: { name: '東側の公道', widthM: 4 } })
    const water = rectangle('water', 630, { label: '南側の水路', road: { name: '南側の水路', widthM: 1.5 } })
    const note = K.addEntity(doc, 'text', { text: '現地確認用の注記', position: { x: 120, y: 260 }, memo: '説明文' })
    K.addEntity(doc, 'distance', { points: [{ x: 40, y: 300 }, { x: 180, y: 300 }] })
    api.store.replace(doc, { clean: true })
    api.activateCommand('select', { focusCanvas: false })
    api.setWorkspace('drawing')
    api.render()
    api.renderer.render()
    return { a: String(a.id), b: String(b.id), road: String(road.id), water: String(water.id), note: String(note.id) }
  }, LONG_NAME, LONG_MEMO)
  await wait(win, 100)
  return ids
}

async function state(win) {
  return evaluate(win, () => {
    const api = window.__KOZU_V210__, active = window.KozuV210.activePage(api.document)
    const reveal = document.querySelector('[data-action="registry-reveal-selection"]')
    const visible = node => Boolean(node && !node.hidden && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden')
    return JSON.parse(JSON.stringify({
      selectedIds: api.ui.selectedIds, registryIds: [...api.ui.registryIds], tab: api.ui.registryTab,
      rowIds: [...document.querySelectorAll('#registry-rows [data-object-id]')].filter(node => node.tagName === 'TR').map(node => node.dataset.objectId),
      search: document.getElementById('registry-search')?.value, filter: document.getElementById('registry-filter')?.value,
      selectionStatus: document.getElementById('registry-selection-status')?.textContent || '',
      revealVisible: visible(reveal), undoDepth: api.store.undoStack.length,
      objects: [...active.shapes, ...active.entities]
    }))
  })
}

async function rowState(win, id) {
  return evaluate(win, id => {
    const row = document.querySelector(`#registry-rows tr[data-object-id="${id}"]`)
    if (!row) return { missing: true }
    const visible = selector => { const node = row.querySelector(selector); return Boolean(node && node.getClientRects().length && !node.hidden) }
    return {
      selected: row.classList.contains('selected'), editing: row.classList.contains('is-editing'),
      priceInput: visible('[data-registry-field="price"]'), memoInput: visible('[data-registry-field="memo"]'),
      priceValue: visible('.registry-price-value'), memoValue: visible('.registry-memo-value'),
      visibleCheckbox: visible('[data-registry-field="visible"]')
    }
  }, id)
}

async function registryLayout(win, id) {
  return evaluate(win, id => {
    const dock = document.getElementById('registry-workspace'), wrap = dock.querySelector('.registry-table-wrap')
    const row = document.querySelector(`#registry-rows tr[data-object-id="${id}"]`)
    const name = row?.querySelector('.registry-name-button')
    const price = row?.querySelector('.registry-price-value,[data-registry-field="price"]')
    const memo = row?.querySelector('.registry-memo-value,[data-registry-field="memo"]')
    const options = document.getElementById('registry-options')
    if (!name || !price || !memo || !options) throw new Error('台帳の新しい名称・価格・メモ・補助設定が見つかりません')
    const bounds = dock.getBoundingClientRect(), nameRect = name.getBoundingClientRect()
    const isVisible = node => Boolean(node && !node.hidden && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden')
    const clipped = [...dock.querySelectorAll('button,input,select,textarea,summary')].filter(isVisible).filter(node => {
      const rect = node.getBoundingClientRect()
      return rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.right > innerWidth + 1
    }).map(node => ({ field: node.dataset.registryField || node.dataset.action || node.id || node.className, text: node.textContent.trim().slice(0, 50), left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right }))
    return {
      optionsOpen: options.open, searchVisible: isVisible(document.getElementById('registry-search')) && !document.getElementById('registry-search').closest('details:not([open])'),
      optionsOwnFilters: ['registry-filter', 'registry-sort', 'registry-area-summary'].every(key => options.contains(document.getElementById(key))),
      nameText: name.textContent.trim(), nameFont: parseFloat(getComputedStyle(name).fontSize),
      priceFont: parseFloat(getComputedStyle(price).fontSize), memoFont: parseFloat(getComputedStyle(memo).fontSize),
      nameWidth: nameRect.width, nameHeight: nameRect.height, nameBottom: nameRect.bottom,
      nameScrollWidth: name.scrollWidth, nameScrollHeight: name.scrollHeight,
      priceTop: price.getBoundingClientRect().top, memoTop: memo.getBoundingClientRect().top,
      areaTop: row.querySelector('.col-area').getBoundingClientRect().top,
      memoVisible: isVisible(memo), rowHeight: row.getBoundingClientRect().height,
      clientWidth: wrap.clientWidth, scrollWidth: wrap.scrollWidth, dockWidth: bounds.width, clipped,
      visibleCheckboxes: [...dock.querySelectorAll('[data-registry-field="visible"]')].filter(isVisible).length,
      editablePriceMemo: [...dock.querySelectorAll('[data-registry-field="price"],[data-registry-field="memo"]')].filter(isVisible).length
    }
  }, id)
}

function nameSelector(id) { return `#registry-rows .registry-name-button[data-action="registry-edit-object"][data-object-id="${id}"]` }
function batchSelector(id) { return `#registry-rows [data-registry-select="${id}"]` }
function registryFieldSelector(id, field) { return `#registry-rows [data-registry-field="${field}"][data-object-id="${id}"]` }
function visibleSelector(id) { return registryFieldSelector(id, 'visible') }
function findObject(snapshot, id) { return snapshot.objects.find(object => String(object.id) === id) }

async function click(win, selector) {
  const point = await evaluate(win, selector => {
    const node = [...document.querySelectorAll(selector)].find(node => !node.hidden && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden')
    if (!node) throw new Error(`操作対象が見つかりません: ${selector}`)
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const rect = node.getBoundingClientRect()
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
  }, selector)
  win.webContents.focus()
  win.webContents.sendInputEvent({ type: 'mouseMove', ...point })
  win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
  win.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
  await wait(win, 70)
}

async function pressKey(win, keyCode, modifiers = []) {
  win.webContents.focus()
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  await wait(win, 55)
}

async function replaceText(win, selector, value) {
  await click(win, selector)
  await pressKey(win, 'A', ['control'])
  win.webContents.insertText(String(value))
  await wait(win, 80)
}

async function chooseSelect(win, selector, value) {
  const values = await evaluate(win, selector => [...document.querySelector(selector).options].map(option => option.value), selector)
  const index = values.indexOf(value)
  assert.ok(index >= 0, `選択肢が見つかりません: ${selector}=${value}`)
  await click(win, selector)
  await pressKey(win, 'HOME')
  for (let offset = 0; offset < index; offset++) await pressKey(win, 'DOWN')
  await pressKey(win, 'ENTER')
  await wait(win, 70)
}

async function capture(win, filename) {
  await evaluate(win, () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await wait(win, 80)
  fs.writeFileSync(path.join(screenshotRoot, filename), (await win.webContents.capturePage()).toPNG())
}

async function evaluate(win, callback, ...args) {
  const result = await win.webContents.executeJavaScript(`(async()=>{
    try{return{value:await (${callback.toString()})(...${JSON.stringify(args)})}}
    catch(error){return{error:error.stack||String(error)}}
  })()`, true)
  if (result.error) throw new Error(result.error)
  return result.value
}
function wait(win, milliseconds) { return evaluate(win, milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), milliseconds) }
