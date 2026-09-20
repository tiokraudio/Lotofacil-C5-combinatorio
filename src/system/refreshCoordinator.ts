/**
 * Coordenador Global de Atualização de Dados Locais (v1.6.0)
 *
 * Responsável por:
 * - Manter a revisão monotônica (dataRevision) do armazenamento local
 * - Notificar componentes e views APENAS após a confirmação definitiva (commit) da transação IndexedDB
 * - Notificar ouvintes de sincronização multiaba (LocalSyncCoordinator) apenas após mutações locais commitadas
 * - Receber invalidações remotas de outras abas sem gerar loops de retransmissão
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

export type RefreshListener = (
  revision: number,
  reason: DataMutationReason,
  contestNumber?: number,
  isRemote?: boolean
) => void;

export type CommitEventListener = (
  reason: DataMutationReason,
  contestNumber?: number
) => void;

export class RefreshCoordinator {
  private revision: number = 1;
  private listeners: Set<RefreshListener> = new Set();
  private commitListeners: Set<CommitEventListener> = new Set();

  /**
   * Retorna a revisão atual dos dados persistidos.
   */
  getRevision(): number {
    return this.revision;
  }

  /**
   * Notifica todos os ouvintes que uma mutação local foi persistida e commitada com sucesso.
   * Incrementa atomicamente a revisão de dados.
   * Notifica também os ouvintes pós-commit (como o transmissor de sincronização multiaba).
   *
   * ATENÇÃO: Nunca invoque este método se o commit no IndexedDB falhou.
   */
  notifyMutationCommitted(reason: DataMutationReason, contestNumber?: number): number {
    this.revision++;
    const currentRev = this.revision;

    for (const listener of Array.from(this.listeners)) {
      try {
        listener(currentRev, reason, contestNumber, false);
      } catch (err) {
        console.error("Erro em listener de atualização de dados:", err);
      }
    }

    if (reason !== "INITIAL_LOAD") {
      for (const commitListener of Array.from(this.commitListeners)) {
        try {
          commitListener(reason, contestNumber);
        } catch (err) {
          console.error("Erro em listener pós-commit:", err);
        }
      }
    }

    return currentRev;
  }

  /**
   * Notifica todos os ouvintes locais que uma invalidação remota foi recebida de outra aba.
   * Incrementa atomicamente a revisão de dados para induzir a releitura do IndexedDB.
   *
   * CRÍTICO (Zero Loop):
   * Este método NÃO dispara os `commitListeners`, garantindo que a aba receptora
   * NUNCA retransmita o evento para o BroadcastChannel.
   */
  notifyExternalSyncReceived(reason: DataMutationReason, contestNumber?: number): number {
    this.revision++;
    const currentRev = this.revision;

    for (const listener of Array.from(this.listeners)) {
      try {
        listener(currentRev, reason, contestNumber, true);
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
   * Inscreve um ouvinte exclusivo para mutações locais commitadas (usado pelo BroadcastChannel).
   */
  onCommit(listener: CommitEventListener): () => void {
    this.commitListeners.add(listener);
    return () => {
      this.commitListeners.delete(listener);
    };
  }

  /**
   * Limpa todos os ouvintes e reinicia a revisão (útil para testes unitários isolados).
   */
  reset(): void {
    this.revision = 1;
    this.listeners.clear();
    this.commitListeners.clear();
  }
}

// Instância canônica global do coordenador
export const refreshCoordinator = new RefreshCoordinator();
