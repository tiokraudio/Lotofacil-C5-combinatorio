/**
 * Camada de repositório para persistência do histórico prospectivo de concursos C₅ no IndexedDB.
 */
import { validateC5 } from "../c5/validator.ts";
import {
  freezeContestRecord,
  scoreFrozenContest,
  verifyScoreIntegrity,
  deepCloneGeneration,
  deepCloneScore,
  defaultClock,
} from "../c5/record.ts";
import {
  verifyContestIntegrity,
  buildCanonicalPayload,
  serializeCanonicalPayload,
  computeSHA256,
} from "../c5/integrity.ts";
import { areContestRecordsIdentical } from "./recordComparison.ts";
import type { ContestRecord, ContestRecordStatus, Clock, PrizeRecord } from "../c5/types.ts";
import {
  openDatabase,
  closeDatabase,
  promisifyRequest,
  waitForTransaction,
  CONTEST_STORE_NAME,
} from "./db.ts";
import { C5_ALGORITHM_VERSION } from "../c5/version.ts";
import { APP_VERSION } from "../system/manifest.ts";
import { type RefreshCoordinator, refreshCoordinator } from "../system/refreshCoordinator.ts";
import {
  BET_PRICE,
  BETS_PER_CONTEST,
  COST_PER_CONTEST,
  COST_PER_CONTEST_CENTS,
  calculateTotalCostCents,
  isValidIsoDate,
  isValidGenerationId,
  type HistorySummary,
  type StoredContestVerification,
  type HistoryAuditResult,
  type HistoryAuditRecordDetail,
  type HistoryExportData,
  type StorageOptions,
  type QuarantinedRecord,
  type DiagnosticExport,
} from "./types.ts";

export {
  BET_PRICE,
  BETS_PER_CONTEST,
  COST_PER_CONTEST,
  COST_PER_CONTEST_CENTS,
  calculateTotalCostCents,
};

/**
 * Gera nome de arquivo padronizado para exportação de diagnóstico de integridade.
 */
export function generateDiagnosticFilename(date: Date = new Date()): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  const YYYY = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const DD = pad(date.getDate());
  const HH = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `lotofacil-c5-diagnostico-${YYYY}-${MM}-${DD}-${HH}${mm}${ss}.json`;
}

/**
 * Realiza clonagem defensiva profunda de um ContestRecord completo.
 * Resistente a corrupções de schema para garantir que registros malformados
 * possam ser inspecionados pela quarentena sem falha catastrófica.
 */
export function deepCloneRecord(record: ContestRecord): ContestRecord {
  let clonedGen: any;
  try {
    clonedGen = deepCloneGeneration(record.generation);
  } catch {
    try {
      clonedGen = JSON.parse(JSON.stringify(record.generation));
    } catch {
      clonedGen = record.generation;
    }
  }

  let clonedScore: any;
  if (record.score) {
    try {
      clonedScore = deepCloneScore(record.score);
    } catch {
      try {
        clonedScore = JSON.parse(JSON.stringify(record.score));
      } catch {
        clonedScore = record.score;
      }
    }
  }

  const clonedRecord: ContestRecord = {
    status: record.status,
    contestNumber: record.contestNumber,
    generationId: record.generationId,
    algorithmVersion: record.algorithmVersion,
    generatedAt: record.generatedAt,
    generation: clonedGen,
  };

  if (record.frozenAt !== undefined) {
    clonedRecord.frozenAt = record.frozenAt;
  }
  if (record.integrityHash !== undefined) {
    clonedRecord.integrityHash = record.integrityHash;
  }
  if (record.betPlacedAt !== undefined) {
    clonedRecord.betPlacedAt = record.betPlacedAt;
  }
  if (record.officialResult !== undefined) {
    clonedRecord.officialResult = [...record.officialResult];
  }
  if (record.scoredAt !== undefined) {
    clonedRecord.scoredAt = record.scoredAt;
  }
  if (clonedScore !== undefined) {
    clonedRecord.score = clonedScore;
  }
  if (record.prize !== undefined) {
    clonedRecord.prize = {
      amountCents: record.prize.amountCents,
      recordedAt: record.prize.recordedAt,
      source: record.prize.source,
    };
  }

  return clonedRecord;
}

/**
 * Repositório do Histórico Prospectivo de Concursos C₅.
 */
export class ContestRepository {
  private options?: StorageOptions;

  constructor(options?: StorageOptions) {
    this.options = options;
  }

  private shouldNotifyCoordinator(): boolean {
    return this.options?.notifyCoordinator !== false;
  }

  private getRefreshCoordinator(): RefreshCoordinator {
    return this.options?.refreshCoordinator ?? refreshCoordinator;
  }

  private async getDB(): Promise<IDBDatabase> {
    return openDatabase(this.options);
  }

  /**
   * Salva um registro em estado DRAFT no IndexedDB.
   * Rejeita se o status não for DRAFT, se as invariantes C₅ forem violadas
   * ou se já existir registro oficial cadastrado para o mesmo concurso.
   */
  async saveDraft(record: ContestRecord): Promise<void> {
    if (record.status !== "DRAFT") {
      throw new Error(
        `saveDraft aceita somente registros com status 'DRAFT'. Status fornecido: '${record.status}'.`
      );
    }

    if (
      typeof record.contestNumber !== "number" ||
      !Number.isInteger(record.contestNumber) ||
      record.contestNumber <= 0
    ) {
      throw new Error(`Número de concurso inválido: ${record.contestNumber}`);
    }

    if (record.betPlacedAt !== undefined) {
      throw new Error(
        `Registro em estado DRAFT não pode conter aposta confirmada ('betPlacedAt').`
      );
    }

    if (record.prize !== undefined) {
      throw new Error(
        `Registro em estado DRAFT não pode conter premiação ('prize').`
      );
    }

    const validation = validateC5(record.generation);
    if (!validation.valid) {
      throw new Error(
        `Tentativa de salvar DRAFT com invariantes C5 violadas: ${validation.errors.join("; ")}`
      );
    }

    const db = await this.getDB();
    try {
      const tx = db.transaction(CONTEST_STORE_NAME, "readwrite");
      const store = tx.objectStore(CONTEST_STORE_NAME);

      // Verificação prévia de existência
      const existing = await promisifyRequest(store.get(record.contestNumber));
      if (existing) {
        throw new Error(
          `Colisão de concurso: o concurso ${record.contestNumber} já possui registro oficial cadastrado. Não é permitida sobrescrita.`
        );
      }

      // Adiciona cópia defensiva usando store.add() para reforço atômico da chave primária
      const clone = deepCloneRecord(record);
      await promisifyRequest(store.add(clone));
      await waitForTransaction(tx);
      if (this.shouldNotifyCoordinator()) {
        this.getRefreshCoordinator().notifyMutationCommitted("SAVE", record.contestNumber);
      }
    } catch (err: any) {
      if (
        err?.name === "ConstraintError" ||
        (err?.message && err.message.includes("Key already exists"))
      ) {
        throw new Error(
          `Colisão de concurso: o concurso ${record.contestNumber} já possui registro oficial cadastrado. Operação concorrente rejeitada.`
        );
      }
      throw err;
    } finally {
      closeDatabase(db);
    }
  }

  /**
   * Insere atomicamente um lote de novos registros em uma única transação IndexedDB readwrite.
   * Se qualquer inserção falhar (ex: chave primária duplicada), a transação sofre rollback total.
   * Não grava nada parcialmente.
   */
  async batchInsertRecords(records: ContestRecord[]): Promise<void> {
    if (records.length === 0) return;

    const db = await this.getDB();
    try {
      const tx = db.transaction(CONTEST_STORE_NAME, "readwrite");
      const store = tx.objectStore(CONTEST_STORE_NAME);

      for (const record of records) {
        const clone = deepCloneRecord(record);
        await promisifyRequest(store.add(clone));
      }

      await waitForTransaction(tx);
      if (this.shouldNotifyCoordinator()) {
        this.getRefreshCoordinator().notifyMutationCommitted("IMPORT");
      }
    } catch (err: any) {
      if (
        err?.name === "ConstraintError" ||
        (err?.message && err.message.includes("Key already exists"))
      ) {
        throw new Error(
          `Colisão de chave primária durante importação em lote: um dos concursos já existe no banco. Lote abortado.`
        );
      }
      throw err;
    } finally {
      closeDatabase(db);
    }
  }

  /**
   * Busca um registro de concurso por seu número oficial.
   * Retorna uma cópia defensiva profunda do registro ou null se não existir.
   */
  async getContestRecord(contestNumber: number): Promise<ContestRecord | null> {
    const db = await this.getDB();
    try {
      const tx = db.transaction(CONTEST_STORE_NAME, "readonly");
      const store = tx.objectStore(CONTEST_STORE_NAME);
      const raw = await promisifyRequest<ContestRecord | undefined>(store.get(contestNumber));
      return raw ? deepCloneRecord(raw) : null;
    } finally {
      closeDatabase(db);
    }
  }

  /**
   * Retorna todos os registros de concursos ordenados por contestNumber DESC (mais recente primeiro).
   * Todos os itens retornados são cópias defensivas independentes.
   */
  async getAllContestRecords(): Promise<ContestRecord[]> {
    const db = await this.getDB();
    try {
      const tx = db.transaction(CONTEST_STORE_NAME, "readonly");
      const store = tx.objectStore(CONTEST_STORE_NAME);
      const rawList = await promisifyRequest<ContestRecord[]>(store.getAll());

      // Ordenação explícita DESC por contestNumber
      rawList.sort((a, b) => b.contestNumber - a.contestNumber);

      return rawList.map(deepCloneRecord);
    } finally {
      closeDatabase(db);
    }
  }

  /**
   * Congela um registro persistido em estado DRAFT, gerando seu hash SHA-256 e selando a geração.
   * Executa em transação segura: se qualquer auditoria falhar, nenhuma alteração é persistida.
   */
  async freezeStoredContest(
    contestNumber: number,
    options?: { clock?: Clock }
  ): Promise<ContestRecord> {
    const clock = options?.clock ?? this.options?.clock ?? defaultClock;
    const snapshot = await this.getContestRecord(contestNumber);
    if (!snapshot) {
      throw new Error(`Concurso ${contestNumber} não encontrado para congelamento.`);
    }

    const verification = await this.verifyStoredContest(contestNumber);
    if (!verification.valid) {
      throw new Error(
        `Operação bloqueada: o registro do concurso ${contestNumber} falhou na auditoria de integridade.`
      );
    }

    if (snapshot.status !== "DRAFT") {
      throw new Error(
        `Apenas registros em estado DRAFT podem ser congelados. Concurso ${contestNumber} possui status: '${snapshot.status}'.`
      );
    }

    // Transição pura via motor matemático C5 (cálculo de hash assíncrono Web Crypto)
    const frozen = await freezeContestRecord(snapshot, { clock });

    // Verificação de integridade pós-congelamento antes de persistir
    const audit = await verifyContestIntegrity(frozen);
    if (!audit.valid) {
      throw new Error(
        `Falha na auditoria de integridade ao congelar concurso ${contestNumber}: ${audit.errors.join("; ")}`
      );
    }

    const db = await this.getDB();
    try {
      const tx = db.transaction(CONTEST_STORE_NAME, "readwrite");
      const store = tx.objectStore(CONTEST_STORE_NAME);

      const current = await promisifyRequest<ContestRecord | undefined>(store.get(contestNumber));
      if (!current || !areContestRecordsIdentical(current, snapshot)) {
        throw new Error(
          `O registro do concurso ${contestNumber} mudou durante a operação. Congelamento cancelado para evitar sobrescrita concorrente.`
        );
      }

      const clone = deepCloneRecord(frozen);
      await promisifyRequest(store.put(clone));
      await waitForTransaction(tx);
      if (this.shouldNotifyCoordinator()) {
        this.getRefreshCoordinator().notifyMutationCommitted("FREEZE", contestNumber);
      }

      return deepCloneRecord(frozen);
    } finally {
      closeDatabase(db);
    }
  }

  /**
   * Pontua um concurso persistido em estado FROZEN contra o resultado oficial da Lotofácil.
   * Transação atômica rigorosa com auditorias duplas (geração + pontuação).
   * Se qualquer etapa falhar, o banco sofre rollback e nenhuma alteração parcial é gravada.
   */
  async scoreStoredContest(
    contestNumber: number,
    officialResult: number[],
    options?: { clock?: Clock }
  ): Promise<ContestRecord> {
    const clock = options?.clock ?? this.options?.clock ?? defaultClock;
    const snapshot = await this.getContestRecord(contestNumber);
    if (!snapshot) {
      throw new Error(`Concurso ${contestNumber} não encontrado para pontuação.`);
    }

    const verification = await this.verifyStoredContest(contestNumber);
    if (!verification.valid) {
      throw new Error(
        `Operação bloqueada: o registro do concurso ${contestNumber} falhou na auditoria de integridade.`
      );
    }

    if (snapshot.status !== "FROZEN") {
      throw new Error(
        `Apenas registros em estado FROZEN podem ser pontuados. Concurso ${contestNumber} possui status: '${snapshot.status}'.`
      );
    }

    // 1. Auditoria prévia do registro FROZEN armazenado (garante que não foi corrompido no banco)
    const preAudit = await verifyContestIntegrity(snapshot);
    if (!preAudit.valid) {
      throw new Error(
        `Recusando pontuação: a integridade do registro congelado no banco foi violada: ${preAudit.errors.join("; ")}`
      );
    }

    // 2. Pontuação pura via motor matemático C5
    const scored = await scoreFrozenContest(snapshot, officialResult, { clock });

    // 3. Auditoria pós-score da integridade da geração congelada
    const postGenAudit = await verifyContestIntegrity(scored);
    if (!postGenAudit.valid) {
      throw new Error(
        `Integridade da geração congelada corrompida após pontuação: ${postGenAudit.errors.join("; ")}`
      );
    }

    // 4. Auditoria independente da pontuação calculada
    const postScoreAudit = verifyScoreIntegrity(scored);
    if (!postScoreAudit.valid) {
      throw new Error(
        `Integridade da pontuação rejeitada na auditoria: ${postScoreAudit.errors.join("; ")}`
      );
    }

    const db = await this.getDB();
    try {
      const tx = db.transaction(CONTEST_STORE_NAME, "readwrite");
      const store = tx.objectStore(CONTEST_STORE_NAME);

      const current = await promisifyRequest<ContestRecord | undefined>(store.get(contestNumber));
      if (!current || !areContestRecordsIdentical(current, snapshot)) {
        throw new Error(
          `O registro do concurso ${contestNumber} mudou durante a operação. Pontuação cancelada para evitar sobrescrita concorrente.`
        );
      }

      const clone = deepCloneRecord(scored);
      await promisifyRequest(store.put(clone));
      await waitForTransaction(tx);
      if (this.shouldNotifyCoordinator()) {
        this.getRefreshCoordinator().notifyMutationCommitted("SCORE", contestNumber);
      }

      return deepCloneRecord(scored);
    } finally {
      closeDatabase(db);
    }
  }

  /**
   * Confirma atomicamente a aposta de um concurso em estado DRAFT (V1.13).
   *
   * Transição pura e atômica:
   * DRAFT -> FROZEN + frozenAt + integrityHash + betPlacedAt
   *
   * Requisitos estritos:
   * 1. Apenas registros no estado DRAFT podem ser confirmados por esta operação;
   * 2. Rejeita registros em SCORED (proibição de confirmação retroativa);
   * 3. Rejeita registros em FROZEN (devem usar confirmBetPlaced legado);
   * 4. Validação de invariantes C5 e integridade antes do congelamento;
   * 5. Timestamps: generatedAt <= frozenAt <= betPlacedAt (frozenAt === betPlacedAt);
   * 6. betPlacedAt permanece fora do FrozenC5Payload;
   * 7. Validação criptográfica pós-congelamento (verifyContestIntegrity);
   * 8. Transação readwrite com proteção TOCTOU (releitura e areContestRecordsIdentical);
   * 9. Se qualquer etapa falhar, o registro no IndexedDB permanece DRAFT original;
   * 10. Emite pós-commit rigorosamente UM evento 'BET_CONFIRMED' (zero evento em falha).
   */
  async confirmDraftBet(
    contestNumber: number,
    options?: { clock?: Clock }
  ): Promise<ContestRecord> {
    const clock = options?.clock ?? this.options?.clock ?? defaultClock;
    const snapshot = await this.getContestRecord(contestNumber);
    if (!snapshot) {
      throw new Error(`Concurso ${contestNumber} não encontrado para confirmação de aposta.`);
    }

    if (snapshot.status === "SCORED") {
      throw new Error(
        `Operação inválida: concursos já apurados (SCORED) não podem ser confirmados. Concurso ${contestNumber} está em estado SCORED.`
      );
    }

    if (snapshot.status === "FROZEN") {
      throw new Error(
        `Operação inválida: a confirmação atômica de rascunho aplica-se a registros DRAFT. O concurso ${contestNumber} já está FROZEN.`
      );
    }

    if (snapshot.status !== "DRAFT") {
      throw new Error(
        `Apenas registros em estado DRAFT podem ser confirmados por esta operação. Concurso ${contestNumber} possui status: '${snapshot.status}'.`
      );
    }

    const validation = validateC5(snapshot.generation);
    if (!validation.valid) {
      throw new Error(
        `Tentativa de confirmar DRAFT com invariantes C5 violadas: ${validation.errors.join("; ")}`
      );
    }

    const now = clock().toISOString();
    const frozenAt = now;
    const betPlacedAt = now;

    if (Date.parse(frozenAt) < Date.parse(snapshot.generatedAt)) {
      throw new Error(
        `Violação de ordem temporal: o timestamp de congelamento/aposta ('${frozenAt}') não pode ser anterior à geração ('${snapshot.generatedAt}').`
      );
    }

    const canonicalPayload = buildCanonicalPayload(
      snapshot.contestNumber,
      snapshot.generationId,
      snapshot.algorithmVersion,
      snapshot.generatedAt,
      frozenAt,
      snapshot.generation
    );

    const serialized = serializeCanonicalPayload(canonicalPayload);
    const integrityHash = await computeSHA256(serialized);

    const updated: ContestRecord = {
      status: "FROZEN",
      contestNumber: snapshot.contestNumber,
      generationId: snapshot.generationId,
      algorithmVersion: snapshot.algorithmVersion,
      generatedAt: snapshot.generatedAt,
      frozenAt,
      integrityHash,
      betPlacedAt,
      generation: deepCloneGeneration(snapshot.generation),
    };

    const audit = await verifyContestIntegrity(updated);
    if (!audit.valid) {
      throw new Error(
        `Falha na auditoria de integridade ao confirmar rascunho do concurso ${contestNumber}: ${audit.errors.join("; ")}`
      );
    }

    const db = await this.getDB();
    try {
      if (this.options?.testHarness?.beforeTransactionCommit) {
        await this.options.testHarness.beforeTransactionCommit(contestNumber, "read");
      }

      const tx = db.transaction(CONTEST_STORE_NAME, "readwrite");
      const store = tx.objectStore(CONTEST_STORE_NAME);

      const current = await promisifyRequest<ContestRecord | undefined>(store.get(contestNumber));
      if (!current || !areContestRecordsIdentical(current, snapshot)) {
        throw new Error(
          `O registro do concurso ${contestNumber} mudou durante a operação. Confirmação de rascunho cancelada para evitar sobrescrita concorrente.`
        );
      }

      if (this.options?.testHarness?.simulateCommitFailure) {
        tx.abort();
        throw new Error("Falha simulada de persistência/commit na transação.");
      }

      if (this.options?.testHarness?.beforeTransactionCommit) {
        await this.options.testHarness.beforeTransactionCommit(contestNumber, "write");
      }

      const clone = deepCloneRecord(updated);
      await promisifyRequest(store.put(clone));
      await waitForTransaction(tx);
      if (this.shouldNotifyCoordinator()) {
        this.getRefreshCoordinator().notifyMutationCommitted("BET_CONFIRMED", contestNumber);
      }

      return deepCloneRecord(updated);
    } finally {
      closeDatabase(db);
    }
  }

  /**
   * Alias de conveniência semântica para confirmDraftBet.
   */
  async freezeAndConfirmBet(
    contestNumber: number,
    options?: { clock?: Clock }
  ): Promise<ContestRecord> {
    return this.confirmDraftBet(contestNumber, options);
  }

  /**
   * Confirma o registro/pagamento dos 5 jogos de um concurso congelado (FROZEN) ou pontuado (SCORED).
   *
   * Requisitos:
   * 1. Apenas registros nos estados FROZEN ou SCORED são permitidos;
   * 2. Rejeita registros em DRAFT;
   * 3. Idempotente: se já possuir betPlacedAt, retorna o registro clonado sem sobrescrever o timestamp original;
   * 4. Validação de integridade antes da gravação;
   * 5. Proteção atômica contra race conditions / TOCTOU;
   * 6. Notifica o refreshCoordinator com motivo 'BET_CONFIRMED' pós-commit.
   */
  async confirmBetPlaced(
    contestNumber: number,
    options?: { clock?: Clock }
  ): Promise<ContestRecord> {
    const clock = options?.clock ?? this.options?.clock ?? defaultClock;
    const snapshot = await this.getContestRecord(contestNumber);
    if (!snapshot) {
      throw new Error(`Concurso ${contestNumber} não encontrado para confirmação de aposta.`);
    }

    if (snapshot.status === "DRAFT") {
      throw new Error(
        `Operação inválida: apenas concursos congelados (FROZEN) podem ter aposta confirmada. Concurso ${contestNumber} está em estado DRAFT.`
      );
    }

    if (snapshot.status === "SCORED") {
      throw new Error(
        `Proibição de confirmação retroativa: o concurso ${contestNumber} já foi apurado (SCORED). A aposta só pode ser confirmada antes da apuração (em estado FROZEN).`
      );
    }

    if (snapshot.status !== "FROZEN") {
      throw new Error(
        `Estado inválido para confirmação de aposta: '${snapshot.status}'. Apenas concursos em estado FROZEN podem ser confirmados.`
      );
    }

    const verification = await this.verifyStoredContest(contestNumber);
    if (!verification.valid) {
      throw new Error(
        `Operação bloqueada: o registro do concurso ${contestNumber} falhou na auditoria de integridade.`
      );
    }

    // Idempotência: se já tiver betPlacedAt, retorna cópia sem alterar timestamp original
    if (snapshot.betPlacedAt) {
      return deepCloneRecord(snapshot);
    }

    const betPlacedAt = clock().toISOString();

    if (snapshot.frozenAt && Date.parse(betPlacedAt) < Date.parse(snapshot.frozenAt)) {
      throw new Error(
        `Violação de ordem temporal: o timestamp da aposta ('${betPlacedAt}') não pode ser anterior ao congelamento ('${snapshot.frozenAt}').`
      );
    }

    const updated: ContestRecord = {
      ...deepCloneRecord(snapshot),
      betPlacedAt,
    };

    const db = await this.getDB();
    try {
      const tx = db.transaction(CONTEST_STORE_NAME, "readwrite");
      const store = tx.objectStore(CONTEST_STORE_NAME);

      const current = await promisifyRequest<ContestRecord | undefined>(store.get(contestNumber));
      if (!current || !areContestRecordsIdentical(current, snapshot)) {
        throw new Error(
          `O registro do concurso ${contestNumber} mudou durante a operação. Confirmação cancelada para evitar sobrescrita concorrente.`
        );
      }

      const clone = deepCloneRecord(updated);
      await promisifyRequest(store.put(clone));
      await waitForTransaction(tx);
      if (this.shouldNotifyCoordinator()) {
        this.getRefreshCoordinator().notifyMutationCommitted("BET_CONFIRMED", contestNumber);
      }

      return deepCloneRecord(updated);
    } finally {
      closeDatabase(db);
    }
  }

  /**
   * Registra o fechamento financeiro / premiação (registro manual) obtida em um concurso SCORED.
   *
   * Requisitos estritos:
   * 1. amountCents deve ser um número inteiro seguro maior ou igual a zero;
   * 2. O concurso deve existir e estar no estado SCORED;
   * 3. O concurso deve ter aposta confirmada (betPlacedAt definido);
   * 4. Imutabilidade: se já possuir prize registrado, a operação é rejeitada (não pode ser sobrescrito);
   * 5. O registro deve passar na auditoria de integridade antes da mutação;
   * 6. Coerência temporal: recordedAt >= scoredAt e recordedAt >= betPlacedAt;
   * 7. Proteção contra TOCTOU com abort em caso de divergência concorrente;
   * 8. Notifica o refreshCoordinator com motivo 'PRIZE_RECORDED' após o commit da transação.
   */
  async recordPrize(
    contestNumber: number,
    amountCents: number,
    options?: { clock?: Clock }
  ): Promise<ContestRecord> {
    if (
      typeof amountCents !== "number" ||
      !Number.isInteger(amountCents) ||
      !Number.isSafeInteger(amountCents) ||
      amountCents < 0
    ) {
      throw new Error(
        `Valor de premiação inválido: ${amountCents}. Deve ser um número inteiro seguro maior ou igual a zero (centavos).`
      );
    }

    const snapshot = await this.getContestRecord(contestNumber);
    if (!snapshot) {
      throw new Error(`Concurso ${contestNumber} não encontrado para registro de prêmio.`);
    }

    if (snapshot.status === "DRAFT") {
      throw new Error(
        `Operação inválida: concursos em estado DRAFT não podem registrar prêmio. Concurso ${contestNumber} está em rascunho.`
      );
    }

    if (snapshot.status === "FROZEN") {
      throw new Error(
        `Operação inválida: concursos em estado FROZEN não podem registrar prêmio antes da apuração. Concurso ${contestNumber} ainda não foi apurado.`
      );
    }

    if (snapshot.status !== "SCORED") {
      throw new Error(
        `Estado inválido para registro de prêmio: '${snapshot.status}'. Apenas concursos em estado SCORED podem registrar prêmio.`
      );
    }

    if (snapshot.betPlacedAt === undefined) {
      throw new Error(
        `Fechamento financeiro indisponível: o concurso ${contestNumber} não teve sua aposta confirmada antes da apuração.`
      );
    }

    if (snapshot.prize !== undefined) {
      throw new Error(
        `Fechamento financeiro já realizado para o concurso ${contestNumber}. O registro de prêmio é imutável e não pode ser reescrito.`
      );
    }

    const verification = await this.verifyStoredContest(contestNumber);
    if (!verification.valid) {
      throw new Error(
        `Operação bloqueada: o registro do concurso ${contestNumber} falhou na auditoria de integridade.`
      );
    }

    const clock = options?.clock ?? this.options?.clock ?? defaultClock;
    const recordedAt = clock().toISOString();

    if (snapshot.scoredAt && Date.parse(recordedAt) < Date.parse(snapshot.scoredAt)) {
      throw new Error(
        `Violação de ordem temporal: o timestamp do prêmio ('${recordedAt}') não pode ser anterior à apuração ('${snapshot.scoredAt}').`
      );
    }

    if (snapshot.betPlacedAt && Date.parse(recordedAt) < Date.parse(snapshot.betPlacedAt)) {
      throw new Error(
        `Violação de ordem temporal: o timestamp do prêmio ('${recordedAt}') não pode ser anterior à aposta ('${snapshot.betPlacedAt}').`
      );
    }

    const prize: PrizeRecord = {
      amountCents,
      recordedAt,
      source: "MANUAL",
    };

    const updated: ContestRecord = {
      ...deepCloneRecord(snapshot),
      prize,
    };

    const db = await this.getDB();
    try {
      const tx = db.transaction(CONTEST_STORE_NAME, "readwrite");
      const store = tx.objectStore(CONTEST_STORE_NAME);

      const current = await promisifyRequest<ContestRecord | undefined>(store.get(contestNumber));
      if (!current || !areContestRecordsIdentical(current, snapshot)) {
        throw new Error(
          `O registro do concurso ${contestNumber} mudou durante a operação. Registro de prêmio cancelado para evitar sobrescrita concorrente.`
        );
      }

      const clone = deepCloneRecord(updated);
      await promisifyRequest(store.put(clone));
      await waitForTransaction(tx);
      if (this.shouldNotifyCoordinator()) {
        this.getRefreshCoordinator().notifyMutationCommitted("PRIZE_RECORDED", contestNumber);
      }

      return deepCloneRecord(updated);
    } finally {
      closeDatabase(db);
    }
  }

  /**
   * Exclui um registro que esteja ESTRITAMENTE em estado DRAFT.
   * Tentativas de excluir registros FROZEN ou SCORED são terminantemente rejeitadas.
   */
  async deleteDraft(contestNumber: number): Promise<void> {
    const snapshot = await this.getContestRecord(contestNumber);
    if (!snapshot) {
      throw new Error(`Concurso ${contestNumber} não encontrado para exclusão.`);
    }

    if (snapshot.status === "FROZEN" || snapshot.status === "SCORED") {
      throw new Error(
        `Operação proibida: registros em estado '${snapshot.status}' não podem ser excluídos da aplicação para assegurar o histórico prospectivo auditável.`
      );
    }

    if (snapshot.status !== "DRAFT") {
      throw new Error(
        `Apenas registros em estado DRAFT podem ser excluídos. Status atual: '${snapshot.status}'.`
      );
    }

    const verification = await this.verifyStoredContest(contestNumber);
    if (!verification.valid) {
      throw new Error(
        `Operação bloqueada: o registro do concurso ${contestNumber} falhou na auditoria de integridade e está em quarentena.`
      );
    }

    const db = await this.getDB();
    try {
      const tx = db.transaction(CONTEST_STORE_NAME, "readwrite");
      const store = tx.objectStore(CONTEST_STORE_NAME);

      const current = await promisifyRequest<ContestRecord | undefined>(store.get(contestNumber));
      if (!current || !areContestRecordsIdentical(current, snapshot)) {
        throw new Error(
          `O registro do concurso ${contestNumber} mudou durante a operação. Exclusão cancelada para evitar exclusão concorrente.`
        );
      }

      await promisifyRequest(store.delete(contestNumber));
      await waitForTransaction(tx);
      if (this.shouldNotifyCoordinator()) {
        this.getRefreshCoordinator().notifyMutationCommitted("DELETE", contestNumber);
      }
    } finally {
      closeDatabase(db);
    }
  }

  /**
  * Audita um concurso persistido individualmente sem alterar seu estado no banco.
  * Inspeciona integridade estrutural, versão de algoritmo, geração C5, integridade criptográfica e pontuação.
  * Se inválido, classifica em quarentena lógica preservando a evidência.
  */
  async verifyStoredContest(contestNumber: number): Promise<StoredContestVerification> {
    const record = await this.getContestRecord(contestNumber);
    if (!record) {
      return {
        exists: false,
        contestNumber,
        status: null,
        generationIntegrity: null,
        scoreIntegrity: null,
        valid: false,
        errors: [`Concurso ${contestNumber} não encontrado no banco.`],
        quarantinedRecord: null,
      };
    }

    const errors: string[] = [];

    // 1. Validação de contestNumber
    if (
      typeof record.contestNumber !== "number" ||
      !Number.isInteger(record.contestNumber) ||
      record.contestNumber <= 0
    ) {
      errors.push(
        `Número de concurso inválido: '${String(record.contestNumber)}'. Deve ser inteiro positivo.`
      );
    }

    // 2. Validação da versão do algoritmo (Requisito 9: não tentar migrar ou interpretar outra versão)
    if (record.algorithmVersion !== C5_ALGORITHM_VERSION) {
      errors.push(
        `Versão de algoritmo desconhecida ou não suportada: '${String(record.algorithmVersion)}'. Suportada apenas '${C5_ALGORITHM_VERSION}'.`
      );
    }

    // 3. Validação do generationId (UUID v4 RFC 4122 estrito)
    if (!isValidGenerationId(record.generationId)) {
      errors.push("Campo 'generationId' inválido: deve ser um UUID v4 RFC 4122 estrito.");
    }

    // 4. Validação do generatedAt (ISO 8601 válido)
    if (!isValidIsoDate(record.generatedAt)) {
      errors.push("Campo 'generatedAt' inválido: deve ser um timestamp ISO 8601 válido.");
    }

    // 5. Validação estrutural da geração C5
    if (!record.generation || typeof record.generation !== "object") {
      errors.push("Campo 'generation' ausente ou inválido.");
    } else {
      const c5Val = validateC5(record.generation);
      if (!c5Val.valid) {
        errors.push(...c5Val.errors);
      }
    }

    // 6. Validação específica de acordo com o status
    let genAudit: any = null;
    let scoreAudit: any = null;

    const isKnownStatus =
      record.status === "DRAFT" || record.status === "FROZEN" || record.status === "SCORED";

    if (!isKnownStatus) {
      errors.push(`Status de concurso inválido ou desconhecido: '${String(record.status)}'.`);
    } else if (record.status === "DRAFT") {
      if (record.frozenAt !== undefined) errors.push("DRAFT não deve possuir frozenAt");
      if (record.betPlacedAt !== undefined) errors.push("DRAFT não deve possuir betPlacedAt");
      if (record.prize !== undefined) errors.push("DRAFT não deve possuir prize");
      if (record.integrityHash !== undefined) errors.push("DRAFT não deve possuir integrityHash");
      if (record.officialResult !== undefined) errors.push("DRAFT não deve possuir officialResult");
      if (record.score !== undefined) errors.push("DRAFT não deve possuir score");
      if (record.scoredAt !== undefined) errors.push("DRAFT não deve possuir scoredAt");
    } else if (record.status === "FROZEN") {
      if (!isValidIsoDate(record.frozenAt)) {
        errors.push("FROZEN deve possuir frozenAt com timestamp ISO 8601 válido");
      }
      if (record.betPlacedAt !== undefined) {
        if (!isValidIsoDate(record.betPlacedAt)) {
          errors.push("FROZEN com betPlacedAt deve possuir timestamp ISO 8601 válido");
        } else if (isValidIsoDate(record.frozenAt) && Date.parse(record.betPlacedAt) < Date.parse(record.frozenAt)) {
          errors.push("Incoerência temporal: betPlacedAt anterior a frozenAt");
        }
      }
      if (record.prize !== undefined) errors.push("FROZEN não deve possuir prize");
      if (
        typeof record.integrityHash !== "string" ||
        !/^[0-9a-fA-F]{64}$/.test(record.integrityHash)
      ) {
        errors.push("FROZEN deve possuir integrityHash SHA-256 válido (64 caracteres hexadecimais)");
      }
      if (record.officialResult !== undefined) errors.push("FROZEN não deve possuir officialResult");
      if (record.score !== undefined) errors.push("FROZEN não deve possuir score");
      if (record.scoredAt !== undefined) errors.push("FROZEN não deve possuir scoredAt");

      if (
        isValidIsoDate(record.generatedAt) &&
        isValidIsoDate(record.frozenAt) &&
        Date.parse(record.frozenAt) < Date.parse(record.generatedAt)
      ) {
        errors.push("Incoerência temporal: frozenAt anterior a generatedAt");
      }

      // Verificação criptográfica da geração congelada
      if (record.generation && typeof record.generation === "object") {
        try {
          genAudit = await verifyContestIntegrity(record);
          if (!genAudit.valid) {
            errors.push(...genAudit.errors);
          }
        } catch (e: any) {
          errors.push(`Falha na verificação de integridade: ${e?.message || "estrutura de geração corrompida"}`);
        }
      }
    } else if (record.status === "SCORED") {
      if (!isValidIsoDate(record.frozenAt)) {
        errors.push("SCORED deve possuir frozenAt com timestamp ISO 8601 válido");
      }
      if (record.betPlacedAt !== undefined) {
        if (!isValidIsoDate(record.betPlacedAt)) {
          errors.push("SCORED com betPlacedAt deve possuir timestamp ISO 8601 válido");
        } else if (isValidIsoDate(record.frozenAt) && Date.parse(record.betPlacedAt) < Date.parse(record.frozenAt)) {
          errors.push("Incoerência temporal: betPlacedAt anterior a frozenAt");
        }
      }
      if (
        typeof record.integrityHash !== "string" ||
        !/^[0-9a-fA-F]{64}$/.test(record.integrityHash)
      ) {
        errors.push("SCORED deve possuir integrityHash SHA-256 válido (64 caracteres hexadecimais)");
      }
      if (!isValidIsoDate(record.scoredAt)) {
        errors.push("SCORED deve possuir scoredAt com timestamp ISO 8601 válido");
      }

      if (
        isValidIsoDate(record.generatedAt) &&
        isValidIsoDate(record.frozenAt) &&
        Date.parse(record.frozenAt) < Date.parse(record.generatedAt)
      ) {
        errors.push("Incoerência temporal: frozenAt anterior a generatedAt");
      }
      if (
        isValidIsoDate(record.frozenAt) &&
        isValidIsoDate(record.scoredAt) &&
        Date.parse(record.scoredAt) < Date.parse(record.frozenAt)
      ) {
        errors.push("Incoerência temporal: scoredAt anterior a frozenAt");
      }

      // Validação de fechamento financeiro / premiação (prize)
      if (record.prize !== undefined) {
        if (record.betPlacedAt === undefined) {
          errors.push("SCORED com prêmio deve possuir aposta previamente confirmada ('betPlacedAt')");
        }
        if (typeof record.prize !== "object" || record.prize === null) {
          errors.push("Campo 'prize' deve ser um objeto válido");
        } else {
          if (
            typeof record.prize.amountCents !== "number" ||
            !Number.isInteger(record.prize.amountCents) ||
            !Number.isSafeInteger(record.prize.amountCents) ||
            record.prize.amountCents < 0
          ) {
            errors.push("Campo 'prize.amountCents' deve ser um número inteiro seguro maior ou igual a zero");
          }
          if (record.prize.source !== "MANUAL") {
            errors.push("Campo 'prize.source' deve ser 'MANUAL'");
          }
          if (!isValidIsoDate(record.prize.recordedAt)) {
            errors.push("Campo 'prize.recordedAt' deve ser um timestamp ISO 8601 válido");
          } else {
            if (
              isValidIsoDate(record.scoredAt) &&
              Date.parse(record.prize.recordedAt) < Date.parse(record.scoredAt)
            ) {
              errors.push("Incoerência temporal: prize.recordedAt anterior a scoredAt");
            }
            if (
              isValidIsoDate(record.betPlacedAt) &&
              Date.parse(record.prize.recordedAt) < Date.parse(record.betPlacedAt)
            ) {
              errors.push("Incoerência temporal: prize.recordedAt anterior a betPlacedAt");
            }
          }
        }
      }

      // Integridade criptográfica da geração
      if (record.generation && typeof record.generation === "object") {
        try {
          genAudit = await verifyContestIntegrity(record);
          if (!genAudit.valid) {
            errors.push(...genAudit.errors);
          }
        } catch (e: any) {
          errors.push(`Falha na verificação de integridade: ${e?.message || "estrutura de geração corrompida"}`);
        }
      }

      // Validação das dezenas do resultado oficial
      if (!Array.isArray(record.officialResult) || record.officialResult.length !== 15) {
        errors.push("SCORED deve possuir officialResult contendo exatamente 15 dezenas.");
      } else {
        const set = new Set<number>();
        let sorted = true;
        let inRange = true;
        for (let i = 0; i < record.officialResult.length; i++) {
          const n = record.officialResult[i];
          if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 25) inRange = false;
          if (set.has(n)) {
            // duplicata detectada
          } else {
            set.add(n);
          }
          if (i > 0 && n <= record.officialResult[i - 1]) sorted = false;
        }
        if (!inRange) errors.push("officialResult contém dezenas fora do intervalo 1..25.");
        if (set.size !== 15) errors.push("officialResult contém dezenas duplicadas.");
        if (!sorted) errors.push("officialResult deve estar estritamente ordenado de forma crescente.");
      }

      // Validação e auditoria do score
      if (!record.score || typeof record.score !== "object") {
        errors.push("SCORED deve possuir objeto score.");
      } else {
        try {
          scoreAudit = verifyScoreIntegrity(record);
          if (!scoreAudit.valid) {
            errors.push(...scoreAudit.errors);
          }
        } catch (e: any) {
          errors.push(`Falha na auditoria do score: ${e?.message || "estrutura de pontuação corrompida"}`);
        }
      }
    }

    const clock = this.options?.clock ?? defaultClock;
    const valid = errors.length === 0;
    let quarantinedRecord: QuarantinedRecord | null = null;

    if (!valid) {
      quarantinedRecord = {
        contestNumber:
          typeof record.contestNumber === "number" ? record.contestNumber : contestNumber,
        persistedStatus: isKnownStatus
          ? (record.status as ContestRecordStatus)
          : "UNKNOWN",
        reasons: [...errors],
        detectedAt: clock().toISOString(),
      };
    }

    return {
      exists: true,
      contestNumber,
      status: isKnownStatus ? (record.status as ContestRecordStatus) : null,
      generationIntegrity: genAudit,
      scoreIntegrity: scoreAudit,
      valid,
      errors,
      quarantinedRecord,
    };
  }

  /**
   * Calcula o resumo estatístico do histórico derivado unicamente a partir dos registros válidos SCORED.
   * Registros em quarentena são ignorados nos cálculos métricos e contados separadamente.
   * Não armazena estatísticas redundantes em disco.
   */
  async getHistorySummary(): Promise<HistorySummary> {
    const all = await this.getAllContestRecords();

    let drafts = 0;
    let frozen = 0;
    let scored = 0;
    let validRecords = 0;
    let quarantinedRecords = 0;
    let confirmedBets = 0;
    let prizesRecorded = 0;
    let totalPrizeCents = 0;
    let pendingFinancialClosures = 0;

    let hits11 = 0;
    let hits12 = 0;
    let hits13 = 0;
    let hits14 = 0;
    let hits15 = 0;

    let contestsWith11Plus = 0;
    let contestsWith12Plus = 0;
    let contestsWith13Plus = 0;
    let contestsWith14Plus = 0;
    let contestsWith15 = 0;

    const maxHitsList: number[] = [];

    for (const record of all) {
      const audit = await this.verifyStoredContest(record.contestNumber);
      if (!audit.valid) {
        quarantinedRecords++;
        continue;
      }

      validRecords++;

      if (record.betPlacedAt !== undefined) {
        confirmedBets++;
      }

      if (record.status === "DRAFT") {
        drafts++;
      } else if (record.status === "FROZEN") {
        frozen++;
      } else if (record.status === "SCORED" && record.score) {
        scored++;
        const s = record.score;

        // Total de jogos individuais por faixa
        hits11 += s.prizeCounts.hits11;
        hits12 += s.prizeCounts.hits12;
        hits13 += s.prizeCounts.hits13;
        hits14 += s.prizeCounts.hits14;
        hits15 += s.prizeCounts.hits15;

        // Quantidade de concursos com pelo menos 1 jogo na faixa cumulativa
        if (s.has11Plus) contestsWith11Plus++;
        if (s.has12Plus) contestsWith12Plus++;
        if (s.has13Plus) contestsWith13Plus++;
        if (s.has14Plus) contestsWith14Plus++;
        if (s.has15) contestsWith15++;

        maxHitsList.push(s.maxHits);

        // Acompanhamento financeiro de prêmios
        if (record.betPlacedAt !== undefined) {
          if (record.prize !== undefined) {
            prizesRecorded++;
            totalPrizeCents += record.prize.amountCents;
          } else {
            pendingFinancialClosures++;
          }
        }
      }
    }

    const contestsPlayed = scored;
    const bestMaxHits = maxHitsList.length > 0 ? Math.max(...maxHitsList) : null;
    const averageMaxHits =
      maxHitsList.length > 0
        ? Number((maxHitsList.reduce((acc, h) => acc + h, 0) / maxHitsList.length).toFixed(4))
        : null;

    const totalSpent = calculateTotalCostCents(contestsPlayed) / 100;
    const confirmedSpentCents = calculateTotalCostCents(confirmedBets);
    const confirmedSpent = confirmedSpentCents / 100;

    const totalPrize = totalPrizeCents / 100;
    const netResultCents = totalPrizeCents - confirmedSpentCents;
    const netResult = netResultCents / 100;
    const financialHistoryComplete = pendingFinancialClosures === 0;

    return {
      totalRecords: all.length,
      validRecords,
      quarantinedRecords,
      drafts,
      frozen,
      scored,
      contestsPlayed,
      hits11,
      hits12,
      hits13,
      hits14,
      hits15,
      contestsWith11Plus,
      contestsWith12Plus,
      contestsWith13Plus,
      contestsWith14Plus,
      contestsWith15,
      bestMaxHits,
      averageMaxHits,
      totalSpent,
      confirmedBets,
      confirmedSpentCents,
      confirmedSpent,
      prizesRecorded,
      totalPrizeCents,
      totalPrize,
      netResultCents,
      netResult,
      pendingFinancialClosures,
      financialHistoryComplete,
    };
  }

  /**
   * Realiza uma auditoria completa em toda a base persistida.
   * Não corrige nada automaticamente: reporta fidelidade absoluta e classifica em quarentena lógica.
   */
  async auditEntireHistory(): Promise<HistoryAuditResult> {
    const all = await this.getAllContestRecords();
    const details: HistoryAuditRecordDetail[] = [];
    const quarantinedList: QuarantinedRecord[] = [];
    let validCount = 0;
    let quarantinedCount = 0;

    for (const record of all) {
      const verification = await this.verifyStoredContest(record.contestNumber);
      const isValid = verification.valid;
      if (isValid) {
        validCount++;
      } else {
        quarantinedCount++;
        if (verification.quarantinedRecord) {
          quarantinedList.push(verification.quarantinedRecord);
        }
      }
      details.push({
        contestNumber: record.contestNumber,
        status: record.status,
        valid: isValid,
        errors: verification.errors,
      });
    }

    return {
      valid: quarantinedCount === 0,
      totalRecords: all.length,
      validRecords: validCount,
      invalidRecords: quarantinedCount,
      quarantinedRecords: quarantinedCount,
      quarantinedList,
      records: details,
    };
  }

  /**
   * Exporta os dados do histórico para backup em estrutura JSON pura e serializável.
   * Requisito v1.3: Se existirem registros em quarentena, BLOQUEIA a exportação operacional normal
   * para evitar propagar dados corrompidos.
   * Não causa nenhuma mutação no banco de dados.
   */
  async exportHistory(): Promise<HistoryExportData> {
    const audit = await this.auditEntireHistory();
    if (!audit.valid || audit.quarantinedRecords > 0) {
      throw new Error(
        "O histórico contém registros que falharam na auditoria. O backup operacional foi bloqueado para evitar propagar dados corrompidos."
      );
    }

    const all = await this.getAllContestRecords();
    // Ordenação OBRIGATÓRIA da exportação: contestNumber ASC
    all.sort((a, b) => a.contestNumber - b.contestNumber);
    const versions = Array.from(new Set(all.map((r) => r.algorithmVersion)));
    const clock = this.options?.clock ?? defaultClock;

    return {
      schemaVersion: 3,
      exportedAt: clock().toISOString(),
      recordCount: all.length,
      algorithmVersions: versions,
      records: all.map(deepCloneRecord),
    };
  }

  /**
   * Exporta exclusivamente os metadados de diagnóstico e quarentena (sem jogos completos).
   * Funciona mesmo com banco em quarentena para fins de depuração segura.
   */
  async exportDiagnostic(): Promise<DiagnosticExport> {
    const audit = await this.auditEntireHistory();
    const clock = this.options?.clock ?? defaultClock;
    const quarantined = (audit.quarantinedList ?? []).map((q) => ({
      contestNumber: q.contestNumber,
      persistedStatus: String(q.persistedStatus),
      reasons: [...q.reasons],
    }));

    return {
      diagnosticSchemaVersion: 1,
      exportedAt: clock().toISOString(),
      appVersion: APP_VERSION,
      algorithmVersion: C5_ALGORITHM_VERSION,
      audit: {
        totalRecords: audit.totalRecords,
        validRecords: audit.validRecords,
        quarantinedRecords: audit.quarantinedRecords,
      },
      quarantined,
    };
  }
}

/**
 * Instância padrão compartilhada do repositório.
 */
export const contestRepository = new ContestRepository();
export const repository = contestRepository;

// Funções delegadas para export direto compatível com a API solicitada
export const saveDraft = (record: ContestRecord) => contestRepository.saveDraft(record);
export const getContestRecord = (contestNumber: number) =>
  contestRepository.getContestRecord(contestNumber);
export const getAllContestRecords = () => contestRepository.getAllContestRecords();
export const freezeStoredContest = (contestNumber: number, options?: { clock?: Clock }) =>
  contestRepository.freezeStoredContest(contestNumber, options);
export const scoreStoredContest = (
  contestNumber: number,
  officialResult: number[],
  options?: { clock?: Clock }
) => contestRepository.scoreStoredContest(contestNumber, officialResult, options);
export const confirmBetPlaced = (contestNumber: number, options?: { clock?: Clock }) =>
  contestRepository.confirmBetPlaced(contestNumber, options);
export const recordPrize = (
  contestNumber: number,
  amountCents: number,
  options?: { clock?: Clock }
) => contestRepository.recordPrize(contestNumber, amountCents, options);
export const deleteDraft = (contestNumber: number) => contestRepository.deleteDraft(contestNumber);
export const verifyStoredContest = (contestNumber: number) =>
  contestRepository.verifyStoredContest(contestNumber);
export const getHistorySummary = () => contestRepository.getHistorySummary();
export const auditEntireHistory = () => contestRepository.auditEntireHistory();
export const exportHistory = () => contestRepository.exportHistory();
export const exportDiagnostic = () => contestRepository.exportDiagnostic();
