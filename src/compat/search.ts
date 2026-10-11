// Busca de músicas no formato que o CMElite espera (ele usa sempre o primeiro resultado).
import { fold } from './normalize';

export interface SongRef {
  guid: string;
  title: string;
  artist: string;
}

export function searchSongs(songs: SongRef[], text: string): SongRef[] {
  const q = fold(text);
  const words = q ? q.split(' ') : [];
  const rank = (title: string) => (q && title === q ? 0 : q && title.startsWith(q) ? 1 : 2);
  return songs
    .map((s) => ({ s, title: fold(s.title), hay: fold(`${s.title} ${s.artist}`) }))
    .filter(({ hay }) => words.every((w) => hay.includes(w)))
    .sort((a, b) => rank(a.title) - rank(b.title) || a.title.localeCompare(b.title))
    .map(({ s }) => s);
}

export function toSongSummary(s: SongRef): { id: string; title: string; artist: string; author: string } {
  return { id: s.guid, title: s.title, artist: s.artist, author: s.artist };
}

/** Mantém só os campos pedidos em `fields` ("id,title,..."); sem lista, devolve tudo. */
export function pickFields<T extends Record<string, unknown>>(obj: T, fields: unknown): Partial<T> {
  if (typeof fields !== 'string' || !fields.trim()) return obj;
  const keep = new Set(fields.split(',').map((f) => f.trim()).filter(Boolean));
  return Object.fromEntries(Object.entries(obj).filter(([k]) => keep.has(k))) as Partial<T>;
}
