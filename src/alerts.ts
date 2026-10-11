// Avisos no sino do Spresenter para os dois casos críticos durante o culto.

export interface AlertInput {
  id: string;
  title: string;
  body: string;
  level: 'warning';
}

export class Alerts {
  private up = false;

  constructor(private publishFn: (n: AlertInput) => void, private now: () => number = () => Date.now()) {}

  private publish(n: AlertInput): void {
    try {
      this.publishFn(n);
    } catch {
      // A central de avisos falhou; o plugin continua funcionando.
    }
  }

  bridgeUp(): void {
    this.up = true;
  }

  bridgeDown(): void {
    if (!this.up) return;
    this.up = false;
    this.publish({
      id: `cmelite-ponte-${this.now()}`,
      title: 'Ponte CMElite desconectada',
      body: 'A ponte parou de responder. As letras do CMElite não vão passar até ela voltar.',
      level: 'warning',
    });
  }

  /** Só token inválido toca o sino; sessão perdida e chamada repetida aparecem apenas no painel. */
  authFailed(remote: string, reason: string): void {
    if (reason !== 'invalid token') return;
    this.publish({
      id: 'cmelite-token',
      title: 'CMElite recusado',
      body: `Token inválido vindo de ${remote}. Confira se o token é o mesmo no painel CMElite e no perfil do CMElite.`,
      level: 'warning',
    });
  }
}
