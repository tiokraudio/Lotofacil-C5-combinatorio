import {
  LotteryResultProvider,
  OfficialContestResult,
  LotteryFetchError,
  LotteryErrorCode,
} from "./types.ts";
import { assertValidOfficialResult } from "./validator.ts";

export interface FakeProviderCall {
  method: "getLatestContest" | "getContest";
  contestNumber?: number;
  timestamp: number;
}

export class FakeLotteryResultProvider implements LotteryResultProvider {
  readonly providerName = "FakeLotteryResultProvider (Simulador de Testes)";

  private latestResult: OfficialContestResult | null = null;
  private contestMap = new Map<number, OfficialContestResult>();
  private simulatedErrors = new Map<
    number | "latest",
    { code: LotteryErrorCode; message: string; status?: number; delayMs?: number }
  >();
  private rawPayloads = new Map<number | "latest", unknown>();

  // Histórico de chamadas para testes de privacidade e conformidade
  readonly calls: FakeProviderCall[] = [];

  constructor() {}

  /** Registra resultado válido para o último concurso */
  setLatestContest(result: OfficialContestResult): void {
    this.latestResult = result;
  }

  /** Registra resultado válido para um concurso específico */
  setContestResult(contestNumber: number, result: OfficialContestResult): void {
    this.contestMap.set(contestNumber, result);
  }

  /** Registra um payload cru (pode ser inválido ou corrompido) para testar o validador */
  setRawPayload(target: number | "latest", raw: unknown): void {
    this.rawPayloads.set(target, raw);
  }

  /** Configura uma simulação de erro para um concurso ou para 'latest' */
  simulateError(
    target: number | "latest",
    code: LotteryErrorCode,
    message: string,
    status?: number,
    delayMs?: number
  ): void {
    this.simulatedErrors.set(target, { code, message, status, delayMs });
  }

  /** Limpa todas as simulações e histórico */
  reset(): void {
    this.latestResult = null;
    this.contestMap.clear();
    this.simulatedErrors.clear();
    this.rawPayloads.clear();
    this.calls.length = 0;
  }

  async getLatestContest(signal?: AbortSignal): Promise<OfficialContestResult> {
    this.calls.push({
      method: "getLatestContest",
      timestamp: Date.now(),
    });

    if (signal?.aborted) {
      throw new LotteryFetchError("A consulta foi cancelada.", "ABORTED");
    }

    const simErr = this.simulatedErrors.get("latest");
    if (simErr) {
      if (simErr.delayMs) {
        await new Promise((r) => setTimeout(r, simErr.delayMs));
      }
      throw new LotteryFetchError(simErr.message, simErr.code, simErr.status);
    }

    const raw = this.rawPayloads.get("latest");
    if (raw !== undefined) {
      return assertValidOfficialResult(raw, undefined, this.providerName);
    }

    if (!this.latestResult) {
      throw new LotteryFetchError(
        "Nenhum resultado registrado na fonte simulada.",
        "NOT_FOUND",
        404
      );
    }

    return this.latestResult;
  }

  async getContest(
    contestNumber: number,
    signal?: AbortSignal
  ): Promise<OfficialContestResult> {
    this.calls.push({
      method: "getContest",
      contestNumber,
      timestamp: Date.now(),
    });

    if (signal?.aborted) {
      throw new LotteryFetchError(
        "A consulta foi cancelada.",
        "ABORTED",
        undefined,
        contestNumber
      );
    }

    const simErr = this.simulatedErrors.get(contestNumber);
    if (simErr) {
      if (simErr.delayMs) {
        await new Promise((r) => setTimeout(r, simErr.delayMs));
      }
      throw new LotteryFetchError(
        simErr.message,
        simErr.code,
        simErr.status,
        contestNumber
      );
    }

    const raw = this.rawPayloads.get(contestNumber);
    if (raw !== undefined) {
      return assertValidOfficialResult(raw, contestNumber, this.providerName);
    }

    const res = this.contestMap.get(contestNumber);
    if (!res) {
      throw new LotteryFetchError(
        `Resultado do concurso ${contestNumber} ainda não disponível na fonte consultada.`,
        "NOT_FOUND",
        404,
        contestNumber
      );
    }

    // Valida com o concurso solicitado
    return assertValidOfficialResult(res, contestNumber, this.providerName);
  }
}
