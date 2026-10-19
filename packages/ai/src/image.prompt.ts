import type { Camera } from '@manga/schema'

/**
 * 画像生成の画風。ネームは本原稿の下描きの前段なので、構図と芝居が読める線だけを描かせ、
 * 顔の造作、服、背景、陰影の描き込みは本原稿に残す
 */
export const NAME_STYLE =
  'manga storyboard thumbnail (nemu), a quick rough sketch in loose grey pencil on white paper. Simple figures with round heads, a cross line for the face direction and just the eyes and mouth for the expression; the pose and gesture carry the acting. The setting as a horizon line or a few perspective lines, or blank. Hair and clothes as their silhouette only.'

/** 画風で抑えきれない描き込みと、配置図の白い領域（フキダシ）に入れられがちな文字を除く */
export const NAME_NEGATIVE =
  'color, shading, hatching, screentone, solid blacks, inked or clean line art, detailed background, detailed hair or clothing, finished illustration, text, letters, speech bubbles'

/** Panel.camera を画像生成に渡す呼び名 */
export const CAMERA_SHOTS: Record<Camera, string> = {
  long: 'long shot',
  middle: 'medium shot',
  bust: 'bust shot',
  close_up: 'close-up',
  low_angle: 'low-angle shot',
  high_angle: 'high-angle shot',
}

/** 画像生成の固定の末尾。配置図の白い領域（フキダシ）を空けさせる */
export const PANEL_ART_TAIL =
  'leave the white areas of the layout image empty, with no text, letters or speech bubbles'

/** 配置図に重ねた配置の印（render の drawPlacement）の読み方。印そのものは描かせない */
export const PLACEMENT_GUIDE =
  'the coloured marks on the layout image are a placement guide: each circle marks where its labelled subject goes (blue: a character or face, orange: a key object, purple: a sound effect), a larger circle a larger and more prominent subject; green arrows show the direction of a gaze or a motion, thicker ones stronger. Leave the circles, dots, arrows and labels out of the art.'

/** ページ全体の生成の説明。配置図のどこが何かと、コマの枠を動かさないこと */
export const PAGE_ART_HEAD =
  'one whole manga page drawn to the layout image: each grey area is a panel and the black lines are its border. Draw every panel inside its border and keep the gutters between panels white.'

/** キャラの参照画像の固定の末尾。コマの生成で参照しやすいよう、1 人を全身で正面から描かせる */
export const CHARACTER_ART_TAIL =
  'character reference sheet, a single character, full body, front view, standing, plain white background, no text, no letters'
