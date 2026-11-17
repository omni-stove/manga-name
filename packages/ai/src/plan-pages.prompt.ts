import type { JsonSchema } from '@manga/schema'
import { lineFields } from './lines.prompt'

/** ページ割りの system。出力規則の後に応答の JSON Schema を入れる */
export const planPagesSystem = (schema: JsonSchema) =>
  [
    'Split the manga script into pages. Reply with the pages in reading order as JSON that conforms to the JSON Schema below.',
    '- note: what happens on the page, in the language of the script, keeping every action, stage direction, setting, sound effect and prop the script gives for this part.',
    '- script: the part of the script that falls on the page, copied verbatim with its speaker names, brackets, stage directions and line breaks. Joined in page order, the scripts of all pages give back the whole script, except a tone note in parentheses at the very top, which goes on no page.',
    '- cast: the ids of the listed characters who appear on the page.',
    ...lineFields('on the page'),
    '- Put every line of the script on exactly one page, word for word; never drop, merge, shorten or paraphrase one.',
    '- Give the key scenes more pages and keep transitions short. Put a reveal at the top of a page.',
    '- Each page is later broken into panels from its script alone, opening a scene with a wide shot of the place. So, where the page count allows, start a page where the script moves to a new place or time rather than in the middle of the page, and keep the stage direction that sets the place at the top of that page script.',
    'JSON Schema:',
    JSON.stringify(schema),
  ].join('\n')
