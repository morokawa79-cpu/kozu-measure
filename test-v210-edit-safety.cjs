'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

// This suite uses an isolated, hidden Electron window and in-memory fixtures.
// No user project or release output is opened or written.
if (!process.versions.electron) {
  const result = spawnSync(require('electron'), [__filename], {
    cwd: __dirname, stdio: 'inherit', windowsHide: true
  })
  process.exitCode = result.status ?? 1
} else {
  run().catch(error => {
    console.error(error.stack || error)
    process.exit(1)
  })
}

async function run() {
  const { app, BrowserWindow } = require('electron')
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kozu-edit-safety-'))
  app.setPath('userData', path.join(temporaryRoot, 'userData'))
  app.setPath('sessionData', path.join(temporaryRoot, 'sessionData'))
  app.disableHardwareAcceleration()
  await app.whenReady()
  const win = new BrowserWindow({
    show: false, width: 1440, height: 900,
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
      preload: path.join(__dirname, 'preload-v210.js')
    }
  })
  const evaluate = async (callback, ...args) => {
    const result = await win.webContents.executeJavaScript(`(async () => {
      try { return { value: await (${callback.toString()})(...${JSON.stringify(args)}) } }
      catch (error) { return { error: error.stack || String(error) } }
    })()`, true)
    if (result.error) throw new Error(result.error)
    return result.value
  }
  const settle = () => evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  let passed = 0

  async function fixture(kind = 'lot', zoom = 1) {
    await win.loadFile(path.join(__dirname, 'index-v210.html'))
    await settle()
    const ids = await evaluate((kind, zoom) => {
      const api = window.__KOZU_V210__
      const K = window.KozuV210
      const model = K.createDocument()
      model.calibration = { ...model.calibration, mpp: 0.1, mapScale: 500 }
      K.activePage(model).calibration = { ...model.calibration }
      model.preferences.snap = { vertex: false, intersection: false, edge: false, grid: false }
      const objects = [0, 1].map(index => {
        const x = 200 + index * 330
        if (kind === 'text') return K.addEntity(model, 'text', {
          position: { x, y: 220 }, text: `注記${index + 1}`, memo: `備考${index + 1}`,
          style: { fontSize: 20, size: 20, color: '#172033' }
        })
        return K.addShape(model, kind, [
          { x, y: 120 }, { x: x + 240, y: 120 }, { x: x + 240, y: 360 }, { x, y: 360 }
        ], {
          number: index + 1, label: `区画${index + 1}`, price: 1000 + index,
          topLabel: `上部${index + 1}`, memo: `備考${index + 1}`,
          labelStyle: { fontSize: 20, size: 20 },
          visibility: { area: false, tsubo: false, dimensions: true }
        })
      })
      api.store.replace(model)
      api.activateCommand('select')
      api.runtime.view = { x: 40, y: 30, zoom }
      api.render()
      return objects.map(object => String(object.id))
    }, kind, zoom)
    await settle()
    return ids
  }

  async function select(ids) {
    await evaluate(ids => {
      const api = window.__KOZU_V210__
      api.ui.registryIds = new Set(ids)
      api.handleAction('registry-focus')
    }, ids)
    await settle()
  }

  async function editField(name, value) {
    await evaluate((name, value) => {
      const api = window.__KOZU_V210__
      let field
      for (const page of ['object-text', 'object-basic', 'object-appearance', 'object-record']) {
        api.ui.contextPage = page
        api.renderCommandSurface()
        field = document.querySelector(`#command-controls [data-field="${name}"]`)
        if (field && !field.disabled && (field.closest('label') || field).getClientRects().length) break
        field = null
      }
      if (!field) throw new Error(`Editable field not found: ${name}`)
      field.value = String(value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
      field.dispatchEvent(new Event('change', { bubbles: true }))
    }, name, value)
    await settle()
  }

  const state = () => evaluate(() => {
    const api = window.__KOZU_V210__
    const active = window.KozuV210.activePage(api.document)
    return {
      objects: [...active.shapes, ...active.entities],
      document: JSON.stringify(api.document),
      undo: api.store.undoStack.length, dirty: api.store.dirty
    }
  })

  async function check(name, callback) {
    await callback()
    passed++
    console.log(`PASS ${name}`)
  }

  try {
    for (const kind of ['lot', 'text']) {
      await check(`${kind}: single content edit and undo`, async () => {
        const ids = await fixture(kind)
        await select([ids[0]])
        const before = await state()
        await editField('object-label', '単一変更')
        const after = await state()
        assert.equal(after.objects[0][kind === 'lot' ? 'label' : 'text'], '単一変更')
        assert.deepEqual(after.objects[1], before.objects[1])
        assert.equal(after.undo, 1)
        await evaluate(() => window.__KOZU_V210__.undo())
        assert.deepEqual((await state()).objects, before.objects)
      })

      await check(`${kind}: batch content is protected while formatting and undo work`, async () => {
        const ids = await fixture(kind)
        await select(ids)
        const before = await state()
        const exposed = await evaluate(() => {
          const api = window.__KOZU_V210__
          const fields = ['lot-number', 'object-label', 'lot-top-label', 'lot-price', 'object-memo']
          const exposed = []
          for (const page of ['object-basic', 'object-text', 'object-record']) {
            api.ui.contextPage = page
            api.renderCommandSurface()
            for (const name of fields) {
              const field = document.querySelector(`#command-controls [data-field="${name}"]`)
              if (field && !field.disabled && field.getClientRects().length) exposed.push(`${page}:${name}`)
            }
          }
          // A delayed field event must not bypass the batch-content restriction.
          api.ui.contextPage = 'object-basic'
          api.renderCommandSurface()
          for (const name of fields) {
            const field = document.createElement('input')
            field.dataset.field = name
            field.value = '999'
            document.getElementById('command-controls').append(field)
            field.dispatchEvent(new Event('change', { bubbles: true }))
            field.remove()
          }
          return exposed
        })
        assert.deepEqual(exposed, [])
        assert.deepEqual((await state()).objects, before.objects)
        assert.equal((await state()).undo, 0)
        await editField('textColor', '#b4232d')
        const after = await state()
        for (let index = 0; index < after.objects.length; index++) {
          const object = after.objects[index]
          const style = kind === 'lot' ? object.labelStyle : object.textStyle
          assert.equal(kind === 'lot' ? style.attributeColors?.name : style.color, '#b4232d')
          for (const key of ['label', 'text', 'number', 'price', 'memo', 'topLabel']) {
            assert.equal(object[key], before.objects[index][key])
          }
        }
        assert.equal(after.undo, 1)
        await evaluate(() => window.__KOZU_V210__.undo())
        assert.deepEqual((await state()).objects, before.objects)
      })
    }

    for (const scenario of [
      { kind: 'text', labelKind: 'entity-label', zoom: 0.5 },
      { kind: 'text', labelKind: 'entity-label', zoom: 2 },
      { kind: 'lot', labelKind: 'shape-label', zoom: 1 },
      { kind: 'lot', labelKind: 'shape-dimension', zoom: 1 }
    ]) {
      await check(`${scenario.labelKind} at zoom ${scenario.zoom}: CSS-pixel drag threshold and undo`, async () => {
        const ids = await fixture(scenario.kind, scenario.zoom)
        await select([ids[0]])
        if (scenario.labelKind === 'shape-dimension') {
          await evaluate(() => {
            const api = window.__KOZU_V210__
            api.ui.contextPage = 'object-dimension'
            api.renderCommandSurface()
            api.render()
          })
          await settle()
        }
        const point = await evaluate((id, labelKind) => {
          const api = window.__KOZU_V210__
          const box = api.renderer.labelBoxes.find(box => String(box.ownerId) === id && box.kind === labelKind)
          if (!box) throw new Error(`Rendered label not found: ${labelKind}`)
          const rect = document.getElementById('drawing-canvas').getBoundingClientRect()
          return { x: Math.round(rect.x + box.x + box.width / 2), y: Math.round(rect.y + box.y + box.height / 2) }
        }, ids[0], scenario.labelKind)
        const before = await state()
        const drag = async distance => {
          win.webContents.sendInputEvent({ type: 'mouseMove', ...point })
          win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
          await settle()
          assert.equal(await evaluate(() => window.__KOZU_V210__.runtime.drag?.type), 'label')
          win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x + distance, y: point.y, button: 'left' })
          await settle()
          win.webContents.sendInputEvent({ type: 'mouseUp', x: point.x + distance, y: point.y, button: 'left', clickCount: 1 })
          await settle()
        }
        await drag(1)
        assert.deepEqual(await state(), before, '1 CSS px must change neither document nor history')
        await drag(4)
        const after = await state()
        assert.notDeepEqual(after.objects[0], before.objects[0])
        assert.equal(after.undo, before.undo + 1)
        assert.equal(after.dirty, true)
        await evaluate(() => window.__KOZU_V210__.undo())
        assert.deepEqual((await state()).objects, before.objects)
        assert.equal((await state()).dirty, false)
      })
    }
    console.log(`v210 edit safety regression: ${passed}/${passed} PASS`)
  } finally {
    win.destroy()
  }
  // Avoid the Electron 36 Windows graceful-shutdown regression in QA processes.
  process.exit(0)
}
