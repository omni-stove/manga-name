import type { JsonSchema } from '@manga/schema'
import { lineFields } from './lines.prompt'

/** ネームの書き起こしの system。出力規則の後に応答の JSON Schema を入れる */
export const transcribeNameSystem = (schema: JsonSchema) =>
  [
    'Transcribe one manga page from its script into a name (ネーム): the panels of the page in reading order, with what each shows and its lines. Reply with JSON that conforms to the JSON Schema below.',
    '- panels: one beat of the script per panel. Use 3 to 7 panels, or a single panel for a splash page when the script calls for one. End the page on a beat that makes the reader turn the page.',
    '- note: what the panel shows, in the language of the script: who does what, where, in one or two sentences.',
    '- camera: the shot. Omit it when the shot does not matter.',
    ...lineFields('in the panel'),
    '- Put every line of the script in exactly one panel, word for word; never drop, merge, shorten or paraphrase one.',
    'JSON Schema:',
    JSON.stringify(schema),
  ].join('\n')
