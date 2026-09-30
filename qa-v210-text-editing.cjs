/*
 * 文字編集の目的別・実入力回帰テスト。
 * 実行: node qa-v210-text-editing.cjs
 * 内部APIの利用はfixture準備と状態・描画位置の観測に限定する。
 * 編集はElectronのマウス/キーボード/insertText経由で行う。
 * IMEケースだけは合成compositionイベントであり、実OS IMEの代替ではない。
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const root = __dirname
const reportPath = path.join(root, 'output', 'qa-v210-text-editing-report.json')
const BODY = '#command-controls [data-field="object-label"]'
const SIZE = '#command-controls [data-field="text-size"]'
const FONT = '#command-controls [data-field="font-family"]'
let activeCase = 'startup'

if (!process.versions.electron) {
  const child = spawnSync(require('electron'), [__filename, '--electron-child'], {
    cwd: root, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, KOZU_V210_TEXT_EDITING_QA: '1' }
  })
  process.exitCode = child.status == null ? 1 : child.status
} else {
  runSuite().catch(error => { console.error(error.stack || error); process.exitCode = 1 })
}

async function runSuite() {
  const { app, BrowserWindow } = require('electron')
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kozu-text-editing-'))
  app.setPath('userData', path.join(tempRoot, 'userData'))
  app.setPath('sessionData', path.join(tempRoot, 'sessionData'))
  const checks = []
  const consoleErrors = []
  await app.whenReady()
  const win = new BrowserWindow({
    width: 1440, height: 1000, minWidth: 900, minHeight: 600, show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: false,
      webSecurity: true, backgroundThrottling: false,
      preload: path.join(root, 'preload-v210.js')
    }
  })
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2 && !/Autofill|DevTools|Electron Security Warning/i.test(message)) {
      consoleErrors.push({ case: activeCase, message, line, sourceId })
    }
  })
  win.webContents.on('render-process-gone', (_event, details) => consoleErrors.push({ case: activeCase, details }))

  async function run(name, callback, { width = 1440, height = 1000 } = {}) {
    activeCase = name
    console.log(`START ${name}`)
    try {
      win.setContentSize(width, height)
      await win.loadFile(path.join(root, 'index-v210.html'))
      await evaluate(win, `Promise.race([Promise.resolve(document.fonts?.ready),new Promise(resolve=>setTimeout(resolve,800))])`)
      await wait(win, 120)
      const ready = await evaluate(win, `Boolean(window.__KOZU_V210__ && document.getElementById('drawing-canvas'))`)
      if (!ready) throw new Error('描画・観測APIの準備ができませんでした')
      const details = await callback()
      checks.push({ name, pass: true, details })
      console.log(`PASS ${name}`)
    } catch (error) {
      checks.push({ name, pass: false, error: error.stack || String(error) })
      console.log(`FAIL ${name}: ${error.message.split('\n')[0]}`)
    }
  }

  try {
    for (const kind of ['lot', 'road', 'water']) {
      await run(`${kind}-visible-name-click-renames-without-tab-detour`, async () => {
        const fixture = await prepareFixture(win, kind)
        await mouseClick(win, await labelPoint(win, fixture.id, kind === 'lot' ? 'shape-label' : 'shape-road-name'))
        const before = await readState(win)
        const body = await fieldState(win, BODY)
        const font = await fieldState(win, FONT)
        assert(body.visible && font.visible, '名称クリック後に、内容と書体へ同じ面から到達できる必要があります', { body, font, before })
        assert(before.contextPage === 'object-text', '名称をクリックした経路が文字編集面であること', before)
        await replaceText(win, BODY, '道路側の区画')
        await blurByClick(win, FONT)
        const after = await readState(win)
        const object = after.objects.find(item => item.id === fixture.id)
        const untouched = after.objects.find(item => item.id === fixture.otherId)
        assert(object?.label === '道路側の区画', '名称がUI入力どおり保存されません', { object, after })
        assert(untouched?.label === '隣の対象', '未選択の名称まで変更されています', untouched)
        if (kind !== 'lot') assert(object.road?.name === '道路側の区画', '道路・水路の名称がモデル間で不一致です', object)
        return { selectedId: fixture.id, beforePage: before.contextPage, label: object.label, untouchedLabel: untouched.label }
      })
    }

    for (const kind of ['text', 'callout', 'arrow']) {
      await run(`${kind}-content-and-style-share-one-editing-surface`, async () => {
        const fixture = await prepareFixture(win, kind)
        await mouseClick(win, await labelPoint(win, fixture.id))
        const fields = await Promise.all([BODY, SIZE, FONT].map(selector => fieldState(win, selector)))
        const state = await readState(win)
        assert(fields.every(field => field.visible), '本文・サイズ・書体が同時に見えません', fields)
        assert(fields[0].tag === 'TEXTAREA', '本文は改行可能なtextareaである必要があります', fields[0])
        assert(/1\s*件/.test(state.controlText), '適用範囲1件の表示が見つかりません', state.controlText)
        await replaceText(win, BODY, '編集済みの注記')
        await pressKey(win, 'ENTER', ['control'])
        const after = await readState(win)
        assert(after.objects.find(item => item.id === fixture.id)?.text === '編集済みの注記', 'Ctrl+Enterで本文が保存されません', after)
        return { kind, fields, text: after.objects.find(item => item.id === fixture.id)?.text, controlText: state.controlText }
      })
    }

    await run('new-text-size-and-existing-size-use-the-same-number', async () => {
      await prepareFixture(win, 'empty')
      await pressKey(win, 'T')
      const newBody = await fieldState(win, '#command-controls [data-field="note-text"]')
      assert(newBody.tag === 'TEXTAREA', '新規注記もtextareaである必要があります', newBody)
      await replaceText(win, '#command-controls [data-field="note-text"]', '作成した注記')
      await replaceText(win, '#command-controls [data-field="note-size"]', '14')
      const canvasPoint = await worldPoint(win, { x: 190, y: 175 })
      await mouseClick(win, canvasPoint)
      const created = (await readState(win)).objects.find(item => item.kind === 'text')
      assert(created?.text === '作成した注記', 'UIから注記を配置できませんでした', created)
      await pressKey(win, 'V')
      await mouseClick(win, await labelPoint(win, created.id))
      const sizeBefore = await fieldState(win, SIZE)
      assert(Number(sizeBefore.value) === 14, '新規14が編集時にも14と表示される必要があります', sizeBefore)
      await replaceText(win, SIZE, '18')
      await pressKey(win, 'ENTER')
      const after = await readState(win)
      const object = after.objects.find(item => item.id === created.id)
      assert(near(object?.textStyle?.fontSize ?? object?.style?.fontSize, 18), 'サイズ18が実サイズ18としてモデルへ保存されません', object)
      const sizeAfter = await fieldState(win, SIZE)
      assert(Number(sizeAfter.value) === 18, 'サイズ変更後にUI表示が倍率へ戻っています', sizeAfter)
      await chooseSelect(win, FONT, 'mincho')
      const formatted = (await readState(win)).objects.find(item => item.id === created.id)
      assert((formatted?.textStyle?.fontFamily ?? formatted?.style?.fontFamily) === 'mincho', '同じ編集面から書体を変更できません', formatted)
      return { created, sizeBefore: sizeBefore.value, sizeAfter: sizeAfter.value, object, formatted }
    })

    await run('plain-enter-adds-a-newline-without-committing-text', async () => {
      const fixture = await prepareFixture(win, 'text')
      await mouseClick(win, await labelPoint(win, fixture.id))
      await replaceText(win, BODY, '1行目')
      const before = await readState(win)
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ENTER' })
      win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ENTER' })
      win.webContents.insertText('2行目')
      await wait(win, 80)
      const field = await fieldState(win, BODY)
      const during = await readState(win)
      assert(field.value === '1行目\n2行目' && field.active, '通常のEnterが改行入力として扱われません', field)
      assert(during.undoDepth === before.undoDepth, '通常のEnterが入力途中で編集を確定しています', { before: before.undoDepth, during: during.undoDepth })
      await pressKey(win, 'ENTER', ['control'])
      const after = await readState(win)
      assert(after.objects.find(item => item.id === fixture.id)?.text === '1行目\n2行目', '改行のある本文が確定されません', after)
      return { value: field.value, undoDuring: during.undoDepth, undoAfter: after.undoDepth }
    })

    await run('multiline-content-commits-and-undo-restores-the-whole-edit', async () => {
      const fixture = await prepareFixture(win, 'text')
      await mouseClick(win, await labelPoint(win, fixture.id))
      const before = await readState(win)
      await replaceText(win, BODY, '境界の注意事項\n面積は現況と異なる場合があります')
      await pressKey(win, 'ENTER', ['control'])
      const committed = await readState(win)
      assert(committed.objects.find(item => item.id === fixture.id)?.text === '境界の注意事項\n面積は現況と異なる場合があります', '改行本文が失われました', committed)
      assert(committed.undoDepth === before.undoDepth + 1, 'ひとまとまりの本文編集は1回のUndoで戻せる必要があります', { before: before.undoDepth, after: committed.undoDepth })
      await clickSelector(win, '#common-rail [data-action="undo"]')
      const undone = await readState(win)
      assert(undone.objects.find(item => item.id === fixture.id)?.text === '既存の注記', 'Undoで編集前の本文に戻りません', undone)
      return { committedText: committed.objects.find(item => item.id === fixture.id)?.text, undoDepth: committed.undoDepth, restored: undone.objects.find(item => item.id === fixture.id)?.text }
    })

    await run('escape-restores-current-textarea-transaction', async () => {
      const fixture = await prepareFixture(win, 'text')
      await mouseClick(win, await labelPoint(win, fixture.id))
      const before = await readState(win)
      await replaceText(win, BODY, '取り消す入力\n2行目')
      await pressKey(win, 'ESCAPE')
      const after = await readState(win)
      const field = await fieldState(win, BODY)
      assert(after.objects.find(item => item.id === fixture.id)?.text === '既存の注記' && field.value === '既存の注記', 'Escで現在の入力が復元されません', { after, field })
      assert(after.undoDepth === before.undoDepth, '取り消した入力がUndo履歴を増やしています', { before: before.undoDepth, after: after.undoDepth })
      return { value: field.value, undoDepth: after.undoDepth }
    })

    await run('double-click-focuses-visible-content-editor', async () => {
      const fixture = await prepareFixture(win, 'text')
      const point = await labelPoint(win, fixture.id)
      const trace = await mouseDoubleClick(win, point)
      const double = await fieldState(win, BODY)
      assert(double.active, '文字のダブルクリックで本文欄にフォーカスしません', { point, double, trace })
      return { doubleClickFocused: double.active, trace }
    })

    await run('enter-focuses-content-of-selected-text', async () => {
      const fixture = await prepareFixture(win, 'text')
      await mouseClick(win, await labelPoint(win, fixture.id))
      await pressKey(win, 'ENTER')
      const enter = await fieldState(win, BODY)
      assert(enter.active, '選択中文字へのEnterで本文欄にフォーカスしません', enter)
      return { enterFocused: enter.active }
    })

    await run('narrow-window-keeps-body-and-main-style-controls-reachable', async () => {
      const fixture = await prepareFixture(win, 'text')
      await mouseClick(win, await labelPoint(win, fixture.id))
      const fields = await Promise.all([BODY, SIZE, FONT].map(selector => fieldState(win, selector)))
      assert(fields.every(field => field.visible && field.insideViewport && field.insideControlBar), '900px幅で主要入力が表示領域から外れています', fields)
      assert(fields[0].width > 138, '本文欄が旧138px幅のままです', fields[0])
      await replaceText(win, BODY, '狭い画面でも入力できる注記')
      await blurByClick(win, SIZE)
      const after = await readState(win)
      assert(after.objects.find(item => item.id === fixture.id)?.text === '狭い画面でも入力できる注記', '狭い画面から入力確定できません', after)
      return { viewport: { width: 900, height: 700 }, fields }
    }, { width: 900, height: 700 })

    await run('synthetic-composition-enter-does-not-commit-before-composition-end', async () => {
      const fixture = await prepareFixture(win, 'text')
      await mouseClick(win, await labelPoint(win, fixture.id))
      await clickSelector(win, BODY)
      const before = await readState(win)
      await evaluate(win, `document.activeElement.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}))`)
      await pressKey(win, 'A', ['control'])
      win.webContents.insertText('変換中の日本語')
      await pressKey(win, 'ENTER', ['control'])
      const during = await readState(win)
      assert(during.undoDepth === before.undoDepth, '変換中のCtrl+Enterが編集を確定しました', { before, during })
      assert((await fieldState(win, BODY)).active, '変換中のEnterで本文欄のフォーカスを失いました')
      await evaluate(win, `document.activeElement.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'変換中の日本語'}))`)
      await wait(win, 150)
      await blurByClick(win, SIZE)
      const after = await readState(win)
      assert(after.objects.find(item => item.id === fixture.id)?.text === '変換中の日本語', '変換終了・blur後に本文が保存されません', after)
      return { mode: 'synthetic-composition-events; not an OS IME acceptance test', undoBefore: before.undoDepth, undoDuring: during.undoDepth, undoAfter: after.undoDepth }
    })
    checks.push({ name: 'electron-renderer-console-errors', pass: consoleErrors.length === 0, details: consoleErrors })
  } finally {
    const failed = checks.filter(check => !check.pass)
    const report = {
      generatedAt: new Date().toISOString(),
      target: { entry: 'index-v210.html', version: require('./package.json').version, mode: 'Electron native input with fixture-only setup' },
      limitations: ['IME is a synthetic composition-event regression, not an OS IME acceptance test.', 'Hidden Electron can suspend animation frames, so fixture/initial target label hit boxes are synchronously flushed for observation; double-click sends both clicks without any intervening wait, evaluation, or renderer flush.', 'No installer build is launched.'],
      summary: { pass: !failed.length, total: checks.length, passed: checks.length - failed.length, failed: failed.length, failedNames: failed.map(check => check.name) },
      checks
    }
    fs.mkdirSync(path.dirname(reportPath), { recursive: true })
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
    console.log(JSON.stringify(report.summary))
    if (!win.isDestroyed()) win.destroy()
    // この試験自身が作った一時ディレクトリだけを、解決済みパスで削除する。
    const resolvedTemp = path.resolve(tempRoot)
    const tempParent = path.resolve(os.tmpdir()) + path.sep
    if (resolvedTemp.startsWith(tempParent) && path.basename(resolvedTemp).startsWith('kozu-text-editing-')) {
      try { fs.rmSync(resolvedTemp, { recursive: true, force: true }) } catch (_) { /* Electron終了中のロックは残す */ }
    }
    app.exit(failed.length ? 1 : 0)
  }
}

async function prepareFixture(win, kind) {
  const result = await evaluate(win, `(() => {
    const api=window.__KOZU_V210__, K=window.KozuV210;
    const doc=K.createDocument(); doc.calibration={...doc.calibration,mpp:0.1,mapScale:500};
    let object=null,other=null;
    const kind=${JSON.stringify(kind)};
    if(['lot','road','water'].includes(kind)) {
      object=K.addShape(doc,kind,[{x:80,y:80},{x:260,y:80},{x:260,y:230},{x:80,y:230}],{number:1,label:'対象の名称',road:{name:'対象の名称',widthM:4,width:4},labelStyle:{fontSize:14,size:14},visibility:{area:false,tsubo:false,dimensions:false}});
      other=K.addShape(doc,kind,[{x:290,y:80},{x:430,y:80},{x:430,y:230},{x:290,y:230}],{number:2,label:'隣の対象',road:{name:'隣の対象',widthM:4,width:4},visibility:{area:false,tsubo:false,dimensions:false}});
    } else if(kind!=='empty') {
      object=K.addEntity(doc,kind,{position:{x:160,y:170},points:[{x:90,y:210},{x:180,y:170}],labelPosition:{x:180,y:170},text:'既存の注記',style:{fontSize:14,size:14,fontFamily:'gothic',color:'#172033'},textStyle:{fontSize:14,size:14,fontFamily:'gothic',color:'#172033'}});
    }
    api.store.replace(doc,{clean:true}); api.runtime.view={x:30,y:30,zoom:1};
    api.activateCommand('select'); api.render();
    return {id:object?.id||null,otherId:other?.id||null};
  })()`)
  // 非表示ElectronではrAFが止まる環境があるためfixture描画のみ同期で準備する。
  await evaluate(win, `window.__KOZU_V210__.renderer.render()`)
  await wait(win, 70)
  return result
}

async function labelPoint(win, id, kind = 'entity-label') {
  // 文字のクリック座標は描画済みラベルを観測する。位置や選択は変更しない。
  await evaluate(win, `window.__KOZU_V210__.renderer.render()`)
  const result = await evaluate(win, `(() => {
    const api=window.__KOZU_V210__, rect=document.getElementById('drawing-canvas').getBoundingClientRect();
    const boxes=api.renderer.getLabelBoxes();
    const box=boxes.find(item=>item.ownerId===${JSON.stringify(id)}&&item.kind===${JSON.stringify(kind)});
    if(!box)return {missing:true,boxes,view:api.view,canvas:{width:rect.width,height:rect.height},objects:window.KozuV210.activePage(api.store.document)};
    return {x:rect.x+box.x+box.width/2,y:rect.y+box.y+box.height/2};
  })()`)
  assert(result && !result.missing, 'クリック対象の描画文字が見つかりません', result)
  return result
}

async function worldPoint(win, point) {
  return evaluate(win, `(() => {const p=window.__KOZU_V210__.worldToScreen(${JSON.stringify(point)});const r=document.getElementById('drawing-canvas').getBoundingClientRect();return{x:r.x+p.x,y:r.y+p.y}})()`)
}

async function readState(win) {
  return evaluate(win, `(() => {
    const api=window.__KOZU_V210__,p=window.KozuV210.activePage(api.store.document);
    return JSON.parse(JSON.stringify({objects:[...p.shapes,...p.entities],selectedIds:api.ui.selectedIds,contextPage:api.ui.contextPage,command:api.session.command,form:api.session.form,undoDepth:api.store.undoStack.length,controlText:document.getElementById('control-bar').textContent,activeTag:document.activeElement?.tagName}));
  })()`)
}

async function fieldState(win, selector) {
  return evaluate(win, `(() => {
    const field=[...document.querySelectorAll(${JSON.stringify(selector)})].find(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&!n.hidden&&getComputedStyle(n).visibility!=='hidden'});
    if(!field)return{visible:false,selector:${JSON.stringify(selector)}};
    const r=field.getBoundingClientRect(),b=document.getElementById('control-bar').getBoundingClientRect();
    return{visible:true,tag:field.tagName,value:field.value,active:document.activeElement===field,width:r.width,height:r.height,x:r.x,y:r.y,insideViewport:r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,insideControlBar:r.left>=b.left-1&&r.top>=b.top-1&&r.right<=b.right+1&&r.bottom<=b.bottom+1};
  })()`)
}

async function clickSelector(win, selector) {
  const field = await fieldState(win, selector)
  assert(field.visible, '操作対象が見つかりません', { selector, field })
  await mouseClick(win, { x: field.x + field.width / 2, y: field.y + field.height / 2 })
}

async function replaceText(win, selector, value) {
  await clickSelector(win, selector)
  await pressKey(win, 'A', ['control'])
  win.webContents.insertText(String(value))
  await wait(win, 60)
}

async function chooseSelect(win, selector, value) {
  const options = await evaluate(win, `[...document.querySelector(${JSON.stringify(selector)}).options].map(item=>item.value)`)
  const index = options.indexOf(value)
  assert(index >= 0, '書体の選択肢が見つかりません', { selector, value, options })
  await clickSelector(win, selector)
  await pressKey(win, 'HOME')
  for (let offset = 0; offset < index; offset++) await pressKey(win, 'DOWN')
  await pressKey(win, 'ENTER')
  await wait(win, 80)
}

async function blurByClick(win, selector) {
  await clickSelector(win, selector)
  // ネイティブselectを開いた場合も編集を続けられる状態に戻す。
  const state = await fieldState(win, selector)
  if (state.tag === 'SELECT') await pressKey(win, 'ESCAPE')
  await wait(win, 80)
}

async function mouseClick(win, point, clickCount = 1) {
  const x = Math.round(point.x), y = Math.round(point.y)
  win.webContents.focus()
  win.webContents.sendInputEvent({ type: 'mouseMove', x, y })
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount })
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount })
  await wait(win, 45)
}

async function mouseDoubleClick(win, point) {
  const snapshot = () => evaluate(win, `(() => { const api=window.__KOZU_V210__,r=document.getElementById('drawing-canvas').getBoundingClientRect(),c=document.getElementById('control-bar').getBoundingClientRect();return{selectedIds:[...api.ui.selectedIds],canvasY:r.y,controlHeight:c.height,view:api.view,activeTag:document.activeElement.tagName};})()`)
  const before = await snapshot()
  const x = Math.round(point.x), y = Math.round(point.y)
  win.webContents.focus()
  win.webContents.sendInputEvent({ type: 'mouseMove', x, y })
  // 2クリック間に待機・観測・描画支援を挟まず、同じ画面座標へ連続送信する。
  for (const clickCount of [1, 2]) {
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount })
    win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount })
  }
  await wait(win, 80)
  return { before, interClickWaitMs: 0, interClickRendererFlush: false, afterSecond: await snapshot() }
}

async function pressKey(win, keyCode, modifiers = []) {
  win.webContents.focus()
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  await wait(win, 65)
}

function evaluate(win, source) { return win.webContents.executeJavaScript(source, true) }
function wait(win, duration) { return evaluate(win, `new Promise(resolve=>setTimeout(resolve,${duration}))`) }
function near(left, right) { return Number.isFinite(Number(left)) && Math.abs(Number(left) - right) < 1e-6 }
function assert(condition, message, details) {
  if (!condition) throw new Error(message + (details === undefined ? '' : '\n' + JSON.stringify(details)))
}
