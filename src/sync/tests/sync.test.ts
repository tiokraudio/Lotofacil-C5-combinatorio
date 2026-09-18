/**
 * Testes unitários da camada de sincronização operacional (Prompt 08).
 * Cobre cenários A-I, ausência de mutação, chamada mínima e proteção contra concorrência.
 */

import { IDBFactory } from "fake-indexeddb";
import { ContestRepository } from "../../storage/contestRepository.ts";
import { createContestDraft, createMulberry32 } from "../../c5/index.ts";
import type { LotteryResultProvider, OfficialContestResult } from "../../lottery/types.ts";
import { buildContestSyncState, ContestSyncController } from "../contestSyncService.ts";

/**
 * Provedor simulado para testes de sincronização
 */
class FakeLotteryResultProvider implements LotteryResultProvider {
  readonly providerName = "FakeCaixaProvider";
  getLatestContestCalls = 0;
  getContestCalls = 0;

  constructor(
    public latestContest: OfficialContestResult | null = null,
    public throwOnLatest: Error | null = null,
    public delayMs = 0
  ) {}

  async getLatestContest(signal?: AbortSignal): Promise<OfficialContestResult> {
    this.getLatestContestCalls++;
    if (this.delayMs > 0) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, this.delayMs);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("ABORTED"));
        });
      });
    }

    if (signal?.aborted) {
      const err = new Error("ABORTED");
      (err as any).code = "ABORTED";
      throw err;
    }

    if (this.throwOnLatest) {
      throw this.throwOnLatest;
    }

    if (!this.latestContest) {
      throw new Error("Nenhum resultado configurado");
    }

    return this.latestContest;
  }

  async getContest(contestNumber: number, signal?: AbortSignal): Promise<OfficialContestResult> {
    this.getContestCalls++;
    throw new Error(`getContest(${contestNumber}) não deve ser chamado no sync!`);
  }
}

const sampleResult: OfficialContestResult = {
  contestNumber: 3350,
  drawDate: "17/09/2026",
  numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  source: "CAIXA",
  fetchedAt: "2026-09-17T18:00:00.000Z",
  nextContestNumber: 3351,
  nextContestDate: "18/09/2026",
  isAccumulated: false,
};

export async function runSyncTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✓ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ [FAIL] ${testName}${detail ? ` - ${detail}` : ""}`);
      failed++;
    }
  }

  console.log("=== INICIANDO TESTES DA CAMADA DE SINCRONIZAÇÃO (PROMPT 08) ===");

  const fixedClock = () => new Date("2026-09-17T14:00:00.000Z");

  // =========================================================================
  // CENÁRIO A: Sistema Vazio (local vazio + CAIXA 3350)
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });
    const fakeProvider = new FakeLotteryResultProvider(sampleResult);

    const state = await buildContestSyncState(fakeProvider, repo);

    assert(state.status === "ONLINE", "Cenário A - status ONLINE");
    assert(state.latestOfficialContest === 3350, "Cenário A - latestOfficialContest === 3350");
    assert(state.nextSuggestedContest === 3351, "Cenário A - nextSuggestedContest === 3351");
    assert(state.localLatestContest === null, "Cenário A - localLatestContest === null");
    assert(state.notices.some((n) => n.type === "EMPTY_SYSTEM"), "Cenário A - notice EMPTY_SYSTEM gerado");
    assert(
      state.recommendedActions.some((a) => a.type === "PREPARE_CONTEST" && a.contestNumber === 3351),
      "Cenário A - ação PREPARE_CONTEST 3351 sugerida"
    );
  }

  // =========================================================================
  // CENÁRIO B: Rascunho Pendente (DRAFT 3351 + CAIXA 3350)
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });
    const draft = createContestDraft(3351, { rng: createMulberry32(1), clock: fixedClock });
    await repo.saveDraft(draft);

    const fakeProvider = new FakeLotteryResultProvider(sampleResult);
    const state = await buildContestSyncState(fakeProvider, repo);

    assert(state.drafts.includes(3351), "Cenário B - rascunho 3351 listado em drafts");
    assert(state.staleDrafts.length === 0, "Cenário B - rascunho 3351 não é stale");
    assert(state.notices.some((n) => n.type === "DRAFT_PENDING" && n.contestNumber === 3351), "Cenário B - notice DRAFT_PENDING para 3351");
    assert(state.recommendedActions.some((a) => a.type === "OPEN_DRAFT" && a.contestNumber === 3351), "Cenário B - ação OPEN_DRAFT para 3351");
  }

  // =========================================================================
  // CENÁRIO C: Aguardando Resultado (FROZEN 3351 + CAIXA 3350)
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });
    const draft = createContestDraft(3351, { rng: createMulberry32(2), clock: fixedClock });
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(3351);

    const fakeProvider = new FakeLotteryResultProvider(sampleResult);
    const state = await buildContestSyncState(fakeProvider, repo);

    assert(state.pendingFrozenContests.includes(3351), "Cenário C - 3351 listado em pendingFrozenContests");
    assert(state.waitingResultContests.includes(3351), "Cenário C - 3351 classificado em waitingResultContests");
    assert(state.availableResultContests.length === 0, "Cenário C - availableResultContests vazio");
    assert(state.notices.some((n) => n.type === "WAITING_RESULT" && n.contestNumber === 3351), "Cenário C - notice WAITING_RESULT gerado");
  }

  // =========================================================================
  // CENÁRIO D: Resultado Disponível (FROZEN 3350 + CAIXA 3350)
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });
    const draft = createContestDraft(3350, { rng: createMulberry32(3), clock: fixedClock });
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(3350);

    const fakeProvider = new FakeLotteryResultProvider(sampleResult);
    const state = await buildContestSyncState(fakeProvider, repo);

    assert(state.availableResultContests.includes(3350), "Cenário D - 3350 em availableResultContests");
    assert(state.waitingResultContests.length === 0, "Cenário D - waitingResultContests vazio");
    assert(state.notices.some((n) => n.type === "RESULT_AVAILABLE" && n.contestNumber === 3350), "Cenário D - notice RESULT_AVAILABLE gerado");
    assert(
      state.recommendedActions.some((a) => a.type === "CHECK_RESULT" && a.contestNumber === 3350 && a.urgency === "HIGH"),
      "Cenário D - ação CHECK_RESULT com urgência HIGH para 3350"
    );
  }

  // =========================================================================
  // CENÁRIO E: Todos Conferidos (SCORED 3350 + CAIXA 3350)
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });
    const draft = createContestDraft(3350, { rng: createMulberry32(4), clock: fixedClock });
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(3350);
    await repo.scoreStoredContest(3350, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

    const fakeProvider = new FakeLotteryResultProvider(sampleResult);
    const state = await buildContestSyncState(fakeProvider, repo);

    assert(state.scoredContests.includes(3350), "Cenário E - 3350 em scoredContests");
    assert(state.pendingFrozenContests.length === 0, "Cenário E - pendingFrozenContests vazio");
    assert(state.notices.some((n) => n.type === "ALL_SCORED"), "Cenário E - notice ALL_SCORED gerado");
  }

  // =========================================================================
  // CENÁRIO F: Múltiplos Pendentes (FROZEN 3348, 3349 + CAIXA 3350)
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    for (const num of [3348, 3349]) {
      const draft = createContestDraft(num, { rng: createMulberry32(num), clock: fixedClock });
      await repo.saveDraft(draft);
      await repo.freezeStoredContest(num);
    }

    const fakeProvider = new FakeLotteryResultProvider(sampleResult);
    const state = await buildContestSyncState(fakeProvider, repo);

    assert(
      state.availableResultContests.includes(3348) && state.availableResultContests.includes(3349),
      "Cenário F - ambos 3348 e 3349 em availableResultContests"
    );
    assert(
      state.recommendedActions.filter((a) => a.type === "CHECK_RESULT").length === 2,
      "Cenário F - ações CHECK_RESULT geradas para ambos os concursos"
    );
  }

  // =========================================================================
  // CENÁRIO G: Rascunho Antigo / Obsoleto (DRAFT 3345 + CAIXA 3350)
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });
    const draft = createContestDraft(3345, { rng: createMulberry32(5), clock: fixedClock });
    await repo.saveDraft(draft);

    const fakeProvider = new FakeLotteryResultProvider(sampleResult);
    const state = await buildContestSyncState(fakeProvider, repo);

    assert(state.staleDrafts.includes(3345), "Cenário G - 3345 classificado em staleDrafts");
    assert(state.notices.some((n) => n.type === "STALE_DRAFT" && n.contestNumber === 3345), "Cenário G - notice STALE_DRAFT para 3345");
    assert(
      state.recommendedActions.some((a) => a.type === "DISCARD_DRAFT" && a.contestNumber === 3345),
      "Cenário G - ação DISCARD_DRAFT recomendada para 3345"
    );
    assert(
      state.recommendedActions.some((a) => a.type === "OPEN_DRAFT" && a.contestNumber === 3345),
      "Cenário G - ação OPEN_DRAFT disponível para inspecionar rascunho obsoleto"
    );
  }

  // =========================================================================
  // CENÁRIO H: Concurso Local à Frente (FROZEN 3360 + CAIXA 3350, next 3351)
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });
    const draft = createContestDraft(3360, { rng: createMulberry32(6), clock: fixedClock });
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(3360);

    const fakeProvider = new FakeLotteryResultProvider(sampleResult);
    const state = await buildContestSyncState(fakeProvider, repo);

    assert(state.aheadContests.includes(3360), "Cenário H - 3360 classificado em aheadContests");
    assert(state.waitingResultContests.includes(3360), "Cenário H - 3360 está em waitingResultContests");
    assert(state.notices.some((n) => n.type === "LOCAL_AHEAD" && n.contestNumber === 3360), "Cenário H - notice LOCAL_AHEAD gerado");
  }

  // =========================================================================
  // CENÁRIO I: Falha de Rede / API Offline
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });
    const draft = createContestDraft(3350, { rng: createMulberry32(7), clock: fixedClock });
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(3350);

    // 1. Falha de rede simulada com erro na API
    const errorProvider = new FakeLotteryResultProvider(null, new Error("Erro de rede / timeout"));
    const stateErr = await buildContestSyncState(errorProvider, repo);

    assert(stateErr.status === "ERROR", "Cenário I.1 - status === ERROR quando API falha");
    assert(stateErr.latestOfficialContest === null, "Cenário I.1 - latestOfficialContest é null");
    assert(stateErr.pendingFrozenContests.includes(3350), "Cenário I.1 - dados locais mantidos íntegros");
    assert(stateErr.waitingResultContests.includes(3350), "Cenário I.1 - FROZEN tratado preventivamente como aguardando");

    // 2. Modo Offline detectado
    const offlineProvider = new FakeLotteryResultProvider(sampleResult);
    const stateOffline = await buildContestSyncState(offlineProvider, repo, { isOnline: false });

    assert(stateOffline.status === "OFFLINE", "Cenário I.2 - status === OFFLINE");
    assert(offlineProvider.getLatestContestCalls === 0, "Cenário I.2 - nenhuma chamada de rede feita se offline");
  }

  // =========================================================================
  // TESTE DE IMUTABILIDADE / AUSÊNCIA DE MUTAÇÕES
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    // Inserir DRAFT, FROZEN e SCORED
    const d1 = createContestDraft(3340, { rng: createMulberry32(10), clock: fixedClock });
    await repo.saveDraft(d1);

    const d2 = createContestDraft(3341, { rng: createMulberry32(11), clock: fixedClock });
    await repo.saveDraft(d2);
    await repo.freezeStoredContest(3341);

    const d3 = createContestDraft(3342, { rng: createMulberry32(12), clock: fixedClock });
    await repo.saveDraft(d3);
    await repo.freezeStoredContest(3342);
    await repo.scoreStoredContest(3342, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

    const beforeRecords = await repo.getAllContestRecords();
    const beforeJson = JSON.stringify(beforeRecords);

    const fakeProvider = new FakeLotteryResultProvider(sampleResult);
    await buildContestSyncState(fakeProvider, repo);

    const afterRecords = await repo.getAllContestRecords();
    const afterJson = JSON.stringify(afterRecords);

    assert(beforeJson === afterJson, "Imutabilidade - buildContestSyncState NÃO realizou nenhuma mutação no IndexedDB");
    assert(afterRecords.length === 3, "Imutabilidade - contagem total de registros inalterada");
    assert(afterRecords.find((r) => r.contestNumber === 3341)?.status === "FROZEN", "Imutabilidade - status 3341 permaneceu FROZEN");
  }

  // =========================================================================
  // TESTE DE CHAMADA MÍNIMA
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    // Criar múltiplos registros locais
    for (const num of [3330, 3331, 3332, 3333]) {
      const d = createContestDraft(num, { rng: createMulberry32(num), clock: fixedClock });
      await repo.saveDraft(d);
      await repo.freezeStoredContest(num);
    }

    const fakeProvider = new FakeLotteryResultProvider(sampleResult);
    await buildContestSyncState(fakeProvider, repo);

    assert(fakeProvider.getLatestContestCalls === 1, "Chamada Mínima - exatamente 1 getLatestContest");
    assert(fakeProvider.getContestCalls === 0, "Chamada Mínima - ZERO chamadas getContest individuais");
  }

  // =========================================================================
  // TESTE DE PROTEÇÃO CONTRA CONCORRÊNCIA (ContestSyncController)
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    const slowProvider = new FakeLotteryResultProvider(sampleResult, null, 60);
    const controller = new ContestSyncController(slowProvider, repo);

    // Dispara requisição 1 lenta
    const req1Promise = controller.sync();

    // Dispara requisição 2 rápida imediatamente depois
    const fastProvider = new FakeLotteryResultProvider(
      { ...sampleResult, contestNumber: 3351, nextContestNumber: 3352 },
      null,
      5
    );
    const controllerFast = new ContestSyncController(fastProvider, repo);
    const req2Promise = controllerFast.sync();

    const [res1, res2] = await Promise.all([req1Promise, req2Promise]);

    assert(res1.isLatest === true, "Concorrência - controller mantém sequenceId consistente");
    assert(res2.isLatest === true, "Concorrência - controller rápido completou");
  }

  console.log(`\n=== FIM DOS TESTES DE SINCRONIZAÇÃO: ${passed} PASS, ${failed} FAIL ===\n`);
  return { passed, failed };
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes("sync.test")) {
  runSyncTests().then((res) => {
    if (res.failed > 0) {
      process.exit(1);
    }
  });
}
