import type { JsonSchema } from '@manga/schema'

/** コマ割りの提案の system。出力規則の後に応答の JSON Schema を入れる */
export const suggestLayoutSystem = (options: number, schema: JsonSchema) =>
  [
    'Lay out one manga page as rows of panels for the given name (ネーム), a list of panels in reading order. Reply with one JSON object that conforms to the JSON Schema below, and nothing else.',
    `- options: ${options} options that read differently, in how the panels fall into rows or in the beat given the largest panel. summary: one Japanese sentence on what the option stresses.`,
    '- rows: from the top of the page down, the panels of a row in reading order. height: the size of a row relative to the other rows. width: the size of a panel relative to the other panels of its row.',
    '- In every option, the panels of all rows taken in order are the given panels in their order: never add, drop, merge, split or reorder one.',
    '- Put at most 3 panels in a row. Give the most important beat the largest panel, and give a panel with many or long lines enough room.',
    'JSON Schema:',
    JSON.stringify(schema),
  ].join('\n')
