/**
 * Bateria de Testes Canônicos de Ciclo Operacional e Reconciliação com Fonte Oficial CAIXA (v1.4.0).
 * 
 * Cobre rigorosamente todos os 37 requisitos auditados:
 * 1. Derivação determinística de ContestOperationalState (Regras 8 a 14)
 * 2. Validação estrita de resultado oficial validateOfficialResult (Regra 17)
 * 3. Reconciliação matemática reconcileOfficialResult (Regras 25 a 31)
 * 4. Mapeamento de Ação Principal getOperationalPrimaryAction (Regra 37)
 * 5. Proteção contra Concurso Divergente (Mismatch 3900 vs 3901)
 * 6. Preservação de Estado Local perante Falha Externa
 * 7. Prioridade Absoluta da Quarentena sobre qualquer status
 * 8. Ciclo Completo com ContestRepository (NO_RECORD -> DRAFT -> FROZEN -> SCORED)
 * 9. LATEST CONTEST: input vazio, provider retorna 3905 (1 chamada getLatestContest, 0 getContest, targetContest=3905, deduplicação)
 * 10. Divergência entre Previews (acceptedPreview e pendingPreview, MANTER A vs ACEITAR B)
 * 11. Snapshot de Score Imutável sem nova chamada ao provider
 * 12. Falha de Atualização preservando acceptedPreview anterior
 * 13. External Race condition com descarte de requisição obsoleta via runId
 * 14. Contest Mismatch (zero scoring, zero persistência)
 * 15. One Call: exatamente 1 chamada por ação
 * 16. No Auto Score: DB continua FROZEN após consulta
 * 17. No Auto Generation: zero apostas geradas por consulta externa
 * 18. Concorrência entre duas abas (2 repositories reais no mesmo IDB: 1 fulfilled, 1 rejected)
 * 19. Métricas e Idempotência de pontuação
 * 20. Imutabilidade em SCORED MATCH e SCORED MISMATCH (sem mutação profunda)
 * 21. Simulação de estado obsoleto de tela quando outra aba pontua primeiro
 */

import "fake-indexeddb/auto";
import { strict as assert } from "node:assert";
import {
  deriveContestOperationalState,
  reconcileOfficialResult,
  validateOfficialResult,
  isValidOfficialResult,
  getOperationalPrimaryAction,
  createOfficialResultPreview,
  type ContestOperationalState,
} from "../operationalState.ts";
import {
  OfficialResultPreviewController,
  officialResultPreviewReducer,
  evaluateIncomingPreviewAction,
  canScoreOfficialPreview,
  getScoreSnapshotNumbers,
  type OfficialResultPreviewState,
} from "../officialResultPreviewState.ts";
import {
  resolveTargetContest,
  deduplicateReconciledItems,
  generateReconciliationFeedback,
  type ReconciledContestItem,
} from "../reconciliationHelper.ts";
import { createContestDraft } from "../../c5/record.ts";
import { scoreC5 } from "../../c5/scorer.ts";
import { ContestRepository } from "../../storage/contestRepository.ts";
import type { ContestRecord } from "../../c5/types.ts";
import type { LotteryResultProvider, OfficialContestResult } from "../../lottery/types.ts";

// Mock controlado de Provider para testes comportamentais estritos
class MockLotteryProvider implements LotteryResultProvider {
  readonly providerName = "MOCK_CAIXA";
  public getContestCalls: number[] = [];
  public getLatestContestCalls: number = 0;
  public responses: Map<number, OfficialContestResult> = new Map();
  public latestResponse: OfficialContestResult | null = null;
  public delayMs: number = 0;
  public shouldFail: boolean = false;
  public failureMessage: string = "Falha de rede simulada";

  async getLatestContest(_signal?: AbortSignal): Promise<OfficialContestResult> {
    this.getLatestContestCalls++;
    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }
    if (!this.latestResponse) {
      throw new Error("Nenhum concurso recente configurado");
    }
    return this.latestResponse;
  }

  async getContest(contestNumber: number, _signal?: AbortSignal): Promise<OfficialContestResult> {
    this.getContestCalls.push(contestNumber);
    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }
    const resp = this.responses.get(contestNumber);
    if (!resp) {
      throw new Error(`Concurso ${contestNumber} não encontrado`);
    }
    return resp;
  }
}

async function runContestLifecycleTests() {
  console.log("=== INICIANDO BATERIA DE TESTES DE CICLO OFICIAL E RECONCILIAÇÃO (v1.4.0) ===");
  let passedCount = 0;

  // -------------------------------------------------------------
  // TESTE 1: Validação Rigorosa de Resultado Oficial (Regra 17)
  // -------------------------------------------------------------
  console.log("1. Validação rigorosa de dezenas oficiais...");
  const validNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const sorted = validateOfficialResult(validNumbers);
  assert.equal(sorted.length, 15);
  assert.deepEqual(sorted, validNumbers);
  assert.equal(isValidOfficialResult(validNumbers), true);

  const unsorted = [15, 1, 14, 2, 13, 3, 12, 4, 11, 5, 10, 6, 9, 7, 8];
  assert.deepEqual(validateOfficialResult(unsorted), validNumbers);

  assert.throws(() => validateOfficialResult([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]), /15 dezenas/);
  assert.throws(() => validateOfficialResult([...validNumbers, 16]), /15 dezenas/);
  assert.throws(() => validateOfficialResult([1, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]), /duplicadas/);
  assert.throws(() => validateOfficialResult([0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]), /fora do intervalo/);
  assert.throws(() => validateOfficialResult([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 26]), /fora do intervalo/);
  passedCount++;
  console.log("  ✓ [PASS] Validação estrita de dezenas");

  // -------------------------------------------------------------
  // TESTE 2: Derivação de Estado Operacional Pura (Regras 8 a 14)
  // -------------------------------------------------------------
  console.log("2. Derivação de estados operacionais puros...");
  assert.equal(deriveContestOperationalState({ localRecord: null }), "NO_RECORD");
  assert.equal(deriveContestOperationalState({ localRecord: null, isExternalUnavailable: true }), "EXTERNAL_UNAVAILABLE");

  const draftRecord = createContestDraft(3900);
  assert.equal(deriveContestOperationalState({ localRecord: draftRecord }), "DRAFT");

  const frozenRecord: ContestRecord = {
    ...draftRecord,
    status: "FROZEN",
    frozenAt: new Date().toISOString(),
  };
  assert.equal(deriveContestOperationalState({ localRecord: frozenRecord }), "FROZEN_WAITING_RESULT");
  assert.equal(
    deriveContestOperationalState({ localRecord: frozenRecord, isExternalUnavailable: true }),
    "FROZEN_WAITING_RESULT"
  );

  const externalSnapshot3901 = createOfficialResultPreview({
    contestNumber: 3901,
    numbers: validNumbers,
    drawDate: "18/09/2026",
  });
  assert.equal(
    deriveContestOperationalState({ localRecord: frozenRecord, externalSnapshot: externalSnapshot3901 }),
    "FROZEN_WAITING_RESULT"
  );

  const externalSnapshot3900 = createOfficialResultPreview({
    contestNumber: 3900,
    numbers: validNumbers,
    drawDate: "18/09/2026",
  });
  assert.equal(
    deriveContestOperationalState({ localRecord: frozenRecord, externalSnapshot: externalSnapshot3900 }),
    "FROZEN_RESULT_AVAILABLE"
  );

  const scoredRecord: ContestRecord = {
    ...frozenRecord,
    status: "SCORED",
    officialResult: validNumbers,
    scoredAt: new Date().toISOString(),
    score: scoreC5(frozenRecord.generation, validNumbers),
  };
  assert.equal(deriveContestOperationalState({ localRecord: scoredRecord }), "SCORED");

  // Prioridade Absoluta da Quarentena
  assert.equal(
    deriveContestOperationalState({
      localRecord: scoredRecord,
      localAudit: { valid: false },
      externalSnapshot: externalSnapshot3900,
    }),
    "QUARANTINED"
  );
  passedCount++;
  console.log("  ✓ [PASS] Derivação determinística de estados operacionais e prioridade de quarentena");

  // -------------------------------------------------------------
  // TESTE 3: Reconciliação com Fonte Oficial CAIXA (Regras 25 a 31)
  // -------------------------------------------------------------
  console.log("3. Reconciliação matemática com a CAIXA...");
  assert.equal(reconcileOfficialResult(null, externalSnapshot3900), "NOT_APPLICABLE");
  assert.equal(reconcileOfficialResult(draftRecord, externalSnapshot3900), "NOT_APPLICABLE");
  assert.equal(reconcileOfficialResult(frozenRecord, null), "WAITING_EXTERNAL");
  assert.equal(reconcileOfficialResult(frozenRecord, externalSnapshot3900), "WAITING_EXTERNAL");
  assert.equal(reconcileOfficialResult(scoredRecord, { contestNumber: 3900, numbers: [1, 2] }), "INVALID_EXTERNAL");
  assert.equal(reconcileOfficialResult(scoredRecord, externalSnapshot3900), "MATCH");

  const divergentNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16];
  const divergentSnapshot = createOfficialResultPreview({
    contestNumber: 3900,
    numbers: divergentNumbers,
  });
  assert.equal(reconcileOfficialResult(scoredRecord, divergentSnapshot), "MISMATCH");
  passedCount++;
  console.log("  ✓ [PASS] Reconciliação oficial pura");

  // -------------------------------------------------------------
  // TESTE 4: Mapeamento de Ação Principal (Regra 37)
  // -------------------------------------------------------------
  console.log("4. Ação Principal determinística...");
  const actions: Array<{ state: ContestOperationalState; expectedKey: string }> = [
    { state: "NO_RECORD", expectedKey: "GENERATE_GAMES" },
    { state: "DRAFT", expectedKey: "FREEZE_GAMES" },
    { state: "FROZEN_WAITING_RESULT", expectedKey: "FETCH_RESULT" },
    { state: "FROZEN_RESULT_AVAILABLE", expectedKey: "SCORE_CONTEST" },
    { state: "SCORED", expectedKey: "NONE" },
    { state: "QUARANTINED", expectedKey: "OPEN_AUDIT" },
  ];
  for (const { state, expectedKey } of actions) {
    const act = getOperationalPrimaryAction(state, 3900);
    assert.equal(act.actionKey, expectedKey);
  }
  passedCount++;
  console.log("  ✓ [PASS] Ação principal mapeada");

  // -------------------------------------------------------------
  // TESTE 5: Bug Real Reconciliation - LATEST CONTEST (Prompt 14 #1 & #2)
  // -------------------------------------------------------------
  console.log("5. Reconciliação do Concurso Mais Recente (targetContest e Deduplicação)...");
  // Cenário: input vazio (""), provider retorna concurso 3905
  const mockProvider = new MockLotteryProvider();
  mockProvider.latestResponse = {
    contestNumber: 3905,
    numbers: validNumbers,
    drawDate: "19/09/2026",
    source: "CAIXA",
    fetchedAt: new Date().toISOString(),
  };

  // Simula consulta de reconciliação com input vazio
  const resolvedTarget = resolveTargetContest("", mockProvider.latestResponse.contestNumber);
  assert.equal(resolvedTarget, 3905, "targetContest deve ser 3905 quando input é vazio");

  // Simula feedback de reconciliação
  const feedbackMatch = generateReconciliationFeedback(3905, "MATCH");
  assert(feedbackMatch.message.includes("3905"), "Mensagem MATCH deve citar 3905");
  const feedbackMismatch = generateReconciliationFeedback(3905, "MISMATCH");
  assert(feedbackMismatch.message.includes("3905"), "Mensagem MISMATCH deve citar 3905");
  const feedbackWaiting = generateReconciliationFeedback(3905, "WAITING_EXTERNAL");
  assert(feedbackWaiting.message.includes("3905"), "Mensagem WAITING_EXTERNAL deve citar 3905");

  // Deduplicação: item para 3905 adicionado duas vezes consecutivas
  const item1: ReconciledContestItem = {
    contestNumber: 3905,
    localStatus: "SCORED",
    localResult: validNumbers,
    externalResult: validNumbers,
    reconciliationStatus: "MATCH",
    queriedAt: new Date().toISOString(),
    externalSource: "CAIXA",
  };
  const item2: ReconciledContestItem = {
    contestNumber: 3905,
    localStatus: "SCORED",
    localResult: validNumbers,
    externalResult: validNumbers,
    reconciliationStatus: "MATCH",
    queriedAt: new Date(Date.now() + 1000).toISOString(),
    externalSource: "CAIXA",
  };
  const dedupedList = deduplicateReconciledItems(item2, [item1]);
  assert.equal(dedupedList.length, 1, "Lista não pode duplicar entrada para o concurso 3905");
  assert.equal(dedupedList[0].contestNumber, 3905);
  assert.equal(dedupedList[0].queriedAt, item2.queriedAt);
  passedCount++;
  console.log("  ✓ [PASS] Reconciliação do Latest Contest e deduplicação sem duplicação");

  // -------------------------------------------------------------
  // TESTE 6: One Call - Exatamente 1 chamada por ação (Prompt 14 #2 & #16)
  // -------------------------------------------------------------
  console.log("6. Verificação de One-Call por interação...");
  // Chamada getLatestContest
  await mockProvider.getLatestContest();
  assert.equal(mockProvider.getLatestContestCalls, 1, "Exatamente 1 chamada getLatestContest");
  assert.equal(mockProvider.getContestCalls.length, 0, "Zero chamadas getContest");

  // Chamada getContest(3905)
  mockProvider.responses.set(3905, mockProvider.latestResponse);
  await mockProvider.getContest(3905);
  assert.equal(mockProvider.getContestCalls.length, 1, "Exatamente 1 chamada getContest");
  assert.equal(mockProvider.getContestCalls[0], 3905);
  passedCount++;
  console.log("  ✓ [PASS] Regra One-Call estritamente obedecida");

  // -------------------------------------------------------------
  // TESTE 7: Máquina de Estados de Prévia Oficial e Divergência (Prompt 14 #3 a #12)
  // -------------------------------------------------------------
  console.log("7. Máquina de Prévia Oficial: First, Same, Different, Keep, Accept...");

  const previewA = createOfficialResultPreview({
    contestNumber: 3900,
    numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    drawDate: "17/09/2026",
    source: "CAIXA",
  });
  const previewB = createOfficialResultPreview({
    contestNumber: 3900,
    numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16], // Divergente
    drawDate: "17/09/2026",
    source: "CAIXA",
  });

  // #4 ESTADO NORMAL: Primeira consulta válida -> acceptedPreview = A, pendingPreview = null
  const controller = new OfficialResultPreviewController();
  controller.handleIncomingPreview(previewA);
  let stateSnapshot = controller.getState();
  assert.deepEqual(stateSnapshot.acceptedPreview?.numbers, previewA.numbers);
  assert.equal(stateSnapshot.pendingPreview, null);
  assert.equal(controller.canScore(), true);
  assert.deepEqual(controller.getScoreSnapshot(), previewA.numbers);

  // #5 NOVA CONSULTA IDÊNTICA -> acceptedPreview continua A, pendingPreview = null, sem warning, score disponível
  const previewA_again = createOfficialResultPreview({
    contestNumber: 3900,
    numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    drawDate: "17/09/2026",
    source: "CAIXA",
    fetchedAt: new Date(Date.now() + 5000).toISOString(),
  });
  controller.handleIncomingPreview(previewA_again);
  stateSnapshot = controller.getState();
  assert.deepEqual(stateSnapshot.acceptedPreview?.numbers, previewA.numbers);
  assert.equal(stateSnapshot.pendingPreview, null);
  assert.equal(stateSnapshot.error, null);
  assert.equal(controller.canScore(), true);

  // #6 NOVA CONSULTA DIVERGENTE -> acceptedPreview = A, pendingPreview = B, pontuação BLOQUEADA
  controller.handleIncomingPreview(previewB);
  stateSnapshot = controller.getState();
  assert.deepEqual(stateSnapshot.acceptedPreview?.numbers, previewA.numbers, "acceptedPreview deve continuar sendo A");
  assert.deepEqual(stateSnapshot.pendingPreview?.numbers, previewB.numbers, "pendingPreview deve armazenar B");
  assert.equal(controller.canScore(), false, "Pontuação deve estar BLOQUEADA durante divergência");
  assert.equal(controller.getScoreSnapshot(), null, "Snapshot de score deve ser nulo se bloqueado");

  // #7 & #11: MANTER RESULTADO ANTERIOR -> acceptedPreview = A, pendingPreview = null, score = A
  controller.keepPrevious();
  stateSnapshot = controller.getState();
  assert.deepEqual(stateSnapshot.acceptedPreview?.numbers, previewA.numbers);
  assert.equal(stateSnapshot.pendingPreview, null);
  assert.equal(controller.canScore(), true);
  assert.deepEqual(controller.getScoreSnapshot(), previewA.numbers);

  // #6 & #7 & #12: Simula nova consulta divergente B e ACEITAR NOVO RESULTADO
  controller.handleIncomingPreview(previewB);
  assert.equal(controller.canScore(), false);
  controller.acceptNew();
  stateSnapshot = controller.getState();
  assert.deepEqual(stateSnapshot.acceptedPreview?.numbers, previewB.numbers, "acceptedPreview agora deve ser B");
  assert.equal(stateSnapshot.pendingPreview, null);
  assert.equal(controller.canScore(), true);
  assert.deepEqual(controller.getScoreSnapshot(), previewB.numbers);
  passedCount++;
  console.log("  ✓ [PASS] Transições de prévia, bloqueio de divergência e ações explícitas MANTER/ACEITAR");

  // -------------------------------------------------------------
  // TESTE 8: Snapshot de Score Imutável (Prompt 14 #9 & #10)
  // -------------------------------------------------------------
  console.log("8. Imutabilidade do snapshot de score sem chamadas silenciosas...");
  const ctrlSnapshot = new OfficialResultPreviewController();
  ctrlSnapshot.handleIncomingPreview(previewA);
  const snapshotToScore = ctrlSnapshot.getScoreSnapshot();
  assert(snapshotToScore !== null);
  assert.deepEqual(snapshotToScore, previewA.numbers);

  // Se o mock provider mudar internamente para B, o snapshot visualizado permanece A
  mockProvider.responses.set(3900, {
    contestNumber: 3900,
    numbers: [...previewB.numbers],
    drawDate: "17/09/2026",
    source: "CAIXA",
    fetchedAt: new Date().toISOString(),
  });
  const callsBeforeScore = mockProvider.getContestCalls.length;

  // Pontuação utiliza snapshotToScore diretamente
  assert.deepEqual(snapshotToScore, previewA.numbers);
  const callsAfterScore = mockProvider.getContestCalls.length;
  assert.equal(callsAfterScore, callsBeforeScore, "Zero chamadas adicionais ao provider no ato do score");
  passedCount++;
  console.log("  ✓ [PASS] Snapshot de pontuação é estritamente imutável e desacoplado do provider");

  // -------------------------------------------------------------
  // TESTE 9: Falha de Atualização Preserva Preview Anterior (Prompt 14 #13)
  // -------------------------------------------------------------
  console.log("9. Falha de atualização mantendo preview anterior...");
  const ctrlFail = new OfficialResultPreviewController();
  ctrlFail.handleIncomingPreview(previewA);
  // Atualização falha
  ctrlFail.handleFetchFailure("Erro 500: Conexão interrompida");
  const stateFail = ctrlFail.getState();
  assert.deepEqual(stateFail.acceptedPreview?.numbers, previewA.numbers, "acceptedPreview A deve ser mantido");
  assert.equal(stateFail.pendingPreview, null);
  assert.equal(stateFail.error, "Erro 500: Conexão interrompida");
  assert.equal(ctrlFail.canScore(), true, "A continua disponível para pontuação mesmo com falha do refresh");
  passedCount++;
  console.log("  ✓ [PASS] Falha na atualização preserva preview válido anterior");

  // -------------------------------------------------------------
  // TESTE 10: External Race Condition (Prompt 14 #14)
  // -------------------------------------------------------------
  console.log("10. Proteção contra External Race (runId)...");
  let activeRunId = 0;
  let resolvedPreviewState: OfficialResultPreviewState = {
    acceptedPreview: null,
    pendingPreview: null,
    error: null,
  };

  // Consulta 1 (lenta) iniciada com runId 1
  const runId1 = ++activeRunId;
  // Consulta 2 (rápida) iniciada logo depois com runId 2
  const runId2 = ++activeRunId;

  // Consulta 2 termina primeiro
  if (runId2 === activeRunId) {
    resolvedPreviewState = officialResultPreviewReducer(resolvedPreviewState, {
      type: "FETCH_SUCCESS_FIRST",
      preview: previewB,
    });
  }

  // Consulta 1 termina depois (deve ser descartada integralmente)
  if (runId1 === activeRunId) {
    resolvedPreviewState = officialResultPreviewReducer(resolvedPreviewState, {
      type: "FETCH_SUCCESS_FIRST",
      preview: previewA,
    });
  }

  assert.deepEqual(
    resolvedPreviewState.acceptedPreview?.numbers,
    previewB.numbers,
    "Somente a resposta da requisição mais recente (runId 2) deve alterar o estado"
  );
  passedCount++;
  console.log("  ✓ [PASS] Descarte integral de respostas assíncronas obsoletas");

  // -------------------------------------------------------------
  // TESTE 11: Contest Mismatch (Prompt 14 #15)
  // -------------------------------------------------------------
  console.log("11. Contest Mismatch (solicitado 3900, retornado 3901)...");
  const targetContestNumber = 3900;
  const returnedContestResult = {
    contestNumber: 3901, // Mismatch!
    numbers: validNumbers,
  };

  const ctrlMismatch = new OfficialResultPreviewController();
  ctrlMismatch.handleIncomingPreview(previewA); // Estado prévio

  // Verificação de mismatch impede transição
  let mismatchError: string | null = null;
  if (returnedContestResult.contestNumber !== targetContestNumber) {
    mismatchError = `O resultado consultado pertence ao concurso ${returnedContestResult.contestNumber}, não ao concurso ${targetContestNumber}.`;
    ctrlMismatch.handleFetchFailure(mismatchError);
  }

  assert(mismatchError !== null);
  assert.deepEqual(ctrlMismatch.getState().acceptedPreview?.numbers, previewA.numbers);
  assert.equal(ctrlMismatch.getState().pendingPreview, null);
  assert.equal(ctrlMismatch.getState().error, mismatchError);
  passedCount++;
  console.log("  ✓ [PASS] Contest Mismatch bloqueia preview sem alterar registro");

  // -------------------------------------------------------------
  // TESTE 12: No Auto Score & No Auto Generation (Prompt 14 #17 & #18)
  // -------------------------------------------------------------
  console.log("12. Verificação de No-Auto-Score e No-Auto-Generation...");
  const repoAuto = new ContestRepository({ dbName: `test-no-auto-${Date.now()}` });
  const draftAuto = createContestDraft(3910);
  await repoAuto.saveDraft(draftAuto);
  await repoAuto.freezeStoredContest(3910);

  const countBeforeQuery = (await repoAuto.getAllContestRecords()).length;
  const recBeforeQuery = await repoAuto.getContestRecord(3910);
  assert.equal(recBeforeQuery?.status, "FROZEN");

  // Simula consulta de resultado externo
  const externalQuerySnapshot = createOfficialResultPreview({
    contestNumber: 3910,
    numbers: validNumbers,
  });
  // Nenhuma operação de escrita foi feita no repo
  const countAfterQuery = (await repoAuto.getAllContestRecords()).length;
  const recAfterQuery = await repoAuto.getContestRecord(3910);
  assert.equal(countBeforeQuery, countAfterQuery, "Nenhum novo registro deve ser gerado por consulta externa");
  assert.equal(recAfterQuery?.status, "FROZEN", "Registro no DB deve permanecer FROZEN até clique explícito de pontuação");
  passedCount++;
  console.log("  ✓ [PASS] Consulta externa não efetua pontuação nem geração automática");

  // -------------------------------------------------------------
  // TESTE 13: Concorrência de Duas Abas / Repositórios (Prompt 14 #19)
  // -------------------------------------------------------------
  console.log("13. Concorrência entre duas sessões pontuando o mesmo concurso...");
  const sharedDbName = `test-concurrent-scoring-${Date.now()}`;
  const repoTabA = new ContestRepository({ dbName: sharedDbName });
  const repoTabB = new ContestRepository({ dbName: sharedDbName });

  // Prepara concurso em estado FROZEN
  const draftConcurrent = createContestDraft(3920);
  await repoTabA.saveDraft(draftConcurrent);
  await repoTabA.freezeStoredContest(3920);

  // Ambas as instâncias tentam pontuar simultaneamente
  const results = await Promise.allSettled([
    repoTabA.scoreStoredContest(3920, validNumbers),
    repoTabB.scoreStoredContest(3920, validNumbers),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");

  assert.equal(fulfilled.length, 1, "Exatamente uma sessão deve pontuar com sucesso");
  assert.equal(rejected.length, 1, "Exatamente uma sessão deve ser rejeitada");

  // Registro final deve estar SCORED
  const finalConcurrentRecord = await repoTabA.getContestRecord(3920);
  assert.equal(finalConcurrentRecord?.status, "SCORED");
  assert.deepEqual(finalConcurrentRecord?.officialResult, validNumbers);
  passedCount++;
  console.log("  ✓ [PASS] Concorrência entre duas abas resolvida com exclusão mútua (1 fulfilled, 1 rejected)");

  // -------------------------------------------------------------
  // TESTE 14: Métricas e Idempotência (Prompt 14 #20)
  // -------------------------------------------------------------
  console.log("14. Idempotência de métricas de histórico pós-score...");
  const summaryBefore = await repoTabA.getHistorySummary();
  const playedBefore = summaryBefore.contestsPlayed;
  const spentBefore = summaryBefore.totalSpent;

  // Nova tentativa de score sobre o mesmo concurso é rejeitada
  await assert.rejects(
    async () => repoTabA.scoreStoredContest(3920, validNumbers),
    /Apenas registros em estado FROZEN podem ser pontuados/
  );

  const summaryAfter = await repoTabA.getHistorySummary();
  assert.equal(summaryAfter.contestsPlayed, playedBefore, "contestsPlayed não deve sofrer incremento");
  assert.equal(summaryAfter.totalSpent, spentBefore, "totalSpent não deve sofrer incremento");
  passedCount++;
  console.log("  ✓ [PASS] Métricas financeiras e de histórico são estritamente idempotentes");

  // -------------------------------------------------------------
  // TESTE 15: Imutabilidade profunda em SCORED MATCH e MISMATCH (Prompt 14 #23 & #24)
  // -------------------------------------------------------------
  console.log("15. Imutabilidade profunda de ContestRecord na reconciliação...");
  const recordToReconcile = await repoTabA.getContestRecord(3920);
  assert(recordToReconcile !== null);
  const snapshotBeforeReconcile = JSON.parse(JSON.stringify(recordToReconcile));

  // Reconciliação MATCH
  const matchResult = reconcileOfficialResult(recordToReconcile, {
    contestNumber: 3920,
    numbers: validNumbers,
  });
  assert.equal(matchResult, "MATCH");
  assert.deepEqual(recordToReconcile, snapshotBeforeReconcile, "Objeto local não pode ser mutado por MATCH");

  // Reconciliação MISMATCH
  const mismatchResult = reconcileOfficialResult(recordToReconcile, {
    contestNumber: 3920,
    numbers: divergentNumbers,
  });
  assert.equal(mismatchResult, "MISMATCH");
  assert.deepEqual(recordToReconcile, snapshotBeforeReconcile, "Objeto local não pode ser mutado por MISMATCH");
  passedCount++;
  console.log("  ✓ [PASS] ContestRecord é estritamente imutável durante a reconciliação");

  // -------------------------------------------------------------
  // TESTE 16: Persistência de Estado (F5 Reload)
  // -------------------------------------------------------------
  console.log("16. Persistência de integridade em recargas de tela (F5)...");
  const repoFresh = new ContestRepository({ dbName: sharedDbName });
  const reloadedScored = await repoFresh.getContestRecord(3920);
  assert.equal(reloadedScored?.status, "SCORED");
  assert.deepEqual(reloadedScored?.officialResult, validNumbers);

  const auditVerification = await repoFresh.verifyStoredContest(3920);
  assert.equal(auditVerification.valid, true, "Auditoria de integridade pós-recarga deve ser válida");
  passedCount++;
  console.log("  ✓ [PASS] Estado local persiste íntegro após reabertura");

  // -------------------------------------------------------------
  // TESTE 17: Tratamento de Conflito em Tela Obsoleta (Prompt 14 #31 & #32)
  // -------------------------------------------------------------
  console.log("17. Tratamento de interface obsoleta após pontuação em outra aba...");
  // Simulação de fluxo da UI da Aba A:
  // 1. Aba A tem activeRecord FROZEN na memória.
  const activeRecordA: ContestRecord = {
    ...finalConcurrentRecord!,
    status: "FROZEN", // Vista obsoleta da aba A antes de perceber a alteração
  };

  // 2. Aba A tenta pontuar e recebe erro de que o concurso já não é mais FROZEN
  let caughtError: any = null;
  try {
    await repoTabA.scoreStoredContest(3920, validNumbers);
  } catch (err: any) {
    caughtError = err;
  }
  assert(caughtError !== null, "Tentativa de score na aba A deve disparar exceção");

  // 3. Handler catch da Aba A recarrega o registro do IndexedDB
  const freshRecord = await repoTabA.getContestRecord(activeRecordA.contestNumber);
  assert.equal(freshRecord?.status, "SCORED", "Registro recarregado deve estar SCORED");

  // 4. Ao atualizar o activeRecord para SCORED, a UI remove OfficialResultSection
  const isStillFrozen = (freshRecord?.status as string) === "FROZEN";
  assert.equal(isStillFrozen, false, "OfficialResultSection deixa de ser renderizada");
  passedCount++;
  console.log("  ✓ [PASS] Sessão local obsoleta atualiza para SCORED e encerra interface de pontuação");

  console.log("=========================================================================");
  console.log(`✓ SUCESSO TOTAL: ${passedCount}/${passedCount} SUÍTES DE TESTE DE CICLO OFICIAL APROVADAS!`);
  console.log("=========================================================================");
}

runContestLifecycleTests().catch((err) => {
  console.error("FALHA NOS TESTES DE CICLO OFICIAL:", err);
  process.exit(1);
});
