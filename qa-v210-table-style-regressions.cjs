/*
 * 表の参照・固定値保持と、文字書式の独立編集の回帰テスト。
 * 実行: node qa-v210-table-style-regressions.cjs
 * 隔離fixtureの準備、複写・履歴・保存の確認には内部APIを利用する。
 * 編集はElectronのマウス/キーボード/insertText経由で行う。
 * 題名・書体・対象区画の編集は実入力で検証する。
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const root = __dirname
const reportPath = path.join(root, 'output', 'qa-v210-table-style-regressions-report.json')
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
    await run('table-empty-title-stays-hidden', async () => {
      const f=await evaluate(win,`(()=>{const api=window.__KOZU_V210__,K=window.KozuV210,d=K.createDocument(),t=K.addEntity(d,'lot-table',{position:{x:100,y:100},title:'題名あり',scale:1,options:{scale:1}});api.store.replace(d,{clean:true});api.activateCommand('select');api.selectObject(t.id,{openEditor:true});api.ui.contextPage='object-special';api.renderCommandSurface();api.render();return{id:t.id}})()`)
      const beforeDoc=await evaluate(win,'window.__KOZU_V210__.store.document')
      await replaceText(win,'[data-field="table-title"]','')
      await pressKey(win,'TAB')
      const result=await evaluate(win,`(()=>{const api=window.__KOZU_V210__,o=window.KozuV210.objectById(api.store.document,${JSON.stringify(f.id)}).object;return{title:o.title,serialized:api.serialize()}})()`)
      assert(result.title===false,'表の題名を空欄にしても、非表示指定が保存されません',result.title??'undefined')
      await assertRoundtripAndUndo(win,beforeDoc)
      return result.title
    })
    await run('measurement-font-change-preserves-new-size', async () => {
      const f=await evaluate(win,`(()=>{const api=window.__KOZU_V210__,K=window.KozuV210,d=K.createDocument();d.calibration.mpp=1;const e=K.addEntity(d,'distance',{points:[{x:100,y:100},{x:250,y:100}],textStyle:{fontFamily:'gothic',fontSize:14,size:14,color:'#172033'},dimensionStyle:{fontSize:14,size:14,color:'#172033'}});api.store.replace(d,{clean:true});api.activateCommand('select');api.selectObject(e.id,{openEditor:true});api.ui.contextPage='object-dimension';api.renderCommandSurface();api.render();return{id:e.id}})()`)
      await replaceText(win,'[data-field="dimension-size"]','20')
      await pressKey(win,'TAB')
      const before=await evaluate(win,`window.KozuV210.objectById(window.__KOZU_V210__.store.document,${JSON.stringify(f.id)}).object.dimensionStyle`)
      await evaluate(win,`window.__KOZU_V210__.ui.contextPage='object-text';window.__KOZU_V210__.renderCommandSurface()`)
      const beforeDoc=await evaluate(win,'window.__KOZU_V210__.store.document')
      await chooseSelect(win,'[data-field="font-family"]','mincho')
      const after=await evaluate(win,`window.KozuV210.objectById(window.__KOZU_V210__.store.document,${JSON.stringify(f.id)}).object.dimensionStyle`)
      const displayed=await fieldState(win,'[data-field="text-size"]')
      assert(Math.abs(Number(displayed.value)-after.fontSize)<0.01,'文字設定側の表示サイズが寸法設定と一致しません',displayed)
      assert(before.fontSize===after.fontSize,'書体だけを変更すると、寸法文字の大きさが以前の値へ戻ります',{before,after})
      await assertRoundtripAndUndo(win,beforeDoc)
      return {before,after}
    })
    await run('copied-lot-and-table-refer-to-copied-lot',async()=>{
      const result=await evaluate(win,`(()=>{const K=window.KozuV210,d=K.createDocument(),a=K.addShape(d,'lot',[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}],{label:'複写元'}),t=K.addEntity(d,'lot-table',{position:{x:200,y:100},dynamic:true,lotIds:[a.id]}),copies=K.duplicateObjects(d,[a.id,t.id],{x:400,y:0}),lot=copies.find(o=>o.kind==='lot'),table=copies.find(o=>o.kind==='lot-table');return{sourceId:a.id,copyId:lot.id,tableIds:table.lotIds}})()`)
      assert(result.tableIds.includes(result.copyId)&&!result.tableIds.includes(result.sourceId),'一緒に複写した表が複写元の区画を参照し続けます',result)
      return result
    })
    await run('fixed-table-add-row-preserves-existing-snapshot',async()=>{
      const result=await evaluate(win,`(()=>{const api=window.__KOZU_V210__,K=window.KozuV210,d=K.createDocument(),p=[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}],a=K.addShape(d,'lot',p,{price:1200}),b=K.addShape(d,'lot',p.map(q=>({x:q.x+200,y:q.y})),{price:800}),t=K.addEntity(d,'lot-table',{position:{x:400,y:100},dynamic:false,snapshot:true,lotIds:[a.id],rows:[{lotId:a.id,number:1,price:900,area:10000,tsubo:3025}]});d.calibration.mpp=1;api.store.replace(d,{clean:true});api.activateCommand('select');api.selectObject(t.id,{openEditor:true});api.ui.contextPage='object-special';api.renderCommandSurface();api.render();return {tableId:t.id,first:a.id,second:b.id}})()`)
      const beforeDoc=await evaluate(win,'window.__KOZU_V210__.store.document')
      await clickSelector(win,'[data-lot-table-id="'+result.second+'"]')
      const rows=await evaluate(win,`window.KozuV210.objectById(window.__KOZU_V210__.store.document,${JSON.stringify(result.tableId)}).object.rows`)
      assert(rows.find(r=>r.lotId===result.first)?.price===900,'固定表に区画を追加すると、既存行の固定価格まで現在値に更新されます',rows)
      assert(rows.some(r=>r.lotId===result.second&&r.price===800),'追加した区画が表に入りません',rows)
      await assertRoundtripAndUndo(win,beforeDoc)
      return rows
    })
    checks.push({ name: 'electron-renderer-console-errors', pass: consoleErrors.length === 0, details: consoleErrors })
  } finally {
    const failed = checks.filter(check => !check.pass)
    const report = {
      generatedAt: new Date().toISOString(),
      target: { entry: 'index-v210.html', version: require(path.join(root,'package.json')).version, mode: 'Electron native input with fixture-only setup' },
      limitations: ['Isolated fixtures; no user project or installer is opened.'],
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

async function mouseClick(win, point, clickCount = 1) {
  const x = Math.round(point.x), y = Math.round(point.y)
  win.webContents.focus()
  win.webContents.sendInputEvent({ type: 'mouseMove', x, y })
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount })
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount })
  await wait(win, 45)
}

async function pressKey(win, keyCode, modifiers = []) {
  win.webContents.focus()
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  await wait(win, 65)
}

function evaluate(win, source) { return win.webContents.executeJavaScript(source, true) }
function wait(win, duration) { return evaluate(win, `new Promise(resolve=>setTimeout(resolve,${duration}))`) }
function assert(condition, message, details) {
  if (!condition) throw new Error(message + (details === undefined ? '' : '\n' + JSON.stringify(details)))
}

async function assertRoundtripAndUndo(win,before) {
  const after=await evaluate(win,'window.__KOZU_V210__.store.document')
  await evaluate(win,'window.__KOZU_V210__.undo()')
  const undone=await evaluate(win,'window.__KOZU_V210__.store.document')
  assert(JSON.stringify(undone.pages)===JSON.stringify(before.pages),'Undoで変更前の内容に戻りません',{before:before.pages,undone:undone.pages})
  await evaluate(win,'window.__KOZU_V210__.redo()')
  const redone=await evaluate(win,'window.__KOZU_V210__.store.document')
  assert(JSON.stringify(redone.pages)===JSON.stringify(after.pages),'Redoで変更後の内容に戻りません')
  const restored=await evaluate(win,'window.KozuV210.IO.deserializeProject(window.__KOZU_V210__.serialize()).document')
  assert(JSON.stringify(restored.pages)===JSON.stringify(after.pages),'保存・再読込で内容が変わります')
}
