/**
 * V1.10 — Coordenador Único de Snapshots Oficiais CAIXA da Sessão.
 *
 * Responsabilidades:
 * 1. Armazenar no máximo um snapshot externo vigente por concurso dentro da sessão (volátil, memória pura).
 * 2. Fonte Única da Verdade na sessão para respostas externas da CAIXA.
 * 3. Concorrência: "Latest-started network operation wins the right to commit for that contest".
 * 4. Cache-first em `consultContest` (HIT = 0 HTTP; MISS = 1 HTTP + commit).
 * 5. Refresh explícito e atômico em `refreshContest` (sem fallback, sem stale-while-revalidate).
 * 6. Consulta explícita ao último concurso em `consultLatest`.
 * 7. Invalidação síncrona em `clear()` impedindo commits de requisições antigas em voo.
 * 8. NUNCA persistir snapshots em IndexedDB, backup, BroadcastChannel ou SHA.
 */

import type {
  OfficialContestResult,
  LotteryResultProvider,
} from "../lottery/types.ts";
import { getLotteryProvider } from "../lottery/index.ts";

export interface OfficialSnapshotEntry {
  snapshot: OfficialContestResult;
  revision: number;
}

export type OfficialSnapshotListener = (
  contestNumber: number,
  entry: OfficialSnapshotEntry | undefined
) => void;

export class OfficialSnapshotCoordinator implements LotteryResultProvider {
  readonly providerName = "OfficialSnapshotCoordinator";
  private readonly provider: LotteryResultProvider;

  // Repositório volátil exclusivo em memória (zero persistência)
  private readonly snapshots = new Map<number, OfficialSnapshotEntry>();
  private revision = 0;
  private readonly listeners = new Set<OfficialSnapshotListener>();

  // Monotonic operation sequence tracking para concorrência por concurso
  private nextOpId = 0;
  private readonly latestStartedOpIdByContest = new Map<number, number>();
  private clearEpoch = 0;

  constructor(options?: { provider?: LotteryResultProvider }) {
    this.provider = options?.provider ?? getLotteryProvider();
  }

  /**
   * Retorna o snapshot vigente e sua revisão na sessão para o concurso, ou undefined se não houver.
   */
  get(contestNumber: number): OfficialSnapshotEntry | undefined {
    return this.snapshots.get(contestNumber);
  }

  /**
   * Retorna o contador de revisão monotônica global da sessão.
   */
  getRevision(): number {
    return this.revision;
  }

  /**
   * Registra um listener para notificações de atualização/invalidação de snapshots.
   */
  subscribe(listener: OfficialSnapshotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Consulta o snapshot do concurso no modo Cache-First:
   * - HIT: Retorna snapshot em memória (ZERO HTTP).
   * - MISS: Consulta o provider externo, aplica regra de concorrência e estabelece o snapshot.
   */
  async consultContest(
    contestNumber: number,
    signal?: AbortSignal
  ): Promise<OfficialContestResult> {
    const existing = this.snapshots.get(contestNumber);
    if (existing) {
      return existing.snapshot;
    }

    const opId = ++this.nextOpId;
    const epoch = this.clearEpoch;
    this.latestStartedOpIdByContest.set(contestNumber, opId);

    const result = await this.provider.getContest(contestNumber, signal);

    if (
      this.clearEpoch === epoch &&
      this.latestStartedOpIdByContest.get(contestNumber) === opId
    ) {
      this.commit(contestNumber, result);
    }

    return result;
  }

  /**
   * Força uma atualização explícita ignorando qualquer cache prévio:
   * - Sempre consulta a rede (provider.refreshContest).
   * - Em caso de sucesso, estabelece novo snapshot SE a operação for a mais recente iniciada para o concurso.
   * - Em caso de falha, rejeita e NUNCA remove ou altera o snapshot anterior.
   */
  async refreshContest(
    contestNumber: number,
    signal?: AbortSignal
  ): Promise<OfficialContestResult> {
    const opId = ++this.nextOpId;
    const epoch = this.clearEpoch;
    this.latestStartedOpIdByContest.set(contestNumber, opId);

    const result = await this.provider.refreshContest(contestNumber, signal);

    if (
      this.clearEpoch === epoch &&
      this.latestStartedOpIdByContest.get(contestNumber) === opId
    ) {
      this.commit(contestNumber, result);
    }

    return result;
  }

  /**
   * Consulta explicitamente o concurso mais recente na fonte externa:
   * - Sempre consulta a rede (provider.getLatestContest).
   * - Estabelece o snapshot para o contestNumber retornado se vencer a concorrência desse concurso.
   */
  async consultLatest(signal?: AbortSignal): Promise<OfficialContestResult> {
    const opId = ++this.nextOpId;
    const epoch = this.clearEpoch;

    const result = await this.provider.getLatestContest(signal);
    const contestNumber = result.contestNumber;

    const latestForContest = this.latestStartedOpIdByContest.get(contestNumber) ?? 0;
    if (this.clearEpoch === epoch && opId >= latestForContest) {
      this.latestStartedOpIdByContest.set(contestNumber, opId);
      this.commit(contestNumber, result);
    }

    return result;
  }

  /**
   * Implementação do contrato LotteryResultProvider para compatibilidade direta.
   */
  async getLatestContest(signal?: AbortSignal): Promise<OfficialContestResult> {
    return this.consultLatest(signal);
  }

  async getContest(
    contestNumber: number,
    signal?: AbortSignal
  ): Promise<OfficialContestResult> {
    return this.consultContest(contestNumber, signal);
  }

  /**
   * Remove todos os snapshots da sessão e invalida o direito de commit de qualquer
   * operação externa atualmente em voo.
   */
  clear(): void {
    const affectedContests = Array.from(this.snapshots.keys());
    this.snapshots.clear();
    this.clearEpoch++;
    this.latestStartedOpIdByContest.clear();

    for (const cNum of affectedContests) {
      this.notifyListeners(cNum, undefined);
    }
  }

  private commit(contestNumber: number, snapshot: OfficialContestResult): void {
    this.revision++;
    const entry: OfficialSnapshotEntry = {
      snapshot,
      revision: this.revision,
    };
    this.snapshots.set(contestNumber, entry);
    this.notifyListeners(contestNumber, entry);
  }

  private notifyListeners(
    contestNumber: number,
    entry: OfficialSnapshotEntry | undefined
  ): void {
    for (const listener of this.listeners) {
      try {
        listener(contestNumber, entry);
      } catch (err) {
        console.error("Erro ao notificar listener do OfficialSnapshotCoordinator:", err);
      }
    }
  }
}

export const officialSnapshotCoordinator = new OfficialSnapshotCoordinator();
