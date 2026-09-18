/**
 * Bateria completa de testes da camada de persistência local C₅ (IndexedDB).
 * Cobre ciclo de vida, unicidade, imutabilidade, transações seguras, corrupção,
 * concorrência, persistência entre sessões, resumo estatístico e backup.
 */
import { IDBFactory } from "fake-indexeddb";
import { createContestDraft, createMulberry32 } from "../../c5/index.ts";
import { ContestRepository } from "../contestRepository.ts";
import {
  openDatabase,
  closeDatabase,
  promisifyRequest,
  CONTEST_STORE_NAME,
} from "../db.ts";
import {
  BET_PRICE,
  BET_PRICE_CENTS,
  BETS_PER_CONTEST,
  COST_PER_CONTEST,
  COST_PER_CONTEST_CENTS,
  calculateTotalCostCents,
  formatBRLFromCents,
} from "../types.ts";
import type { ContestRecord, Clock } from "../../c5/types.ts";

export async function runStorageTests(): Promise<{ passed: number; failed: number }> {
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

  console.log("=== INICIANDO TESTES DA CAMADA DE PERSISTÊNCIA INDEXEDDB (STORAGE.TEST) ===");

  const fixedDate1 = new Date("2026-09-17T14:00:00.000Z");
  const fixedDate2 = new Date("2026-09-17T14:05:00.000Z");
  const fixedDate3 = new Date("2026-09-17T21:00:00.000Z");

  const clock1: Clock = () => fixedDate1;
  const clock2: Clock = () => fixedDate2;
  const clock3: Clock = () => fixedDate3;

  const standardResult = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

  // =========================================================================
  // 1. Ciclo Básico: Salvar DRAFT, Recuperar, Congelar, Pontuar e Exclusão
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    const draft = createContestDraft(3300, {
      rng: createMulberry32(101),
      clock: clock1,
      generationId: "uuid-3300",
    });

    // 1.1 Salvar DRAFT
    await repo.saveDraft(draft);
    const recDRAFT = await repo.getContestRecord(3300);
    assert(
      recDRAFT !== null &&
        recDRAFT.status === "DRAFT" &&
        recDRAFT.contestNumber === 3300 &&
        recDRAFT.generationId === "uuid-3300",
      "1.1. Salvar e recuperar DRAFT com sucesso"
    );

    // 1.2 Impedir concurso duplicado
    let duplicateRejected = false;
    try {
      const duplicateDraft = createContestDraft(3300, {
        rng: createMulberry32(102),
      });
      await repo.saveDraft(duplicateDraft);
    } catch (e: any) {
      duplicateRejected = e.message.includes("já possui registro oficial cadastrado");
    }
    assert(duplicateRejected, "1.2. Impedir cadastro duplicado para o mesmo número de concurso");

    // 1.3 Congelar registro persistido
    const frozen = await repo.freezeStoredContest(3300, { clock: clock2 });
    const recFROZEN = await repo.getContestRecord(3300);
    assert(
      frozen.status === "FROZEN" &&
        recFROZEN !== null &&
        recFROZEN.status === "FROZEN" &&
        recFROZEN.frozenAt === fixedDate2.toISOString() &&
        typeof recFROZEN.integrityHash === "string" &&
        recFROZEN.integrityHash.length === 64,
      "1.3. Congelar registro persistido gerando SHA-256 e timestamp frozenAt"
    );

    // 1.4 Impedir exclusão de registro FROZEN
    let deleteFrozenRejected = false;
    try {
      await repo.deleteDraft(3300);
    } catch (e: any) {
      deleteFrozenRejected = e.message.includes("não podem ser excluídos");
    }
    assert(deleteFrozenRejected, "1.4. Impedir exclusão de registro em estado FROZEN");

    // 1.5 Pontuar registro persistido
    const scored = await repo.scoreStoredContest(3300, standardResult, { clock: clock3 });
    const recSCORED = await repo.getContestRecord(3300);
    assert(
      scored.status === "SCORED" &&
        recSCORED !== null &&
        recSCORED.status === "SCORED" &&
        recSCORED.scoredAt === fixedDate3.toISOString() &&
        recSCORED.score !== undefined &&
        recSCORED.integrityHash === frozen.integrityHash,
      "1.5. Pontuar registro persistido com auditorias e preservação do hash"
    );

    // 1.6 Impedir exclusão de registro SCORED
    let deleteScoredRejected = false;
    try {
      await repo.deleteDraft(3300);
    } catch (e: any) {
      deleteScoredRejected = e.message.includes("não podem ser excluídos");
    }
    assert(deleteScoredRejected, "1.6. Impedir exclusão de registro em estado SCORED");

    // 1.7 Permitir exclusão de DRAFT
    const draft2 = createContestDraft(3301, { rng: createMulberry32(202) });
    await repo.saveDraft(draft2);
    assert((await repo.getContestRecord(3301)) !== null, "1.7.a. DRAFT 3301 criado e persistido");
    await repo.deleteDraft(3301);
    const recDeleted = await repo.getContestRecord(3301);
    assert(recDeleted === null, "1.7.b. DRAFT 3301 excluído com sucesso via deleteDraft");
  }

  // =========================================================================
  // 2. Cópias Defensivas (Mutação Externa Não Afeta o Banco)
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    const draft = createContestDraft(3310, { rng: createMulberry32(303) });
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(3310);

    const recordRead1 = await repo.getContestRecord(3310);
    const originalFirstNumber = recordRead1!.generation.games[0][0];

    // Mutamos o objeto em memória deliberadamente
    recordRead1!.generation.games[0][0] = 999;
    recordRead1!.status = "DRAFT";

    // Lemos novamente do banco
    const recordRead2 = await repo.getContestRecord(3310);
    const unchanged =
      recordRead2!.generation.games[0][0] === originalFirstNumber &&
      recordRead2!.status === "FROZEN";

    assert(
      unchanged,
      "2. Cópias defensivas: alteração em objeto retornado não contamina os dados do IndexedDB"
    );
  }

  // =========================================================================
  // 3. Ordenação do Histórico (contestNumber DESC)
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    // Salva em ordem não sequencial
    const numbers = [3105, 3101, 3120, 3102, 3115];
    for (const num of numbers) {
      await repo.saveDraft(createContestDraft(num, { rng: createMulberry32(num) }));
    }

    const all = await repo.getAllContestRecords();
    const allNumbers = all.map((r) => r.contestNumber);
    const isSortedDesc =
      allNumbers.length === 5 &&
      allNumbers[0] === 3120 &&
      allNumbers[1] === 3115 &&
      allNumbers[2] === 3105 &&
      allNumbers[3] === 3102 &&
      allNumbers[4] === 3101;

    assert(
      isSortedDesc,
      "3. getAllContestRecords() retorna registros estritamente ordenados por contestNumber DESC",
      `Retornado: [${allNumbers.join(", ")}]`
    );
  }

  // =========================================================================
  // 4. Resumo do Histórico com Dataset Controlado e Custo Derivado
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    // Cria 1 DRAFT, 1 FROZEN, e 3 SCORED com jogos e resultados precisamente controlados
    // Concurso 3401: DRAFT
    await repo.saveDraft(createContestDraft(3401, { rng: createMulberry32(401) }));

    // Concurso 3402: FROZEN
    await repo.saveDraft(createContestDraft(3402, { rng: createMulberry32(402) }));
    await repo.freezeStoredContest(3402);

    // Concurso 3403: SCORED (Jackpot de J1 com 15 acertos)
    const draft3 = createContestDraft(3403, { rng: createMulberry32(403) });
    await repo.saveDraft(draft3);
    await repo.freezeStoredContest(3403);
    // Usamos como resultado oficial o exato jogo J1 de 3403
    const resJ1 = [...draft3.generation.games[0]];
    const scored3 = await repo.scoreStoredContest(3403, resJ1);
    // Verificação das pontuações de 3403: J1 tem 15 acertos, demais têm [8, 7, 7, 8] acertos (invariante do jackpot)
    // Portanto em 3403: maxHits = 15, prizeCounts: hits15 = 1, outros = 0

    // Concurso 3404: SCORED com acertos conhecidos
    const draft4 = createContestDraft(3404, { rng: createMulberry32(404) });
    await repo.saveDraft(draft4);
    await repo.freezeStoredContest(3404);
    // Montamos resultado com 12 acertos em J1: pega 12 de J1 e 3 dezenas fora de J1
    const setJ1 = new Set(draft4.generation.games[0]);
    const outJ1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25].filter(
      (n) => !setJ1.has(n)
    );
    const res12 = [...draft4.generation.games[0].slice(0, 12), outJ1[0], outJ1[1], outJ1[2]].sort(
      (a, b) => a - b
    );
    const scored4 = await repo.scoreStoredContest(3404, res12);

    // Concurso 3405: SCORED
    const draft5 = createContestDraft(3405, { rng: createMulberry32(405) });
    await repo.saveDraft(draft5);
    await repo.freezeStoredContest(3405);
    const scored5 = await repo.scoreStoredContest(3405, standardResult);

    const summary = await repo.getHistorySummary();

    // Contagens manuais exatas esperadas:
    const expectedDrafts = 1;
    const expectedFrozen = 1;
    const expectedScored = 3;
    const expectedTotalRecords = 5;
    const expectedContestsPlayed = 3;

    // Prêmios individuais somados jogo a jogo:
    const expHits11 =
      scored3.score!.prizeCounts.hits11 +
      scored4.score!.prizeCounts.hits11 +
      scored5.score!.prizeCounts.hits11;
    const expHits12 =
      scored3.score!.prizeCounts.hits12 +
      scored4.score!.prizeCounts.hits12 +
      scored5.score!.prizeCounts.hits12;
    const expHits13 =
      scored3.score!.prizeCounts.hits13 +
      scored4.score!.prizeCounts.hits13 +
      scored5.score!.prizeCounts.hits13;
    const expHits14 =
      scored3.score!.prizeCounts.hits14 +
      scored4.score!.prizeCounts.hits14 +
      scored5.score!.prizeCounts.hits14;
    const expHits15 =
      scored3.score!.prizeCounts.hits15 +
      scored4.score!.prizeCounts.hits15 +
      scored5.score!.prizeCounts.hits15;

    // Concursos com faixa cumulativa:
    const expWith11Plus =
      (scored3.score!.has11Plus ? 1 : 0) +
      (scored4.score!.has11Plus ? 1 : 0) +
      (scored5.score!.has11Plus ? 1 : 0);
    const expWith12Plus =
      (scored3.score!.has12Plus ? 1 : 0) +
      (scored4.score!.has12Plus ? 1 : 0) +
      (scored5.score!.has12Plus ? 1 : 0);
    const expWith13Plus =
      (scored3.score!.has13Plus ? 1 : 0) +
      (scored4.score!.has13Plus ? 1 : 0) +
      (scored5.score!.has13Plus ? 1 : 0);
    const expWith14Plus =
      (scored3.score!.has14Plus ? 1 : 0) +
      (scored4.score!.has14Plus ? 1 : 0) +
      (scored5.score!.has14Plus ? 1 : 0);
    const expWith15 =
      (scored3.score!.has15 ? 1 : 0) +
      (scored4.score!.has15 ? 1 : 0) +
      (scored5.score!.has15 ? 1 : 0);

    const maxList: number[] = [scored3.score!.maxHits, scored4.score!.maxHits, scored5.score!.maxHits];
    const expBestMaxHits = Math.max(...maxList);
    const expAvgMaxHits = Number((maxList.reduce((a, b) => a + b, 0) / 3).toFixed(4));
    const expTotalSpent = expectedContestsPlayed * COST_PER_CONTEST; // 3 * 17.50 = 52.50

    const summaryMatches =
      summary.totalRecords === expectedTotalRecords &&
      summary.drafts === expectedDrafts &&
      summary.frozen === expectedFrozen &&
      summary.scored === expectedScored &&
      summary.contestsPlayed === expectedContestsPlayed &&
      summary.hits11 === expHits11 &&
      summary.hits12 === expHits12 &&
      summary.hits13 === expHits13 &&
      summary.hits14 === expHits14 &&
      summary.hits15 === expHits15 &&
      summary.contestsWith11Plus === expWith11Plus &&
      summary.contestsWith12Plus === expWith12Plus &&
      summary.contestsWith13Plus === expWith13Plus &&
      summary.contestsWith14Plus === expWith14Plus &&
      summary.contestsWith15 === expWith15 &&
      summary.bestMaxHits === expBestMaxHits &&
      summary.averageMaxHits === expAvgMaxHits &&
      summary.totalSpent === expTotalSpent;

    assert(
      summaryMatches,
      "4.1. Resumo estatístico do histórico coincide 100% com os valores exatos esperados",
      `Spent: ${summary.totalSpent}, Played: ${summary.contestsPlayed}, Hits15: ${summary.hits15}, BestMax: ${summary.bestMaxHits}, AvgMax: ${summary.averageMaxHits}`
    );

    // Validação da constante central de custo
    const costFormulaOk =
      BET_PRICE_CENTS === 350 &&
      BET_PRICE === 3.5 &&
      BETS_PER_CONTEST === 5 &&
      COST_PER_CONTEST_CENTS === 1750 &&
      COST_PER_CONTEST === 17.5 &&
      COST_PER_CONTEST_CENTS === BET_PRICE_CENTS * BETS_PER_CONTEST &&
      COST_PER_CONTEST === COST_PER_CONTEST_CENTS / 100;
    assert(costFormulaOk, "4.2. Constantes centrais de custo (BET_PRICE_CENTS, COST_PER_CONTEST_CENTS, COST_PER_CONTEST) rigorosamente calibradas");

    // 4.3. Testes obrigatórios de custo para 0, 1, 2, 10 e 100 concursos
    const cost0 = calculateTotalCostCents(0);
    const cost1 = calculateTotalCostCents(1);
    const cost2 = calculateTotalCostCents(2);
    const cost10 = calculateTotalCostCents(10);
    const cost100 = calculateTotalCostCents(100);

    assert(cost0 === 0 && cost0 / 100 === 0, "4.3.a. Custo para 0 concursos = R$ 0,00 (0 centavos)");
    assert(cost1 === 1750 && cost1 / 100 === 17.5, "4.3.b. Custo para 1 concurso = R$ 17,50 (1750 centavos)");
    assert(cost2 === 3500 && cost2 / 100 === 35.0, "4.3.c. Custo para 2 concursos = R$ 35,00 (3500 centavos)");
    assert(cost10 === 17500 && cost10 / 100 === 175.0, "4.3.d. Custo para 10 concursos = R$ 175,00 (17500 centavos)");
    assert(cost100 === 175000 && cost100 / 100 === 1750.0, "4.3.e. Custo para 100 concursos = R$ 1.750,00 (175000 centavos)");

    // 4.4. Validação da regra de status: DRAFT e FROZEN não adicionam custo ao totalSpent (apenas SCORED contabiliza)
    const idbStatusTest = new IDBFactory();
    const repoStatusTest = new ContestRepository({ idbFactory: idbStatusTest });
    await repoStatusTest.saveDraft(createContestDraft(9001, { rng: createMulberry32(9001) }));
    const draftSummary = await repoStatusTest.getHistorySummary();
    assert(draftSummary.totalSpent === 0 && draftSummary.contestsPlayed === 0, "4.4.a. Rascunho DRAFT não adiciona custo ao totalSpent");

    await repoStatusTest.freezeStoredContest(9001);
    const frozenSummary = await repoStatusTest.getHistorySummary();
    assert(frozenSummary.totalSpent === 0 && frozenSummary.contestsPlayed === 0, "4.4.b. Concurso FROZEN não adiciona custo ao totalSpent (aguardando conferência)");
  }

  // =========================================================================
  // 5. Auditoria Global do Histórico (auditEntireHistory) e Verificação
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    await repo.saveDraft(createContestDraft(3501, { rng: createMulberry32(501) }));

    const d2 = createContestDraft(3502, { rng: createMulberry32(502) });
    await repo.saveDraft(d2);
    await repo.freezeStoredContest(3502);

    const d3 = createContestDraft(3503, { rng: createMulberry32(503) });
    await repo.saveDraft(d3);
    await repo.freezeStoredContest(3503);
    await repo.scoreStoredContest(3503, standardResult);

    const auditRes = await repo.auditEntireHistory();
    const auditOk =
      auditRes.valid &&
      auditRes.totalRecords === 3 &&
      auditRes.validRecords === 3 &&
      auditRes.invalidRecords === 0;

    assert(
      auditOk,
      "5.1. auditEntireHistory() certifica integridade de todos os registros (DRAFT, FROZEN, SCORED)"
    );

    const v1 = await repo.verifyStoredContest(3501);
    const v2 = await repo.verifyStoredContest(3502);
    const v3 = await repo.verifyStoredContest(3503);
    const indOk =
      v1.exists &&
      v1.valid &&
      v1.status === "DRAFT" &&
      v2.exists &&
      v2.valid &&
      v2.status === "FROZEN" &&
      Boolean(v2.generationIntegrity?.valid) &&
      v3.exists &&
      v3.valid &&
      v3.status === "SCORED" &&
      Boolean(v3.generationIntegrity?.valid) &&
      Boolean(v3.scoreIntegrity?.valid);

    assert(indOk, "5.2. verifyStoredContest() valida individualmente com precisão cada estado");
  }

  // =========================================================================
  // 6. Teste de Corrupção do Banco (Detecção e Bloqueio de Score)
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb });

    const draft = createContestDraft(3600, { rng: createMulberry32(600) });
    await repo.saveDraft(draft);
    await repo.freezeStoredContest(3600);

    // Corrupção deliberada direta no IndexedDB, contornando o repository
    const rawDB = await openDatabase({ idbFactory: idb });
    const tx = rawDB.transaction(CONTEST_STORE_NAME, "readwrite");
    const store = tx.objectStore(CONTEST_STORE_NAME);
    const recordToCorrupt = await promisifyRequest<ContestRecord>(store.get(3600));

    // Altera uma dezena em games[0][0]
    recordToCorrupt.generation.games[0][0] = recordToCorrupt.generation.games[0][0] === 1 ? 25 : 1;
    await promisifyRequest(store.put(recordToCorrupt));
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    closeDatabase(rawDB);

    // 6.1 verifyStoredContest deve detectar a adulteração
    const storedAudit = await repo.verifyStoredContest(3600);
    assert(
      !storedAudit.valid && storedAudit.generationIntegrity?.hashMatches === false,
      "6.1. verifyStoredContest() detecta corrupção direta no IndexedDB"
    );

    // 6.2 auditEntireHistory deve apontar o registro corrompido
    const globalAudit = await repo.auditEntireHistory();
    assert(
      !globalAudit.valid &&
        globalAudit.invalidRecords === 1 &&
        globalAudit.records.some((r) => r.contestNumber === 3600 && !r.valid),
      "6.2. auditEntireHistory() detecta registro corrompido na auditoria global"
    );

    // 6.3 scoreStoredContest deve RECUSAR pontuar o registro adulterado
    let scoreCorruptBlocked = false;
    try {
      await repo.scoreStoredContest(3600, standardResult);
    } catch (e: any) {
      scoreCorruptBlocked = e.message.includes("integridade do registro congelado no banco foi violada");
    }
    assert(
      scoreCorruptBlocked,
      "6.3. scoreStoredContest() recusa terminantemente pontuar registro corrompido"
    );
  }

  // =========================================================================
  // 7. Recuperação Após Reinício (Simulação de Sessões A, B, C)
  // =========================================================================
  {
    const idb = new IDBFactory(); // mesma fábrica simulando disco compartilhado entre sessões
    let storedHashSessionA = "";

    // SESSÃO A: Criar DRAFT, salvar, congelar, fechar
    {
      const repoA = new ContestRepository({ idbFactory: idb });
      const draft = createContestDraft(3700, {
        rng: createMulberry32(701),
        clock: clock1,
        generationId: "uuid-session-test",
      });
      await repoA.saveDraft(draft);
      const frozen = await repoA.freezeStoredContest(3700, { clock: clock2 });
      storedHashSessionA = frozen.integrityHash!;
    }

    // SESSÃO B: Reabrir banco, buscar 3700, auditar hash, pontuar, fechar
    {
      const repoB = new ContestRepository({ idbFactory: idb });
      const recordB = await repoB.getContestRecord(3700);
      assert(
        recordB !== null &&
          recordB.status === "FROZEN" &&
          recordB.integrityHash === storedHashSessionA &&
          recordB.generationId === "uuid-session-test",
        "7.1. Sessão B: Registro recuperado intacto após encerramento da Sessão A"
      );

      const verificationB = await repoB.verifyStoredContest(3700);
      assert(verificationB.valid, "7.2. Sessão B: Auditoria de integridade aprovada");

      await repoB.scoreStoredContest(3700, standardResult, { clock: clock3 });
    }

    // SESSÃO C: Reabrir banco, buscar 3700, verificar SCORED, hash inalterado e integridade dupla
    {
      const repoC = new ContestRepository({ idbFactory: idb });
      const recordC = await repoC.getContestRecord(3700);
      assert(
        recordC !== null &&
          recordC.status === "SCORED" &&
          recordC.integrityHash === storedHashSessionA &&
          recordC.score !== undefined &&
          recordC.officialResult !== undefined,
        "7.3. Sessão C: Registro SCORED recuperado com hash preservado e integridade intacta"
      );

      const verificationC = await repoC.verifyStoredContest(3700);
      assert(
        verificationC.valid &&
          Boolean(verificationC.generationIntegrity?.valid) &&
          Boolean(verificationC.scoreIntegrity?.valid),
        "7.4. Sessão C: Dupla auditoria (geração + pontuação) aprovada com 100% de integridade"
      );
    }
  }

  // =========================================================================
  // 8. Testes de Concorrência Rigorosos
  // =========================================================================
  {
    // 8.1 Concorrência de Criação: Duas tentativas simultâneas de salvar o mesmo concurso
    const idb1 = new IDBFactory();
    const repo1 = new ContestRepository({ idbFactory: idb1 });

    const draftA = createContestDraft(3801, {
      rng: createMulberry32(801),
      generationId: "uuid-first",
    });
    const draftB = createContestDraft(3801, {
      rng: createMulberry32(802),
      generationId: "uuid-second",
    });

    const results = await Promise.allSettled([repo1.saveDraft(draftA), repo1.saveDraft(draftB)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    const allRecords3801 = await repo1.getAllContestRecords();
    const concurrentCreateOk =
      fulfilled.length === 1 && rejected.length === 1 && allRecords3801.length === 1;

    assert(
      concurrentCreateOk,
      "8.1. Concorrência de criação: exatamente 1 operação aceita e 1 rejeitada por colisão",
      `Aceitas: ${fulfilled.length}, Rejeitadas: ${rejected.length}, Registros: ${allRecords3801.length}`
    );

    // 8.2 Concorrência de Pontuação: Duas tentativas simultâneas de pontuar o mesmo FROZEN
    const idb2 = new IDBFactory();
    const repo2 = new ContestRepository({ idbFactory: idb2 });

    const draftFrozen = createContestDraft(3802, { rng: createMulberry32(803) });
    await repo2.saveDraft(draftFrozen);
    await repo2.freezeStoredContest(3802);

    const scoreResults = await Promise.allSettled([
      repo2.scoreStoredContest(3802, standardResult),
      repo2.scoreStoredContest(3802, standardResult),
    ]);

    const scoreFulfilled = scoreResults.filter((r) => r.status === "fulfilled");
    const scoreRejected = scoreResults.filter((r) => r.status === "rejected");
    const finalRecord = await repo2.getContestRecord(3802);

    const concurrentScoreOk =
      scoreFulfilled.length === 1 &&
      scoreRejected.length === 1 &&
      finalRecord?.status === "SCORED";

    assert(
      concurrentScoreOk,
      "8.2. Concorrência de pontuação: exatamente 1 transição prevalece, a outra é rejeitada",
      `Aceitas: ${scoreFulfilled.length}, Rejeitadas: ${scoreRejected.length}`
    );
  }

  // =========================================================================
  // 9. Exportação de Backup (exportHistory)
  // =========================================================================
  {
    const idb = new IDBFactory();
    const repo = new ContestRepository({ idbFactory: idb, clock: clock3 });

    await repo.saveDraft(createContestDraft(3901, { rng: createMulberry32(901) }));
    await repo.saveDraft(createContestDraft(3902, { rng: createMulberry32(902) }));
    await repo.freezeStoredContest(3902);

    const backup = await repo.exportHistory();
    const isSerializable = JSON.stringify(backup);
    const parsed = JSON.parse(isSerializable);

    const backupOk =
      parsed.schemaVersion === 1 &&
      parsed.exportedAt === fixedDate3.toISOString() &&
      parsed.recordCount === 2 &&
      Array.isArray(parsed.algorithmVersions) &&
      parsed.algorithmVersions.includes("C5-1.0.0") &&
      Array.isArray(parsed.records) &&
      parsed.records.length === 2 &&
      parsed.records[0].contestNumber === 3901 &&
      parsed.records[1].contestNumber === 3902;

    assert(
      backupOk,
      "9. exportHistory() produz estrutura pura, 100% serializável e com integridade preservada"
    );
  }

  console.log(
    `=== FIM DOS TESTES DE PERSISTÊNCIA: ${passed} PASSOU, ${failed} FALHOU ===\n`
  );

  return { passed, failed };
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes("storage.test.ts")) {
  runStorageTests().then(({ failed }) => {
    if (failed > 0) {
      process.exit(1);
    }
  });
}
