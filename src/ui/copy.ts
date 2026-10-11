// Copia um texto no painel. O iframe do Spresenter bloqueia a área de transferência moderna,
// então há uma segunda tentativa com o comando de cópia clássico (precisa do texto selecionado).

export interface CopyDeps {
  writeText?: (text: string) => Promise<void>;
  /** Seleciona o texto na tela e executa a cópia clássica; true se copiou. */
  execCopy: () => boolean;
}

export async function copyText(text: string, deps: CopyDeps): Promise<'copied' | 'selected'> {
  if (deps.writeText) {
    try {
      await deps.writeText(text);
      return 'copied';
    } catch {
      // bloqueada no iframe: tenta a cópia clássica abaixo
    }
  }
  return deps.execCopy() ? 'copied' : 'selected';
}
