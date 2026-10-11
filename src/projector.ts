// Põe as partes da música no ar pelo SDK, do jeito mais próximo do clique manual.
import type { Projector } from './compat/actions';

export interface ProjectorConfig {
  layer: number;
  perOutput: boolean;
  blankMode: 'clear' | 'hide';
}

/** Valores confirmados na Task 1 (sonda no Spresenter 0.3.50, D3–D5). Ver spec §11. */
export const PROJECTOR_CONFIG: ProjectorConfig = { layer: 1, perOutput: false, blankMode: 'clear' };

export interface ProjectorApi {
  outputs: { list(): Promise<Array<{ index: number; disabledLayers?: number[] }>> };
  live: {
    setMusicVerse(output: string, layer: number, assetGuid: string, index: number): Promise<void>;
    clear(output: string, layer: number): Promise<void>;
    setState(output: string, layer: number, patch: { show: boolean }): Promise<unknown>;
    apply(output: string, layer: number, presentation: unknown): Promise<void>;
  };
}

/** Apresentação avulsa com um único texto (sem item na biblioteca). */
export function textPresentation(text: string): unknown {
  return {
    title: 'CMElite',
    asset: { type: 'presentation', guid: 'cmelite-texto-livre', title: 'CMElite' },
    theme: {
      title: 'CMElite',
      css: {},
      elements: [
        {
          id: 'texto',
          type: 'TEXT',
          text,
          x: 0,
          y: 0,
          visible: true,
          css: {
            width: '100%', height: '100%', display: 'flex', 'align-items': 'center', 'justify-content': 'center',
            'text-align': 'center', 'white-space': 'pre-line', 'font-family': 'Arial', 'font-size': '72px',
            'font-weight': '700', color: '#ffffff', padding: '0 80px',
          },
        },
      ],
    },
    props: {},
  };
}

export function createProjector(api: ProjectorApi, cfg: ProjectorConfig = PROJECTOR_CONFIG): Projector {
  const targets = async (): Promise<string[]> => {
    const usable = (await api.outputs.list()).filter((o) => (o.disabledLayers ?? []).indexOf(cfg.layer) < 0);
    const chosen = cfg.perOutput ? usable : usable.slice(0, 1);
    return chosen.length > 0 ? chosen.map((o) => String(o.index)) : ['0'];
  };
  return {
    async showPart(guid, index) {
      for (const o of await targets()) {
        await api.live.setMusicVerse(o, cfg.layer, guid, index);
        if (cfg.blankMode === 'hide') await api.live.setState(o, cfg.layer, { show: true });
      }
    },
    async clearLyrics() {
      for (const o of await targets()) {
        if (cfg.blankMode === 'hide') await api.live.setState(o, cfg.layer, { show: false });
        else await api.live.clear(o, cfg.layer);
      }
    },
    async showText(text) {
      for (const o of await targets()) {
        await api.live.apply(o, cfg.layer, textPresentation(text));
        await api.live.setState(o, cfg.layer, { show: true });
      }
    },
  };
}
