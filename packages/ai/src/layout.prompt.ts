import type { JsonSchema } from '@manga/schema'
import { ANGLE_SHOTS, CAMERA_SHOTS } from './image.prompt'

/** コマ割りの提案の system。出力規則の後に応答の JSON Schema を入れる。寄りと角度は user と同じ呼び名で書く */
export const suggestLayoutSystem = (options: number, schema: JsonSchema) =>
  [
    'Lay out one manga page as rows of panels for the given name (ネーム), a list of panels in reading order. Reply with JSON that conforms to the JSON Schema below.',
    `- options: ${options} options that read differently, in how the panels fall into rows or in the beat given the largest panel. summary: one Japanese sentence on what the option stresses.`,
    '- rows: from the top of the page down, the panels of a row in reading order. height: the size of a row relative to the other rows. width: the size of a panel relative to the other panels of its row.',
    '- In every option, the panels of all rows taken in order are the given panels in their order: never add, drop, merge, split or reorder one.',
    '- A panel may end with its shot in parentheses: how much of the subject it takes in, then the angle it looks from when not at eye level.',
    '- Under each panel, a line starting with "- " is a line of dialogue and one starting with "* " is the acting of a character in it.',
    '- Put at most 3 panels in a row. Give the most important beat the largest panel, and give a panel with many or long lines, or with a large action, enough room.',
    `- Size a panel for its shot: an ${CAMERA_SHOTS.extreme_long} or a ${ANGLE_SHOTS.bird} needs a wide panel, often a whole row, for the place to read; a ${ANGLE_SHOTS.worm} needs a tall one; an ${CAMERA_SHOTS.insert} or an ${CAMERA_SHOTS.extreme_close_up} reads in a small panel beside a larger one.`,
    'JSON Schema:',
    JSON.stringify(schema),
  ].join('\n')
