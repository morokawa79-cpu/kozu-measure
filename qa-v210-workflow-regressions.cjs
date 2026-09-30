/*
 * 監査で発見した文字編集・複写・表の操作回帰テスト。
 * 実行: node qa-v210-workflow-regressions.cjs
 * 隔離fixture、描画の観測、削除アクションの呼出しに内部APIを利用する。
 * 編集はElectronのマウス/キーボード/insertText経由で行う。
 * 隅切り復元ボタンと平行線の離れ編集は実入力で検証する。
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const root = __dirname
const reportPath = path.join(root, 'output', 'qa-v210-workflow-regressions-report.json')
const BODY = '#command-controls [data-field="object-label"]'
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
    await run('audit-price-enter-focus', async () => {
      const fixture=await prepareFixture(win,'lot')
      await mouseClick(win,await labelPoint(win,fixture.id,'shape-label'))
      await chooseSelect(win,'[data-text-role]','price')
      await evaluate(win,`document.getElementById('drawing-canvas').focus()`)
      await pressKey(win,'ENTER')
      const result=await fieldState(win,'#command-controls [data-field="lot-price"]')
      assert(result.active,'価格を選択してEnterを押しても価格欄にフォーカスしません',result)
      return result
    })
    await run('audit-price-click-selects-price', async () => {
      const fixture=await prepareFixture(win,'lot')
      await evaluate(win,`(()=>{const api=window.__KOZU_V210__,K=window.KozuV210;const doc=K.clone(api.store.document),lot=K.activePage(doc).shapes[0];lot.price=900;lot.visibility.price=true;api.store.replace(doc,{clean:true});api.render();api.renderer.render()})()`)
      const box=await evaluate(win,`(()=>{const api=window.__KOZU_V210__,b=api.renderer.labelBoxes.find(b=>b.ownerId===${JSON.stringify(fixture.id)}&&b.kind==='shape-label'),r=document.getElementById('drawing-canvas').getBoundingClientRect();return{x:r.x+b.x+b.width/2,y:r.y+b.y+b.height*0.75}})()`)
      await mouseClick(win,box)
      const role=await evaluate(win,'window.__KOZU_V210__.ui.textRole')
      assert(role==='price','価格をクリックしても区画名の編集になります',{role})
      return {role}
    })
    await run('audit-deep-lot-name-newline-rendering', async () => {
      const fixture=await prepareFixture(win,'lot')
      await mouseClick(win,await labelPoint(win,fixture.id,'shape-label'))
      await replaceText(win,BODY,'名称1行目\n名称2行目')
      await pressKey(win,'ENTER',['control'])
      const draws=await evaluate(win,`(()=>{const api=window.__KOZU_V210__,result=[],p=CanvasRenderingContext2D.prototype,original=p.fillText;p.fillText=function(text,x,y,...rest){result.push({text,x,y});return original.call(this,text,x,y,...rest)};try{api.renderer.render()}finally{p.fillText=original}return result})()`)
      assert(!draws.some(d=>d.text.includes('\n')),'区画名の改行が別行にならず、そのままCanvasに渡されます',draws)
      return draws
    })
    await run('audit-deep-road-width-and-area-overlap', async () => {
      const fixture=await prepareFixture(win,'road')
      const boxes=await evaluate(win,`(()=>{const api=window.__KOZU_V210__,K=window.KozuV210,doc=K.clone(api.store.document),road=K.activePage(doc).shapes[0];road.visibility.area=true;road.areaLabel.visible=true;api.store.replace(doc,{clean:true});api.render();api.renderer.render();return api.renderer.labelBoxes.filter(b=>b.ownerId===${JSON.stringify(fixture.id)}).map(b=>({kind:b.kind,x:b.x,y:b.y,width:b.width,height:b.height}))})()`)
      const width=boxes.find(b=>b.kind==='shape-road-width'),area=boxes.find(b=>b.kind==='shape-area-label')
      const overlap=width&&area&&Math.min(width.x+width.width,area.x+area.width)>Math.max(width.x,area.x)&&Math.min(width.y+width.height,area.y+area.height)>Math.max(width.y,area.y)
      assert(!overlap,'自動配置の幅員と面積の文字枠が重なります',boxes)
      return boxes
    })
    await run('audit-deep-name-color-and-frame-color', async () => {
      await prepareFixture(win,'lot')
      const draws=await evaluate(win,`(()=>{const api=window.__KOZU_V210__,K=window.KozuV210,doc=K.clone(api.store.document),lot=K.activePage(doc).shapes[0];lot.labelStyle={...lot.labelStyle,color:'#172033',attributeColors:{name:'#b91c1c'},frame:true};api.store.replace(doc,{clean:true});api.render();const result=[],p=CanvasRenderingContext2D.prototype,fill=p.fillText,stroke=p.strokeRect;p.fillText=function(text,...args){result.push({kind:'text',text,color:this.fillStyle});return fill.call(this,text,...args)};p.strokeRect=function(...args){result.push({kind:'frame',color:this.strokeStyle});return stroke.apply(this,args)};try{api.renderer.render()}finally{p.fillText=fill;p.strokeRect=stroke}return result})()`)
      const frame=draws.find(d=>d.kind==='frame'),text=draws.find(d=>d.kind==='text'&&d.text.includes('区画 1'))
      assert(frame?.color===text?.color,'区画名の色変更に枠の色が追従しません',draws)
      return draws
    })
    await run('audit-flow-copied-cutout-restores-wrong-lot', async () => {
      const f=await evaluate(win,`(()=>{const api=window.__KOZU_V210__,K=window.KozuV210,d=K.createDocument(),p=[{x:80,y:80},{x:180,y:80},{x:180,y:180},{x:80,y:180}],a=K.addShape(d,'lot',p),cut=K.cutShapeCorner(d,a.id,0,10),copies=K.duplicateObjects(d,[a.id,cut.cutout.id],{x:200,y:0}),copyCut=copies.find(s=>s.kind==='cutout');api.store.replace(d,{clean:true});api.activateCommand('select');api.selectObject(copyCut.id);api.ui.contextPage='object-special';api.renderCommandSurface();api.render();return {originalId:a.id,copyId:copies.find(s=>s.kind==='lot').id}})()`)
      await clickSelector(win,'[data-action="restore-cutout"]')
      const areas=await evaluate(win,`(()=>{const K=window.KozuV210,d=window.__KOZU_V210__.store.document;return {original:K.polygonArea(K.objectById(d,${JSON.stringify(f.originalId)}).object.points),copy:K.polygonArea(K.objectById(d,${JSON.stringify(f.copyId)}).object.points)}})()`)
      assert(areas.original===9950&&areas.copy===10000,'複写した隅切りを戻すボタンで、複写元の区画が変更されます',areas)
      return areas
    })
    await run('audit-flow-moved-parallel-distance-edit-jumps-back', async () => {
      const f=await evaluate(win,`(()=>{const api=window.__KOZU_V210__,K=window.KozuV210,d=K.createDocument();d.calibration.mpp=1;const baseline=[{x:80,y:80},{x:180,y:80}],e=K.addEntity(d,'parallel',{points:K.parallelLine(...baseline,10),options:{baselinePoints:baseline,distanceM:10,parallelSign:1}});K.translateObject(e,200,100);api.store.replace(d,{clean:true});api.activateCommand('select');api.selectObject(e.id);api.ui.contextPage='object-special';api.renderCommandSurface();api.render();return {id:e.id,before:e.points}})()`)
      await replaceText(win,'[data-field="parallel-distance-edit"]','20')
      await pressKey(win,'TAB')
      const points=await evaluate(win,`window.KozuV210.objectById(window.__KOZU_V210__.store.document,${JSON.stringify(f.id)}).object.points`)
      assert(points[0].x===f.before[0].x,'移動した平行線の離れを編集すると、移動前の基準線へ戻ります',{before:f.before,after:points})
      return points
    })
    await run('audit-flow-fixed-table-loses-row-after-source-delete', async () => {
      const f=await evaluate(win,`(()=>{const api=window.__KOZU_V210__,K=window.KozuV210,d=K.createDocument(),a=K.addShape(d,'lot',[{x:80,y:80},{x:180,y:80},{x:180,y:180},{x:80,y:180}],{label:'固定表の対象'});d.calibration.mpp=1;K.addEntity(d,'lot-table',{position:{x:300,y:100},dynamic:false,snapshot:true,lotIds:[a.id],rows:[{lotId:a.id,number:1,label:'固定表の対象',area:10000,tsubo:3025,price:900}]});api.store.replace(d,{clean:true});api.activateCommand('select');api.render();return{id:a.id}})()`)
      const read=()=>evaluate(win,`(()=>{const api=window.__KOZU_V210__,p=CanvasRenderingContext2D.prototype,original=p.fillText,result=[];p.fillText=function(text,...args){result.push(String(text));return original.call(this,text,...args)};try{api.renderer.render()}finally{p.fillText=original}return result})()`)
      const before=await read()
      await evaluate(win,`window.__KOZU_V210__.selectObject(${JSON.stringify(f.id)})`)
      await evaluate(win,`window.__KOZU_V210__.handleAction('delete-selected')`)
      const after=await read()
      assert(after.includes('固定表の対象'),'現在値で固定した表も、元区画の削除で行が消えます',{before,after})
      return {before,after}
    })
    await run('audit-flow-uncalibrated-fixed-table-shows-zero-area', async () => {
      const draws=await evaluate(win,`(()=>{const api=window.__KOZU_V210__,K=window.KozuV210,d=K.createDocument();K.addEntity(d,'lot-table',{position:{x:100,y:100},dynamic:false,snapshot:true,rows:[{number:1,label:'未計測',area:null,tsubo:null,price:null}]});api.store.replace(d,{clean:true});api.render();const p=CanvasRenderingContext2D.prototype,original=p.fillText,result=[];p.fillText=function(text,...args){result.push(String(text));return original.call(this,text,...args)};try{api.renderer.render()}finally{p.fillText=original}return result})()`)
      assert(!draws.includes('0.00㎡'),'未計測の面積nullが、固定表では0.00㎡として描画されます',draws)
      return draws
    })
    checks.push({ name: 'electron-renderer-console-errors', pass: consoleErrors.length === 0, details: consoleErrors })
  } finally {
    const failed = checks.filter(check => !check.pass)
    const report = {
      generatedAt: new Date().toISOString(),
      target: { entry: 'index-v210.html', version: require('./package.json').version, mode: 'Electron native input with fixture-only setup' },
      limitations: ['Hidden Electron can suspend animation frames, so fixture/initial target label hit boxes are synchronously flushed for observation; double-click sends both clicks without any intervening wait, evaluation, or renderer flush.', 'No installer build is launched.'],
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
  if (selector === '[data-text-role]') {
    await clickSelector(win, `[data-text-role="${value}"]`)
    return
  }
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
