/** セリフ（PlanLine）の書き方。ページ割りとコマ割りの提案で同じにする。`where` はセリフを振る先 */
export const lineFields = (where: 'on the page' | 'in the panel') => [
  `- lines: the lines of dialogue, inner monologue and narration that fall ${where}, in reading order, without the speaker name and brackets.`,
  '  - speakerId: the id of the listed character who says it. Omit it for narration or a speaker not listed.',
  '  - shape: normal for speech, shout for shouting, thought for inner monologue, whisper for whispering, tremble for a shaky or frightened voice, electronic for a voice through a phone, TV, radio or machine, urchin for a flustered or startled inner voice, none for a murmur written straight on the art, narration for narration and captions.',
]
