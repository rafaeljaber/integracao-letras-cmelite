// Normalização de texto usada na busca de músicas e na comparação de slides.

/** Minúsculas, sem acentos, espaços colapsados e aparado — para comparar nomes. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Texto de slide comparável: quebras unificadas, cada linha aparada, sem linhas vazias nas pontas. */
export function normalizeSlideText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/** O CMElite manda " " para seções do VS sem letra. */
export function isBlank(s: string): boolean {
  return s.trim() === '';
}
