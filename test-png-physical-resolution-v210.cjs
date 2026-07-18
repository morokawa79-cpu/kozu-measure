'use strict'

const assert = require('assert')
const zlib = require('zlib')
const {
  PNG_PIXELS_PER_METRE_300_DPI,
  setPngPhysicalResolution300Dpi
} = require('./png-physical-resolution-v210')

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function independentCrc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function makeChunk(type, data = Buffer.alloc(0)) {
  const chunk = Buffer.alloc(data.length + 12)
  chunk.writeUInt32BE(data.length, 0)
  chunk.write(type, 4, 4, 'ascii')
  data.copy(chunk, 8)
  chunk.writeUInt32BE(independentCrc32(chunk.subarray(4, 8 + data.length)), 8 + data.length)
  return chunk
}

function makePhysicalData(pixelsPerMetre) {
  const data = Buffer.alloc(9)
  data.writeUInt32BE(pixelsPerMetre, 0)
  data.writeUInt32BE(pixelsPerMetre, 4)
  data[8] = 1
  return data
}

function makePng(physicalData = null) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const idat = zlib.deflateSync(Buffer.from([0, 0x12, 0x34, 0x56, 0xff]))
  return Buffer.concat([
    SIGNATURE,
    makeChunk('IHDR', ihdr),
    ...(physicalData ? [makeChunk('pHYs', physicalData)] : []),
    makeChunk('IDAT', idat),
    makeChunk('IEND')
  ])
}

function parseChunks(bytes) {
  assert(bytes.subarray(0, 8).equals(SIGNATURE), 'PNG署名が保持されている')
  const chunks = []
  let offset = 8
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const dataEnd = offset + 8 + length
    const storedCrc = bytes.readUInt32BE(dataEnd)
    const actualCrc = independentCrc32(bytes.subarray(offset + 4, dataEnd))
    assert.strictEqual(storedCrc, actualCrc, `${type}チャンクのCRCが正しい`)
    chunks.push({ type, data: bytes.subarray(offset + 8, dataEnd), raw: bytes.subarray(offset, dataEnd + 4) })
    offset = dataEnd + 4
  }
  assert.strictEqual(offset, bytes.length, 'すべてのチャンクを解析できる')
  return chunks
}

assert.strictEqual(PNG_PIXELS_PER_METRE_300_DPI, 11811, '300dpiは11811 pixels per metre')

const source = makePng()
const sourceSnapshot = Buffer.from(source)
const sourceChunks = parseChunks(source)
const inserted = setPngPhysicalResolution300Dpi(source)
const insertedChunks = parseChunks(inserted)
assert(source.equals(sourceSnapshot), '入力PNGを変更しない')
assert.deepStrictEqual(insertedChunks.map(chunk => chunk.type), ['IHDR', 'pHYs', 'IDAT', 'IEND'], 'pHYsをIHDR直後へ挿入する')
assert.strictEqual(insertedChunks[1].data.readUInt32BE(0), 11811, '水平解像度が11811')
assert.strictEqual(insertedChunks[1].data.readUInt32BE(4), 11811, '垂直解像度が11811')
assert.strictEqual(insertedChunks[1].data[8], 1, '解像度単位がmetre')
assert.strictEqual(insertedChunks[1].raw.readUInt32BE(insertedChunks[1].raw.length - 4), 0x78a53f76, 'pHYsの既知CRCが正しい')
assert(insertedChunks.find(chunk => chunk.type === 'IDAT').raw.equals(sourceChunks.find(chunk => chunk.type === 'IDAT').raw), 'IDAT画素データを変更しない')

const existing = makePng(makePhysicalData(2835))
const existingChunks = parseChunks(existing)
const replacedChunks = parseChunks(setPngPhysicalResolution300Dpi(existing))
assert.deepStrictEqual(replacedChunks.map(chunk => chunk.type), existingChunks.map(chunk => chunk.type), '既存pHYsを重複させず置換する')
assert.strictEqual(replacedChunks.filter(chunk => chunk.type === 'pHYs').length, 1, 'pHYsは1個だけ')
assert.strictEqual(replacedChunks.find(chunk => chunk.type === 'pHYs').data.readUInt32BE(0), 11811, '既存pHYsの値を置換する')
assert(replacedChunks.find(chunk => chunk.type === 'IDAT').raw.equals(existingChunks.find(chunk => chunk.type === 'IDAT').raw), '置換時もIDAT画素データを変更しない')

assert.throws(() => setPngPhysicalResolution300Dpi(Buffer.from('not png')), /PNGデータが不正です: PNG署名/)
assert.throws(() => setPngPhysicalResolution300Dpi(source.subarray(0, source.length - 2)), /PNGデータが不正です:/)
const badCrc = Buffer.from(source)
badCrc[badCrc.length - 1] ^= 0x01
assert.throws(() => setPngPhysicalResolution300Dpi(badCrc), /PNGデータが不正です: IENDチャンクのCRC/)

console.log('PNG 300dpi metadata: signature, CRC, insert, replace, invalid input, 11811 passed')
