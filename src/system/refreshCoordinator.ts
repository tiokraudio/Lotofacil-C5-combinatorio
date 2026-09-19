/**
 * Coordenador Global de Atualização de Dados Locais (v1.5.0)
 *
 * Responsável por:
 * - Manter a revisão monotônica (dataRevision) do armazenamento local
 * - Notificar componentes e views APENAS após a confirmação definitiva (commit) da transação IndexedDB
 * - Garantir que nenhuma notificação ocorra se uma operação for abortada ou falhar antes do commit
 * - Manter o IndexedDB como Fonte Única da Verdade (Source of Truth), sem criar caches paralelos
 */

export type DataMutationReason =
  | "SAVE"
  | "FREEZE"
  | "SCORE"
  | "DELETE"
  | "IMPORT"
  | "INITIAL_LOAD";

export type RefreshListener = (revision: number, reason: DataMutationReason) => void;

export class RefreshCoordinator {
  private revision: number = 1;
  private listeners: Set<RefreshListener> = new Set();

  /**
   * Retorna a revisão atual dos dados persistidos.
   */
  getRevision(): number {
    return this.revision;
  }

  /**
   * Notifica todos os ouvintes que uma mutação foi persistida e commitada com sucesso.
   * Incrementa atomicamente a revisão de dados.
   *
   * ATENÇÃO: Nunca invoque este método se o commit no IndexedDB falhou.
   */
  notifyMutationCommitted(reason: DataMutationReason): number {
    this.revision++;
    const currentRev = this.revision;

    for (const listener of Array.from(this.listeners)) {
      try {
        listener(currentRev, reason);
      } catch (err) {
        console.error("Erro em listener de atualização de dados:", err);
      }
    }

    return currentRev;
  }

  /**
   * Inscreve um ouvinte para atualizações coordenadas de dados.
   * Retorna a função de limpeza (unsubscribe) segura contra vazamento de memória.
   */
  subscribe(listener: RefreshListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Limpa todos os ouvintes (útil para testes unitários).
   */
  reset(): void {
    this.revision = 1;
    this.listeners.clear();
  }
}

// Instância canônica global do coordenador
export const refreshCoordinator = new RefreshCoordinator();
