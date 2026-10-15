const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * PNG として読めるかの確認。シグネチャと先頭の IHDR チャンクの幅・高さだけを見る。
 * Workers には画像 decoder が無く、ピクセルまで復号すると CPU 時間を食うため。
 */
export function isDecodablePng(bytes: Uint8Array): boolean {
  if (bytes.length < 33) return false
  if (!SIGNATURE.every((b, i) => bytes[i] === b)) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(12) !== 0x49484452) return false
  return view.getUint32(16) > 0 && view.getUint32(20) > 0
}
