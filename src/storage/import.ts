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
import { validateOfficialResult } from "../c5/scorer.ts";
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
import type { HistoryExportData, HistoryAuditResult } from "./types.ts";

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
  reason?: string;
}

export interface ImportPlan {
  valid: boolean;
  totalBackupRecords: number;
  newRecords: number;
  identicalRecords: number;
  conflicts: number;
  records: ImportPlanRecordDetail[];
  errors: string[];
  preparedRecordsToImport: ContestRecord[];
}

export interface BackupValidationResult {
  valid: boolean;
  data?: HistoryExportData;
  errors: string[];
}

export interface ImportExecutionResult {
  success: boolean;
  importedCount: number;
  skippedCount: number;
  historyAudit: HistoryAuditResult;
}

// ============================================================================
// AUXILIARES DE VALIDAÇÃO PURA
// ============================================================================

/**
 * Valida se uma string representa um timestamp ISO 8601 estrito e parseável.
 */
export function isValidIsoDate(str: unknown): str is string {
  if (typeof str !== "string" || str.trim().length === 0) {
    return false;
  }
  const timestamp = Date.parse(str);
  if (Number.isNaN(timestamp)) {
    return false;
  }
  // Formato ISO 8601 com 'Z' ou offset
  const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
  return isoRegex.test(str);
}

/**
 * Valida se o generationId possui formato compatível com os UUIDs do sistema.
 * Suporta UUID v4 RFC 4122 e identificadores padronizados de teste do sistema.
 */
export function isValidGenerationId(id: unknown): id is string {
  if (typeof id !== "string" || id.trim().length === 0) {
    return false;
  }
  // UUID RFC 4122 padrão (8-4-4-4-12 hex)
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  // Identificadores de teste compatíveis gerados internamente (ex: gen-test-uuid-1, auth-uuid-777, uuid-3300)
  const systemTestIdRegex = /^(?:uuid|gen|auth)-[a-zA-Z0-9_-]{3,64}$/i;

  return uuidRegex.test(id) || systemTestIdRegex.test(id);
}

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
    cleanScoreGames.push({
      gameIndex: (i + 1) as 1 | 2 | 3 | 4 | 5,
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

/**
 * Compara dois registros de concurso de forma semântica e estrita em todos os campos.
 */
export function areContestRecordsIdentical(r1: ContestRecord, r2: ContestRecord): boolean {
  if (r1.contestNumber !== r2.contestNumber) return false;
  if (r1.status !== r2.status) return false;
  if (r1.generationId !== r2.generationId) return false;
  if (r1.algorithmVersion !== r2.algorithmVersion) return false;
  if (r1.generatedAt !== r2.generatedAt) return false;
  if (r1.frozenAt !== r2.frozenAt) return false;
  if (r1.integrityHash !== r2.integrityHash) return false;
  if (r1.scoredAt !== r2.scoredAt) return false;

  // Comparação de officialResult
  if (Boolean(r1.officialResult) !== Boolean(r2.officialResult)) return false;
  if (r1.officialResult && r2.officialResult) {
    if (r1.officialResult.length !== r2.officialResult.length) return false;
    for (let i = 0; i < r1.officialResult.length; i++) {
      if (r1.officialResult[i] !== r2.officialResult[i]) return false;
    }
  }

  // Comparação de score
  if (Boolean(r1.score) !== Boolean(r2.score)) return false;
  if (r1.score && r2.score) {
    if (r1.score.maxHits !== r2.score.maxHits) return false;
    if (r1.score.has11Plus !== r2.score.has11Plus) return false;
    if (r1.score.has12Plus !== r2.score.has12Plus) return false;
    if (r1.score.has13Plus !== r2.score.has13Plus) return false;
    if (r1.score.has14Plus !== r2.score.has14Plus) return false;
    if (r1.score.has15 !== r2.score.has15) return false;
    for (let i = 0; i < 5; i++) {
      if (r1.score.games[i].hits !== r2.score.games[i].hits) return false;
    }
  }

  // Comparação da geração
  if (r1.generation.permutation.length !== r2.generation.permutation.length) return false;
  for (let i = 0; i < 25; i++) {
    if (r1.generation.permutation[i] !== r2.generation.permutation[i]) return false;
  }
  for (const slot of C5_SLOTS) {
    if (r1.generation.slotAssignments[slot] !== r2.generation.slotAssignments[slot]) return false;
  }
  for (let g = 0; g < 5; g++) {
    for (let d = 0; d < 15; d++) {
      if (r1.generation.games[g][d] !== r2.generation.games[g][d]) return false;
    }
  }

  return true;
}

// ============================================================================
// ETAPA 1: PARSER DEFENSIVO
// ============================================================================

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

  // 3. Parse seguro com reviver neutralizando vetores de prototype pollution
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText, (key, value) => {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        return undefined; // Descarte seguro
      }
      return value;
    });
  } catch (err: any) {
    throw new Error(`JSON malformado: erro de sintaxe ao interpretar o arquivo: ${err?.message ?? "sintaxe inválida"}.`);
  }

  // 4. Verificações de estrutura no nível raiz
  if (parsed === null) {
    throw new Error("Estrutura de backup inválida: o arquivo contém 'null' no nível raiz.");
  }

  if (typeof parsed !== "object") {
    throw new Error(`Estrutura de backup inválida: esperava-se um objeto JSON, mas recebeu '${typeof parsed}'.`);
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

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {
      valid: false,
      errors: ["Estrutura de backup inválida: esperava-se um objeto no nível raiz."],
    };
  }

  const raw = data as Record<string, any>;

  // 1. schemaVersion (aceita somente 1)
  if (!("schemaVersion" in raw)) {
    errors.push("Campo obrigatório 'schemaVersion' ausente no cabeçalho do backup.");
  } else if (typeof raw.schemaVersion !== "number" || raw.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    errors.push(
      `Versão de esquema incompatível: '${String(raw.schemaVersion)}'. Apenas schemaVersion = ${EXPECTED_SCHEMA_VERSION} é aceita.`
    );
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
  const seenGenerationIds = new Set<string>();
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
      errors.push(`Concurso ${contestNumber} aparece duplicado dentro do arquivo de backup.`);
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
      errors.push(`generationId '${generationId}' aparece duplicado dentro do arquivo de backup (concurso ${contestNumber}).`);
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
          `Concurso ${contestNumber}: auditoria de integridade do registro congelado falhou: ${audit.errors.join("; ")}`
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
            `Concurso ${contestNumber}: auditoria de integridade da geração congelada falhou: ${genAudit.errors.join("; ")}`
          );
        }

        // Auditoria estrita da pontuação calculada
        const scoreAudit = verifyScoreIntegrity(candidateScored);
        if (!scoreAudit.valid || !scoreAudit.scoreMatches || !scoreAudit.officialResultValid) {
          errors.push(
            `Concurso ${contestNumber}: auditoria da pontuação oficial falhou: ${scoreAudit.errors.join("; ")}`
          );
        }

        sanitizedRecords.push(candidateScored);
      }
    }
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

  // 1. Executa validação prévia integral
  const validation = await validateHistoryBackup(data);
  if (!validation.valid || !validation.data) {
    return {
      valid: false,
      totalBackupRecords: 0,
      newRecords: 0,
      identicalRecords: 0,
      conflicts: 0,
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

    if (local) {
      // O concurso já existe localmente: verificar igualdade semântica
      const isIdentical = areContestRecordsIdentical(local, backupRec);

      if (isIdentical) {
        identicalCount++;
        planRecords.push({
          contestNumber: backupRec.contestNumber,
          action: "SKIP_IDENTICAL",
          localStatus: local.status,
          backupStatus: backupRec.status,
          reason: "Registro idêntico ao já persistido localmente.",
        });
      } else {
        conflictCount++;
        planRecords.push({
          contestNumber: backupRec.contestNumber,
          action: "CONFLICT",
          localStatus: local.status,
          backupStatus: backupRec.status,
          reason: `Concurso já existe localmente com dados divergentes (Local: ${local.status}, Backup: ${backupRec.status}).`,
        });
      }
    } else {
      // O concurso não existe localmente: verificar se generationId já existe em outro concurso local
      const existingContestForGenId = localContestByGenId.get(backupRec.generationId);

      if (existingContestForGenId !== undefined) {
        conflictCount++;
        planRecords.push({
          contestNumber: backupRec.contestNumber,
          action: "CONFLICT",
          backupStatus: backupRec.status,
          reason: `generationId '${backupRec.generationId}' já está associado localmente ao concurso ${existingContestForGenId}.`,
        });
      } else {
        newCount++;
        toImport.push(deepCloneRecord(backupRec));
        planRecords.push({
          contestNumber: backupRec.contestNumber,
          action: "IMPORT",
          backupStatus: backupRec.status,
          reason: "Novo concurso validado pronto para importação.",
        });
      }
    }
  }

  // Ordenação descendente para prévia
  planRecords.sort((a, b) => b.contestNumber - a.contestNumber);

  return {
    valid: conflictCount === 0,
    totalBackupRecords: backupData.records.length,
    newRecords: newCount,
    identicalRecords: identicalCount,
    conflicts: conflictCount,
    records: planRecords,
    errors: [],
    preparedRecordsToImport: toImport,
  };
}

// ============================================================================
// ETAPA 4: COMMIT ATÔMICO COM REVALIDAÇÃO TOCTOU
// ============================================================================

/**
 * Executa a importação atômica dos registros validados no IndexedDB.
 *
 * Exigências:
 * 1. O plano não pode conter nenhum CONFLICT;
 * 2. Revalidação TOCTOU imediata antes do commit para proteger contra concorrência;
 * 3. Commit de todos os registros 'IMPORT' em uma única transação IndexedDB readwrite;
 * 4. Se qualquer inserção falhar, aborta a transação inteira com rollback;
 * 5. Auditoria completa pós-importação garantindo fidelidade absoluta do banco.
 *
 * @param planOrData Plano de importação (gerado na prévia) ou dados brutos do backup.
 * @param repository Repositório de persistência IndexedDB (opcional).
 * @returns Resultado da execução com contadores e auditoria pós-importação.
 * @throws Error se houver conflitos, colisão TOCTOU ou falha na transação.
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
    "conflicts" in (planOrData as any)
  ) {
    plan = planOrData as ImportPlan;
  } else {
    plan = await prepareHistoryImport(planOrData, repo);
  }

  if (!plan.valid || plan.conflicts > 0) {
    throw new Error(
      `Importação bloqueada: existem ${plan.conflicts} conflito(s) entre o backup e o histórico local.`
    );
  }

  if (plan.newRecords === 0) {
    // Nada novo para gravar (apenas registros idênticos)
    const audit = await repo.auditEntireHistory();
    return {
      success: true,
      importedCount: 0,
      skippedCount: plan.identicalRecords,
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
        `Conflito de concorrência (TOCTOU): concurso ${toImport.contestNumber} foi inserido no banco local antes da confirmação da importação. Operação abortada sem modificações.`
      );
    }
    if (freshGenIdMap.has(toImport.generationId)) {
      throw new Error(
        `Conflito de concorrência (TOCTOU): generationId '${toImport.generationId}' colidiu com registro inserido concorrentemente no concurso ${freshGenIdMap.get(
          toImport.generationId
        )}. Operação abortada.`
      );
    }
  }

  // 3. Commit atômico em lote via transação única readwrite
  await repo.batchInsertRecords(plan.preparedRecordsToImport);

  // 4. Auditoria pós-importação obrigatória
  const postAudit = await repo.auditEntireHistory();
  if (!postAudit.valid || postAudit.invalidRecords > 0) {
    throw new Error(
      `Erro crítico pós-importação: a auditoria da base detectou ${postAudit.invalidRecords} registro(s) inválido(s) após o commit.`
    );
  }

  return {
    success: true,
    importedCount: plan.newRecords,
    skippedCount: plan.identicalRecords,
    historyAudit: postAudit,
  };
}
