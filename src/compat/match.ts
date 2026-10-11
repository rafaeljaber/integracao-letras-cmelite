// Acha qual parte da música corresponde ao texto que o CMElite mandou.
import { normalizeSlideText } from './normalize';

/**
 * Índice da parte com esse texto, ou -1. Com texto repetido (refrão), prefere:
 * a parte atual (se já é esse texto) → a primeira depois da atual → a primeira da música.
 */
export function findPartIndex(slides: ReadonlyArray<{ text: string }>, text: string, current: number | null): number {
  const target = normalizeSlideText(text);
  if (!target) return -1;
  const hits: number[] = [];
  slides.forEach((s, i) => {
    if (normalizeSlideText(s.text) === target) hits.push(i);
  });
  if (hits.length === 0) return -1;
  if (current !== null) {
    if (hits.indexOf(current) >= 0) return current;
    for (const i of hits) if (i > current) return i;
  }
  return hits[0];
}
