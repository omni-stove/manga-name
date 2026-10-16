/** 偽の値を落としてクラス名をつなぐ */
export const cx = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).join(' ')
