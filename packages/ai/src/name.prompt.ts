import type { Angle, Camera, JsonSchema } from '@manga/schema'
import { lineFields } from './lines.prompt'

/** Panel.camera の値ごとの使いどころ。Record にするのは、寄りを足したときに説明の書き漏れを型で止めるため */
const CAMERA_USES: Record<Camera, string> = {
  extreme_long:
    'a vast place with the figures tiny in it, to open a scene in a new place or to show its scale.',
  long: 'whole figures in their setting, to show where everyone stands or an action of the whole body.',
  middle: 'figures from the waist up, for a talk carried by gestures.',
  bust: 'one or two figures from the chest up, for dialogue and reactions.',
  close_up: 'one face filling the panel, for a strong emotion.',
  extreme_close_up:
    'part of a face, such as the eyes or the mouth, for the peak of a shock or a resolve.',
  insert:
    'an object alone, such as a prop in a hand, a clue or a sign, for a thing the reader must notice.',
}

/** Panel.angle の値ごとの使いどころ。Record にする理由は CAMERA_USES と同じ */
const ANGLE_USES: Record<Angle, string> = {
  low: 'looking up at the subject, to make it strong, proud or threatening.',
  high: 'looking down on the subject, to make it small, weak or alone.',
  bird: 'straight down from above, to lay out a place, a crowd or a fight.',
  worm: 'straight up from the ground, for something towering over the reader.',
  dutch: 'a tilted frame, for tension, unease, a shock or a chaotic action.',
  pov: "through a character's eyes, showing what that character sees and not the character.",
  over_shoulder:
    "from behind one character's shoulder toward who or what they face, for a face-off or a tense talk.",
}

const uses = (values: Record<string, string>) =>
  Object.entries(values).map(([value, use]) => `  - ${value}: ${use}`)

/** ネームの書き起こしの system。出力規則の後に応答の JSON Schema を入れる */
export const transcribeNameSystem = (schema: JsonSchema) =>
  [
    'Transcribe one manga page from its script into a name (ネーム): the panels of the page in reading order, with what each shows and its lines. Reply with JSON that conforms to the JSON Schema below.',
    '- panels: one beat of the script per panel. Use 3 to 7 panels, or a single panel for a splash page when the script calls for one. End the page on a beat that makes the reader turn the page.',
    '- note: what the panel shows, in the language of the script: who does what, where, in one or two sentences.',
    '- camera: how much the shot takes in, chosen for what the beat must show:',
    ...uses(CAMERA_USES),
    '  Open a new scene or place with extreme_long or long, show a prop or a clue the script points at with insert, and change the camera from panel to panel rather than repeat one. Omit camera when the shot does not matter.',
    '- angle: where the shot looks from, chosen for the mood of the beat:',
    ...uses(ANGLE_USES),
    '  Omit angle for a shot at eye level or when the angle does not matter.',
    '- noArt: true for a panel of text alone, with no picture. Give its lines the shape none or narration.',
    '- fill: black for a panel painted black.',
    '- effect: focus_lines to pull the eye to the subject, speed_lines to carry a motion, beta_flash to land a shock.',
    ...lineFields('in the panel'),
    '- acting: for each listed character in the panel, the pose, gesture and expression that carry the beat, in the language of the script, as one short phrase. characterId: the id of the listed character. Leave out characters not listed, and omit acting when no listed character is in the panel.',
    '- Put every line of the script in exactly one panel, word for word; never drop, merge, shorten or paraphrase one.',
    '- Current acting, when given, is what the author already wrote for the panels on the page: on the panel that shows the same beat, keep it word for word for the same character.',
    'JSON Schema:',
    JSON.stringify(schema),
  ].join('\n')
