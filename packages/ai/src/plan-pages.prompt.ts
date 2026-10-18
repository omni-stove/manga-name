import type { JsonSchema } from '@manga/schema'
import { LINE_FIELDS } from './lines.prompt'

/** ページ割りの system。出力規則の後に応答の JSON Schema を入れる */
export const planPagesSystem = (schema: JsonSchema) =>
  [
    'Split the manga script into pages. Reply with the pages in reading order as JSON that conforms to the JSON Schema below.',
    '- note: what happens on the page, in the language of the script, keeping every action, stage direction, setting, sound effect and prop the script gives for this part.',
    '- script: the part of the script that falls on the page, copied verbatim with its speaker names, brackets, stage directions and line breaks. Joined in page order, the scripts of all pages give back the whole script, except a tone note in parentheses at the very top, which goes on no page.',
    '- cast: the ids of the listed characters who appear on the page.',
    '- lines: every line of dialogue, inner monologue and narration that falls on the page, in reading order, copied verbatim without the speaker name and brackets.',
    ...LINE_FIELDS,
    '- Put every line of the script on exactly one page, word for word; never drop, merge, shorten or paraphrase one.',
    '- Give the key scenes more pages and keep transitions short. Put a reveal at the top of a page.',
    'JSON Schema:',
    JSON.stringify(schema),
  ].join('\n')
