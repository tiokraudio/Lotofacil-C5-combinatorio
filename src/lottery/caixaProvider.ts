import {
  LotteryResultProvider,
  OfficialContestResult,
  LotteryFetchError,
} from "./types.ts";
import { assertValidOfficialResult } from "./validator.ts";

export interface CaixaProviderOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

const DEFAULT_BASE_URL =
  "https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil";
const DEFAULT_TIMEOUT_MS = 10_000;

function parseHitFromRateioItem(item: Record<string, unknown>): number | undefined {
  // 1. Identidade canônica determinada estritamente pelo campo estrutural 'faixa' da CAIXA
  const rawFaixa =
    typeof item.faixa === "number" && Number.isSafeInteger(item.faixa)
      ? item.faixa
      : typeof item.faixa === "string" && /^\d+$/.test(item.faixa.trim())
      ? parseInt(item.faixa.trim(), 10)
      : undefined;

  if (rawFaixa !== undefined) {
    if (rawFaixa === 1) return 15;
    if (rawFaixa === 2) return 14;
    if (rawFaixa === 3) return 13;
    if (rawFaixa === 4) return 12;
    if (rawFaixa === 5) return 11;
    // Qualquer outra faixa numérica é desconhecida/inválida
    return undefined;
  }

  // 2. Se 'faixa' não estiver presente, permite 'hits' direto se for safe integer entre 11 e 15
  if (
    typeof item.hits === "number" &&
    Number.isSafeInteger(item.hits) &&
    item.hits >= 11 &&
    item.hits <= 15
  ) {
    return item.hits;
  }

  // Nota: 'descricaoFaixa' não determina hits (não sobrepõe e não define identidade primária)
  return undefined;
}

function parseWinnersFromRateioItem(item: Record<string, unknown>): number | undefined {
  const rawW =
    item.numeroDeGanhadores !== undefined
      ? item.numeroDeGanhadores
      : item.numeroGanhadores !== undefined
      ? item.numeroGanhadores
      : item.ganhadores !== undefined
      ? item.ganhadores
      : item.winners;

  if (typeof rawW === "number") {
    if (!Number.isSafeInteger(rawW) || rawW < 0) {
      return undefined;
    }
    return rawW;
  }

  if (typeof rawW === "string") {
    const trimmed = rawW.trim();
    const cleaned = trimmed.replace(/\./g, "");
    if (/^\d+$/.test(cleaned)) {
      const n = parseInt(cleaned, 10);
      if (Number.isSafeInteger(n) && n >= 0) {
        return n;
      }
    }
  }

  return undefined;
}

function parsePrizeCentsFromRateioItem(item: Record<string, unknown>): number | undefined {
  if (
    typeof item.prizePerWinnerCents === "number" &&
    Number.isSafeInteger(item.prizePerWinnerCents) &&
    item.prizePerWinnerCents >= 0
  ) {
    return item.prizePerWinnerCents;
  }

  const rawV =
    item.valorPremio !== undefined
      ? item.valorPremio
      : item.valor !== undefined
      ? item.valor
      : item.prizePerWinner;

  if (typeof rawV === "number") {
    if (!Number.isFinite(rawV) || rawV < 0) {
      return undefined;
    }

    // Verifica se possui mais de 2 casas decimais significativas (rejeita 1.234, 10.999)
    const cents = rawV * 100;
    const roundedCents = Math.round(cents);
    if (Math.abs(cents - roundedCents) > 1e-6) {
      return undefined;
    }

    const str = rawV.toString();
    if (str.includes(".")) {
      const decPart = str.split(".")[1];
      if (decPart.length > 2 && !/^0+$/.test(decPart.slice(2))) {
        return undefined;
      }
    }

    if (!Number.isSafeInteger(roundedCents) || roundedCents < 0) {
      return undefined;
    }

    return roundedCents;
  }

  if (typeof rawV === "string") {
    let s = rawV.trim();
    if (s.toUpperCase().startsWith("R$")) {
      s = s.slice(2).trim();
    }

    if (!s) return undefined;

    // Formato Brasileiro: e.g. "1.500.000,00", "12,50", "0" (máximo 2 casas após vírgula)
    const brRegex = /^(?:\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/;
    // Formato Decimal padrão: e.g. "1500000.00", "12.50", "0" (máximo 2 casas após ponto)
    const dotRegex = /^\d+(?:\.(\d{1,2}))?$/;

    let match = brRegex.exec(s);
    if (match) {
      const integerPart = s.split(",")[0].replace(/\./g, "");
      const decPart = (match[1] ?? "").padEnd(2, "0");
      const intVal = parseInt(integerPart, 10);
      const decVal = parseInt(decPart, 10);
      if (!Number.isSafeInteger(intVal)) return undefined;
      const cents = intVal * 100 + decVal;
      return Number.isSafeInteger(cents) && cents >= 0 ? cents : undefined;
    }

    match = dotRegex.exec(s);
    if (match) {
      const parts = s.split(".");
      const integerPart = parts[0];
      const decPart = (match[1] ?? "").padEnd(2, "0");
      const intVal = parseInt(integerPart, 10);
      const decVal = parseInt(decPart, 10);
      if (!Number.isSafeInteger(intVal)) return undefined;
      const cents = intVal * 100 + decVal;
      return Number.isSafeInteger(cents) && cents >= 0 ? cents : undefined;
    }

    // Qualquer outro formato com lixo ("10abc", "10,999", "-1") é rejeitado
    return undefined;
  }

  return undefined;
}

/**
 * Adapter dedicado para o formato peculiar da CAIXA.
 * Converte o formato específico da CAIXA (onde dezenas vêm como string[] ex: ["03", "25"])
 * para a estrutura esperada pelo validador do modelo de domínio (onde numbers é number[]).
 * O validador de domínio permanece estrito e puro (rejeitando strings).
 */
export function adaptCaixaRawPayload(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }
  const obj = raw as Record<string, unknown>;

  // A Caixa envia as dezenas em 'listaDezenas' (ou alternativamente 'dezenasSorteadasOrdemSorteio')
  const rawDezenas = Array.isArray(obj.listaDezenas)
    ? obj.listaDezenas
    : Array.isArray(obj.dezenasSorteadasOrdemSorteio)
    ? obj.dezenasSorteadasOrdemSorteio
    : obj.numbers;

  let adaptedNumbers: unknown = rawDezenas;

  if (Array.isArray(rawDezenas)) {
    adaptedNumbers = rawDezenas.map((val) => {
      // Converte strings ("03" -> 3, "25" -> 25)
      if (typeof val === "string") {
        const trimmed = val.trim();
        if (/^\d+$/.test(trimmed)) {
          return parseInt(trimmed, 10);
        }
        // Se for string não numérica (ex: "abc"), preserva para o validador acusar
        return val;
      }
      return val;
    });
  }

  const contestNumber =
    typeof obj.numero === "number" ? obj.numero : obj.contestNumber;
  const fetchedAt =
    typeof obj.fetchedAt === "string" && obj.fetchedAt.trim()
      ? obj.fetchedAt
      : new Date().toISOString();

  // Adaptação da lista de rateio oficial da CAIXA (V1.9)
  let adaptedPrizeRef: unknown = undefined;

  if (Array.isArray(obj.listaRateioPremio)) {
    const adaptedTiers: Array<{
      hits?: number;
      winners?: number;
      prizePerWinnerCents?: number;
    }> = [];

    for (const item of obj.listaRateioPremio) {
      if (item && typeof item === "object") {
        const itemObj = item as Record<string, unknown>;
        const hits = parseHitFromRateioItem(itemObj);
        const winners = parseWinnersFromRateioItem(itemObj);
        const prizePerWinnerCents = parsePrizeCentsFromRateioItem(itemObj);

        adaptedTiers.push({
          hits,
          winners,
          prizePerWinnerCents,
        });
      } else {
        adaptedTiers.push(item as any);
      }
    }

    // Ordena canonicamente de 15 a 11 acertos (decrescente).
    // Qualquer ordem recebida de listaRateioPremio produzirá exatamente a mesma referência!
    adaptedTiers.sort((a, b) => {
      const hA = typeof a?.hits === "number" ? a.hits : 0;
      const hB = typeof b?.hits === "number" ? b.hits : 0;
      return hB - hA;
    });

    adaptedPrizeRef = {
      contestNumber,
      source: "CAIXA",
      fetchedAt,
      tiers: adaptedTiers,
    };
  } else if (obj.prizeReference !== undefined) {
    adaptedPrizeRef = obj.prizeReference;
  }

  return {
    contestNumber,
    drawDate:
      typeof obj.dataApuracao === "string" ? obj.dataApuracao : obj.drawDate,
    numbers: adaptedNumbers,
    source: "CAIXA",
    nextContestNumber:
      typeof obj.numeroConcursoProximo === "number"
        ? obj.numeroConcursoProximo
        : undefined,
    nextContestDate:
      typeof obj.dataProximoConcurso === "string"
        ? obj.dataProximoConcurso
        : undefined,
    isAccumulated:
      typeof obj.acumulado === "boolean" ? obj.acumulado : undefined,
    fetchedAt,
    prizeReference: adaptedPrizeRef,
  };
}

export class CaixaLotteryProvider implements LotteryResultProvider {
  readonly providerName = "CAIXA - Portal Oficial";
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options?: CaixaProviderOptions) {
    this.baseUrl = options?.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn = options?.fetchFn ?? ((...args) => globalThis.fetch(...args));
  }

  /**
   * Operação sem estado mantida por compatibilidade de interface.
   * O gerenciamento de snapshots pertence exclusivamente ao OfficialSnapshotCoordinator.
   */
  clearCache(): void {
    // no-op: caching e concorrência são gerenciados pelo OfficialSnapshotCoordinator
  }

  /**
   * Consulta o concurso mais recente disponibilizado pela Caixa.
   */
  async getLatestContest(signal?: AbortSignal): Promise<OfficialContestResult> {
    const data = await this.fetchJson(this.baseUrl, undefined, signal);
    const adapted = adaptCaixaRawPayload(data);
    return assertValidOfficialResult(
      adapted,
      undefined,
      this.providerName
    );
  }

  /**
   * Consulta o resultado oficial de um concurso específico via rede.
   */
  async getContest(
    contestNumber: number,
    signal?: AbortSignal
  ): Promise<OfficialContestResult> {
    if (!Number.isInteger(contestNumber) || contestNumber <= 0) {
      throw new LotteryFetchError(
        `Número de concurso inválido (${contestNumber}). Deve ser um inteiro positivo.`,
        "INVALID_PAYLOAD",
        undefined,
        contestNumber
      );
    }

    const url = `${this.baseUrl}/${contestNumber}`;
    const data = await this.fetchJson(url, contestNumber, signal);
    const adapted = adaptCaixaRawPayload(data);
    return assertValidOfficialResult(
      adapted,
      contestNumber,
      this.providerName
    );
  }

  /**
   * Executa nova consulta externa real para o concurso.
   */
  async refreshContest(
    contestNumber: number,
    signal?: AbortSignal
  ): Promise<OfficialContestResult> {
    if (!Number.isInteger(contestNumber) || contestNumber <= 0) {
      throw new LotteryFetchError(
        `Número de concurso inválido (${contestNumber}). Deve ser um inteiro positivo.`,
        "INVALID_PAYLOAD",
        undefined,
        contestNumber
      );
    }

    const url = `${this.baseUrl}/${contestNumber}`;
    const data = await this.fetchJson(url, contestNumber, signal);
    const adapted = adaptCaixaRawPayload(data);
    return assertValidOfficialResult(
      adapted,
      contestNumber,
      this.providerName
    );
  }

  /**
   * Executa a requisição HTTP com timeout explícito de 10s e AbortController.
   */
  private async fetchJson(
    url: string,
    contestNumber?: number,
    callerSignal?: AbortSignal
  ): Promise<unknown> {
    const controller = new AbortController();
    let timeoutTriggered = false;

    const timeoutId = setTimeout(() => {
      timeoutTriggered = true;
      controller.abort();
    }, this.timeoutMs);

    // Conecta o signal do chamador se fornecido
    const handleCallerAbort = () => {
      controller.abort();
    };

    if (callerSignal) {
      if (callerSignal.aborted) {
        clearTimeout(timeoutId);
        throw new LotteryFetchError(
          "A consulta foi cancelada.",
          "ABORTED",
          undefined,
          contestNumber
        );
      }
      callerSignal.addEventListener("abort", handleCallerAbort);
    }

    try {
      const response = await this.fetchFn(url, {
        method: "GET",
        headers: {
          Accept: "application/json, text/plain, */*",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Tratamento de Status HTTP
      if (!response.ok) {
        if (response.status === 404) {
          throw new LotteryFetchError(
            contestNumber
              ? `Resultado do concurso ${contestNumber} ainda não disponível na fonte consultada.`
              : "Concurso não encontrado na fonte consultada.",
            "NOT_FOUND",
            404,
            contestNumber
          );
        }

        // A API da Caixa responde status 500 quando um concurso futuro ainda não foi apurado
        if (response.status === 500) {
          let errorBodyText = "";
          try {
            errorBodyText = await response.text();
          } catch {
            // Silencioso
          }

          if (
            errorBodyText.includes('"StatusCode":404') ||
            errorBodyText.includes("StatusCode") ||
            errorBodyText.includes("Ocorreu um erro inesperado")
          ) {
            throw new LotteryFetchError(
              contestNumber
                ? `Resultado do concurso ${contestNumber} ainda não disponível na fonte consultada.`
                : "Concurso ainda não disponível na fonte consultada.",
              "NOT_FOUND",
              500,
              contestNumber
            );
          }

          throw new LotteryFetchError(
            `A fonte da CAIXA retornou erro no servidor (HTTP ${response.status}).`,
            "HTTP_ERROR",
            response.status,
            contestNumber
          );
        }

        throw new LotteryFetchError(
          `A fonte externa respondeu com erro HTTP ${response.status} (${response.statusText}).`,
          "HTTP_ERROR",
          response.status,
          contestNumber
        );
      }

      // HTTP 200: Parse do JSON
      let json: unknown;
      try {
        json = await response.json();
      } catch (jsonErr: any) {
        throw new LotteryFetchError(
          "A fonte respondeu com sucesso, mas o formato não é um JSON válido.",
          "INVALID_PAYLOAD",
          200,
          contestNumber
        );
      }

      return json;
    } catch (err: any) {
      clearTimeout(timeoutId);

      if (err instanceof LotteryFetchError) {
        throw err;
      }

      if (timeoutTriggered) {
        throw new LotteryFetchError(
          `Tempo limite da consulta excedido (${Math.round(this.timeoutMs / 1000)}s).`,
          "TIMEOUT",
          undefined,
          contestNumber
        );
      }

      if (callerSignal?.aborted || err.name === "AbortError") {
        throw new LotteryFetchError(
          "A consulta foi cancelada.",
          "ABORTED",
          undefined,
          contestNumber
        );
      }

      // Erro genérico de rede/CORS
      throw new LotteryFetchError(
        "Não foi possível consultar o resultado (falha de rede ou conectividade).",
        "NETWORK_ERROR",
        undefined,
        contestNumber
      );
    } finally {
      if (callerSignal) {
        callerSignal.removeEventListener("abort", handleCallerAbort);
      }
    }
  }
}
