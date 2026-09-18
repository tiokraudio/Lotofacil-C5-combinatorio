import {
  LotteryResultProvider,
  OfficialContestResult,
  LotteryFetchError,
} from "./types.ts";
import { assertValidOfficialResult } from "./validator.ts";

export interface CaixaProviderOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL =
  "https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil";
const DEFAULT_TIMEOUT_MS = 10_000;

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

  return {
    contestNumber: typeof obj.numero === "number" ? obj.numero : obj.contestNumber,
    drawDate: typeof obj.dataApuracao === "string" ? obj.dataApuracao : obj.drawDate,
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
    fetchedAt: new Date().toISOString(),
  };
}

export class CaixaLotteryProvider implements LotteryResultProvider {
  readonly providerName = "CAIXA - Portal Oficial";
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  // Cache volátil apenas em memória durante a sessão
  private readonly sessionCache = new Map<number, OfficialContestResult>();

  constructor(options?: CaixaProviderOptions) {
    this.baseUrl = options?.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Limpa o cache volátil em memória.
   */
  clearCache(): void {
    this.sessionCache.clear();
  }

  /**
   * Consulta o concurso mais recente disponibilizado pela Caixa.
   */
  async getLatestContest(signal?: AbortSignal): Promise<OfficialContestResult> {
    const data = await this.fetchJson(this.baseUrl, undefined, signal);
    const adapted = adaptCaixaRawPayload(data);
    const normalized = assertValidOfficialResult(adapted, undefined, this.providerName);

    // Cacheia por número de concurso
    this.sessionCache.set(normalized.contestNumber, normalized);
    return normalized;
  }

  /**
   * Consulta o resultado oficial de um concurso específico.
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

    // Se já estiver no cache da sessão, retorna sem nova requisição
    if (this.sessionCache.has(contestNumber)) {
      return this.sessionCache.get(contestNumber)!;
    }

    const url = `${this.baseUrl}/${contestNumber}`;
    const data = await this.fetchJson(url, contestNumber, signal);
    const adapted = adaptCaixaRawPayload(data);
    const normalized = assertValidOfficialResult(
      adapted,
      contestNumber,
      this.providerName
    );

    this.sessionCache.set(contestNumber, normalized);
    return normalized;
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
      const response = await fetch(url, {
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
