import type { JsonSchema } from '@manga/schema'
import { LINE_FIELDS } from './lines.prompt'

/** コマ割りの提案の system。出力規則の後に応答の JSON Schema を入れる */
export const suggestLayoutSystem = (options: number, schema: JsonSchema) =>
  [
    'Lay out one manga page from its script as rows of panels. Reply with one JSON object that conforms to the JSON Schema below, and nothing else.',
    `- options: ${options} options that read differently, in the number of panels or in the beat given the largest panel. summary: one Japanese sentence on what the option stresses.`,
    '- rows: from the top of the page down, the panels of a row in reading order. height: the size of a row relative to the other rows. width: the size of a panel relative to the other panels of its row.',
    '- Use 3 to 7 panels, at most 3 in a row, or a splash page when the script calls for one. Give the most important beat the largest panel, and end the page on a beat that makes the reader turn the page.',
    '- note: what the panel shows, in the language of the script: who does what, where, in one or two sentences.',
    '- camera: the shot in the language of the script, such as ロング, バストアップ, アップ, 俯瞰 or あおり. Omit it when the shot does not matter.',
    '- lines: the lines of dialogue, inner monologue and narration that fall in the panel, in reading order, copied verbatim without the speaker name and brackets.',
    ...LINE_FIELDS,
    '- In every option, put every line of the script in exactly one panel, word for word; never drop, merge, shorten or paraphrase one. Give a panel with many or long lines enough room.',
    'JSON Schema:',
    JSON.stringify(schema),
  ].join('\n')
