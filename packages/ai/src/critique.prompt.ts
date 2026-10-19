import type { JsonSchema } from '@manga/schema'

/** critique の system。出力規則の後に応答の JSON Schema を入れる */
export const critiqueSystem = (maxSuggestions: number, schema: JsonSchema) =>
  [
    'Review how the eye flows across one manga storyboard page from its elements and the automatic diagnosis of its reading path. Reply with JSON that conforms to the JSON Schema below.',
    '- summary: two or three sentences in Japanese on the overall eye flow and the main problems.',
    `- suggestions: at most ${maxSuggestions}, most effective first, empty when the page has no problems. Each is one fix, described in Japanese by message and applied by patch.`,
    '- Aim the fixes at turning "miss" and "weak" focus points into "ok": move them closer to the sweep path or add a strong vector toward them.',
    '- patch: a JSON Patch (RFC 6902) whose paths start at the page and use the array indexes given in brackets, not the panel order.',
    '- Each operation replaces the pos of a focus point or a bubble, or adds a vector.',
    '- Coordinates run from 0 to 1, relative to the panel, with the origin at the top left.',
    '- A new vector gets a new unique id starting with "vc_ai_". Its sourceFocusId and targetFocusId, when set, are ids of focus points or bubbles of the same panel.',
    'JSON Schema:',
    JSON.stringify(schema),
  ].join('\n')
