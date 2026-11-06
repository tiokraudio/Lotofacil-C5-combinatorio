/**
 * C5-Memory-2.0.0 — Tipos Oficiais e Estruturas Canônicas
 */

export type LotofacilNumber = number; // 1 a 25
export type C5Game = readonly number[]; // 15 dezenas estritamente crescentes [1..25]

export interface PoolCandidate {
  readonly index: number;
  readonly games: readonly C5Game[];
  readonly leximinScore?: readonly number[];
}

export interface MemoryHistory {
  readonly games: readonly C5Game[];
  readonly revision: number;
  readonly fingerprint: string;
}

export interface Draft {
  readonly contestNumber: number;
  readonly games: readonly C5Game[];
  readonly poolIndex: number;
  readonly poolMasterSeed: string;
  readonly historyFingerprint: string;
  readonly historyRevision: number;
  readonly leximinProfile: readonly number[];
  readonly generatedAt: string;
  readonly isDemo?: boolean;
  readonly isFixture?: boolean;
}

export interface FrozenMemoryPayload {
  readonly contestNumber: number;
  readonly games: readonly C5Game[];
  readonly poolIndex: number;
  readonly poolMasterSeed: string;
  readonly historyFingerprint: string;
  readonly historyRevision: number;
  readonly sha256: string;
  readonly frozenAt: string;
}

export type ContestStatus = "AVAILABLE" | "PREVIEW" | "FROZEN" | "COMPLETED";
export type AlgorithmVersion = "C5-Memory-3.0" | "C5-Memory-2.1.0" | "C5-Memory-2.0.0" | "C5-1.0.0";

export type RateioConfirmationSource =
  | "OFFICIAL_CAIXA_AUTOMATIC"
  | "OFFICIAL_CAIXA"
  | "MANUAL_ENTRY"
  | "OFFICIAL_SOURCE_RETRIEVED_UNVERIFIED"
  | "API_TERCEIROS"
  | "MANUAL_CONFERENCE";

export type ResultSource =
  | "API_CAIXA"
  | "API_TERCEIROS"
  | "API_LOTERIAS"
  | "MANUAL_CONFERENCE"
  | "HISTORICAL_FIXTURE";

import type { Draft30, FrozenMemoryPayload30 } from "./engine30";
import type { Draft210, FrozenMemoryPayload210 } from "./engine210";
import { syncSha256 } from "./sha256";

export type AnyDraft = Draft30 | Draft210 | Draft;
export type AnyFrozenPayload = FrozenMemoryPayload30 | FrozenMemoryPayload210 | FrozenMemoryPayload;

export interface ContestRecord {
  readonly id?: string;
  readonly contestNumber: number;
  readonly contestDate: string; // YYYY-MM-DD
  readonly status: ContestStatus;
  readonly algorithmVersion: AlgorithmVersion;
  readonly games: readonly C5Game[];
  readonly draft?: AnyDraft;
  readonly frozenPayload?: AnyFrozenPayload;
  readonly officialResult?: readonly number[];
  readonly gameHits?: readonly number[];
  readonly bestHits?: number;
  readonly bestHitsCount?: number;
  readonly totalCost?: number;
  readonly totalPrize?: number;
  readonly officialConfirmedPrize?: number;
  readonly manualConfirmedPrize?: number;
  readonly manualInformedPrize?: number;
  readonly officialValidatedPrize?: number;
  readonly officialNetBalance?: number;
  readonly officialRoiPercentage?: number;
  readonly isDemo?: boolean;
  readonly isFixture?: boolean;
  readonly hasPendingVariableRateio?: boolean;
  readonly hasProvisionalVariableRateio?: boolean;
  readonly prizeBreakdown?: {
    readonly [tier: string]: {
      readonly contestNumber?: number;
      readonly tier?: number;
      readonly count: number;
      readonly unitValue?: number;
      readonly totalValue?: number;
      readonly isVariableRateio?: boolean;
      readonly pendingRateio?: boolean;
      readonly confirmationSource?: RateioConfirmationSource;
      readonly isOfficialCaixaProof?: boolean;
      readonly confirmedAt?: string;
      readonly officialPublishedAt?: string;
      readonly proofRetrievedAt?: string;
      readonly notes?: string;
      readonly documentProof?: string;
      readonly officialProof?: any;
      readonly operatorId?: string;
      readonly manualInformedValue?: number;
      readonly manualConfirmedValue?: number;
      readonly officialValidatedValue?: number;
    };
  };
  readonly confirmedVariablePrizes?: Record<number, any>;
  readonly financialStatus?: ContestFinancialStatus;
  readonly resultSource?: ResultSource;
  readonly resultFetchedAt?: string;
  readonly resultConfirmed?: boolean;
  readonly resultConfirmedAt?: string;
  readonly resultConfirmedBy?: string;
  readonly resultProof?: OfficialCaixaDirectResultProof | string | any;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Prova Criptográfica de Procedência Direta da Caixa Econômica Federal.
 * 
 * NOTA DE AUDITORIA CRIPTOGRÁFICA:
 * O hash SHA-256 (payloadSha256) atesta estritamente a integridade física dos bytes/caracteres
 * do payload bruto (rawPayload) recebido pela aplicação e impede adulteração local de dados.
 * O hash NÃO constitui assinatura digital ICP-Brasil da Caixa Econômica Federal.
 */
export interface OfficialCaixaDirectResultProof {
  readonly proofType: "OFFICIAL_CAIXA_DIRECT_ENDPOINT";
  readonly contestNumber: number;
  readonly officialEndpoint: string;
  readonly httpStatus?: number; // Sucesso HTTP (estritamente 200)
  readonly drawDate: string; // Data ISO YYYY-MM-DD
  readonly drawnNumbers: readonly number[]; // 15 dezenas 1..25 ordenadas
  readonly retrievedAt: string; // Timestamp ISO 8601 da captura
  readonly payloadSha256: string; // 64 caracteres hexadecimais minúsculos
  readonly rawPayload: string; // Payload bruto original obrigatório e não vazio
}

/**
 * Validação e normalização de datas da Lotofácil (DD/MM/YYYY ou YYYY-MM-DD)
 */
export function parseOfficialCaixaDate(rawDate: unknown): string | null {
  if (typeof rawDate !== "string") return null;
  const trimmed = rawDate.trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    const [d, m, y] = trimmed.split("/").map(Number);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2003 && y <= 2100) {
      const dt = new Date(Date.UTC(y, m - 1, d));
      if (dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d) {
        return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      }
    }
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split("-").map(Number);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2003 && y <= 2100) {
      const dt = new Date(Date.UTC(y, m - 1, d));
      if (dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d) {
        return trimmed;
      }
    }
  }
  return null;
}

export function validateOfficialCaixaDirectProof(
  proof: unknown,
  expectedContest?: number,
  expectedNumbers?: readonly number[]
): { valid: boolean; reason?: string } {
  if (!proof || typeof proof !== "object") {
    return { valid: false, reason: "Objeto de comprovação ausente ou inválido." };
  }

  const p = proof as Partial<OfficialCaixaDirectResultProof>;

  if (p.proofType !== "OFFICIAL_CAIXA_DIRECT_ENDPOINT") {
    return {
      valid: false,
      reason: `Tipo de prova inválido: esperado 'OFFICIAL_CAIXA_DIRECT_ENDPOINT', recebido '${String(p.proofType)}'.`,
    };
  }

  // 1. P0-02: Código HTTP de sucesso obrigatório
  if (p.httpStatus !== undefined && p.httpStatus !== 200) {
    return {
      valid: false,
      reason: `UNSUCCESSFUL_HTTP_STATUS: Código HTTP inválido no comprovante: esperado 200 (recebido: ${p.httpStatus}).`,
    };
  }

  // 2. P0-02: Payload bruto original é ESTRITAMENTE OBRIGATÓRIO e NÃO VAZIO
  if (typeof p.rawPayload !== "string" || p.rawPayload.trim().length === 0) {
    return {
      valid: false,
      reason: "EMPTY_RAW_PAYLOAD: Payload bruto original da resposta oficial é obrigatório e não pode ser vazio.",
    };
  }

  // 3. Validação do número do concurso declarado
  if (typeof p.contestNumber !== "number" || !Number.isInteger(p.contestNumber) || p.contestNumber <= 0) {
    return { valid: false, reason: `Número de concurso inválido no comprovante: ${String(p.contestNumber)}.` };
  }

  if (expectedContest !== undefined && p.contestNumber !== expectedContest) {
    return {
      valid: false,
      reason: `Concurso no comprovante (#${p.contestNumber}) não coincide com o concurso esperado (#${expectedContest}).`,
    };
  }

  // 4. Validação da URL do endpoint oficial
  if (typeof p.officialEndpoint !== "string" || p.officialEndpoint.trim().length === 0) {
    return { valid: false, reason: "URL do endpoint oficial ausente ou vazia no comprovante." };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(p.officialEndpoint);
  } catch {
    return { valid: false, reason: `URL do endpoint oficial malformada: ${p.officialEndpoint}.` };
  }

  if (parsedUrl.protocol !== "https:") {
    return { valid: false, reason: `Protocolo '${parsedUrl.protocol}' inseguro. Comprovação Caixa exige 'https:'.` };
  }

  if (parsedUrl.username !== "" || parsedUrl.password !== "") {
    return { valid: false, reason: "A URL do endpoint oficial não pode conter credenciais de autenticação embutidas." };
  }

  if (parsedUrl.port !== "" && parsedUrl.port !== "443") {
    return { valid: false, reason: `Porta não autorizada '${parsedUrl.port}' na URL do endpoint oficial.` };
  }

  const rawHostname = parsedUrl.hostname.toLowerCase();
  const isExactCaixa =
    rawHostname === "caixa.gov.br" ||
    rawHostname === "loterias.caixa.gov.br" ||
    rawHostname === "servicebus2.caixa.gov.br";
  const isSubdomainCaixa = rawHostname.endsWith(".caixa.gov.br") && !rawHostname.endsWith("..caixa.gov.br");
  if (!isExactCaixa && !isSubdomainCaixa) {
    return { valid: false, reason: `O hostname '${rawHostname}' não pertence ao domínio oficial *.caixa.gov.br.` };
  }

  // 5. Validação de data do sorteio
  if (typeof p.drawDate !== "string" || p.drawDate.trim().length === 0) {
    return { valid: false, reason: "Data do sorteio ausente ou vazia no comprovante." };
  }

  // 6. Validação das 15 dezenas no comprovante
  if (!Array.isArray(p.drawnNumbers) || p.drawnNumbers.length !== 15) {
    return {
      valid: false,
      reason: `O comprovante deve conter exatamente 15 dezenas (recebido: ${
        Array.isArray(p.drawnNumbers) ? p.drawnNumbers.length : 0
      }).`,
    };
  }

  const seenNumbers = new Set<number>();
  for (let i = 0; i < p.drawnNumbers.length; i++) {
    const n = p.drawnNumbers[i];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 25) {
      return { valid: false, reason: `Dezena inválida na posição ${i} do comprovante: ${n}.` };
    }
    if (seenNumbers.has(n)) {
      return { valid: false, reason: `Dezena duplicada no comprovante: ${n}.` };
    }
    seenNumbers.add(n);
  }

  if (expectedNumbers !== undefined) {
    const sortedExpected = [...expectedNumbers].sort((a, b) => a - b);
    const sortedProof = [...p.drawnNumbers].sort((a, b) => a - b);
    if (sortedExpected.length !== 15 || sortedProof.some((n, i) => n !== sortedExpected[i])) {
      return {
        valid: false,
        reason: `Dezenas no comprovante (${sortedProof.join(", ")}) diferem das dezenas esperadas (${sortedExpected.join(", ")}).`,
      };
    }
  }

  // 7. Validação do timestamp de captura
  if (!isValidIso8601Timestamp(p.retrievedAt)) {
    return { valid: false, reason: `Data/hora de captura inválida no comprovante: ${String(p.retrievedAt)}.` };
  }

  // 8. Validação do formato do SHA-256 declarado
  if (typeof p.payloadSha256 !== "string" || !/^[0-9a-f]{64}$/.test(p.payloadSha256)) {
    return {
      valid: false,
      reason: `SHA-256 do payload ausente ou com formato inválido (exige 64 hexadecimais minúsculos): ${String(
        p.payloadSha256
      )}.`,
    };
  }

  // 9. Recálculo obrigatório do SHA-256 a partir do rawPayload
  const computedSha = syncSha256(p.rawPayload);
  if (computedSha !== p.payloadSha256) {
    return {
      valid: false,
      reason: `Divergência de hash SHA-256 entre payload bruto (${computedSha}) e payloadSha256 declarado (${p.payloadSha256}).`,
    };
  }

  // 10. Validação semântica do conteúdo interno do rawPayload (parse JSON)
  let parsedJson: any;
  try {
    parsedJson = JSON.parse(p.rawPayload);
  } catch {
    return {
      valid: false,
      reason: "O payload bruto não é um JSON válido.",
    };
  }

  // 10a. Concurso no payload
  const rawContest = Number(parsedJson.numero ?? parsedJson.concurso);
  if (!Number.isInteger(rawContest) || rawContest !== p.contestNumber) {
    return {
      valid: false,
      reason: `Número do concurso extraído do payload bruto (#${rawContest}) diverge do comprovante (#${p.contestNumber}).`,
    };
  }

  // 10b. Data no payload
  const rawDateStr = parsedJson.dataApuracao ?? parsedJson.data;
  const parsedDrawDate = parseOfficialCaixaDate(rawDateStr);
  if (!parsedDrawDate) {
    return {
      valid: false,
      reason: `Data oficial extraída do payload bruto ('${rawDateStr}') é inválida ou ausente.`,
    };
  }
  const declaredNormalizedDate = parseOfficialCaixaDate(p.drawDate) ?? p.drawDate;
  if (parsedDrawDate !== declaredNormalizedDate) {
    return {
      valid: false,
      reason: `Data extraída do payload bruto ('${parsedDrawDate}') diverge da data declarada no comprovante ('${p.drawDate}').`,
    };
  }

  // 10c. Dezenas no payload
  const rawDezenas = parsedJson.listaDezenas ?? parsedJson.dezenasSorteadasOrdemSorteio ?? parsedJson.dezenas;
  if (!Array.isArray(rawDezenas) || rawDezenas.length !== 15) {
    return {
      valid: false,
      reason: "Payload bruto não contém o array regulamentar de 15 dezenas oficiais.",
    };
  }
  const payloadDrawn = rawDezenas
    .map((n: any) => Number(n))
    .filter((n: number) => Number.isInteger(n) && n >= 1 && n <= 25)
    .sort((a: number, b: number) => a - b);
  if (payloadDrawn.length !== 15 || new Set(payloadDrawn).size !== 15) {
    return {
      valid: false,
      reason: "Dezenas extraídas do payload bruto contêm números repetidos ou fora do intervalo [1, 25].",
    };
  }

  const proofDrawn = [...p.drawnNumbers].sort((a, b) => a - b);
  if (payloadDrawn.some((n, idx) => n !== proofDrawn[idx])) {
    return {
      valid: false,
      reason: `Dezenas extraídas do payload bruto (${payloadDrawn.join(", ")}) diferem das dezenas no comprovante (${proofDrawn.join(", ")}).`,
    };
  }

  return { valid: true };
}

export type ContestFinancialStatus = "PENDING_HOMOLOGATION" | "HOMOLOGATED";

/**
 * Expressão regular estrita para validação de formato ISO 8601 com data e horário completos
 * Exige: YYYY-MM-DDTHH:mm:ss[.sss...](Z|[+-]HH:MM)
 * Rejeita: strings sem fuso, datas puras, espaços soltos ou formatos permissivos.
 */
export const ISO_8601_TIMESTAMP_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):?(\d{2}))$/;

/**
 * Validação semântica e de calendário para timestamps ISO 8601:
 * - Valida sintaxe estrita (YYYY-MM-DDTHH:mm:ss[.sss](Z|[+-]HH:MM));
 * - Rejeita datas impossíveis (ex: 31 de fevereiro, 31 de abril, 29 de fevereiro em ano não bissexto);
 * - Rejeita horas (> 23), minutos (> 59), segundos (> 59);
 * - Rejeita offsets de fuso inválidos (> 23 horas ou > 59 minutos);
 * - Rejeita parsers permissivos do Date.parse().
 */
export function isValidIso8601Timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  const match = trimmed.match(ISO_8601_TIMESTAMP_REGEX);
  if (!match) return false;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);
  const second = parseInt(match[6], 10);

  // Mês regulamentar 1 a 12
  if (month < 1 || month > 12) return false;

  // Horas, minutos, segundos
  if (hour < 0 || hour > 23) return false;
  if (minute < 0 || minute > 59) return false;
  if (second < 0 || second > 59) return false;

  // Validação de calendário e anos bissextos
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  let maxDaysInMonth = 31;
  if (month === 2) {
    maxDaysInMonth = isLeapYear ? 29 : 28;
  } else if (month === 4 || month === 6 || month === 9 || month === 11) {
    maxDaysInMonth = 30;
  }

  if (day < 1 || day > maxDaysInMonth) {
    return false;
  }

  // Se fuso horário for offset ([+-]HH:MM)
  if (match[8] !== "Z") {
    const offsetHour = parseInt(match[10], 10);
    const offsetMinute = parseInt(match[11], 10);
    if (offsetHour < 0 || offsetHour > 23) return false;
    if (offsetMinute < 0 || offsetMinute > 59) return false;
  }

  const parsed = Date.parse(trimmed);
  return !Number.isNaN(parsed);
}

export interface ContestAuditEvent {
  readonly id: string;
  readonly contestNumber: number;
  readonly operation: "SCORE_CONTEST" | "RECTIFY_OFFICIAL_RESULT";
  readonly financialStatus: ContestFinancialStatus;
  readonly resultConfirmed: boolean;
  readonly operatorId?: string;
  readonly timestamp: string;
  readonly resultSource: ResultSource;
  readonly financialSummary: {
    readonly totalCost: number;
    readonly totalPrize: number;
    readonly officialConfirmedPrize?: number;
    readonly manualConfirmedPrize?: number;
    readonly officialValidatedPrize?: number;
    readonly netBalance: number;
    readonly hasPendingVariableRateio: boolean;
    readonly hasProvisionalVariableRateio?: boolean;
    readonly winningGamesCount: number;
  };
  readonly createdAt: string;
}
