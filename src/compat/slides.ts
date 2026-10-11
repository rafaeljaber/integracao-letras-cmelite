// Converte a letra do Spresenter nos slides do protocolo compatível.
// O CMElite casa as seções do VS com `slide_description`, então o nome importa.

export interface LyricsLike {
  lyrics?: string[];
  sections?: Array<{ type?: string; text: string; group?: string }>;
  groups?: Array<{ id: string; name: string }>;
}

export interface CompatSlide {
  number: number;
  text: string;
  slide_description: string;
  background_id: string;
}

export const TYPE_NAMES: Record<string, string> = {
  intro: 'Introdução',
  verse: 'Verso',
  'pre-chorus': 'Pré-refrão',
  chorus: 'Refrão',
  bridge: 'Ponte',
  instrumental: 'Instrumental',
  tag: 'Tag',
  outro: 'Final',
  ending: 'Encerramento',
};

export function buildSlides(l: LyricsLike | null): CompatSlide[] {
  if (!l) return [];
  const groups = new Map((l.groups ?? []).map((g) => [g.id, g.name] as [string, string]));
  const sections = l.sections ?? [];
  if (sections.length > 0) {
    return sections.map((s, i) => ({
      number: i + 1,
      text: s.text,
      slide_description: (s.group && groups.get(s.group)) || (s.type && TYPE_NAMES[s.type]) || '',
      background_id: '',
    }));
  }
  return (l.lyrics ?? []).map((text, i) => ({ number: i + 1, text, slide_description: '', background_id: '' }));
}
