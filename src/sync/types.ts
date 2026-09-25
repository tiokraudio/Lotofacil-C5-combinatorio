/**
 * Tipos e modelos formais para a camada operacional de sincronização da Lotofácil (Prompt 08).
 * Sincronização estritamente declarativa: LER, COMPARAR, INFORMAR.
 * NUNCA alterar registros automaticamente.
 */

/**
 * Categorias estruturadas de avisos operacionais da sincronização.
 */
export type SyncNoticeType =
  | "EMPTY_SYSTEM"     // Nenhum registro no banco local
  | "RESULT_AVAILABLE" // Concurso FROZEN local com resultado já apurado na CAIXA (<= latestOfficialContest)
  | "WAITING_RESULT"   // Concurso FROZEN local aguardando apuração oficial (> latestOfficialContest)
  | "DRAFT_PENDING"    // Rascunho válido presente no banco local
  | "STALE_DRAFT"      // Rascunho local de concurso anterior ao último apurado pela CAIXA
  | "LOCAL_AHEAD"      // Concurso local com numeração superior ao próximo sugerido pela CAIXA
  | "ALL_SCORED";      // Todos os concursos locais já estão apurados e pontuados

/**
 * Tipos de ações operacionais recomendadas.
 * OBS: Ações são estritamente operacionais (navegação, preenchimento de input, abertura de conferência).
 * NUNCA recomendação de dezenas ou geração automática.
 */
export type SyncActionType =
  | "PREPARE_CONTEST" // Preencher número do concurso no gerador (sem gerar jogos)
  | "OPEN_DRAFT"      // Carregar rascunho existente no gerador
  | "CHECK_RESULT"    // Iniciar conferência individual do concurso com resultado disponível
  | "VIEW_CONTEST";   // Visualizar concurso registrado

export interface SyncRecommendedAction {
  id: string;
  type: SyncActionType;
  contestNumber: number;
  label: string;
  description: string;
  urgency: "HIGH" | "MEDIUM" | "LOW";
}

export interface SyncNotice {
  type: SyncNoticeType;
  contestNumber?: number;
  title: string;
  message: string;
  level: "info" | "warning" | "success";
}

/**
 * Estado normalizado da sincronização operacional.
 * Mantido em memória; a verdade externa é a CAIXA e a local é o IndexedDB.
 */
export interface ContestSyncState {
  /** Timestamp ISO do momento da sincronização */
  fetchedAt: string;

  /** Estado de conectividade da consulta externa */
  status: "ONLINE" | "OFFLINE" | "ERROR";

  /** Nome do provider utilizado */
  providerName: string;

  /** Mensagem de erro caso a consulta externa tenha falhado */
  errorMessage?: string;

  /** Último concurso apurado oficialmente pela CAIXA (null se offline) */
  latestOfficialContest: number | null;

  /** Data de apuração do último concurso oficial */
  latestDrawDate: string | null;

  /** Próximo concurso sugerido pela CAIXA (null se offline) */
  nextSuggestedContest: number | null;

  /** Maior número de concurso registrado no histórico local (null se vazio) */
  localLatestContest: number | null;

  /** Lista de todos os concursos FROZEN locais */
  pendingFrozenContests: number[];

  /** Concursos FROZEN locais cujo resultado já está disponível na CAIXA (<= latestOfficialContest) */
  availableResultContests: number[];

  /** Concursos FROZEN locais aguardando sorteio (> latestOfficialContest) */
  waitingResultContests: number[];

  /** Concursos SCORED no histórico local */
  scoredContests: number[];

  /** Concursos DRAFT no histórico local */
  drafts: number[];

  /** Rascunhos antigos (< latestOfficialContest) */
  staleDrafts: number[];

  /** Concursos locais à frente do próximo sugerido (> nextSuggestedContest) */
  aheadContests: number[];

  /** Avisos operacionais classificados */
  notices: SyncNotice[];

  /** Ações operacionais recomendadas */
  recommendedActions: SyncRecommendedAction[];
}

/**
 * Item reconciliado entre o resultado oficial da CAIXA e o estado local (v1.4 / v1.5).
 */
export interface ReconciledContestItem {
  contestNumber: number;
  localStatus: string;
  localResult: number[] | null;
  externalResult: number[] | null;
  reconciliationStatus: import("./operationalState.ts").ReconciliationStatus;
  queriedAt: string;
  externalSource: string;
  errorMessage?: string;
}
