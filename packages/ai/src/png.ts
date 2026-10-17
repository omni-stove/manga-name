/**
 * 8 bit グレースケール PNG のエンコーダ。依存なしで、同じ入力から常に同じバイト列を作る。
 * zlib / CompressionStream を使わないのは、実行環境ごとに出力が変わると
 * commit したフィクスチャと createFakeImageProvider の出力が一致しなくなるため。
 */

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (const x of bytes) {
    a = (a + x) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

function createBitWriter() {
  const out: number[] = []
  let acc = 0
  let n = 0

  /** value の下位 count ビットを LSB から順に書く */
  const bits = (value: number, count: number) => {
    acc |= value << n
    n += count
    while (n >= 8) {
      out.push(acc & 0xff)
      acc >>>= 8
      n -= 8
    }
  }

  /** ハフマン符号は MSB から順に並ぶので、ビット順を反転して書く */
  const code = (value: number, count: number) => {
    let rev = 0
    for (let i = 0; i < count; i++) rev = (rev << 1) | ((value >> i) & 1)
    bits(rev, count)
  }

  const finish = (): Uint8Array => {
    if (n > 0) out.push(acc & 0xff)
    return Uint8Array.from(out)
  }

  return { bits, code, finish }
}

type BitWriter = ReturnType<typeof createBitWriter>

/** 固定ハフマン表のリテラル / 長さ符号（RFC 1951 3.2.6） */
function literal(w: BitWriter, v: number) {
  if (v < 144) w.code(0x30 + v, 8)
  else if (v < 256) w.code(0x190 + (v - 144), 9)
  else if (v < 280) w.code(v - 256, 7)
  else w.code(0xc0 + (v - 280), 8)
}

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
]
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
]

/** 長さ 3..258 を長さ符号と extra bits で書く。距離は常に 1（直前バイトの繰り返し） */
function match(w: BitWriter, length: number) {
  let i = LENGTH_BASE.length - 1
  while ((LENGTH_BASE[i] as number) > length) i--
  literal(w, 257 + i)
  const extra = LENGTH_EXTRA[i] as number
  if (extra > 0) w.bits(length - (LENGTH_BASE[i] as number), extra)
  w.code(0, 5)
}

/**
 * zlib 形式の deflate。固定ハフマン 1 ブロックで、同じバイトの連続だけを距離 1 の match にする。
 * 灰色の矩形のような画像にはこれで十分に効く。
 */
function zlibDeflate(data: Uint8Array): Uint8Array {
  const w = createBitWriter()
  w.bits(1, 1)
  w.bits(1, 2)
  let i = 0
  while (i < data.length) {
    const v = data[i] as number
    let run = 1
    while (i + run < data.length && data[i + run] === v && run < 259) run++
    literal(w, v)
    i++
    if (run >= 4) {
      const length = Math.min(run - 1, 258)
      match(w, length)
      i += length
    }
  }
  literal(w, 256)
  const body = w.finish()
  const out = new Uint8Array(2 + body.length + 4)
  out.set([0x78, 0x01])
  out.set(body, 2)
  new DataView(out.buffer).setUint32(2 + body.length, adler32(data))
  return out
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(typeBytes, 4)
  out.set(data, 8)
  const crcInput = new Uint8Array(4 + data.length)
  crcInput.set(typeBytes)
  crcInput.set(data, 4)
  view.setUint32(8 + data.length, crc32(crcInput))
  return out
}

/** width * height の 8 bit グレー画素列（行優先）を PNG にする */
export function encodeGrayPng(
  width: number,
  height: number,
  pixels: Uint8Array,
): Uint8Array<ArrayBuffer> {
  if (pixels.length !== width * height) throw new Error('pixels does not match width * height')
  const raw = new Uint8Array((width + 1) * height)
  for (let y = 0; y < height; y++) {
    raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1)
  }
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr.set([8, 0, 0, 0, 0], 8)
  const chunks = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibDeflate(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  /** 署名の後ろを chunk に分ける */
  const chunksOf = (png: Uint8Array) => {
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    const out: { type: string; data: Uint8Array; crc: number }[] = []
    for (let i = 8; i < png.length; ) {
      const length = view.getUint32(i)
      const type = new TextDecoder().decode(png.subarray(i + 4, i + 8))
      out.push({
        type,
        data: png.subarray(i + 8, i + 8 + length),
        crc: view.getUint32(i + 8 + length),
      })
      i += 12 + length
    }
    return out
  }

  // 自前の deflate を自前で解くと誤りが打ち消し合うので、実行環境の inflate で解く
  const inflate = async (data: Uint8Array) => {
    const stream = new Blob([data as Uint8Array<ArrayBuffer>])
      .stream()
      .pipeThrough(new DecompressionStream('deflate'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  }

  /** IDAT を解いて、行頭のフィルタ種別を除いた画素列にする */
  const decode = async (png: Uint8Array) => {
    const chunks = chunksOf(png)
    const ihdr = chunks.find((c) => c.type === 'IHDR')?.data as Uint8Array
    const view = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength)
    const width = view.getUint32(0)
    const height = view.getUint32(4)
    const raw = await inflate(chunks.find((c) => c.type === 'IDAT')?.data as Uint8Array)
    const filters = new Set<number>()
    const pixels = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) {
      filters.add(raw[y * (width + 1)] as number)
      pixels.set(raw.subarray(y * (width + 1) + 1, (y + 1) * (width + 1)), y * width)
    }
    return { width, height, depthAndColor: [ihdr[8], ihdr[9]], filters, pixels, raw }
  }

  test('writes the signature, then IHDR, IDAT and IEND with valid CRCs', () => {
    const png = encodeGrayPng(2, 1, Uint8Array.from([0, 255]))
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const chunks = chunksOf(png)
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND'])
    // IEND の CRC は中身が空なので常にこの値になる
    expect(chunks[2]?.crc).toBe(0xae426082)
    for (const c of chunks) {
      const input = new Uint8Array(4 + c.data.length)
      input.set(new TextEncoder().encode(c.type))
      input.set(c.data, 4)
      expect(c.crc).toBe(crc32(input))
    }
  })

  test('the IHDR says 8 bit grayscale and the pixels round-trip through inflate', async () => {
    const pixels = Uint8Array.from({ length: 7 * 5 }, (_, i) => (i * 37) % 256)
    const decoded = await decode(encodeGrayPng(7, 5, pixels))
    expect([decoded.width, decoded.height]).toEqual([7, 5])
    expect(decoded.depthAndColor).toEqual([8, 0])
    expect(decoded.filters).toEqual(new Set([0]))
    expect(decoded.pixels).toEqual(pixels)
  })

  test('runs longer than one match, and every length code, round-trip', async () => {
    // 1..600 の長さの連続を順に並べ、長さ符号の境目と 258 を超える連続を全部通す
    const runs: number[] = []
    for (let n = 1; n <= 600; n++) for (let k = 0; k < n; k++) runs.push(n % 2 === 0 ? 0x40 : 0xc0)
    const pixels = Uint8Array.from(runs)
    const decoded = await decode(encodeGrayPng(pixels.length, 1, pixels))
    expect(decoded.pixels).toEqual(pixels)
  })

  test('a flat image compresses far below its raw size', () => {
    const png = encodeGrayPng(512, 512, new Uint8Array(512 * 512).fill(0xc0))
    expect(png.length).toBeLessThan((512 * 513) / 20)
  })

  test('crc32 and adler32 match their published check values', () => {
    const ascii = (t: string) => new TextEncoder().encode(t)
    expect(crc32(ascii('123456789'))).toBe(0xcbf43926)
    expect(adler32(ascii('Wikipedia'))).toBe(0x11e60398)
  })

  test('the same input always gives the same bytes', () => {
    const pixels = Uint8Array.from({ length: 64 }, (_, i) => i * 4)
    expect(encodeGrayPng(8, 8, pixels)).toEqual(encodeGrayPng(8, 8, pixels))
  })

  test('throws when pixels do not match width * height', () => {
    expect(() => encodeGrayPng(2, 2, new Uint8Array(3))).toThrow('width * height')
  })
}
