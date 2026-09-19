/**
 * Controlador de Bloqueio de Ação e Prevenção de Duplo Clique (v1.5.0)
 *
 * Garante que:
 * - Ações assíncronas mutáveis (gerar, congelar, pontuar, importar, etc.) não sejam disparadas
 *   concorrentemente por duplo clique ou cliques rápidos repetidos.
 * - Toda operação execute exatamente UMA vez por intenção do usuário.
 * - O lock seja SEMPRE liberado no bloco 'finally', mesmo em falhas ou cancelamentos.
 * - A interface desabilite os botões e exiba o rótulo objetivo em andamento.
 */

export type AppOperation =
  | "GENERATE"
  | "FREEZE"
  | "SCORE"
  | "DELETE"
  | "IMPORT"
  | "EXPORT"
  | "AUDIT"
  | "CAIXA_QUERY"
  | "RECONCILIATION";

export interface ActionLockState {
  isLocked: boolean;
  currentOperation: AppOperation | null;
}

export type ActionLockListener = (state: ActionLockState) => void;

export class ActionLockController {
  private activeOperation: AppOperation | null = null;
  private listeners: Set<ActionLockListener> = new Set();

  /**
   * Tenta adquirir o lock exclusivo para a operação solicitada.
   * Retorna true se adquirido com sucesso; false se já houver operação em andamento (ex: duplo clique).
   */
  acquire(operation: AppOperation): boolean {
    if (this.activeOperation !== null) {
      return false;
    }
    this.activeOperation = operation;
    this.notify();
    return true;
  }

  /**
   * Libera o lock ativo.
   * Deve ser SEMPRE invocado dentro de uma cláusula `finally`.
   */
  release(operation?: AppOperation): void {
    if (operation && this.activeOperation !== operation) {
      // Evita liberação incorreta de operação não pertencente
      return;
    }
    this.activeOperation = null;
    this.notify();
  }

  /**
   * Executa uma função protegida pelo lock de forma exclusiva.
   * Se o lock já estiver ocupado, descarta a chamada redundante e retorna { executed: false }.
   */
  async runExclusive<T>(
    operation: AppOperation,
    action: () => Promise<T>
  ): Promise<{ executed: true; result: T } | { executed: false; reason: "ALREADY_LOCKED" }> {
    if (!this.acquire(operation)) {
      return { executed: false, reason: "ALREADY_LOCKED" };
    }

    try {
      const result = await action();
      return { executed: true, result };
    } finally {
      this.release(operation);
    }
  }

  /**
   * Verifica se alguma operação (ou uma operação específica) está atualmente em execução.
   */
  isLocked(operation?: AppOperation): boolean {
    if (!operation) {
      return this.activeOperation !== null;
    }
    return this.activeOperation === operation;
  }

  /**
   * Obtém a operação ativa no momento.
   */
  getCurrentOperation(): AppOperation | null {
    return this.activeOperation;
  }

  /**
   * Rótulo descritivo objetivo para o estado em andamento (Prompt 14 #30).
   */
  getOperationLabel(operation?: AppOperation | null): string {
    const op = operation ?? this.activeOperation;
    switch (op) {
      case "GENERATE":
        return "GERANDO...";
      case "FREEZE":
        return "CONGELANDO...";
      case "SCORE":
        return "PONTUANDO...";
      case "DELETE":
        return "EXCLUINDO...";
      case "IMPORT":
        return "IMPORTANDO...";
      case "EXPORT":
        return "EXPORTANDO...";
      case "AUDIT":
        return "AUDITANDO...";
      case "CAIXA_QUERY":
        return "CONSULTANDO...";
      case "RECONCILIATION":
        return "RECONCILIANDO...";
      default:
        return "PROCESSANDO...";
    }
  }

  /**
   * Inscreve um ouvinte para alterações no estado de bloqueio.
   */
  subscribe(listener: ActionLockListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const state: ActionLockState = {
      isLocked: this.activeOperation !== null,
      currentOperation: this.activeOperation,
    };
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(state);
      } catch (err) {
        console.error("Erro em listener de action lock:", err);
      }
    }
  }

  /**
   * Reseta o estado do lock (para testes unitários).
   */
  reset(): void {
    this.activeOperation = null;
    this.listeners.clear();
  }
}

// Instância canônica global do controlador de lock
export const actionLockController = new ActionLockController();
