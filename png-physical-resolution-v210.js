'use strict'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_PIXELS_PER_METRE_300_DPI = Math.round(300 / 0.0254)

const CRC_TABLE = new Uint32Array(256)
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
  }
  CRC_TABLE[index] = value >>> 0
}

function pngError(reason) {
  return new Error(`PNGデータが不正です: ${reason}`)
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function isChunkType(bytes) {
  return bytes.length === 4 && [...bytes].every(byte =>
    (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a))
}

function validateIhdr(source, chunk) {
  if (chunk.length !== 13) throw pngError('IHDRチャンクの長さが13バイトではありません')
  const offset = chunk.dataStart
  const width = source.readUInt32BE(offset)
  const height = source.readUInt32BE(offset + 4)
  const bitDepth = source[offset + 8]
  const colorType = source[offset + 9]
  const validBitDepths = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16]
  }

  if (!width || !height) throw pngError('IHDRチャンクの画像サイズが0です')
  if (!validBitDepths[colorType]?.includes(bitDepth)) throw pngError('IHDRチャンクの色形式が不正です')
  if (source[offset + 10] !== 0) throw pngError('IHDRチャンクの圧縮方式が不正です')
  if (source[offset + 11] !== 0) throw pngError('IHDRチャンクのフィルター方式が不正です')
  if (source[offset + 12] > 1) throw pngError('IHDRチャンクのインターレース方式が不正です')
}

function parsePngChunks(source) {
  if (source.length < PNG_SIGNATURE.length || !source.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw pngError('PNG署名がありません')
  }

  const chunks = []
  let offset = PNG_SIGNATURE.length
  let sawIdat = false
  let sawIend = false

  while (offset < source.length) {
    if (sawIend) throw pngError('IENDチャンクの後ろに余分なデータがあります')
    if (source.length - offset < 12) throw pngError('チャンクが途中で切れています')

    const length = source.readUInt32BE(offset)
    if (length > source.length - offset - 12) throw pngError('チャンク長がデータ範囲を超えています')

    const typeStart = offset + 4
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const end = dataEnd + 4
    const typeBytes = source.subarray(typeStart, dataStart)
    if (!isChunkType(typeBytes)) throw pngError('チャンク種別が不正です')

    const type = typeBytes.toString('ascii')
    const expectedCrc = source.readUInt32BE(dataEnd)
    const actualCrc = crc32(source.subarray(typeStart, dataEnd))
    if (actualCrc !== expectedCrc) throw pngError(`${type}チャンクのCRCが一致しません`)

    const chunk = { type, length, start: offset, dataStart, dataEnd, end }
    if (chunks.length === 0 && type !== 'IHDR') throw pngError('先頭チャンクがIHDRではありません')
    if (type === 'IHDR') {
      if (chunks.length !== 0) throw pngError('IHDRチャンクが重複しています')
      validateIhdr(source, chunk)
    } else if (type === 'IDAT') {
      sawIdat = true
    } else if (type === 'pHYs' && length !== 9) {
      throw pngError('pHYsチャンクの長さが9バイトではありません')
    } else if (type === 'IEND') {
      if (length !== 0) throw pngError('IENDチャンクの長さが0ではありません')
      sawIend = true
    }

    chunks.push(chunk)
    offset = end
  }

  if (!chunks.length || chunks[0].type !== 'IHDR') throw pngError('IHDRチャンクがありません')
  if (!sawIdat) throw pngError('IDATチャンクがありません')
  if (!sawIend) throw pngError('IENDチャンクがありません')
  if (chunks.at(-1).type !== 'IEND') throw pngError('IENDチャンクが末尾にありません')
  if (chunks.filter(chunk => chunk.type === 'pHYs').length > 1) throw pngError('pHYsチャンクが重複しています')
  return chunks
}

function createChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  typeBytes.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length)
  return chunk
}

function createPhysicalResolutionChunk() {
  const data = Buffer.alloc(9)
  data.writeUInt32BE(PNG_PIXELS_PER_METRE_300_DPI, 0)
  data.writeUInt32BE(PNG_PIXELS_PER_METRE_300_DPI, 4)
  data[8] = 1
  return createChunk('pHYs', data)
}

function setPngPhysicalResolution300Dpi(bytes) {
  if (!(bytes instanceof Uint8Array)) throw pngError('入力がUint8Arrayではありません')
  const source = Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const chunks = parsePngChunks(source)
  const hasPhysicalResolution = chunks.some(chunk => chunk.type === 'pHYs')
  const physicalResolutionChunk = createPhysicalResolutionChunk()
  const output = [source.subarray(0, PNG_SIGNATURE.length)]

  for (const [index, chunk] of chunks.entries()) {
    if (chunk.type === 'pHYs') output.push(physicalResolutionChunk)
    else output.push(source.subarray(chunk.start, chunk.end))
    if (index === 0 && !hasPhysicalResolution) output.push(physicalResolutionChunk)
  }

  return Buffer.concat(output)
}

module.exports = {
  PNG_PIXELS_PER_METRE_300_DPI,
  setPngPhysicalResolution300Dpi
}
