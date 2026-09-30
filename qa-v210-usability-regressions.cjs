/*
 * 編集対象・表のレイアウト・書式独立性・台帳列の回帰テスト。
 * 実行: node qa-v210-usability-regressions.cjs
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
const reportPath = path.join(root, 'output', 'qa-v210-usability-regressions-report.json')
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
  app.disableHardwareAcceleration()
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
    await run('batch-frame-preserves-each-underline',async()=>{
      await evaluate(win,`(()=>{const api=window.__KOZU_V210__,K=window.KozuV210,d=K.createDocument(),a=K.addEntity(d,'text',{position:{x:100,y:100},text:'下線なし',textStyle:{underline:false}}),b=K.addEntity(d,'text',{position:{x:300,y:100},text:'下線あり',textStyle:{underline:true}});api.store.replace(d,{clean:true});api.activateCommand('select');api.ui.registryIds=new Set([a.id,b.id]);api.handleAction('registry-focus');api.ui.contextPage='object-basic';api.renderCommandSurface();api.render()})()`)
      const before=await evaluate(win,`window.KozuV210.activePage(window.__KOZU_V210__.store.document).entities.map(o=>({text:o.text,underline:o.textStyle.underline}))`)
      const beforeDoc=await evaluate(win,'window.__KOZU_V210__.store.document')
      await clickSelector(win,'[data-field="text-frame"]')
      const after=await evaluate(win,`window.KozuV210.activePage(window.__KOZU_V210__.store.document).entities.map(o=>({text:o.text,underline:o.textStyle.underline,frame:o.textStyle.frame}))`)
      assert(after.every((o,i)=>o.frame===true&&o.underline===before[i].underline),'枠だけを一括追加しても、各文字の下線設定まで統一されます',{before,after})
      await assertRoundtripAndUndo(win,beforeDoc)
      return {before,after}
    })
    await run('table-larger-text-keeps-rows-separated',async()=>{
      await evaluate(win,`(()=>{const api=window.__KOZU_V210__,K=window.KozuV210,d=K.createDocument(),t=K.addEntity(d,'lot-table',{position:{x:100,y:100},dynamic:false,snapshot:true,scale:1,rows:[{number:1,label:'あいうえお',area:100,tsubo:30},{number:2,label:'かきくけこ',area:200,tsubo:60}],style:{size:14,fontSize:14}});api.store.replace(d,{clean:true});api.activateCommand('select');api.selectObject(t.id,{openEditor:true});api.ui.contextPage='object-special';api.renderCommandSurface();api.render()})()`)
      await replaceText(win,'[data-field="text-size"]','3')
      await pressKey(win,'TAB')
      const draws=await evaluate(win,`(()=>{const api=window.__KOZU_V210__,p=CanvasRenderingContext2D.prototype,fn=p.fillText,result=[];p.fillText=function(text,x,y,...args){const m=this.measureText(text);if(['あいうえお','かきくけこ'].includes(String(text)))result.push({text,font:this.font,x,y,top:y-m.actualBoundingBoxAscent,bottom:y+m.actualBoundingBoxDescent});return fn.call(this,text,x,y,...args)};try{api.renderer.render()}finally{p.fillText=fn}return result})()`)
      assert(draws.length===2&&draws[0].bottom<=draws[1].top,'表の文字を大きくすると行高が追従せず、上下の文字が重なります',draws)
      return draws
    })
    await run('table-long-name-does-not-overlap-area-column',async()=>{
      const draws=await evaluate(win,`(()=>{const api=window.__KOZU_V210__,K=window.KozuV210,d=K.createDocument();K.addEntity(d,'lot-table',{position:{x:100,y:100},dynamic:false,snapshot:true,rows:[{number:1,label:'南側道路に面した広い分譲区画の名称',area:123.45,tsubo:37.34}],style:{size:14,fontSize:14}});api.store.replace(d,{clean:true});api.render();const p=CanvasRenderingContext2D.prototype,fn=p.fillText,result=[];p.fillText=function(text,x,y,...args){const m=this.measureText(text);if(String(text).startsWith('南側道路')||String(text)==='123.45㎡')result.push({text,x,y,left:x-m.actualBoundingBoxLeft,right:x+m.actualBoundingBoxRight,maxWidth:args[0]??null});return fn.call(this,text,x,y,...args)};try{api.renderer.render()}finally{p.fillText=fn}return result})()`)
      const name=draws.find(d=>d.text.startsWith('南側道路')),area=draws.find(d=>d.text==='123.45㎡'&&d.y===name?.y)
      assert(name&&area&&name.right<=area.left,'長い区画名が隣の面積欄まで描画され、数値と重なります',draws)
      return draws
    })
    await run('fixed-deleted-row-survives-adding-another-lot',async()=>{
      const f=await evaluate(win,`(()=>{const api=window.__KOZU_V210__,K=window.KozuV210,d=K.createDocument(),p=[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}],a=K.addShape(d,'lot',p,{price:900}),b=K.addShape(d,'lot',p.map(q=>({x:q.x+200,y:q.y})),{price:800}),t=K.addEntity(d,'lot-table',{position:{x:400,y:100},dynamic:false,snapshot:true,lotIds:[a.id],rows:[{lotId:a.id,number:1,price:900,area:10000,tsubo:3025}]});d.calibration.mpp=1;api.store.replace(d,{clean:true});api.activateCommand('select');api.selectObject(a.id,{openEditor:true});api.handleAction('delete-selected');api.selectObject(t.id,{openEditor:true});api.ui.contextPage='object-special';api.renderCommandSurface();api.render();return{table:t.id,deleted:a.id,newLot:b.id}})()`)
      const before=await evaluate(win,`window.KozuV210.objectById(window.__KOZU_V210__.store.document,${JSON.stringify(f.table)}).object.rows`)
      const beforeDoc=await evaluate(win,'window.__KOZU_V210__.store.document')
      await clickSelector(win,'[data-lot-table-id="'+f.newLot+'"]')
      const after=await evaluate(win,`window.KozuV210.objectById(window.__KOZU_V210__.store.document,${JSON.stringify(f.table)}).object.rows`)
      assert(after.some(r=>r.lotId===f.deleted&&r.price===900),'固定表に別区画を追加すると、削除済み区画の固定行が失われます',{before,after})
      await assertRoundtripAndUndo(win,beforeDoc)
      return {before,after}
    })
    await run('dimension-text-color-does-not-change-line-color',async()=>{
      const f=await evaluate(win,`(()=>{const api=window.__KOZU_V210__,K=window.KozuV210,d=K.createDocument();d.calibration.mpp=1;const e=K.addEntity(d,'distance',{points:[{x:100,y:100},{x:250,y:100}],style:{color:'#172033'},textStyle:{color:'#172033'},dimensionStyle:{color:'#172033'}});api.store.replace(d,{clean:true});api.activateCommand('select');api.selectObject(e.id,{openEditor:true});api.ui.contextPage='object-dimension';api.renderCommandSurface();api.render();return {id:e.id}})()`)
      const beforeDoc=await evaluate(win,'window.__KOZU_V210__.store.document')
      const options=await evaluate(win,`[...document.querySelector('[data-field="dimensionColor"]').options].map(o=>o.value)`)
      const color=options.find(v=>/^#[0-9a-f]{6}$/i.test(v)&&v.toLowerCase()!=='#172033')
      await clickSelector(win,'[data-color-control]:has([data-field="dimensionColor"]) [data-color-trigger]')
      await clickSelector(win,'[data-color-palette] [data-color-value="'+color+'"]')
      const after=await evaluate(win,`window.KozuV210.objectById(window.__KOZU_V210__.store.document,${JSON.stringify(f.id)}).object`)
      assert(after.dimensionStyle.color===color&&after.style.color==='#172033','寸法文字の色変更で線の色まで変わります',{chosen:color,lineColor:after.style.color,textColor:after.dimensionStyle.color})
      await assertRoundtripAndUndo(win,beforeDoc)
      return after
    })

    for (const width of [1440, 900]) await run(`text-target-buttons-and-value-source-${width}`, async () => {
      await evaluate(win, `(()=>{const api=window.__KOZU_V210__,K=window.KozuV210,d=K.createDocument();d.calibration.mpp=0.1;const lot=K.addShape(d,'lot',[{x:80,y:60},{x:500,y:60},{x:500,y:400},{x:80,y:400}],{label:'南側の区画',price:900,areaLabel:{text:'999㎡'},visibility:{area:true,tsubo:true,price:true,dimensions:false}});api.store.replace(d,{clean:true});api.activateCommand('select');api.selectObject(lot.id,{openEditor:true});api.ui.contextPage='object-text';api.runtime.view={x:30,y:30,zoom:1};api.renderCommandSurface();api.render()})()`)
      await clickSelector(win,'[data-text-role="area"]')
      const state=await evaluate(win,`(()=>{const api=window.__KOZU_V210__,buttons=[...document.querySelectorAll('[data-text-role]')];api.renderer.render();return{roles:buttons.map(b=>{const r=b.getBoundingClientRect();return{role:b.dataset.textRole,inside:r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight}}),pressed:document.querySelector('[data-text-role][aria-pressed=true]')?.dataset.textRole,state:document.querySelector('[data-value-source="area-label-text"]')?.textContent,overlay:api.renderer.overlay?.textRole,error:api.renderer.lastError?.stack,boxes:api.renderer.labelBoxes.map(b=>({kind:b.kind,polygon:b.polygon})),size:api.renderer.getSize(),view:api.view}})()`)
      assert(state.roles.length===6&&state.roles.every(b=>b.inside)&&state.pressed==='area','編集対象ボタンが狭い画面で使えません',state)
      assert(state.state.includes('手入力表示')&&state.state.includes('1428.00'),'手入力表示と計算値を区別できません',state)
      await evaluate(win,`window.__KOZU_V210__.fitView()`); await wait(win,200); await evaluate(win,`window.__KOZU_V210__.renderer.render()`); await wait(win,80)
      const renderState=await evaluate(win,`(()=>{const r=window.__KOZU_V210__.renderer;return{error:r.lastError?.stack,boxes:r.labelBoxes.length,size:r.getSize(),view:r.view}})()`);assert(!renderState.error&&renderState.boxes>0,'図面の描画に失敗しています',renderState)
      fs.mkdirSync(path.join(root,'output','usability-screens'),{recursive:true})
      fs.writeFileSync(path.join(root,'output','usability-screens',`text-${width}.png`),(await win.webContents.capturePage()).toPNG())
      const canvasImage=await evaluate(win,`document.getElementById('drawing-canvas').toDataURL('image/png').split(',')[1]`)
      fs.writeFileSync(path.join(root,'output','usability-screens',`text-canvas-${width}.png`),Buffer.from(canvasImage,'base64'))
      await clickSelector(win,'[data-action="reset-text-role-value"]')
      const automatic=await evaluate(win,`document.querySelector('[data-value-source="area-label-text"]')?.textContent`)
      assert(automatic.includes('自動表示'),'自動表示へ戻した状態が更新されません',automatic)
      await clickSelector(win,'[data-text-role="price"]')
      await replaceText(win,'[data-field="lot-price"]','1200')
      await pressKey(win,'TAB')
      const history=await evaluate(win,`(()=>{const api=window.__KOZU_V210__;return{label:api.store.undoStack.at(-1).label,title:document.querySelector('[data-action="undo"]').title,price:window.KozuV210.activePage(api.store.document).shapes[0].price}})()`)
      assert(history.price===1200&&history.label==='価格の変更'&&history.title.includes('価格の変更を戻す'),'戻す操作名が対象と一致しません',history)
      await evaluate(win,`window.__KOZU_V210__.handleAction('undo')`)
      assert(await evaluate(win,`window.KozuV210.activePage(window.__KOZU_V210__.store.document).shapes[0].price`)===900,'価格変更を取り消せません')
      await evaluate(win,`window.__KOZU_V210__.handleAction('redo')`)
      assert(await evaluate(win,`window.KozuV210.activePage(window.__KOZU_V210__.store.document).shapes[0].price`)===1200,'価格変更をやり直せません')
      return {state,automatic,history}
    }, {width,height:1000})

    await run('registry-column-choice-preserves-data-and-session',async()=>{
      await evaluate(win,`(()=>{const api=window.__KOZU_V210__,K=window.KozuV210,d=K.createDocument();d.calibration.mpp=.1;K.addShape(d,'lot',[{x:80,y:60},{x:300,y:60},{x:300,y:250},{x:80,y:250}],{label:'南側道路に面した区画',price:900,memo:'現地確認済み'});api.store.replace(d,{clean:true});api.activateCommand('select');api.render()})()`)
      await clickSelector(win,'#registry-options summary')
      await wait(win,150)
      const before=await evaluate(win,`JSON.stringify(window.__KOZU_V210__.store.document.pages)`)
      const height=await evaluate(win,`document.querySelector('#registry-rows tr').getBoundingClientRect().height`)
      for(const key of ['price','tsubo','memo']) await clickSelector(win,`[data-registry-column="${key}"]`)
      const after=await evaluate(win,`(()=>{const row=document.querySelector('#registry-rows tr');return{height:row.getBoundingClientRect().height,hidden:['price','tsubo','memo'].every(key=>getComputedStyle(row.querySelector('.col-'+key)).display==='none'),data:JSON.stringify(window.__KOZU_V210__.store.document.pages),dirty:window.__KOZU_V210__.store.dirty}})()`)
      fs.writeFileSync(path.join(root,'output','usability-screens','registry-debug.png'),(await win.webContents.capturePage()).toPNG())
      assert(after.hidden&&after.height<height&&after.data===before&&!after.dirty,'表示列変更でデータが変わるか空白行が残ります',{height,after})
      fs.writeFileSync(path.join(root,'output','usability-screens','registry-900.png'),(await win.webContents.capturePage()).toPNG())
      await evaluate(win,`window.__KOZU_V210__.render()`)
      await wait(win,180)
      const persisted=await evaluate(win,`[...document.querySelectorAll('[data-registry-column]')].every(el=>!el.checked)`)
      assert(persisted,'再描画で表示列が戻ります')
      return {height,afterHeight:after.height,persisted}
    },{width:900,height:1000})

    await run('fixed-table-status-and-mode-switch',async()=>{
      await evaluate(win,`(()=>{const api=window.__KOZU_V210__,K=window.KozuV210,d=K.createDocument(),t=K.addEntity(d,'lot-table',{position:{x:60,y:60},dynamic:false,snapshot:true,lotIds:['deleted-lot'],rows:[{lotId:'deleted-lot',number:1,label:'南側道路に面した広い分譲区画の名称',price:900,area:123.45,tsubo:37.34}],scale:1,options:{scale:1,mode:'snapshot'}});api.store.replace(d,{clean:true});api.activateCommand('select');api.selectObject(t.id,{openEditor:true});api.ui.contextPage='object-special';api.renderCommandSurface();api.render()})()`)
      const before=await evaluate(win,`document.querySelector('[data-table-source-state]').textContent`)
      assert(before.includes('現在値で固定')&&before.includes('削除された1行'),'削除済み区画の固定値の状態が表示されません',before)
      fs.writeFileSync(path.join(root,'output','usability-screens','fixed-table.png'),(await win.webContents.capturePage()).toPNG())
      await chooseSelect(win,'[data-field="table-mode"]','dynamic')
      const after=await evaluate(win,`document.querySelector('[data-table-source-state]').textContent`)
      assert(after.includes('自動更新')&&!after.includes('保持'),'更新方法を変えても状態表示が古いままです',after)
      return {before,after}
    })

    await run('distance-manual-text-shows-geometric-value',async()=>{
      await evaluate(win,`(()=>{const api=window.__KOZU_V210__,K=window.KozuV210,d=K.createDocument();d.calibration.mpp=.1;const e=K.addEntity(d,'distance',{points:[{x:60,y:60},{x:160,y:60}],text:'参考寸法'});api.store.replace(d,{clean:true});api.activateCommand('select');api.selectObject(e.id,{openEditor:true});api.ui.contextPage='object-text';api.renderCommandSurface();api.render()})()`)
      const state=await evaluate(win,`document.querySelector('[data-value-source="object-label"]')?.textContent`)
      assert(state?.includes('手入力表示')&&state.includes('10.00m'),'寸法の手入力と計算値の区別がありません',state)
      return state
    })
    await run('table-layout-bounds-follow-font-rows-and-rotation',async()=>{
      const result=await evaluate(win,`(()=>{const api=window.__KOZU_V210__,K=window.KozuV210,d=K.createDocument(),t=K.addEntity(d,'lot-table',{position:{x:80,y:80},rotation:30,dynamic:false,snapshot:true,rows:Array.from({length:9},(_,i)=>({number:i+1,label:'道路沿いの長い名称\\n2行目',area:1234.56,price:1234567})),textStyle:{fontSize:42,size:42}});api.store.replace(d,{clean:true});api.render();api.renderer.render();const box=api.renderer.labelBoxes.find(b=>b.ownerId===t.id),bounds=api.renderer.computeObjectBounds(t,d);return{polygon:box.worldPolygon,bounds,error:api.renderer.lastError?.message}})()`)
      assert(!result.error&&result.polygon.every(p=>p.x>=result.bounds.minX-.01&&p.x<=result.bounds.maxX+.01&&p.y>=result.bounds.minY-.01&&p.y<=result.bounds.maxY+.01),'拡大した表が全体表示・出力範囲からはみ出します',result)
      return result
    })
    await run('legacy-fixed-rows-without-selection-or-source-survive-edits',async()=>{
      const f=await evaluate(win,`(()=>{const api=window.__KOZU_V210__,K=window.KozuV210,d=K.createDocument(),lot=K.addShape(d,'lot',[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}],{label:'追加区画'}),t=K.addEntity(d,'lot-table',{position:{x:200,y:100},dynamic:false,snapshot:true,rows:[{lotId:'deleted',label:'削除済み固定行',price:900},{label:'旧形式の固定行',price:800}],scale:1,options:{scale:1,mode:'snapshot'}});api.store.replace(d,{clean:true});api.activateCommand('select');api.selectObject(t.id,{openEditor:true});api.ui.contextPage='object-special';api.renderCommandSurface();api.render();return{lot:lot.id,table:t.id}})()`)
      await clickSelector(win,'[data-lot-table-id="'+f.lot+'"]')
      await clickSelector(win,'[data-lot-table-id="'+f.lot+'"]')
      const rows=await evaluate(win,`window.KozuV210.objectById(window.__KOZU_V210__.store.document,${JSON.stringify(f.table)}).object.rows`)
      assert(rows.length===3&&rows.some(r=>r.label==='削除済み固定行'&&r.price===900)&&rows.some(r=>r.label==='旧形式の固定行'&&r.price===800)&&rows.some(r=>r.lotId===f.lot),'旧形式の固定表を編集すると既存行が失われます',rows)
      return rows
    })
    checks.push({ name: 'electron-renderer-console-errors' , pass: consoleErrors.length === 0, details: consoleErrors })
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
