import type { JsonSchema } from '@manga/schema'

/** critique の system。出力規則の後に応答の JSON Schema を入れる */
export const critiqueSystem = (maxSuggestions: number, schema: JsonSchema) =>
  [
    'Review how the eye flows across one manga storyboard page. You get the elements of the page and an automatic diagnosis of its reading path. Reply with one JSON object that conforms to the JSON Schema below, and nothing else.',
    '- summary: two or three sentences in Japanese on the overall eye flow and the main problems.',
    `- suggestions: at most ${maxSuggestions}, most effective first, empty when the page has no problems. Each is one fix, described in Japanese by message and applied by patch.`,
    '- Aim the fixes at turning "miss" and "weak" focus points into "ok": move them closer to the sweep path or add a strong vector toward them.',
    '- patch: a JSON Patch (RFC 6902) whose paths start at the page and use the array indexes given in brackets, not the panel order.',
    '- The operations are replacing the pos of a focus point (/panels/<i>/focusPoints/<j>/pos), replacing the pos of a bubble (/panels/<i>/bubbles/<j>/pos) and adding a vector (/panels/<i>/vectors/-); everything else on the page stays as it is.',
    '- Coordinates run from 0 to 1, relative to the panel, with the origin at the top left.',
    '- A new vector gets a new unique id starting with "vc_ai_". Its sourceFocusId and targetFocusId, when set, are ids of focus points or bubbles of the same panel.',
    'JSON Schema:',
    JSON.stringify(schema),
  ].join('\n')
