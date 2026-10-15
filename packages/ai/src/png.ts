/**
 * 8 bit グレースケール PNG のエンコーダ。依存なしで、同じ入力から常に同じバイト列を作る。
 * zlib / CompressionStream を使わないのは、実行環境ごとに出力が変わると
 * commit したフィクスチャと FakeImageProvider の出力が一致しなくなるため。
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

class BitWriter {
  private out: number[] = []
  private acc = 0
  private n = 0

  /** value の下位 count ビットを LSB から順に書く */
  bits(value: number, count: number) {
    this.acc |= value << this.n
    this.n += count
    while (this.n >= 8) {
      this.out.push(this.acc & 0xff)
      this.acc >>>= 8
      this.n -= 8
    }
  }

  /** ハフマン符号は MSB から順に並ぶので、ビット順を反転して書く */
  code(value: number, count: number) {
    let rev = 0
    for (let i = 0; i < count; i++) rev = (rev << 1) | ((value >> i) & 1)
    this.bits(rev, count)
  }

  finish(): Uint8Array {
    if (this.n > 0) this.out.push(this.acc & 0xff)
    return Uint8Array.from(this.out)
  }
}

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
  const w = new BitWriter()
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
