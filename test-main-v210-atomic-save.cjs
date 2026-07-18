const assert = require('assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { atomicWriteFile } = require('./atomic-write-v210')

async function filesIn(folder) {
  return (await fs.promises.readdir(folder)).sort()
}

async function run() {
  const folder = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kozu-atomic-save-'))
  try {
    const target = path.join(folder, 'project.kozu.json')
    await fs.promises.writeFile(target, 'old project', 'utf8')

    await atomicWriteFile(target, 'new project', { encoding: 'utf8' })
    assert.equal(await fs.promises.readFile(target, 'utf8'), 'new project')
    assert.deepEqual(await filesIn(folder), ['project.kozu.json'])

    await fs.promises.writeFile(target, 'old project kept', 'utf8')
    let renameAttempts = 0
    const failingFileSystem = {
      open: fs.promises.open.bind(fs.promises),
      unlink: fs.promises.unlink.bind(fs.promises),
      rename: async () => {
        renameAttempts += 1
        const error = new Error('target is locked')
        error.code = 'EPERM'
        throw error
      }
    }
    await assert.rejects(
      atomicWriteFile(target, 'must not replace', {
        encoding: 'utf8',
        fileSystem: failingFileSystem,
        platform: 'win32',
        retryDelays: [0, 0],
        waitForRetry: async () => {}
      }),
      error => error?.code === 'EPERM'
    )
    assert.equal(renameAttempts, 3)
    assert.equal(await fs.promises.readFile(target, 'utf8'), 'old project kept')
    assert.deepEqual(await filesIn(folder), ['project.kozu.json'])

    const syncFailingFileSystem = {
      open: async (...args) => {
        const handle = await fs.promises.open(...args)
        return {
          writeFile: handle.writeFile.bind(handle),
          sync: async () => {
            const error = new Error('sync failed')
            error.code = 'EIO'
            throw error
          },
          close: handle.close.bind(handle)
        }
      },
      unlink: fs.promises.unlink.bind(fs.promises),
      rename: fs.promises.rename.bind(fs.promises)
    }
    await assert.rejects(
      atomicWriteFile(target, 'unsynced project', { fileSystem: syncFailingFileSystem }),
      error => error?.code === 'EIO'
    )
    assert.equal(await fs.promises.readFile(target, 'utf8'), 'old project kept')
    assert.deepEqual(await filesIn(folder), ['project.kozu.json'])

    let transientAttempts = 0
    const retryingFileSystem = {
      open: fs.promises.open.bind(fs.promises),
      unlink: fs.promises.unlink.bind(fs.promises),
      rename: async (source, destination) => {
        transientAttempts += 1
        if (transientAttempts < 3) {
          const error = new Error('temporary lock')
          error.code = 'EBUSY'
          throw error
        }
        await fs.promises.rename(source, destination)
      }
    }
    await atomicWriteFile(target, 'after retry', {
      encoding: 'utf8',
      fileSystem: retryingFileSystem,
      platform: 'win32',
      retryDelays: [0, 0],
      waitForRetry: async () => {}
    })
    assert.equal(transientAttempts, 3)
    assert.equal(await fs.promises.readFile(target, 'utf8'), 'after retry')
    assert.deepEqual(await filesIn(folder), ['project.kozu.json'])

    const order = []
    const orderedFileSystem = {
      open: async () => {
        order.push('open')
        return {
          writeFile: async () => { order.push('write') },
          sync: async () => { order.push('sync') },
          close: async () => { order.push('close') }
        }
      },
      rename: async () => { order.push('rename') },
      unlink: async () => { order.push('unlink') }
    }
    await atomicWriteFile(target, 'ordered write', {
      fileSystem: orderedFileSystem,
      tempPath: path.join(folder, '.ordered.tmp'),
      platform: 'win32'
    })
    assert.deepEqual(order, ['open', 'write', 'sync', 'close', 'rename'])

    process.stdout.write('main-v210 atomic save: 5 checks passed\n')
  } finally {
    await fs.promises.rm(folder, { recursive: true, force: true })
  }
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
