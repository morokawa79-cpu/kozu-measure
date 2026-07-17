const { app, BrowserWindow, dialog, ipcMain, protocol, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

const VERSION = '2.1.0-alpha.8'
const TITLE = `土地区画作成工房 v${VERSION}`
const APP_ID = 'com.fmoro.kozu-measure.v210'
const dataRoot = path.join(app.getPath('appData'), 'FMoro', 'KozuMeasureV210')

fs.mkdirSync(dataRoot, { recursive: true })
app.setPath('userData', dataRoot)
app.setPath('sessionData', path.join(dataRoot, 'Session'))
app.setAppUserModelId(APP_ID)

protocol.registerSchemesAsPrivileged([
  { scheme: 'pdfres', privileges: { secure: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true } }
])

function uniqueDownloadPath(requested, extension) {
  const fallback = `kozu-${new Date().toISOString().slice(0, 10)}${extension}`
  let fileName = path.basename(typeof requested === 'string' && requested ? requested : fallback)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
  if (!fileName.toLowerCase().endsWith(extension)) fileName += extension
  const parsed = path.parse(fileName)
  let target = path.join(app.getPath('downloads'), fileName)
  let suffix = 2
  while (fs.existsSync(target)) {
    target = path.join(app.getPath('downloads'), `${parsed.name}-${suffix}${extension}`)
    suffix += 1
  }
  return target
}

function safeOutputName(requested, fallback, extension) {
  let fileName = path.basename(typeof requested === 'string' && requested ? requested : fallback)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
  if (!fileName.toLowerCase().endsWith(extension)) fileName += extension
  return fileName
}

async function chooseOutputPath(owner, payload, options) {
  if (typeof payload.outputPath === 'string' && path.isAbsolute(payload.outputPath)) {
    return payload.outputPath.toLowerCase().endsWith(options.extension)
      ? payload.outputPath
      : `${payload.outputPath}${options.extension}`
  }
  const fileName = safeOutputName(payload.fileName, options.fallback, options.extension)
  const selection = await dialog.showSaveDialog(owner, {
    title: options.title,
    defaultPath: path.join(app.getPath('documents'), fileName),
    filters: [{ name: options.filterName, extensions: [options.extension.slice(1)] }],
    properties: ['showOverwriteConfirmation', 'createDirectory']
  })
  return selection.canceled || !selection.filePath ? null : (selection.filePath.toLowerCase().endsWith(options.extension) ? selection.filePath : `${selection.filePath}${options.extension}`)
}

async function waitForAssets(window) {
  await window.webContents.executeJavaScript(`
    Promise.all([
      document.fonts ? document.fonts.ready : Promise.resolve(),
      ...Array.from(document.images).map(image => image.complete
        ? Promise.resolve()
        : new Promise(resolve => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
          }))
    ]).then(() => true)
  `)
}

async function withOutputWindow(owner, html, callback) {
  if (typeof html !== 'string' || !html.trim()) throw new Error('出力データが空です')
  const folder = path.join(os.tmpdir(), 'kozu-measure-v210')
  fs.mkdirSync(folder, { recursive: true })
  const file = path.join(folder, `output-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
  const outputWindow = new BrowserWindow({
    show: false,
    parent: owner || undefined,
    width: 1200,
    height: 900,
    backgroundColor: '#ffffff',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false }
  })
  try {
    await fs.promises.writeFile(file, html, 'utf8')
    await outputWindow.loadFile(file)
    outputWindow.webContents.setZoomFactor(1)
    await waitForAssets(outputWindow)
    return await callback(outputWindow)
  } finally {
    if (!outputWindow.isDestroyed()) outputWindow.destroy()
    fs.promises.unlink(file).catch(() => {})
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: TITLE,
    backgroundColor: '#eef1f5',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      preload: path.join(__dirname, 'preload-v210.js')
    }
  })

  let closeState = 'idle'
  win.loadFile('index-v210.html')
  win.on('focus', () => { if (!win.webContents.isDestroyed()) win.webContents.focus() })
  win.on('close', event => {
    if (closeState === 'approved') return
    event.preventDefault()
    if (closeState !== 'idle') return
    closeState = 'waiting'
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send('app-close-requested')
  })

  const onCloseResponse = (event, action) => {
    if (event.sender !== win.webContents || closeState !== 'waiting') return
    if (action === 'cancel') { closeState = 'idle'; return }
    if (action === 'save') { closeState = 'saving'; win.webContents.send('app-save-before-close'); return }
    if (action === 'discard') { closeState = 'approved'; win.close() }
  }
  const onSaveComplete = (event, success) => {
    if (event.sender !== win.webContents || !['waiting', 'saving'].includes(closeState)) return
    if (success) { closeState = 'approved'; win.close() }
    else closeState = 'idle'
  }
  ipcMain.on('app-close-response', onCloseResponse)
  ipcMain.on('app-save-complete', onSaveComplete)
  win.on('closed', () => {
    ipcMain.removeListener('app-close-response', onCloseResponse)
    ipcMain.removeListener('app-save-complete', onSaveComplete)
  })
  return win
}

ipcMain.handle('save-project-before-close', async (event, payload = {}) => {
  if (typeof payload.contents !== 'string' || !payload.contents) throw new Error('保存する作業データが空です')
  const target = uniqueDownloadPath(payload.fileName, '.json')
  await fs.promises.writeFile(target, payload.contents, 'utf8')
  return { path: target, fileName: path.basename(target) }
})

ipcMain.handle('save-project-v210', async (event, payload = {}) => {
  if (typeof payload.contents !== 'string' || !payload.contents) throw new Error('保存する編集データが空です')
  const owner = BrowserWindow.fromWebContents(event.sender)
  const target = await chooseOutputPath(owner, payload, {
    title: '編集データを保存する', fallback: 'kozu-project.kozu.json', extension: '.json', filterName: '区画作成工房 編集データ'
  })
  if (!target) return { success: false, canceled: true }
  await fs.promises.writeFile(target, payload.contents, 'utf8')
  return { success: true, canceled: false, path: target, fileName: path.basename(target) }
})

ipcMain.handle('export-png-v210', async (event, payload = {}) => {
  const bytes = payload.bytes instanceof Uint8Array ? payload.bytes : null
  if (!bytes?.byteLength) throw new Error('保存するPNGデータが空です')
  const owner = BrowserWindow.fromWebContents(event.sender)
  const target = await chooseOutputPath(owner, payload, {
    title: 'PNG画像を書き出す', fallback: '区画図.png', extension: '.png', filterName: 'PNG画像'
  })
  if (!target) return { success: false, canceled: true }
  await fs.promises.writeFile(target, Buffer.from(bytes))
  if (payload.reveal !== false) shell.showItemInFolder(target)
  return { success: true, canceled: false, path: target, fileName: path.basename(target) }
})

ipcMain.handle('print-drawing-v210', async (event, payload = {}) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  return withOutputWindow(owner, payload.html, outputWindow => new Promise((resolve, reject) => {
    outputWindow.webContents.print({
      silent: false,
      printBackground: true,
      color: true,
      pageSize: payload.pageSize === 'A3' ? 'A3' : 'A4',
      landscape: payload.landscape !== false,
      margins: { marginType: 'none' },
      scaleFactor: 100
    }, (success, failureReason) => {
      if (!success && failureReason !== 'Print job canceled') reject(new Error(failureReason || '印刷できませんでした'))
      else resolve({ success, canceled: !success })
    })
  }))
})

ipcMain.handle('export-pdf-v210', async (event, payload = {}) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  const buffer = await withOutputWindow(owner, payload.html, outputWindow => outputWindow.webContents.printToPDF({
    printBackground: true,
    landscape: payload.landscape !== false,
    pageSize: payload.pageSize === 'A3' ? 'A3' : 'A4',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    preferCSSPageSize: true
  }))
  const target = await chooseOutputPath(owner, payload, {
    title: 'PDFを書き出す', fallback: '区画図.pdf', extension: '.pdf', filterName: 'PDF文書'
  })
  if (!target) return { success: false, canceled: true }
  await fs.promises.writeFile(target, buffer)
  if (payload.reveal !== false) shell.showItemInFolder(target)
  return { success: true, canceled: false, path: target, fileName: path.basename(target) }
})

ipcMain.handle('show-output-file-v210', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return false
  shell.showItemInFolder(filePath)
  return true
})

app.whenReady().then(() => {
  protocol.handle('pdfres', request => {
    const url = new URL(request.url)
    const root = app.isPackaged
      ? path.join(process.resourcesPath, url.host === 'cmaps' ? 'cmaps' : 'standard_fonts')
      : path.join(__dirname, 'node_modules', 'pdfjs-dist', url.host === 'cmaps' ? 'cmaps' : 'standard_fonts')
    const safeName = path.basename(url.pathname)
    try {
      return new Response(fs.readFileSync(path.join(root, safeName)), { headers: { 'Content-Type': 'application/octet-stream' } })
    } catch (_) {
      return new Response('not found', { status: 404 })
    }
  })
  createWindow()
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
