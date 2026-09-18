/**
 * Módulo de importação segura e transacional de backups JSON do Gerador Oficial C₅.
 *
 * Arquitetura de 4 fases estritas:
 * 1. PARSE: leitura defensiva com limites de tamanho e proteção contra prototype pollution;
 * 2. VALIDAÇÃO: verificação estrutural e criptográfica completa de 100% dos registros antes de qualquer persistência;
 * 3. PLANEJAMENTO: prévia detalhada com detecção de novos, idênticos e conflitos com a base local;
 * 4. COMMIT ATÔMICO: revalidação TOCTOU e gravação em transação única IndexedDB readwrite.
 */
import { validateC5 } from "../c5/validator.ts";
import { verifyContestIntegrity } from "../c5/integrity.ts";
import { verifyScoreIntegrity } from "../c5/record.ts";
import { validateOfficialResult, scoreC5 } from "../c5/scorer.ts";
import { C5_SLOTS } from "../c5/constants.ts";
import {
  ContestRepository,
  contestRepository,
  deepCloneRecord,
} from "./contestRepository.ts";
import type {
  ContestRecord,
  ContestRecordStatus,
  C5Generation,
  C5Score,
  HitCount,
} from "../c5/types.ts";
import {
  type HistoryExportData,
  type HistoryAuditResult,
  UUID_V4_REGEX,
  isValidIsoDate,
  isValidGenerationId,
} from "./types.ts";

import { areContestRecordsIdentical } from "./recordComparison.ts";

export { UUID_V4_REGEX, isValidIsoDate, isValidGenerationId, areContestRecordsIdentical };

// ============================================================================
// CONSTANTES DEFENSIVAS CENTRAIS
// ============================================================================

/**
 * Limite máximo defensivo de tamanho do arquivo JSON (10 MB).
 */
export const MAX_JSON_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Limite máximo defensivo de registros por backup (100.000).
 */
export const MAX_BACKUP_RECORDS = 100_000;

/**
 * Versão do esquema suportada nesta versão (estritamente 1).
 */
export const EXPECTED_SCHEMA_VERSION = 1;

/**
 * Versões do algoritmo C5 aceitas nesta versão operacional.
 */
export const SUPPORTED_ALGORITHM_VERSIONS = ["C5-1.0.0"] as const;

// ============================================================================
// TIPOS E INTERFACES
// ============================================================================

export type ImportRecordAction = "IMPORT" | "SKIP_IDENTICAL" | "CONFLICT";

export interface ImportPlanRecordDetail {
  contestNumber: number;
  action: ImportRecordAction;
  localStatus?: ContestRecordStatus;
  backupStatus: ContestRecordStatus;
  localGenerationId?: string;
  backupGenerationId?: string;
  localIntegrityHash?: string;
  backupIntegrityHash?: string;
  reason?: string;
}

export interface ImportPlan {
  valid: boolean;
  totalBackupRecords: number;
  newRecords: number;
  identicalRecords: number;
  conflicts: number;
  invalidRecords: number;
  records: ImportPlanRecordDetail[];
  errors: string[];
  preparedRecordsToImport: ContestRecord[];
  backupData?: HistoryExportData;
}

export interface BackupValidationResult {
  valid: boolean;
  data?: HistoryExportData;
  errors: string[];
}

export interface ImportExecutionResult {
  success: boolean;
  importedCount: number;
  skippedIdenticalCount: number;
  conflictCount: number;
  historyAudit: HistoryAuditResult;
}

// ============================================================================
// AUXILIARES DE VALIDAÇÃO PURA
// ============================================================================

/**
 * Higieniza e reconstrói defensivamente um objeto C5Generation,
 * garantindo ausência de propriedades herdadas ou poluição de protótipo.
 */
function sanitizeGeneration(raw: any, contestNumber: number, errors: string[]): C5Generation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(`Concurso ${contestNumber}: 'generation' deve ser um objeto.`);
    return null;
  }

  // 1. permutation
  if (!Array.isArray(raw.permutation) || raw.permutation.length !== 25) {
    errors.push(`Concurso ${contestNumber}: 'generation.permutation' deve ser um array com exatamente 25 dezenas.`);
    return null;
  }
  const permutation: number[] = [];
  for (const n of raw.permutation) {
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 25) {
      errors.push(`Concurso ${contestNumber}: dezena inválida na permutação: ${String(n)}.`);
      return null;
    }
    permutation.push(n);
  }

  // 2. slotAssignments
  if (!raw.slotAssignments || typeof raw.slotAssignments !== "object" || Array.isArray(raw.slotAssignments)) {
    errors.push(`Concurso ${contestNumber}: 'generation.slotAssignments' deve ser um objeto.`);
    return null;
  }
  const slotAssignments: Record<string, number> = Object.create(null);
  for (const slot of C5_SLOTS) {
    const val = raw.slotAssignments[slot];
    if (typeof val !== "number" || !Number.isInteger(val) || val < 1 || val > 25) {
      errors.push(`Concurso ${contestNumber}: slotAssignment '${slot}' inválido ou ausente: ${String(val)}.`);
      return null;
    }
    slotAssignments[slot] = val;
  }

  // 3. games (exatamente 5 jogos de 15 dezenas cada)
  if (!Array.isArray(raw.games) || raw.games.length !== 5) {
    errors.push(`Concurso ${contestNumber}: 'generation.games' deve conter exatamente 5 jogos.`);
    return null;
  }
  const games: [number[], number[], number[], number[], number[]] = [[], [], [], [], []];
  for (let i = 0; i < 5; i++) {
    const game = raw.games[i];
    if (!Array.isArray(game) || game.length !== 15) {
      errors.push(`Concurso ${contestNumber}: jogo J${i + 1} deve possuir exatamente 15 dezenas.`);
      return null;
    }
    const cleanGame: number[] = [];
    for (const num of game) {
      if (typeof num !== "number" || !Number.isInteger(num) || num < 1 || num > 25) {
        errors.push(`Concurso ${contestNumber}: dezena inválida no jogo J${i + 1}: ${String(num)}.`);
        return null;
      }
      cleanGame.push(num);
    }
    games[i] = cleanGame;
  }

  return {
    permutation,
    slotAssignments: { ...slotAssignments },
    games,
  };
}

/**
 * Higieniza e reconstrói defensivamente um objeto C5Score a partir de dados brutos.
 */
function sanitizeScore(raw: any, contestNumber: number, errors: string[]): C5Score | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(`Concurso ${contestNumber}: 'score' deve ser um objeto.`);
    return null;
  }

  if (!Array.isArray(raw.result) || raw.result.length !== 15) {
    errors.push(`Concurso ${contestNumber}: 'score.result' deve possuir exatamente 15 dezenas.`);
    return null;
  }

  if (!Array.isArray(raw.games) || raw.games.length !== 5) {
    errors.push(`Concurso ${contestNumber}: 'score.games' deve possuir exatamente 5 jogos.`);
    return null;
  }

  if (typeof raw.maxHits !== "number" || !Number.isInteger(raw.maxHits)) {
    errors.push(`Concurso ${contestNumber}: 'score.maxHits' deve ser um número inteiro.`);
    return null;
  }

  if (!Array.isArray(raw.bestGameIndexes)) {
    errors.push(`Concurso ${contestNumber}: 'score.bestGameIndexes' deve ser um array.`);
    return null;
  }

  if (!raw.prizeCounts || typeof raw.prizeCounts !== "object") {
    errors.push(`Concurso ${contestNumber}: 'score.prizeCounts' deve ser um objeto.`);
    return null;
  }

  const cleanScoreGames: C5Score["games"] = [] as any;
  for (let i = 0; i < 5; i++) {
    const g = raw.games[i];
    if (!g || typeof g !== "object") {
      errors.push(`Concurso ${contestNumber}: 'score.games[${i}]' inválido.`);
      return null;
    }
    if (g.gameIndex !== (i + 1)) {
      errors.push(`Concurso ${contestNumber}: 'score.games[${i}].gameIndex' deve ser ${i + 1}.`);
    }
    cleanScoreGames.push({
      gameIndex: g.gameIndex,
      hits: Number(g.hits) as HitCount,
      matchedNumbers: Array.isArray(g.matchedNumbers) ? [...g.matchedNumbers] : [],
      missedNumbers: Array.isArray(g.missedNumbers) ? [...g.missedNumbers] : [],
    });
  }

  return {
    result: [...raw.result],
    games: cleanScoreGames,
    maxHits: raw.maxHits,
    bestGameIndexes: [...raw.bestGameIndexes],
    prizeCounts: {
      hits11: Number(raw.prizeCounts.hits11 ?? 0),
      hits12: Number(raw.prizeCounts.hits12 ?? 0),
      hits13: Number(raw.prizeCounts.hits13 ?? 0),
      hits14: Number(raw.prizeCounts.hits14 ?? 0),
      hits15: Number(raw.prizeCounts.hits15 ?? 0),
    },
    has11Plus: Boolean(raw.has11Plus),
    has12Plus: Boolean(raw.has12Plus),
    has13Plus: Boolean(raw.has13Plus),
    has14Plus: Boolean(raw.has14Plus),
    has15: Boolean(raw.has15),
  };
}

// ============================================================================
// ETAPA 1: PARSER DEFENSIVO
// ============================================================================

/**
 * Detecta chaves potencialmente perigosas (__proto__, constructor, prototype)
 * em qualquer profundidade da árvore de objetos.
 */
export function hasDangerousKeys(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") {
    return false;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (hasDangerousKeys(item)) {
        return true;
      }
    }
    return false;
  }
  const keys = Object.getOwnPropertyNames(obj);
  for (const k of keys) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") {
      return true;
    }
    try {
      if (hasDangerousKeys((obj as any)[k])) {
        return true;
      }
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * Lê e analisa defensivamente o texto JSON de um backup.
 * Bloqueia payloads gigantescos, JSON malformado e protege contra prototype pollution.
 *
 * @param jsonText Texto bruto do arquivo JSON.
 * @returns Objeto parsed puro em runtime.
 * @throws Error com mensagem clara se o formato ou tamanho for inválido.
 */
export function parseHistoryBackup(jsonText: string): unknown {
  if (typeof jsonText !== "string") {
    throw new Error("JSON inválido: o conteúdo do backup deve ser uma string de texto.");
  }

  // 1. Limite defensivo de tamanho
  const byteLength = new TextEncoder().encode(jsonText).length;
  if (byteLength > MAX_JSON_SIZE_BYTES) {
    throw new Error(
      `Tamanho do arquivo excede o limite máximo permitido de ${MAX_JSON_SIZE_BYTES / (1024 * 1024)} MB (${byteLength} bytes).`
    );
  }

  // 2. Arquivo vazio
  if (jsonText.trim().length === 0) {
    throw new Error("Arquivo de backup vazio. Nenhum dado para processar.");
  }

  // 3. Parse seguro com reviver detectando e rejeitando vetores de prototype pollution
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText, (key, value) => {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        throw new Error("Backup rejeitado: chave potencialmente perigosa detectada.");
      }
      return value;
    });
  } catch (err: any) {
    if (err?.message?.includes("chave potencialmente perigosa detectada")) {
      throw err;
    }
    throw new Error(`JSON malformado: erro de sintaxe ao interpretar o arquivo: ${err?.message ?? "sintaxe inválida"}.`);
  }

  // 4. Verificações de estrutura no nível raiz
  if (parsed === null) {
    throw new Error("Estrutura de backup inválida: o arquivo contém 'null' no nível raiz.");
  }

  if (typeof parsed !== "object") {
    throw new Error(`Estrutura de backup inválida: esperava-se um objeto JSON, mas recebeu '${typeof parsed}'.`);
  }

  if (parsed && typeof parsed === "object" && "diagnosticSchemaVersion" in (parsed as any)) {
    throw new Error("Arquivo de diagnóstico não é um backup restaurável.");
  }

  if (Array.isArray(parsed)) {
    throw new Error("Estrutura de backup inválida: array no nível raiz não é aceito. Espera-se objeto com { schemaVersion, records, ... }.");
  }

  return parsed;
}

// ============================================================================
// ETAPA 2: VALIDAÇÃO PROFUNDA E AUDITORIA CRIPTOGRÁFICA
// ============================================================================

/**
 * Valida de ponta a ponta a integridade estrutural, semântica e criptográfica do backup.
 * Nenhuma gravação ocorre nesta etapa.
 *
 * Exigências:
 * - schemaVersion === 1 estritamente;
 * - exportedAt: string ISO 8601 válida;
 * - algorithmVersions: array de strings não vazias contendo apenas 'C5-1.0.0';
 * - Unicidade estrita interna: nenhum contestNumber duplicado e nenhum generationId duplicado;
 * - Relação 1:1 entre contestNumber e generationId;
 * - Validação matemática das invariantes C5 em 100% das gerações;
 * - Auditoria de integridade com recálculo via Web Crypto SHA-256 para FROZEN e SCORED;
 * - Auditoria de pontuação para SCORED com recálculo determinístico do resultado oficial;
 * - Validação das datas e coerência temporal (generatedAt <= frozenAt <= scoredAt).
 *
 * @param data Objeto já parseado (unknown).
 * @returns Resultado da validação com dados sanitizados ou lista de erros.
 */
export async function validateHistoryBackup(data: unknown): Promise<BackupValidationResult> {
  const errors: string[] = [];

  if (hasDangerousKeys(data)) {
    return {
      valid: false,
      errors: ["Backup rejeitado: chave potencialmente perigosa detectada."],
    };
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {
      valid: false,
      errors: ["Estrutura de backup inválida: esperava-se um objeto no nível raiz."],
    };
  }

  if ("diagnosticSchemaVersion" in (data as any)) {
    return {
      valid: false,
      errors: ["Arquivo de diagnóstico não é um backup restaurável."],
    };
  }

  const raw = data as Record<string, any>;

  // 1. schemaVersion (aceita somente 1)
  if (!("schemaVersion" in raw)) {
    errors.push("Campo obrigatório 'schemaVersion' ausente no cabeçalho do backup.");
  } else if (typeof raw.schemaVersion !== "number" || !Number.isInteger(raw.schemaVersion)) {
    errors.push(
      `Campo 'schemaVersion' inválido: '${String(raw.schemaVersion)}'. Deve ser um número inteiro.`
    );
  } else if (raw.schemaVersion > EXPECTED_SCHEMA_VERSION) {
    errors.push("Este backup foi criado por uma versão mais recente e não pode ser importado com segurança.");
  } else if (raw.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    errors.push(
      `Versão de esquema incompatível: '${String(raw.schemaVersion)}'. Apenas schemaVersion = ${EXPECTED_SCHEMA_VERSION} é aceita.`
    );
  }

  // 1.1 recordCount (opcional para compatibilidade com backups legados, mas se presente deve ser verificado)
  if ("recordCount" in raw) {
    if (typeof raw.recordCount !== "number" || !Number.isInteger(raw.recordCount) || raw.recordCount < 0) {
      errors.push(`Campo 'recordCount' inválido: '${String(raw.recordCount)}'. Deve ser um número inteiro positivo.`);
    } else if (Array.isArray(raw.records) && raw.recordCount !== raw.records.length) {
      errors.push(
        `Campo 'recordCount' (${raw.recordCount}) diverge da contagem real de registros no backup (${raw.records.length}).`
      );
    }
  }

  // 2. exportedAt
  if (!("exportedAt" in raw)) {
    errors.push("Campo obrigatório 'exportedAt' ausente no cabeçalho do backup.");
  } else if (!isValidIsoDate(raw.exportedAt)) {
    errors.push(`Campo 'exportedAt' inválido: '${String(raw.exportedAt)}'. Deve ser um timestamp ISO 8601 válido.`);
  }

  // 3. algorithmVersions
  if (!("algorithmVersions" in raw)) {
    errors.push("Campo obrigatório 'algorithmVersions' ausente no cabeçalho do backup.");
  } else if (!Array.isArray(raw.algorithmVersions)) {
    errors.push("Campo 'algorithmVersions' deve ser um array de strings.");
  } else {
    const versionSet = new Set<string>();
    for (const v of raw.algorithmVersions) {
      if (typeof v !== "string" || v.trim().length === 0) {
        errors.push(`Versão do algoritmo inválida em 'algorithmVersions': '${String(v)}'. Deve ser string não-vazia.`);
      } else if (versionSet.has(v)) {
        errors.push(`Versão do algoritmo duplicada em 'algorithmVersions': '${v}'.`);
      } else {
        versionSet.add(v);
      }

      if (v !== "C5-1.0.0") {
        errors.push(`Versão de algoritmo desconhecida ou não suportada: '${v}'. Suportada apenas 'C5-1.0.0'.`);
      }
    }
  }

  // 4. records
  if (!("records" in raw)) {
    errors.push("Campo obrigatório 'records' ausente no backup.");
    return { valid: false, errors };
  }

  if (!Array.isArray(raw.records)) {
    errors.push("Campo 'records' deve ser um array de registros de concurso.");
    return { valid: false, errors };
  }

  if (raw.records.length > MAX_BACKUP_RECORDS) {
    errors.push(
      `Número de registros no backup (${raw.records.length}) excede o limite máximo permitido de ${MAX_BACKUP_RECORDS}.`
    );
    return { valid: false, errors };
  }

  // Rastreamento interno de unicidade e integridade
  const seenContestNumbers = new Set<number>();
  const duplicateContestNumbers = new Set<number>();
  const seenGenerationIds = new Set<string>();
  const duplicateGenerationIds = new Set<string>();
  const contestToGenId = new Map<number, string>();
  const genIdToContest = new Map<string, number>();

  const sanitizedRecords: ContestRecord[] = [];

  for (let index = 0; index < raw.records.length; index++) {
    const r = raw.records[index];
    const prefix = `Registro #${index + 1}`;

    if (!r || typeof r !== "object" || Array.isArray(r)) {
      errors.push(`${prefix}: deve ser um objeto representando um ContestRecord.`);
      continue;
    }

    // 4.1 contestNumber
    if (
      typeof r.contestNumber !== "number" ||
      !Number.isInteger(r.contestNumber) ||
      r.contestNumber <= 0
    ) {
      errors.push(
        `${prefix}: 'contestNumber' inválido: '${String(r.contestNumber)}'. Deve ser número inteiro positivo.`
      );
      continue;
    }
    const contestNumber = r.contestNumber;

    if (seenContestNumbers.has(contestNumber)) {
      duplicateContestNumbers.add(contestNumber);
    } else {
      seenContestNumbers.add(contestNumber);
    }

    // 4.2 generationId
    if (!isValidGenerationId(r.generationId)) {
      errors.push(
        `Concurso ${contestNumber}: 'generationId' inválido: '${String(r.generationId)}'. Deve ser um UUID compatível.`
      );
      continue;
    }
    const generationId = r.generationId;

    if (seenGenerationIds.has(generationId)) {
      duplicateGenerationIds.add(generationId);
    } else {
      seenGenerationIds.add(generationId);
    }

    // 4.3 Relação 1:1 contestNumber <-> generationId
    if (contestToGenId.has(contestNumber) && contestToGenId.get(contestNumber) !== generationId) {
      errors.push(`Inconsistência 1:1: concurso ${contestNumber} mapeado para múltiplos generationId.`);
    }
    if (genIdToContest.has(generationId) && genIdToContest.get(generationId) !== contestNumber) {
      errors.push(`Inconsistência 1:1: generationId '${generationId}' compartilhado entre concursos diferentes.`);
    }
    contestToGenId.set(contestNumber, generationId);
    genIdToContest.set(generationId, contestNumber);

    // 4.4 algorithmVersion
    if (r.algorithmVersion !== "C5-1.0.0") {
      errors.push(
        `Concurso ${contestNumber}: versão de algoritmo não suportada: '${String(r.algorithmVersion)}'. Suportada apenas 'C5-1.0.0'.`
      );
    }

    // 4.5 generatedAt
    if (!isValidIsoDate(r.generatedAt)) {
      errors.push(
        `Concurso ${contestNumber}: 'generatedAt' inválido: '${String(r.generatedAt)}'. Deve ser ISO 8601.`
      );
    }

    // 4.6 generation
    const sanitizedGen = sanitizeGeneration(r.generation, contestNumber, errors);
    if (!sanitizedGen) {
      continue;
    }
    const c5Validation = validateC5(sanitizedGen);
    if (!c5Validation.valid) {
      errors.push(
        `Concurso ${contestNumber}: geração viola invariantes matemáticas C5: ${c5Validation.errors.join("; ")}`
      );
      continue;
    }

    // 4.7 Status e regras específicas
    const status = r.status as ContestRecordStatus;
    if (status !== "DRAFT" && status !== "FROZEN" && status !== "SCORED") {
      errors.push(`Concurso ${contestNumber}: status desconhecido ou inválido: '${String(r.status)}'.`);
      continue;
    }

    if (status === "DRAFT") {
      if (r.frozenAt !== undefined) {
        errors.push(`Concurso ${contestNumber}: registro em estado DRAFT não pode possuir 'frozenAt'.`);
      }
      if (r.integrityHash !== undefined) {
        errors.push(`Concurso ${contestNumber}: registro em estado DRAFT não pode possuir 'integrityHash'.`);
      }
      if (r.officialResult !== undefined) {
        errors.push(`Concurso ${contestNumber}: registro em estado DRAFT não pode possuir 'officialResult'.`);
      }
      if (r.scoredAt !== undefined) {
        errors.push(`Concurso ${contestNumber}: registro em estado DRAFT não pode possuir 'scoredAt'.`);
      }
      if (r.score !== undefined) {
        errors.push(`Concurso ${contestNumber}: registro em estado DRAFT não pode possuir 'score'.`);
      }

      sanitizedRecords.push({
        status: "DRAFT",
        contestNumber,
        generationId,
        algorithmVersion: r.algorithmVersion,
        generatedAt: r.generatedAt,
        generation: sanitizedGen,
      });
    } else if (status === "FROZEN") {
      if (!isValidIsoDate(r.frozenAt)) {
        errors.push(`Concurso ${contestNumber}: 'frozenAt' obrigatório e deve ser ISO 8601 válido.`);
      } else if (new Date(r.generatedAt).getTime() > new Date(r.frozenAt).getTime()) {
        errors.push(`Concurso ${contestNumber}: violação de ordem temporal (generatedAt > frozenAt).`);
      }

      if (typeof r.integrityHash !== "string" || !/^[0-9a-f]{64}$/.test(r.integrityHash)) {
        errors.push(`Concurso ${contestNumber}: 'integrityHash' obrigatório e deve possuir 64 caracteres hexadecimais em minúsculas.`);
      }

      if (r.officialResult !== undefined) {
        errors.push(`Concurso ${contestNumber}: registro em estado FROZEN não pode possuir 'officialResult'.`);
      }
      if (r.scoredAt !== undefined) {
        errors.push(`Concurso ${contestNumber}: registro em estado FROZEN não pode possuir 'scoredAt'.`);
      }
      if (r.score !== undefined) {
        errors.push(`Concurso ${contestNumber}: registro em estado FROZEN não pode possuir 'score'.`);
      }

      const candidateFrozen: ContestRecord = {
        status: "FROZEN",
        contestNumber,
        generationId,
        algorithmVersion: r.algorithmVersion,
        generatedAt: r.generatedAt,
        frozenAt: r.frozenAt,
        integrityHash: r.integrityHash,
        generation: sanitizedGen,
      };

      // Auditoria criptográfica obrigatória via Web Crypto SHA-256
      const audit = await verifyContestIntegrity(candidateFrozen);
      if (!audit.valid || !audit.hashMatches || !audit.generationValid) {
        errors.push(
          `Concurso ${contestNumber}: auditoria de integridade do registro congelado falhou (adulteração detectada): ${audit.errors.join("; ")}`
        );
      }

      sanitizedRecords.push(candidateFrozen);
    } else if (status === "SCORED") {
      if (!isValidIsoDate(r.frozenAt)) {
        errors.push(`Concurso ${contestNumber}: 'frozenAt' obrigatório e deve ser ISO 8601 válido.`);
      }
      if (!isValidIsoDate(r.scoredAt)) {
        errors.push(`Concurso ${contestNumber}: 'scoredAt' obrigatório e deve ser ISO 8601 válido.`);
      }

      if (isValidIsoDate(r.generatedAt) && isValidIsoDate(r.frozenAt) && isValidIsoDate(r.scoredAt)) {
        const tGen = new Date(r.generatedAt).getTime();
        const tFroz = new Date(r.frozenAt).getTime();
        const tScor = new Date(r.scoredAt).getTime();
        if (tGen > tFroz || tFroz > tScor) {
          errors.push(`Concurso ${contestNumber}: violação de ordem temporal (esperado generatedAt <= frozenAt <= scoredAt).`);
        }
      }

      if (typeof r.integrityHash !== "string" || !/^[0-9a-f]{64}$/.test(r.integrityHash)) {
        errors.push(`Concurso ${contestNumber}: 'integrityHash' obrigatório e deve possuir 64 caracteres hexadecimais em minúsculas.`);
      }

      // officialResult
      let validatedOfficialResult: number[] | null = null;
      try {
        if (!Array.isArray(r.officialResult) || r.officialResult.length !== 15) {
          throw new Error("Resultado oficial deve conter 15 dezenas.");
        }
        validatedOfficialResult = [...validateOfficialResult(r.officialResult)];
      } catch (err: any) {
        errors.push(`Concurso ${contestNumber}: 'officialResult' inválido: ${err?.message ?? "dezenas inválidas"}.`);
      }

      // score
      const sanitizedSc = sanitizeScore(r.score, contestNumber, errors);

      if (validatedOfficialResult && sanitizedSc) {
        const candidateScored: ContestRecord = {
          status: "SCORED",
          contestNumber,
          generationId,
          algorithmVersion: r.algorithmVersion,
          generatedAt: r.generatedAt,
          frozenAt: r.frozenAt,
          integrityHash: r.integrityHash,
          officialResult: validatedOfficialResult,
          scoredAt: r.scoredAt,
          score: sanitizedSc,
          generation: sanitizedGen,
        };

        // Auditoria criptográfica da geração congelada
        const genAudit = await verifyContestIntegrity(candidateScored);
        if (!genAudit.valid || !genAudit.hashMatches || !genAudit.generationValid) {
          errors.push(
            `Concurso ${contestNumber}: auditoria de integridade da geração congelada falhou (adulteração detectada): ${genAudit.errors.join("; ")}`
          );
        }

        // Auditoria estrita da pontuação calculada
        const scoreAudit = verifyScoreIntegrity(candidateScored);
        if (!scoreAudit.valid || !scoreAudit.scoreMatches || !scoreAudit.officialResultValid) {
          errors.push(
            `Concurso ${contestNumber}: auditoria da pontuação oficial falhou: ${scoreAudit.errors.join("; ")}`
          );
        }

        // Comparação exaustiva de TODOS os campos do score recalculado (Prompt 11.2 - Requisito 9)
        const recomputedScore = scoreC5(candidateScored.generation, validatedOfficialResult);
        const storedScore = candidateScored.score!;

        if (
          recomputedScore.result.length !== storedScore.result.length ||
          recomputedScore.result.some((num, idx) => num !== storedScore.result[idx])
        ) {
          errors.push(`Concurso ${contestNumber}: 'score.result' diverge do resultado oficial recalculado.`);
        }

        if (recomputedScore.maxHits !== storedScore.maxHits) {
          errors.push(`Concurso ${contestNumber}: 'score.maxHits' diverge do valor recalculado.`);
        }

        if (
          recomputedScore.bestGameIndexes.length !== storedScore.bestGameIndexes.length ||
          recomputedScore.bestGameIndexes.some((idx, i) => idx !== storedScore.bestGameIndexes[i])
        ) {
          errors.push(`Concurso ${contestNumber}: 'score.bestGameIndexes' diverge do valor recalculado.`);
        }

        if (
          recomputedScore.prizeCounts.hits11 !== storedScore.prizeCounts.hits11 ||
          recomputedScore.prizeCounts.hits12 !== storedScore.prizeCounts.hits12 ||
          recomputedScore.prizeCounts.hits13 !== storedScore.prizeCounts.hits13 ||
          recomputedScore.prizeCounts.hits14 !== storedScore.prizeCounts.hits14 ||
          recomputedScore.prizeCounts.hits15 !== storedScore.prizeCounts.hits15
        ) {
          errors.push(`Concurso ${contestNumber}: 'score.prizeCounts' diverge do valor recalculado.`);
        }

        if (
          recomputedScore.has11Plus !== storedScore.has11Plus ||
          recomputedScore.has12Plus !== storedScore.has12Plus ||
          recomputedScore.has13Plus !== storedScore.has13Plus ||
          recomputedScore.has14Plus !== storedScore.has14Plus ||
          recomputedScore.has15 !== storedScore.has15
        ) {
          errors.push(`Concurso ${contestNumber}: flags de premiação do score divergem do valor recalculado.`);
        }

        for (let i = 0; i < 5; i++) {
          const rg = recomputedScore.games[i];
          const sg = storedScore.games[i];
          if (rg.gameIndex !== sg.gameIndex) {
            errors.push(`Concurso ${contestNumber}: 'score.games[${i}].gameIndex' diverge do recalculado.`);
          }
          if (rg.hits !== sg.hits) {
            errors.push(`Concurso ${contestNumber}: 'score.games[${i}].hits' diverge do recalculado.`);
          }
          if (
            rg.matchedNumbers.length !== sg.matchedNumbers.length ||
            rg.matchedNumbers.some((num, m) => num !== sg.matchedNumbers[m])
          ) {
            errors.push(`Concurso ${contestNumber}: 'score.games[${i}].matchedNumbers' diverge do recalculado.`);
          }
          if (
            rg.missedNumbers.length !== sg.missedNumbers.length ||
            rg.missedNumbers.some((num, m) => num !== sg.missedNumbers[m])
          ) {
            errors.push(`Concurso ${contestNumber}: 'score.games[${i}].missedNumbers' diverge do recalculado.`);
          }
        }

        sanitizedRecords.push(candidateScored);
      }
    }
  }

  // Verificação de concursos e generationIds duplicados internamente (Seção 9)
  if (duplicateContestNumbers.size > 0) {
    const sortedDups = Array.from(duplicateContestNumbers).sort((a, b) => a - b);
    errors.push(
      `Backup inválido: concurso duplicado dentro do arquivo. Concurso(s) duplicado(s): ${sortedDups.join(", ")}.`
    );
  }

  if (duplicateGenerationIds.size > 0) {
    errors.push(
      `Backup inválido: generationId duplicado dentro do arquivo: ${Array.from(duplicateGenerationIds).join(", ")}.`
    );
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
    };
  }

  const cleanVersions = Array.from(new Set(sanitizedRecords.map((r) => r.algorithmVersion)));

  return {
    valid: true,
    data: {
      schemaVersion: EXPECTED_SCHEMA_VERSION,
      exportedAt: raw.exportedAt,
      recordCount: sanitizedRecords.length,
      algorithmVersions: cleanVersions,
      records: sanitizedRecords,
    },
    errors: [],
  };
}

// ============================================================================
// ETAPA 3: PLANEJAMENTO DA IMPORTAÇÃO (PREVIEW SEM PERSISTÊNCIA)
// ============================================================================

/**
 * Prepara o plano de importação comparando os dados validados do backup com o banco local atual.
 * Nenhuma gravação ocorre nesta etapa.
 *
 * Categorização:
 * - IMPORT: concurso não existe localmente e generationId é globalmente novo;
 * - SKIP_IDENTICAL: concurso já existe localmente e todos os campos são semântica e criptograficamente idênticos;
 * - CONFLICT: concurso já existe com dados divergentes OU generationId colide com outro concurso local.
 *
 * @param data Objeto ou texto do backup.
 * @param repository Repositório de persistência IndexedDB (opcional).
 * @returns Plano de importação com contadores e lista detalhada por concurso.
 */
export async function prepareHistoryImport(
  data: unknown,
  repository?: ContestRepository
): Promise<ImportPlan> {
  const repo = repository ?? contestRepository;

  let parsedData = data;
  if (typeof data === "string") {
    try {
      parsedData = parseHistoryBackup(data);
    } catch (err: any) {
      return {
        valid: false,
        totalBackupRecords: 0,
        newRecords: 0,
        identicalRecords: 0,
        conflicts: 0,
        invalidRecords: 1,
        records: [],
        errors: [err?.message ?? "Falha ao interpretar JSON do backup."],
        preparedRecordsToImport: [],
      };
    }
  }

  // 1. Executa validação prévia integral
  const validation = await validateHistoryBackup(parsedData);
  if (!validation.valid || !validation.data) {
    const totalRaw =
      parsedData && typeof parsedData === "object" && Array.isArray((parsedData as any).records)
        ? (parsedData as any).records.length
        : 0;

    return {
      valid: false,
      totalBackupRecords: totalRaw,
      newRecords: 0,
      identicalRecords: 0,
      conflicts: 0,
      invalidRecords: validation.errors.length,
      records: [],
      errors: validation.errors,
      preparedRecordsToImport: [],
    };
  }

  const backupData = validation.data;
  const localRecords = await repo.getAllContestRecords();

  const localByContest = new Map<number, ContestRecord>();
  const localContestByGenId = new Map<string, number>();

  for (const local of localRecords) {
    localByContest.set(local.contestNumber, local);
    localContestByGenId.set(local.generationId, local.contestNumber);
  }

  const planRecords: ImportPlanRecordDetail[] = [];
  const toImport: ContestRecord[] = [];
  let newCount = 0;
  let identicalCount = 0;
  let conflictCount = 0;

  for (const backupRec of backupData.records) {
    const local = localByContest.get(backupRec.contestNumber);
    const backupHash = backupRec.integrityHash ?? "NÃO CONGELADO";

    if (local) {
      const localHash = local.integrityHash ?? "NÃO CONGELADO";
      const localAudit = await repo.verifyStoredContest(local.contestNumber);
      if (!localAudit.valid) {
        conflictCount++;
        planRecords.push({
          contestNumber: backupRec.contestNumber,
          action: "CONFLICT",
          localStatus: local.status,
          backupStatus: backupRec.status,
          localGenerationId: local.generationId,
          backupGenerationId: backupRec.generationId,
          localIntegrityHash: localHash,
          backupIntegrityHash: backupHash,
          reason: "Concurso local encontra-se em quarentena (auditoria pendente/registro inválido). Preservando evidência local contra sobrescrita.",
        });
        continue;
      }

      // O concurso já existe localmente e é íntegro: verificar igualdade semântica
      const isIdentical = areContestRecordsIdentical(local, backupRec);

      if (isIdentical) {
        identicalCount++;
        planRecords.push({
          contestNumber: backupRec.contestNumber,
          action: "SKIP_IDENTICAL",
          localStatus: local.status,
          backupStatus: backupRec.status,
          localGenerationId: local.generationId,
          backupGenerationId: backupRec.generationId,
          localIntegrityHash: localHash,
          backupIntegrityHash: backupHash,
          reason: "Registro idêntico ao já persistido localmente.",
        });
      } else {
        conflictCount++;
        planRecords.push({
          contestNumber: backupRec.contestNumber,
          action: "CONFLICT",
          localStatus: local.status,
          backupStatus: backupRec.status,
          localGenerationId: local.generationId,
          backupGenerationId: backupRec.generationId,
          localIntegrityHash: localHash,
          backupIntegrityHash: backupHash,
          reason: `Concurso já existe localmente com dados divergentes (Local: ${local.status}, Backup: ${backupRec.status}).`,
        });
      }
    } else {
      // O concurso não existe localmente: verificar se generationId já existe em outro concurso local
      const existingContestForGenId = localContestByGenId.get(backupRec.generationId);

      if (existingContestForGenId !== undefined) {
        const collidingLocal = localByContest.get(existingContestForGenId);
        conflictCount++;
        planRecords.push({
          contestNumber: backupRec.contestNumber,
          action: "CONFLICT",
          localStatus: collidingLocal?.status,
          backupStatus: backupRec.status,
          localGenerationId: collidingLocal?.generationId,
          backupGenerationId: backupRec.generationId,
          localIntegrityHash: collidingLocal?.integrityHash ?? "NÃO CONGELADO",
          backupIntegrityHash: backupHash,
          reason: `generationId '${backupRec.generationId}' já está associado localmente ao concurso ${existingContestForGenId}.`,
        });
      } else {
        newCount++;
        toImport.push(deepCloneRecord(backupRec));
        planRecords.push({
          contestNumber: backupRec.contestNumber,
          action: "IMPORT",
          backupStatus: backupRec.status,
          backupGenerationId: backupRec.generationId,
          backupIntegrityHash: backupHash,
          reason: "Novo concurso validado pronto para importação.",
        });
      }
    }
  }

  // Ordenação descendente para prévia
  planRecords.sort((a, b) => b.contestNumber - a.contestNumber);

  return {
    valid: true,
    totalBackupRecords: backupData.records.length,
    newRecords: newCount,
    identicalRecords: identicalCount,
    conflicts: conflictCount,
    invalidRecords: 0,
    records: planRecords,
    errors: [],
    preparedRecordsToImport: toImport,
    backupData,
  };
}

// ============================================================================
// ETAPA 4: COMMIT ATÔMICO COM REVALIDAÇÃO TOCTOU
// ============================================================================

/**
 * Executa a importação atômica dos registros validados no IndexedDB.
 *
 * Exigências v1.2:
 * 1. O plano deve ser válido (sem erros estruturais ou corrupção no arquivo);
 * 2. Conflitos são informativos e preservados no banco local; apenas registros 'IMPORT' são persistidos;
 * 3. Revalidação TOCTOU imediata antes do commit para proteger contra concorrência;
 * 4. Commit de todos os novos registros em uma única transação IndexedDB readwrite atômica;
 * 5. Se qualquer inserção falhar, aborta a transação inteira com rollback;
 * 6. Verificação estrita de não-mutação de registros pré-existentes;
 * 7. Auditoria completa pós-importação garantindo fidelidade absoluta do banco.
 *
 * @param planOrData Plano de importação (gerado na prévia) ou dados brutos do backup.
 * @param repository Repositório de persistência IndexedDB (opcional).
 * @returns Resultado da execução com contadores e auditoria pós-importação.
 * @throws Error se o backup for inválido, colisão TOCTOU ou falha na transação.
 */
export async function importHistory(
  planOrData: ImportPlan | unknown,
  repository?: ContestRepository
): Promise<ImportExecutionResult> {
  const repo = repository ?? contestRepository;

  // 1. Obtém o plano ou calcula a partir dos dados fornecidos
  let plan: ImportPlan;
  if (
    planOrData &&
    typeof planOrData === "object" &&
    "preparedRecordsToImport" in (planOrData as any) &&
    "conflicts" in (planOrData as any) &&
    "valid" in (planOrData as any)
  ) {
    plan = planOrData as ImportPlan;
  } else {
    plan = await prepareHistoryImport(planOrData, repo);
  }

  if (!plan.valid) {
    throw new Error(
      `Importação bloqueada: o arquivo de backup contém registros estruturalmente inválidos (${plan.errors.join("; ")}).`
    );
  }

  if (plan.newRecords === 0) {
    // Nada novo para gravar (apenas registros idênticos ou conflitos ignorados)
    const audit = await repo.auditEntireHistory();
    return {
      success: true,
      importedCount: 0,
      skippedIdenticalCount: plan.identicalRecords,
      conflictCount: plan.conflicts,
      historyAudit: audit,
    };
  }

  // 2. Proteção TOCTOU: revalidação imediata antes de abrir a escrita
  const freshLocalRecords = await repo.getAllContestRecords();
  const freshContestMap = new Map<number, ContestRecord>();
  const freshGenIdMap = new Map<string, number>();

  for (const rec of freshLocalRecords) {
    freshContestMap.set(rec.contestNumber, rec);
    freshGenIdMap.set(rec.generationId, rec.contestNumber);
  }

  for (const toImport of plan.preparedRecordsToImport) {
    if (freshContestMap.has(toImport.contestNumber)) {
      throw new Error(
        "O histórico local mudou desde a pré-visualização. Revise o plano de importação novamente."
      );
    }
    if (freshGenIdMap.has(toImport.generationId)) {
      throw new Error(
        "O histórico local mudou desde a pré-visualização. Revise o plano de importação novamente."
      );
    }
  }

  if (plan.backupData) {
    const freshPlan = await prepareHistoryImport(plan.backupData, repo);
    if (
      freshPlan.newRecords !== plan.newRecords ||
      freshPlan.identicalRecords !== plan.identicalRecords ||
      freshPlan.conflicts !== plan.conflicts
    ) {
      throw new Error(
        "O histórico local mudou desde a pré-visualização. Revise o plano de importação novamente."
      );
    }
  }

  // Snapshot antes do commit para assegurar não-mutação de registros pré-existentes (Seção 17)
  const snapshotBefore = await repo.getAllContestRecords();
  const mapBefore = new Map<number, ContestRecord>();
  for (const r of snapshotBefore) {
    mapBefore.set(r.contestNumber, r);
  }

  // 3. Commit atômico em lote via transação única readwrite
  await repo.batchInsertRecords(plan.preparedRecordsToImport);

  // 4. Verificação pós-gravação de não-mutação de registros pré-existentes (Seção 17)
  for (const [contestNum, recBefore] of mapBefore) {
    const recAfter = await repo.getContestRecord(contestNum);
    if (!recAfter || !areContestRecordsIdentical(recBefore, recAfter)) {
      throw new Error(
        `Falha crítica de integridade: registro pré-existente do concurso ${contestNum} foi mutado durante a importação.`
      );
    }
  }

  // 5. Auditoria pós-importação obrigatória
  const postAudit = await repo.auditEntireHistory();
  if (!postAudit.valid || postAudit.invalidRecords > 0) {
    throw new Error(
      `Erro crítico pós-importação: a auditoria da base detectou ${postAudit.invalidRecords} registro(s) inválido(s) após o commit.`
    );
  }

  return {
    success: true,
    importedCount: plan.newRecords,
    skippedIdenticalCount: plan.identicalRecords,
    conflictCount: plan.conflicts,
    historyAudit: postAudit,
  };
}
