const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = __dirname
const packageVersion = require('./package.json').version
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

function runPreload() {
  let exposed = null
  vm.runInNewContext(read('preload-v210.js'), {
    require(request) {
      if (request === 'electron') {
        return {
          contextBridge: { exposeInMainWorld(_name, value) { exposed = value } },
          ipcRenderer: { on() {}, removeListener() {}, send() {}, invoke() {} }
        }
      }
      if (request === './package.json') return { version: packageVersion }
      throw new Error(`unexpected require: ${request}`)
    }
  })
  return exposed
}

function browserSandbox(desktopVersion) {
  const versionNode = { textContent: '' }
  const document = {
    title: '',
    querySelectorAll(selector) { return selector === '[data-app-version]' ? [versionNode] : [] }
  }
  const window = { document }
  if (desktopVersion) window.kozuDesktop = { version: desktopVersion }
  window.window = window
  const sandbox = { window, structuredClone: global.structuredClone, console }
  vm.createContext(sandbox)
  vm.runInContext(read('v210/core.js'), sandbox)
  vm.runInContext(read('v210/io.js'), sandbox)
  return { window, versionNode }
}

const mainSource = read('main-v210.js')
assert.match(mainSource, /const VERSION = app\.getVersion\(\)/)
assert.doesNotMatch(mainSource, /const VERSION = ['"]2\.1\.0/)

const desktop = runPreload()
assert.equal(desktop.version, packageVersion)

const electronBrowser = browserSandbox(packageVersion)
assert.equal(electronBrowser.window.KozuV210.APP_VERSION, packageVersion)
assert.equal(electronBrowser.window.KozuV210.IO.APP_VERSION, packageVersion)
assert.equal(electronBrowser.window.document.title, `土地区画作成工房 v${packageVersion}`)
assert.equal(electronBrowser.versionNode.textContent, `v${packageVersion}`)
const saved = JSON.parse(electronBrowser.window.KozuV210.IO.serializeProject(electronBrowser.window.KozuV210.createDocument()))
assert.equal(saved.appVersion, packageVersion)
assert.equal(saved.document.appVersion, packageVersion)

const webBrowser = browserSandbox()
assert.equal(webBrowser.window.KozuV210.APP_VERSION, packageVersion)
assert.equal(webBrowser.window.KozuV210.IO.APP_VERSION, packageVersion)
assert.equal(webBrowser.versionNode.textContent, `v${packageVersion}`)

assert.doesNotMatch(read('index-v210.html'), /2\.1\.0-alpha\./)
process.stdout.write(`v210 version consistency: ${packageVersion} (Electron + Web fallback)\n`)
