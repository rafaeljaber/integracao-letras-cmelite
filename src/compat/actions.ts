// As ações que o CMElite chama, implementadas sobre interfaces injetadas (testáveis sem o Spresenter).
import { findPartIndex } from './match';
import { isBlank } from './normalize';
import { pickFields, searchSongs, toSongSummary, type SongRef } from './search';
import { buildSlides, type CompatSlide, type LyricsLike } from './slides';

export interface SongStore {
  listSongs(): Promise<SongRef[]>;
  getSong(guid: string): Promise<SongRef | null>;
  getLyrics(guid: string): Promise<LyricsLike | null>;
  /** Músicas cuja letra pode conter esse texto (candidatas; a confirmação é feita aqui). */
  findByText(text: string): Promise<SongRef[]>;
}

export interface Projector {
  showPart(guid: string, index: number): Promise<void>;
  clearLyrics(): Promise<void>;
  showText(text: string): Promise<void>;
}

export type LogLevel = 'info' | 'warn' | 'error';

export interface ActionDeps {
  songs: SongStore;
  projector: Projector;
  log(level: LogLevel, message: string): void;
  onNowPlaying(title: string | null, part: string | null): void;
  /** Guarda a música aberta (ou null) para sobreviver a um reinício do plugin. */
  rememberSong(guid: string | null): void;
}

interface Current {
  guid: string;
  title: string;
  slides: CompatSlide[];
  index: number | null;
  onAir: boolean;
}

export class CompatActions {
  private current: Current | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private deps: ActionDeps) {}

  /** As chamadas rodam uma de cada vez, na ordem de chegada: uma parte lenta nunca é ultrapassada por um "apagar". */
  handle(action: string, body: Record<string, unknown>): Promise<unknown> {
    const run = this.queue.then(() => this.dispatch(action, body));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Volta à música lembrada depois de um reinício do plugin, sem pôr nada no ar. */
  restore(guid: string): Promise<void> {
    const run = this.queue.then(async () => {
      const loaded = await this.load(guid);
      if (!loaded) return;
      this.current = { guid, title: loaded.song.title, slides: loaded.slides, index: null, onAir: false };
      this.deps.log('info', `música retomada: ${loaded.song.title}`);
      this.deps.onNowPlaying(loaded.song.title, null);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async dispatch(action: string, body: Record<string, unknown>): Promise<unknown> {
    switch (action) {
      case 'SearchLyrics':
        return this.search(body);
      case 'GetLyrics':
        return this.getLyrics(body);
      case 'ShowLyrics':
        return this.showLyrics(body);
      case 'ShowQuickPresentation':
        return this.showText(body);
      case 'CloseCurrentPresentation':
        return this.close();
      default:
        this.deps.log('warn', `ação não suportada: ${action}`);
        return undefined;
    }
  }

  private async search(body: Record<string, unknown>): Promise<unknown> {
    const text = String(body.text ?? body.input ?? '');
    const found = searchSongs(await this.deps.songs.listSongs(), text);
    this.deps.log('info', `busca "${text.trim()}" → ${found.length} resultado(s)`);
    return found.map((s) => pickFields(toSongSummary(s), body.fields));
  }

  private async load(guid: string): Promise<{ song: SongRef; slides: CompatSlide[] } | null> {
    if (!guid) return null;
    const song = await this.deps.songs.getSong(guid);
    if (!song) return null;
    return { song, slides: buildSlides(await this.deps.songs.getLyrics(guid)) };
  }

  private async getLyrics(body: Record<string, unknown>): Promise<unknown> {
    const loaded = await this.load(String(body.id ?? ''));
    if (!loaded) return null;
    return pickFields({ ...toSongSummary(loaded.song), slides: loaded.slides }, body.fields);
  }

  private async showLyrics(body: Record<string, unknown>): Promise<unknown> {
    const guid = String(body.id ?? '');
    const loaded = await this.load(guid);
    if (!loaded) throw new Error(`música não encontrada: ${guid}`);
    this.current = { guid, title: loaded.song.title, slides: loaded.slides, index: null, onAir: false };
    this.deps.rememberSong(guid);
    this.deps.log('info', `música aberta: ${loaded.song.title}`);
    this.deps.onNowPlaying(loaded.song.title, null);
    return undefined;
  }

  private async showText(body: Record<string, unknown>): Promise<unknown> {
    const text = String(body.text ?? '');
    const cur = this.current;
    if (isBlank(text)) {
      await this.deps.projector.clearLyrics();
      if (cur) cur.onAir = false;
      this.deps.onNowPlaying(cur ? cur.title : null, null);
      return undefined;
    }
    if (!cur) {
      if (await this.recover(text, null)) return undefined;
      await this.deps.projector.showText(text);
      this.deps.log('warn', 'texto recebido sem música aberta; exibido como texto livre');
      return undefined;
    }
    let idx = findPartIndex(cur.slides, text, cur.index);
    if (idx < 0) {
      const fresh = await this.load(cur.guid);
      if (fresh) {
        cur.slides = fresh.slides;
        idx = findPartIndex(cur.slides, text, cur.index);
      }
    }
    if (idx < 0) {
      if (await this.recover(text, cur.guid)) return undefined;
      await this.deps.projector.showText(text);
      cur.onAir = false;
      this.deps.log('warn', `texto não encontrado em "${cur.title}"; exibido como texto livre`);
      this.deps.onNowPlaying(cur.title, null);
      return undefined;
    }
    await this.project(cur, idx);
    return undefined;
  }

  private async project(cur: Current, idx: number): Promise<void> {
    if (idx === cur.index && cur.onAir) return;
    await this.deps.projector.showPart(cur.guid, idx);
    cur.index = idx;
    cur.onAir = true;
    const part = cur.slides[idx].slide_description || `parte ${idx + 1}`;
    this.deps.log('info', `${part} no ar`);
    this.deps.onNowPlaying(cur.title, part);
  }

  /**
   * Texto sem música aberta, ou de outra música (ex.: plugin reiniciado no meio da música, que perde
   * o ShowLyrics): procura a música pela letra e a abre, para projetar pelo tema em vez de texto livre.
   */
  private async recover(text: string, skipGuid: string | null): Promise<boolean> {
    for (const song of await this.deps.songs.findByText(text)) {
      if (song.guid === skipGuid) continue;
      const slides = buildSlides(await this.deps.songs.getLyrics(song.guid));
      const idx = findPartIndex(slides, text, null);
      if (idx < 0) continue;
      this.current = { guid: song.guid, title: song.title, slides, index: null, onAir: false };
      this.deps.rememberSong(song.guid);
      this.deps.log('info', `música reconhecida pela letra: ${song.title}`);
      await this.project(this.current, idx);
      return true;
    }
    return false;
  }

  private async close(): Promise<unknown> {
    await this.deps.projector.clearLyrics();
    this.current = null;
    this.deps.rememberSong(null);
    this.deps.log('info', 'letra encerrada');
    this.deps.onNowPlaying(null, null);
    return undefined;
  }
}
