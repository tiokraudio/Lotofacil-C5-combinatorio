/**
 * Modelo abstrato e contratos para consulta de resultados oficiais da Lotofácil.
 * Total isolamento entre rede externa e domínio do motor C5.
 */

export type PrizeHits = 11 | 12 | 13 | 14 | 15;

export interface OfficialPrizeTier {
  hits: PrizeHits;
  winners: number;
  prizePerWinnerCents: number;
}

export interface OfficialPrizeReference {
  contestNumber: number;
  source: "CAIXA";
  fetchedAt: string;
  tiers: readonly OfficialPrizeTier[];
}

/**
 * Modelo normalizado e auditável do resultado oficial da Lotofácil.
 */
export interface OfficialContestResult {
  /** Número do concurso oficial (inteiro positivo). */
  contestNumber: number;
  /** Data de apuração/sorteio (formato brasileiro DD/MM/YYYY ou ISO). */
  drawDate: string;
  /** Array contendo exatamente 15 dezenas únicas ordenadas de 1 a 25. */
  numbers: number[];
  /** Identificação da fonte de dados (ex: 'CAIXA'). */
  source: string;
  /** Timestamp ISO UTC do momento da consulta local. */
  fetchedAt: string;
  /** Metadados adicionais úteis (opcionais, sem interferir no modelo restrito). */
  nextContestNumber?: number;
  nextContestDate?: string;
  isAccumulated?: boolean;
  /** Referência oficial de premiação (CAIXA), exclusivamente volátil/read-only. */
  prizeReference?: OfficialPrizeReference;
}

/**
 * Contrato abstrato de provider de resultados de loteria.
 */
export interface LotteryResultProvider {
  /** Nome identificador do provider para fins de rastreabilidade. */
  readonly providerName: string;

  /**
   * Consulta o concurso mais recente disponibilizado pela fonte.
   * @param signal Sinal opcional para abort/cancelamento de requisições.
   */
  getLatestContest(signal?: AbortSignal): Promise<OfficialContestResult>;

  /**
   * Consulta o resultado oficial de um concurso específico.
   * @param contestNumber Número do concurso a ser consultado (inteiro positivo).
   * @param signal Sinal opcional para abort/cancelamento de requisições.
   */
  getContest(contestNumber: number, signal?: AbortSignal): Promise<OfficialContestResult>;

  /**
   * Força uma atualização explícita ignorando o cache local da sessão.
   * Em caso de falha, preserva integralmente o cache anterior.
   * @param contestNumber Número do concurso a ser atualizado.
   * @param signal Sinal opcional para abort/cancelamento.
   */
  refreshContest?(
    contestNumber: number,
    signal?: AbortSignal
  ): Promise<OfficialContestResult>;
}

/**
 * Categorias estruturadas de erro na consulta externa.
 */
export type LotteryErrorCode =
  | "NOT_FOUND"          // Concurso não encontrado ou resultado ainda não apurado
  | "CONTEST_MISMATCH"   // Resposta retornou concurso diferente do solicitado
  | "INVALID_PAYLOAD"    // Payload violou o contrato de tipos ou integridade das 15 dezenas
  | "TIMEOUT"            // Requisição excedeu o tempo limite configurado
  | "NETWORK_ERROR"      // Falha de conectividade ou CORS
  | "HTTP_ERROR"         // Erro HTTP (ex: 500, 502, etc.)
  | "ABORTED";           // Operação cancelada explicitamente via AbortController

/**
 * Classe padronizada de erro de consulta de loteria.
 */
export class LotteryFetchError extends Error {
  readonly code: LotteryErrorCode;
  readonly status?: number;
  readonly contestNumber?: number;

  constructor(
    message: string,
    code: LotteryErrorCode,
    status?: number,
    contestNumber?: number
  ) {
    super(message);
    this.name = "LotteryFetchError";
    this.code = code;
    this.status = status;
    this.contestNumber = contestNumber;
    Object.setPrototypeOf(this, LotteryFetchError.prototype);
  }
}
