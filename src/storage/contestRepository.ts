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
import { verifyContestIntegrity } from "../c5/integrity.ts";
import type { ContestRecord, Clock } from "../c5/types.ts";
import {
  openDatabase,
  closeDatabase,
  promisifyRequest,
  waitForTransaction,
  CONTEST_STORE_NAME,
} from "./db.ts";
import {
  BET_PRICE,
  BETS_PER_CONTEST,
  COST_PER_CONTEST,
  COST_PER_CONTEST_CENTS,
  calculateTotalCostCents,
  type HistorySummary,
  type StoredContestVerification,
  type HistoryAuditResult,
  type HistoryAuditRecordDetail,
  type HistoryExportData,
  type StorageOptions,
} from "./types.ts";

export { BET_PRICE, BETS_PER_CONTEST, COST_PER_CONTEST, COST_PER_CONTEST_CENTS, calculateTotalCostCents };

/**
 * Realiza clonagem defensiva profunda de um ContestRecord completo.
 */
export function deepCloneRecord(record: ContestRecord): ContestRecord {
  return {
    status: record.status,
    contestNumber: record.contestNumber,
    generationId: record.generationId,
    algorithmVersion: record.algorithmVersion,
    generatedAt: record.generatedAt,
    frozenAt: record.frozenAt,
    integrityHash: record.integrityHash,
    officialResult: record.officialResult ? [...record.officialResult] : undefined,
    scoredAt: record.scoredAt,
    score: record.score ? deepCloneScore(record.score) : undefined,
    generation: deepCloneGeneration(record.generation),
  };
}

/**
 * Repositório do Histórico Prospectivo de Concursos C₅.
 */
export class ContestRepository {
  private options?: StorageOptions;

  constructor(options?: StorageOptions) {
    this.options = options;
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
    const existing = await this.getContestRecord(contestNumber);
    if (!existing) {
      throw new Error(`Concurso ${contestNumber} não encontrado para congelamento.`);
    }

    if (existing.status !== "DRAFT") {
      throw new Error(
        `Apenas registros em estado DRAFT podem ser congelados. Concurso ${contestNumber} possui status: '${existing.status}'.`
      );
    }

    // Transição pura via motor matemático C5 (cálculo de hash assíncrono Web Crypto)
    const frozen = await freezeContestRecord(existing, { clock });

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
      if (!current || current.status !== "DRAFT") {
        throw new Error(
          `Apenas registros em estado DRAFT podem ser congelados. Concurso ${contestNumber} possui status: '${current?.status}'.`
        );
      }

      const clone = deepCloneRecord(frozen);
      await promisifyRequest(store.put(clone));
      await waitForTransaction(tx);

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
    const existing = await this.getContestRecord(contestNumber);
    if (!existing) {
      throw new Error(`Concurso ${contestNumber} não encontrado para pontuação.`);
    }

    if (existing.status !== "FROZEN") {
      throw new Error(
        `Apenas registros em estado FROZEN podem ser pontuados. Concurso ${contestNumber} possui status: '${existing.status}'.`
      );
    }

    // 1. Auditoria prévia do registro FROZEN armazenado (garante que não foi corrompido no banco)
    const preAudit = await verifyContestIntegrity(existing);
    if (!preAudit.valid) {
      throw new Error(
        `Recusando pontuação: a integridade do registro congelado no banco foi violada: ${preAudit.errors.join("; ")}`
      );
    }

    // 2. Pontuação pura via motor matemático C5
    const scored = await scoreFrozenContest(existing, officialResult, { clock });

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
      if (!current || current.status !== "FROZEN") {
        throw new Error(
          `Apenas registros em estado FROZEN podem ser pontuados. Concurso ${contestNumber} possui status: '${current?.status}'.`
        );
      }

      const clone = deepCloneRecord(scored);
      await promisifyRequest(store.put(clone));
      await waitForTransaction(tx);

      return deepCloneRecord(scored);
    } finally {
      closeDatabase(db);
    }
  }

  /**
   * Exclui um registro que esteja ESTRITAMENTE em estado DRAFT.
   * Tentativas de excluir registros FROZEN ou SCORED são terminantemente rejeitadas.
   */
  async deleteDraft(contestNumber: number): Promise<void> {
    const db = await this.getDB();
    try {
      const tx = db.transaction(CONTEST_STORE_NAME, "readwrite");
      const store = tx.objectStore(CONTEST_STORE_NAME);

      const existing = await promisifyRequest<ContestRecord | undefined>(store.get(contestNumber));
      if (!existing) {
        throw new Error(`Concurso ${contestNumber} não encontrado para exclusão.`);
      }

      if (existing.status === "FROZEN" || existing.status === "SCORED") {
        throw new Error(
          `Operação proibida: registros em estado '${existing.status}' não podem ser excluídos da aplicação para assegurar o histórico prospectivo auditável.`
        );
      }

      if (existing.status !== "DRAFT") {
        throw new Error(
          `Apenas registros em estado DRAFT podem ser excluídos. Status atual: '${existing.status}'.`
        );
      }

      await promisifyRequest(store.delete(contestNumber));
      await waitForTransaction(tx);
    } finally {
      closeDatabase(db);
    }
  }

  /**
   * Audita um concurso persistido individualmente sem alterar seu estado no banco.
   * Inspeciona integridade criptográfica da geração e da pontuação (quando SCORED).
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
      };
    }

    if (record.status === "DRAFT") {
      const c5Validation = validateC5(record.generation);
      const errors = [...c5Validation.errors];
      if (!record.generationId) errors.push("DRAFT não possui generationId");
      if (!record.generatedAt) errors.push("DRAFT não possui generatedAt");
      if (record.frozenAt !== undefined) errors.push("DRAFT não deve possuir frozenAt");
      if (record.integrityHash !== undefined) errors.push("DRAFT não deve possuir integrityHash");

      return {
        exists: true,
        contestNumber,
        status: "DRAFT",
        generationIntegrity: null,
        scoreIntegrity: null,
        valid: c5Validation.valid && errors.length === 0,
        errors,
      };
    }

    if (record.status === "FROZEN") {
      const genAudit = await verifyContestIntegrity(record);
      const errors = [...genAudit.errors];
      if (record.score !== undefined) errors.push("FROZEN não deve possuir score");
      if (record.officialResult !== undefined) errors.push("FROZEN não deve possuir officialResult");
      if (record.scoredAt !== undefined) errors.push("FROZEN não deve possuir scoredAt");

      return {
        exists: true,
        contestNumber,
        status: "FROZEN",
        generationIntegrity: genAudit,
        scoreIntegrity: null,
        valid: genAudit.valid && errors.length === genAudit.errors.length,
        errors,
      };
    }

    // status === "SCORED"
    const genAudit = await verifyContestIntegrity(record);
    const scoreAudit = verifyScoreIntegrity(record);
    const errors = [...genAudit.errors, ...scoreAudit.errors];

    return {
      exists: true,
      contestNumber,
      status: "SCORED",
      generationIntegrity: genAudit,
      scoreIntegrity: scoreAudit,
      valid: genAudit.valid && scoreAudit.valid && errors.length === 0,
      errors,
    };
  }

  /**
   * Calcula o resumo estatístico do histórico derivado unicamente a partir dos registros SCORED.
   * Não armazena estatísticas redundantes em disco.
   */
  async getHistorySummary(): Promise<HistorySummary> {
    const all = await this.getAllContestRecords();

    let drafts = 0;
    let frozen = 0;
    let scored = 0;

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
      }
    }

    const contestsPlayed = scored;
    const bestMaxHits = maxHitsList.length > 0 ? Math.max(...maxHitsList) : null;
    const averageMaxHits =
      maxHitsList.length > 0
        ? Number((maxHitsList.reduce((acc, h) => acc + h, 0) / maxHitsList.length).toFixed(4))
        : null;

    const totalSpent = calculateTotalCostCents(contestsPlayed) / 100;

    return {
      totalRecords: all.length,
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
    };
  }

  /**
   * Realiza uma auditoria completa em toda a base persistida.
   * Não corrige nada automaticamente: reporta fidelidade absoluta de cada registro.
   */
  async auditEntireHistory(): Promise<HistoryAuditResult> {
    const all = await this.getAllContestRecords();
    const details: HistoryAuditRecordDetail[] = [];
    let validCount = 0;
    let invalidCount = 0;

    for (const record of all) {
      const verification = await this.verifyStoredContest(record.contestNumber);
      const isValid = verification.valid;
      if (isValid) {
        validCount++;
      } else {
        invalidCount++;
      }
      details.push({
        contestNumber: record.contestNumber,
        status: record.status,
        valid: isValid,
        errors: verification.errors,
      });
    }

    return {
      valid: invalidCount === 0,
      totalRecords: all.length,
      validRecords: validCount,
      invalidRecords: invalidCount,
      records: details,
    };
  }

  /**
   * Exporta os dados do histórico para backup em estrutura JSON pura e serializável.
   * Ordenação obrigatória: contestNumber ASC conforme especificação v1.2.
   * Não causa nenhuma mutação no banco de dados.
   */
  async exportHistory(): Promise<HistoryExportData> {
    const all = await this.getAllContestRecords();
    // Ordenação OBRIGATÓRIA da exportação: contestNumber ASC
    all.sort((a, b) => a.contestNumber - b.contestNumber);
    const versions = Array.from(new Set(all.map((r) => r.algorithmVersion)));
    const clock = this.options?.clock ?? defaultClock;

    return {
      schemaVersion: 1,
      exportedAt: clock().toISOString(),
      recordCount: all.length,
      algorithmVersions: versions,
      records: all.map(deepCloneRecord),
    };
  }
}

/**
 * Instância padrão compartilhada do repositório.
 */
export const contestRepository = new ContestRepository();

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
export const deleteDraft = (contestNumber: number) => contestRepository.deleteDraft(contestNumber);
export const verifyStoredContest = (contestNumber: number) =>
  contestRepository.verifyStoredContest(contestNumber);
export const getHistorySummary = () => contestRepository.getHistorySummary();
export const auditEntireHistory = () => contestRepository.auditEntireHistory();
export const exportHistory = () => contestRepository.exportHistory();
