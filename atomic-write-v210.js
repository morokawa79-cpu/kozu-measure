const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const WINDOWS_RENAME_RETRY_CODES = new Set(['EACCES', 'EBUSY', 'EPERM'])
const WINDOWS_RENAME_RETRY_DELAYS_MS = [20, 60, 140]

function temporaryPathFor(target) {
  const token = `${process.pid}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`
  return path.join(path.dirname(target), `.${path.basename(target)}.${token}.tmp`)
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function replaceFile(source, target, options = {}) {
  const fileSystem = options.fileSystem || fs.promises
  const platform = options.platform || process.platform
  const retryDelays = options.retryDelays || WINDOWS_RENAME_RETRY_DELAYS_MS
  const waitForRetry = options.waitForRetry || wait
  let attempt = 0

  while (true) {
    try {
      await fileSystem.rename(source, target)
      return
    } catch (error) {
      const retryable = platform === 'win32' && WINDOWS_RENAME_RETRY_CODES.has(error?.code)
      if (!retryable || attempt >= retryDelays.length) throw error
      await waitForRetry(retryDelays[attempt])
      attempt += 1
    }
  }
}

async function atomicWriteFile(target, contents, options = {}) {
  const fileSystem = options.fileSystem || fs.promises
  const tempPath = options.tempPath || temporaryPathFor(target)
  let handle = null
  let tempCreated = false
  let replaced = false
  let operationError = null
  let cleanupError = null

  try {
    handle = await fileSystem.open(tempPath, 'wx', 0o666)
    tempCreated = true
    await handle.writeFile(contents, options.encoding || 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await replaceFile(tempPath, target, {
      fileSystem,
      platform: options.platform,
      retryDelays: options.retryDelays,
      waitForRetry: options.waitForRetry
    })
    replaced = true
  } catch (error) {
    operationError = error
  } finally {
    if (handle) {
      try { await handle.close() } catch (error) { cleanupError ||= error }
    }
    if (tempCreated && !replaced) {
      try {
        await fileSystem.unlink(tempPath)
      } catch (error) {
        if (error?.code !== 'ENOENT') cleanupError ||= error
      }
    }
  }

  if (operationError) {
    if (cleanupError && operationError.cause == null) operationError.cause = cleanupError
    throw operationError
  }
  if (cleanupError) throw cleanupError
}

module.exports = { atomicWriteFile, replaceFile, temporaryPathFor }
