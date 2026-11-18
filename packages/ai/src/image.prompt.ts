import type { Angle, Camera } from '@manga/schema'

/**
 * 画像生成の画風。ネームは本原稿の下描きの前段なので、構図と芝居が読める線だけを描かせ、
 * 顔の造作、服、背景、陰影の描き込みは本原稿に残す。線を間引くうえ、ページを切り抜いたコマは解像度が落ちるので、
 * 薄く揺れた線にはさせず、少ない線を濃くはっきり描かせる
 */
export const NAME_STYLE =
  'manga storyboard thumbnail (nemu), drawn in few, confident dark pencil lines on white paper. Simple figures with round heads, a cross line for the face direction and just the eyes and mouth for the expression; a clear outline of each figure carries the pose and gesture. Hair and clothes as their silhouette only.'

/**
 * 漫画家がコマごとにやる情報の間引き。画像生成はどのコマも端まで描き込み、書いていない人物や小物や背景を足すので、
 * コマに書いたものだけを描かせ、主役を 1 つに絞らせ、余白を残させる。背景を描くかはコマごとの background の行で決める
 */
export const SPARSE_DRAWING =
  'each panel holds only the characters, objects and setting its line names: its main subject drawn, the rest as simple shapes. Leave white space, and fewer things in a smaller panel.'

/** 場面の最初のコマと引きのコマの背景。読者が場所を掴むのはここなので、場所の見分けがつく目印だけを描かせる */
export const BACKGROUND_ESTABLISH =
  'background: the few landmarks that identify the place, in simple lines'

/** 寄りのコマの背景。場所は前のコマで伝わっているので描かせない */
export const BACKGROUND_BLANK = 'background: blank'

/** 場面の途中の中間の寄りの背景。人物の立つ位置が分かるだけの線に留めさせる */
export const BACKGROUND_SUGGEST = 'background: a horizon line or a few perspective lines'

/** 画風で抑えきれない描き込みと、配置図の白い領域（フキダシ）に入れられがちな文字を除く */
export const NAME_NEGATIVE =
  'color, shading, hatching, screentone, solid blacks, inked line art, detailed background, detailed hair or clothing, finished illustration, extra or background characters, crowds, cluttered composition, text, letters, speech bubbles'

/** Panel.camera を画像生成に渡す呼び名 */
export const CAMERA_SHOTS: Record<Camera, string> = {
  extreme_long: 'extreme long shot',
  long: 'long shot',
  middle: 'medium shot',
  bust: 'bust shot',
  close_up: 'close-up',
  extreme_close_up: 'extreme close-up',
  insert: 'insert shot of an object',
}

/** Panel.angle を画像生成に渡す呼び名 */
export const ANGLE_SHOTS: Record<Angle, string> = {
  low: 'low-angle shot',
  high: 'high-angle shot',
  bird: "bird's-eye view from directly above",
  worm: "worm's-eye view from directly below",
  dutch: 'dutch angle',
  pov: 'point-of-view shot',
  over_shoulder: 'over-the-shoulder shot',
}

/** Panel.beat のコマの行。セリフも動きも無い「間」なので、芝居をさせず止まった絵にさせる */
export const BEAT_PANEL = 'a silent beat with no dialogue and no action: a still, quiet moment'

/** 画像生成の固定の末尾。配置図の白い領域（フキダシ）を空けさせる */
export const PANEL_ART_TAIL =
  'leave the white areas of the layout image empty, with no text, letters or speech bubbles'

/** 配置図に重ねた配置の印（render の drawPlacement）の読み方。印そのものは描かせない */
export const PLACEMENT_GUIDE =
  'the coloured marks on the layout image are a placement guide: each circle marks where its labelled subject goes (blue: a character or face, orange: a key object, purple: a sound effect), a larger circle a larger and more prominent subject; green arrows show the direction of a gaze or a motion, thicker ones stronger. Leave the circles, dots, arrows and labels out of the art.'

/** ページ全体の生成の説明。配置図のどこが何かと、コマの枠を動かさないこと */
export const PAGE_ART_HEAD =
  'one whole manga page drawn to the layout image: each grey area is a panel and the black lines are its border. Draw every panel inside its border and keep the gutters between panels white.'

/**
 * キャラの参照画像の画風。参照画像はコマの生成がキャラを見分ける拠り所なので、ネームの画風で略さず、
 * 顔の造作、髪型、服を描き込ませる
 */
export const CHARACTER_STYLE =
  'manga character design sheet, a clean pencil line drawing on white paper. The face in full detail: the shape of the eyes, eyebrows, nose and mouth, and the hairstyle with its parting and strands; the outfit with its seams, folds and accessories; the body in its stated proportions.'

/** キャラの参照画像では描き込みは要るが、色とトーンと背景は見分けの邪魔になるので除く */
export const CHARACTER_NEGATIVE = 'color, screentone, background, text, letters'

/** 描き込んだキャラの参照画像をコマに写させず、見分けにだけ使わせる。登場キャラがいて、かつキャラの参照画像を送る生成でだけ、画風の後に置く */
export const CHARACTER_REF_GUIDE =
  'the character reference images fix who each character is (face shape, hairstyle, build and outfit silhouette); draw them in the rough storyboard style above, not in the detail of the references.'

/** キャラの参照画像の固定の末尾。コマの生成で参照しやすいよう、1 人を全身で正面から描かせる */
export const CHARACTER_ART_TAIL =
  'character reference sheet, a single character, full body, front view, standing, plain white background, no text, no letters'
