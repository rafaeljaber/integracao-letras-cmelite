// Adapta a biblioteca do Spresenter (SDK) para a interface SongStore.
import type { SongStore } from './compat/actions';
import type { SongRef } from './compat/search';
import { normalizeSlideText } from './compat/normalize';
import type { LyricsLike } from './compat/slides';

/** Tipo de asset das músicas no Spresenter 0.3.50 (confirmado na Task 1, D1). */
export const MUSIC_TYPE = 'music';

interface AssetLike {
  guid: string;
  type?: string;
  title?: string;
  author?: string;
}

export interface AssetsApi {
  list(filters?: { type?: string }): Promise<AssetLike[]>;
  get(guid: string): Promise<AssetLike | null>;
  getLyrics(guid: string): Promise<LyricsLike | null>;
}

const toRef = (a: AssetLike): SongRef => ({ guid: a.guid, title: a.title ?? '', artist: a.author ?? '' });

/** Linhas de todas as partes da letra, normalizadas, para comparar com o texto recebido. */
function lyricLines(l: LyricsLike | null): string[] {
  if (!l) return [];
  const texts = l.sections && l.sections.length > 0 ? l.sections.map((s) => s.text) : l.lyrics ?? [];
  return texts.map(normalizeSlideText).join('\n').split('\n');
}

export function createSongStore(assets: AssetsApi): SongStore & { invalidate(): void } {
  // A busca do Spresenter (assets.search) só olha o título; para achar pela letra é preciso
  // percorrer as letras. Elas ficam em memória até a biblioteca mudar (evento "assets").
  const lyricsCache = new Map<string, string[]>();
  return {
    async listSongs() {
      return (await assets.list({ type: MUSIC_TYPE })).map(toRef);
    },
    async getSong(guid) {
      if (!guid) return null;
      const a = await assets.get(guid);
      return a && a.type === MUSIC_TYPE ? toRef(a) : null;
    },
    getLyrics: (guid) => assets.getLyrics(guid),
    async findByText(text) {
      const target = normalizeSlideText(text).split('\n')[0];
      if (!target) return [];
      const found: SongRef[] = [];
      for (const a of await assets.list({ type: MUSIC_TYPE })) {
        let lines = lyricsCache.get(a.guid);
        if (!lines) {
          lines = lyricLines(await assets.getLyrics(a.guid));
          lyricsCache.set(a.guid, lines);
        }
        if (lines.indexOf(target) >= 0) found.push(toRef(a));
      }
      return found;
    },
    invalidate() {
      lyricsCache.clear();
    },
  };
}
