/**
 * C5-MEMORY-2.0.0 — SUÍTE DE TESTES DO CICLO OPERACIONAL DIÁRIO (UI-1C)
 *
 * Cobre integralmente os 24 requisitos obrigatórios da especificação UI-1C:
 * 1. Somente C5-Memory disponível para nova geração;
 * 2. C5-1.0.0 não pode gerar nova aposta;
 * 3. Registro legado continua legível;
 * 4. Backup contendo legado continua válido;
 * 5. AVAILABLE → PREVIEW;
 * 6. PREVIEW → FROZEN;
 * 7. Preview descartado não altera H;
 * 8. FROZEN sobrevive reload;
 * 9. Resultado não modifica FrozenMemoryPayload;
 * 10. Resultado não modifica historyFingerprint por campos exógenos;
 * 11. Score correto dos cinco jogos;
 * 12. COMPLETED preserva os cinco jogos;
 * 13. Concurso seguinte utiliza H atualizado;
 * 14. Concurso seguinte possui novo Draft explícito;
 * 15. Jogo histórico exato continua bloqueado;
 * 16. Não existe botão/recurso de repetir aposta;
 * 17. Stale multiaba continua bloqueado;
 * 18. Auditoria permanece somente leitura;
 * 19. Histórico mostra múltiplos concursos;
 * 20. Legado não recebe memoryPayload retroativamente;
 * 21. Nenhuma auto-regeneração;
 * 22. Nenhuma geração automática no carregamento;
 * 23. Nenhuma chamada direta da UI ao domínio/storage;
 * 24. Reload completo do ciclo N → N+1.
 */

import fs from "fs";
import path from "path";
import { IDBFactory } from "fake-indexeddb";
import { ContestRepository } from "../../../storage/contestRepository.ts";
import { openDatabase, closeDatabase, promisifyRequest, CONTEST_STORE_NAME } from "../../../storage/db.ts";
import {
  getMemoryOperationalState,
  generateMemoryDraft,
  confirmMemoryDraft,
  getMemoryAuditDetails,
  detectDuplicateGames,
  ExactHistoryDuplicateBlockedError,
  EXACT_HISTORY_DUPLICATE_BLOCKED,
} from "../memoryBetOrchestrator.ts";
import {
  getMemoryHistoryState,
  confirmMemoryBetAtomic,
} from "../../../storage/memoryTransaction.ts";
import { StaleRevisionRejectedError } from "../../draft.ts";
import { parseHistoryBackup, validateHistoryBackup } from "../../../storage/import.ts";
import { createContestDraft } from "../../../c5/index.ts";
import type { ContestRecord } from "../../../c5/types.ts";

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    throw new Error(`ASSERTION_FAILURE: ${msg}`);
  }
}

async function runUI1CTests() {
  console.log("===============================================================================");
  console.log("C5-MEMORY-2.0.0 — SUÍTE DE TESTES DO CICLO OPERACIONAL DIÁRIO (UI-1C)");
  console.log("===============================================================================");

  function createTestEnv(dbName: string) {
    const idb = new IDBFactory();
    const options = { idbFactory: idb, dbName };
    const repo = new ContestRepository(options);
    return { idb, options, repo };
  }

  // ---------------------------------------------------------------------------
  // 1. Somente C5-Memory disponível para nova geração
  // ---------------------------------------------------------------------------
  console.log("\n▶ [1] Somente C5-Memory disponível para nova geração");
  {
    const { options, repo } = createTestEnv("ui1c-test-01");
    const result = await generateMemoryDraft(3500, undefined, options, repo);
    assert(result.status === "READY", "Geração de nova aposta retorna status READY");
    if (result.status === "READY") {
      assert(
        result.draft.algorithmVersion === "C5-Memory-2.0.0",
        "Algoritmo do draft gerado deve ser estritamente C5-Memory-2.0.0"
      );
    }
    console.log("  ✓ [PASS] C5-Memory é o único algoritmo utilizado na geração de novos drafts.");
  }

  // ---------------------------------------------------------------------------
  // 2. C5-1.0.0 não pode gerar nova aposta
  // ---------------------------------------------------------------------------
  console.log("\n▶ [2] C5-1.0.0 não pode gerar nova aposta");
  {
    const { options, repo } = createTestEnv("ui1c-test-02");
    // Tentativa de submeter um draft com C5-1.0.0 na fronteira atômica é sumariamente rejeitada
    const fakeLegacyDraft: any = {
      algorithmVersion: "C5-1.0.0",
      contestNumber: 3500,
      poolMasterSeed: 12345,
      poolIndex: 0,
      selectedC5: [
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20],
        [1, 2, 3, 4, 5, 11, 12, 13, 14, 15, 21, 22, 23, 24, 25],
        [6, 7, 8, 9, 10, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
        [1, 2, 6, 7, 11, 12, 16, 17, 21, 22, 3, 8, 13, 18, 23],
      ],
      expectedHistoryRevision: 0,
      expectedHistoryFingerprint: "C5-MEMORY-H-FINGERPRINT-V1:0:",
      createdAt: new Date().toISOString(),
      winnerHistogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    };

    let threw = false;
    try {
      await confirmMemoryDraft(3500, fakeLegacyDraft, options, repo);
    } catch (err: any) {
      threw = true;
      assert(
        err.message.includes("C5-Memory") || err.message.includes("inválido"),
        "Deve rejeitar draft não pertencente ao C5-Memory"
      );
    }
    assert(threw, "confirmMemoryDraft deve rejeitar nova aposta com C5-1.0.0");
    console.log("  ✓ [PASS] C5-1.0.0 impedido de criar novas apostas.");
  }

  // ---------------------------------------------------------------------------
  // 3. Registro legado continua legível
  // ---------------------------------------------------------------------------
  console.log("\n▶ [3] Registro legado continua legível");
  {
    const { options, repo } = createTestEnv("ui1c-test-03");
    // Inserir diretamente um registro legado válido no store
    const legacyRecord: ContestRecord = {
      status: "FROZEN",
      contestNumber: 3000,
      generationId: "legacy-uuid-3000",
      algorithmVersion: "C5-1.0.0",
      generatedAt: "2026-09-01T10:00:00.000Z",
      frozenAt: "2026-09-01T10:05:00.000Z",
      betPlacedAt: "2026-09-01T10:05:00.000Z",
      generation: {
        permutation: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
        slotAssignments: {},
        games: [
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20],
          [1, 2, 3, 4, 5, 11, 12, 13, 14, 15, 21, 22, 23, 24, 25],
          [6, 7, 8, 9, 10, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
          [1, 2, 6, 7, 11, 12, 16, 17, 21, 22, 3, 8, 13, 18, 23],
        ],
      },
    };

    const db = await openDatabase(options);
    const tx = db.transaction(CONTEST_STORE_NAME, "readwrite");
    await promisifyRequest(tx.objectStore(CONTEST_STORE_NAME).put(legacyRecord));
    closeDatabase(db);

    const retrieved = await repo.getContestRecord(3000);
    assert(retrieved !== null, "Registro legado deve ser recuperado com sucesso");
    assert(retrieved?.algorithmVersion === "C5-1.0.0", "algorithmVersion legado preservado");
    assert(retrieved?.memoryPayload === undefined, "memoryPayload não é injetado retroativamente");

    const opState = await getMemoryOperationalState(3000, options, repo);
    assert(opState.hasRecord === true, "opState detecta registro");
    assert(opState.existingRecordAlgorithm === "C5-1.0.0", "opState reporta algoritmo C5-1.0.0");
    assert(opState.canGenerateMemoryBet === false, "Bloqueia nova geração para concurso legado confirmado");

    console.log("  ✓ [PASS] Registro histórico C5-1.0.0 permanece 100% legível e intacto.");
  }

  // ---------------------------------------------------------------------------
  // 4. Backup contendo legado continua válido
  // ---------------------------------------------------------------------------
  console.log("\n▶ [4] Backup contendo legado continua válido");
  {
    const { options, repo } = createTestEnv("ui1c-test-04-source");
    const legacyDraft = createContestDraft(2999);
    await repo.saveDraft(legacyDraft);

    const exported = await repo.exportHistory();
    const backupJSON = JSON.stringify(exported);

    const parsed = parseHistoryBackup(backupJSON);
    const validation = await validateHistoryBackup(parsed);
    assert(validation.valid === true, `Backup legado Schema V3 deve ser aceito como válido. Erros: ${validation.errors?.join(", ")}`);
    if (validation.valid && validation.data) {
      assert(validation.data.records.length === 1, "Exatamente 1 registro extraído");
      assert(validation.data.records[0].algorithmVersion === "C5-1.0.0", "Registro legado mantém C5-1.0.0");
    }
    console.log("  ✓ [PASS] Backup contendo registros C5-1.0.0 continua plenamente suportado.");
  }

  // ---------------------------------------------------------------------------
  // 5. AVAILABLE → PREVIEW
  // ---------------------------------------------------------------------------
  console.log("\n▶ [5] AVAILABLE → PREVIEW");
  {
    const { options, repo } = createTestEnv("ui1c-test-05");
    const opInitial = await getMemoryOperationalState(3501, options, repo);
    assert(opInitial.canGenerateMemoryBet === true, "Concurso 3501 está AVAILABLE");
    assert(opInitial.hasRecord === false, "Nenhum registro persistido");

    const draftRes = await generateMemoryDraft(3501, undefined, options, repo);
    assert(draftRes.status === "READY", "Draft gerado com status READY");
    if (draftRes.status === "READY") {
      assert(draftRes.draft.selectedC5.length === 5, "Draft possui 5 jogos");
      assert(draftRes.contestNumber === 3501, "Concurso é 3501");
    }
    console.log("  ✓ [PASS] Transição de AVAILABLE para PREVIEW verificada.");
  }

  // ---------------------------------------------------------------------------
  // 6. PREVIEW → FROZEN
  // ---------------------------------------------------------------------------
  console.log("\n▶ [6] PREVIEW → FROZEN");
  {
    const { options, repo } = createTestEnv("ui1c-test-06");
    const draftRes = await generateMemoryDraft(3501, undefined, options, repo);
    if (draftRes.status === "READY") {
      const confirmed = await confirmMemoryDraft(3501, draftRes.draft, options, repo);
      assert(confirmed.status === "FROZEN", "Status transiciona para FROZEN");
      assert(typeof confirmed.betPlacedAt === "string", "betPlacedAt é registrado");
      assert(confirmed.memoryPayload?.algorithmVersion === "C5-Memory-2.0.0", "memoryPayload gravado");
      assert(confirmed.memoryPayload?.confirmedRevision === 1, "confirmedRevision é 1");
    }
    console.log("  ✓ [PASS] Transição de PREVIEW para FROZEN confirmada.");
  }

  // ---------------------------------------------------------------------------
  // 7. Preview descartado não altera H
  // ---------------------------------------------------------------------------
  console.log("\n▶ [7] Preview descartado não altera H");
  {
    const { options, repo } = createTestEnv("ui1c-test-07");
    const hStateBefore = await getMemoryHistoryState(options);

    const draftRes = await generateMemoryDraft(3501, undefined, options, repo);
    assert(draftRes.status === "READY", "Draft gerado");

    // Descarte: simplesmente não chama confirmação
    const hStateAfter = await getMemoryHistoryState(options);
    assert(hStateAfter.H.length === hStateBefore.H.length, "H permanece inalterado");
    assert(hStateAfter.historyRevision === hStateBefore.historyRevision, "Revision inalterada");
    assert(hStateAfter.historyFingerprint === hStateBefore.historyFingerprint, "Fingerprint inalterado");
    console.log("  ✓ [PASS] Descarte de preview não contamina H.");
  }

  // ---------------------------------------------------------------------------
  // 8. FROZEN sobrevive reload
  // ---------------------------------------------------------------------------
  console.log("\n▶ [8] FROZEN sobrevive reload");
  {
    const idb = new IDBFactory();
    const options = { idbFactory: idb, dbName: "ui1c-test-08" };
    const repo1 = new ContestRepository(options);

    const draftRes = await generateMemoryDraft(3501, undefined, options, repo1);
    if (draftRes.status === "READY") {
      await confirmMemoryDraft(3501, draftRes.draft, options, repo1);
    }

    // Simulação de reload com novo repositório apontando para o mesmo banco
    const repo2 = new ContestRepository(options);
    const reloaded = await repo2.getContestRecord(3501);
    assert(reloaded !== null, "Registro recuperado pós-reload");
    assert(reloaded?.status === "FROZEN", "Status permanece FROZEN");
    assert(reloaded?.memoryPayload !== undefined, "memoryPayload permanece intacto");
    assert(reloaded?.generation.games.length === 5, "5 jogos preservados");
    console.log("  ✓ [PASS] FROZEN sobrevive integralmente ao reload.");
  }

  // ---------------------------------------------------------------------------
  // 9. Resultado não modifica FrozenMemoryPayload
  // ---------------------------------------------------------------------------
  console.log("\n▶ [9] Resultado não modifica FrozenMemoryPayload");
  {
    const { options, repo } = createTestEnv("ui1c-test-09");
    const draftRes = await generateMemoryDraft(3501, undefined, options, repo);
    assert(draftRes.status === "READY", "Draft gerado");
    if (draftRes.status === "READY") {
      const confirmed = await confirmMemoryDraft(3501, draftRes.draft, options, repo);
      const originalPayload = JSON.stringify(confirmed.memoryPayload);

      // Pontuar o concurso frente a um sorteio oficial
      const officialResult = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
      const scored = await repo.scoreStoredContest(3501, officialResult);

      assert(scored.status === "SCORED", "Registro transiciona para SCORED");
      const postScorePayload = JSON.stringify(scored.memoryPayload);
      assert(postScorePayload === originalPayload, "FrozenMemoryPayload permanece 100% idêntico pós-score");
    }
    console.log("  ✓ [PASS] Resultado oficial não muta nem contamina o FrozenMemoryPayload.");
  }

  // ---------------------------------------------------------------------------
  // 10. Resultado não modifica historyFingerprint por campos exógenos
  // ---------------------------------------------------------------------------
  console.log("\n▶ [10] Resultado não modifica historyFingerprint por campos exógenos");
  {
    const { options, repo } = createTestEnv("ui1c-test-10");
    const draftRes = await generateMemoryDraft(3501, undefined, options, repo);
    if (draftRes.status === "READY") {
      await confirmMemoryDraft(3501, draftRes.draft, options, repo);
    }

    const stateBeforeScore = await getMemoryHistoryState(options);

    // Registra pontuação oficial CAIXA (dado exógeno)
    await repo.scoreStoredContest(3501, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

    const stateAfterScore = await getMemoryHistoryState(options);
    assert(
      stateBeforeScore.historyFingerprint === stateAfterScore.historyFingerprint,
      "historyFingerprint idêntico antes e depois do score oficial"
    );
    assert(
      stateBeforeScore.historyRevision === stateAfterScore.historyRevision,
      "historyRevision idêntica antes e depois do score oficial"
    );
    assert(
      stateBeforeScore.H.length === stateAfterScore.H.length,
      "H idêntico antes e depois do score oficial"
    );
    console.log("  ✓ [PASS] Dados CAIXA não afetam o fingerprint nem a revisão de H.");
  }

  // ---------------------------------------------------------------------------
  // 11. Score correto dos cinco jogos
  // ---------------------------------------------------------------------------
  console.log("\n▶ [11] Score correto dos cinco jogos");
  {
    const { options, repo } = createTestEnv("ui1c-test-11");
    const draftRes = await generateMemoryDraft(3501, undefined, options, repo);
    if (draftRes.status === "READY") {
      await confirmMemoryDraft(3501, draftRes.draft, options, repo);
      const draw = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
      const scored = await repo.scoreStoredContest(3501, draw);

      assert(scored.score !== undefined, "score gerado");
      assert(scored.score?.games.length === 5, "5 jogos pontuados");

      // Validar que cada jogo teve os acertos matematicamente corretos frente ao sorteio
      for (let i = 0; i < 5; i++) {
        const game = scored.generation.games[i];
        const expectedHits = game.filter((n) => draw.includes(n)).length;
        assert(scored.score?.games[i].hits === expectedHits, `Acertos do jogo ${i + 1} corretos`);
      }
    }
    console.log("  ✓ [PASS] Desempenho e acertos dos cinco jogos calculados com exatidão.");
  }

  // ---------------------------------------------------------------------------
  // 12. COMPLETED preserva os cinco jogos
  // ---------------------------------------------------------------------------
  console.log("\n▶ [12] COMPLETED preserva os cinco jogos");
  {
    const { options, repo } = createTestEnv("ui1c-test-12");
    const draftRes = await generateMemoryDraft(3501, undefined, options, repo);
    if (draftRes.status === "READY") {
      const originalGames = draftRes.draft.selectedC5.map((g) => [...g]);
      await confirmMemoryDraft(3501, draftRes.draft, options, repo);

      const scored = await repo.scoreStoredContest(3501, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      assert(scored.generation.games.length === 5, "5 jogos mantidos");

      for (let i = 0; i < 5; i++) {
        const sortedOriginal = [...originalGames[i]].sort((a, b) => a - b);
        const sortedScored = [...scored.generation.games[i]].sort((a, b) => a - b);
        assert(
          JSON.stringify(sortedOriginal) === JSON.stringify(sortedScored),
          `Jogo ${i + 1} 100% idêntico no estado COMPLETED`
        );
      }
    }
    console.log("  ✓ [PASS] Estado COMPLETED preserva rigorosamente os cinco jogos originais.");
  }

  // ---------------------------------------------------------------------------
  // 13. Concurso seguinte utiliza H atualizado
  // ---------------------------------------------------------------------------
  console.log("\n▶ [13] Concurso seguinte utiliza H atualizado");
  {
    const { options, repo } = createTestEnv("ui1c-test-13");
    const draftRes1 = await generateMemoryDraft(3501, undefined, options, repo);
    if (draftRes1.status === "READY") {
      await confirmMemoryDraft(3501, draftRes1.draft, options, repo);
    }

    const opNext = await getMemoryOperationalState(3502, options, repo);
    assert(opNext.historyRevision === 1, "historyRevision avançou para 1");
    assert(opNext.eligibleGamesCountInH === 5, "H contém exatamente os 5 jogos do concurso 3501");
    console.log("  ✓ [PASS] Concurso 3502 observa H expandido com os 5 jogos do 3501.");
  }

  // ---------------------------------------------------------------------------
  // 14. Concurso seguinte possui novo Draft explícito
  // ---------------------------------------------------------------------------
  console.log("\n▶ [14] Concurso seguinte possui novo Draft explícito");
  {
    const { options, repo } = createTestEnv("ui1c-test-14");
    const draftRes1 = await generateMemoryDraft(3501, undefined, options, repo);
    let draft1PoolIndex = -1;
    if (draftRes1.status === "READY") {
      draft1PoolIndex = draftRes1.draft.poolIndex;
      await confirmMemoryDraft(3501, draftRes1.draft, options, repo);
    }

    const draftRes2 = await generateMemoryDraft(3502, undefined, options, repo);
    assert(draftRes2.status === "READY", "Novo draft para 3502 gerado com sucesso");
    if (draftRes2.status === "READY") {
      assert(draftRes2.contestNumber === 3502, "Concurso é 3502");
      assert(draftRes2.draft.expectedHistoryRevision === 1, "expectedHistoryRevision é 1");
    }
    console.log("  ✓ [PASS] Novo draft explícito gerado para o próximo concurso.");
  }

  // ---------------------------------------------------------------------------
  // 15. Jogo histórico exato continua bloqueado
  // ---------------------------------------------------------------------------
  console.log("\n▶ [15] Jogo histórico exato continua bloqueado");
  {
    const { options, repo } = createTestEnv("ui1c-test-15");
    const draftRes1 = await generateMemoryDraft(3501, undefined, options, repo);
    let gameFrom3501: number[] = [];
    if (draftRes1.status === "READY") {
      gameFrom3501 = [...draftRes1.draft.selectedC5[0]];
      await confirmMemoryDraft(3501, draftRes1.draft, options, repo);
    }

    // Criar um draft malicioso contendo exatamente o jogo do concurso 3501
    const hState = await getMemoryHistoryState(options);
    const conflictingDraft: any = {
      algorithmVersion: "C5-Memory-2.0.0",
      contestNumber: 3502,
      poolMasterSeed: 9999,
      poolIndex: 42,
      selectedC5: [
        [...gameFrom3501].reverse(), // Ordem invertida
        [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 1, 3, 5],
        [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 2, 4],
        [2, 3, 5, 7, 11, 13, 17, 19, 23, 1, 4, 6, 8, 9, 10],
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16],
      ],
      expectedHistoryRevision: hState.historyRevision,
      expectedHistoryFingerprint: hState.historyFingerprint,
      createdAt: new Date().toISOString(),
      winnerHistogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    };

    let blocked = false;
    try {
      await confirmMemoryDraft(3502, conflictingDraft, options, repo);
    } catch (err: any) {
      blocked = err.code === EXACT_HISTORY_DUPLICATE_BLOCKED || err instanceof ExactHistoryDuplicateBlockedError;
    }
    assert(blocked, "Confirmação com jogo repetido de 3501 deve ser bloqueada");
    console.log("  ✓ [PASS] Hard Block de repetição protege integralmente entre concursos.");
  }

  // ---------------------------------------------------------------------------
  // 16. Não existe botão/recurso de repetir aposta
  // ---------------------------------------------------------------------------
  console.log("\n▶ [16] Não existe botão/recurso de repetir aposta");
  {
    const viewPath = path.resolve("src/components/C5MemoryView.tsx");
    const modalPath = path.resolve("src/components/ContestDetailModal.tsx");
    const histPath = path.resolve("src/components/HistoryView.tsx");

    const viewCode = fs.readFileSync(viewPath, "utf-8");
    const modalCode = fs.readFileSync(modalPath, "utf-8");
    const histCode = fs.readFileSync(histPath, "utf-8");

    const prohibitedPatterns = [
      /repetir\s*aposta/i,
      /jogar\s*novamente/i,
      /apostar\s*novamente/i,
      /clonar\s*aposta/i,
      /usar\s*novamente/i,
      /converter\s*para\s*memory/i,
    ];

    for (const pat of prohibitedPatterns) {
      assert(!pat.test(viewCode), `C5MemoryView não pode conter ação: ${pat}`);
      assert(!pat.test(modalCode), `ContestDetailModal não pode conter ação: ${pat}`);
      assert(!pat.test(histCode), `HistoryView não pode conter ação: ${pat}`);
    }
    console.log("  ✓ [PASS] Zero botões ou opções de clonagem/repetição de aposta.");
  }

  // ---------------------------------------------------------------------------
  // 17. Stale multiaba continua bloqueado
  // ---------------------------------------------------------------------------
  console.log("\n▶ [17] Stale multiaba continua bloqueado");
  {
    const { options, repo } = createTestEnv("ui1c-test-17");
    // Tab A gera draft para concurso 3501
    const draftTabA = await generateMemoryDraft(3501, undefined, options, repo);
    assert(draftTabA.status === "READY", "Tab A gerou draft");

    // Tab B confirma um concurso intermediário ou avança H
    const draftTabB = await generateMemoryDraft(3500, undefined, options, repo);
    if (draftTabB.status === "READY") {
      await confirmMemoryDraft(3500, draftTabB.draft, options, repo);
    }

    // Tab A tenta confirmar seu draft agora desatualizado (stale)
    let staleBlocked = false;
    if (draftTabA.status === "READY") {
      try {
        await confirmMemoryDraft(3501, draftTabA.draft, options, repo);
      } catch (err: any) {
        staleBlocked = err.code === "STALE_REVISION_REJECTED" || err instanceof StaleRevisionRejectedError;
      }
    }
    assert(staleBlocked, "Tab A deve ser rejeitada como STALE");
    console.log("  ✓ [PASS] Concorrência multiaba estritamente bloqueada via OCC.");
  }

  // ---------------------------------------------------------------------------
  // 18. Auditoria permanece somente leitura
  // ---------------------------------------------------------------------------
  console.log("\n▶ [18] Auditoria permanece somente leitura");
  {
    const { options, repo } = createTestEnv("ui1c-test-18");
    const draftRes = await generateMemoryDraft(3501, undefined, options, repo);
    if (draftRes.status === "READY") {
      const confirmed = await confirmMemoryDraft(3501, draftRes.draft, options, repo);
      const audit = getMemoryAuditDetails(confirmed);
      assert(audit !== null, "Audit details obtido");

      // Tentar mutar propriedade retornada não altera o banco
      try {
        (audit as any).poolIndex = 9999;
      } catch {
        // Objeto pode ser congelado
      }

      const freshRecord = await repo.getContestRecord(3501);
      assert(freshRecord?.memoryPayload?.poolIndex === confirmed.memoryPayload?.poolIndex, "Storage imutável");
    }
    console.log("  ✓ [PASS] Auditoria é puramente informativa e somente leitura.");
  }

  // ---------------------------------------------------------------------------
  // 19. Histórico mostra múltiplos concursos
  // ---------------------------------------------------------------------------
  console.log("\n▶ [19] Histórico mostra múltiplos concursos");
  {
    const { options, repo } = createTestEnv("ui1c-test-19");
    const d1 = await generateMemoryDraft(3501, undefined, options, repo);
    if (d1.status === "READY") await confirmMemoryDraft(3501, d1.draft, options, repo);

    const d2 = await generateMemoryDraft(3502, undefined, options, repo);
    if (d2.status === "READY") await confirmMemoryDraft(3502, d2.draft, options, repo);

    const all = await repo.getAllContestRecords();
    assert(all.length === 2, "Histórico deve conter exatamente os 2 concursos");
    assert(all.some((r) => r.contestNumber === 3501), "Contém 3501");
    assert(all.some((r) => r.contestNumber === 3502), "Contém 3502");
    console.log("  ✓ [PASS] Histórico armazena e recupera múltiplos concursos ordenados.");
  }

  // ---------------------------------------------------------------------------
  // 20. Legado não recebe memoryPayload retroativamente
  // ---------------------------------------------------------------------------
  console.log("\n▶ [20] Legado não recebe memoryPayload retroativamente");
  {
    const { options, repo } = createTestEnv("ui1c-test-20");
    const legacyRecord: ContestRecord = {
      status: "FROZEN",
      contestNumber: 2500,
      generationId: "legacy-2500",
      algorithmVersion: "C5-1.0.0",
      generatedAt: "2026-08-01T10:00:00.000Z",
      frozenAt: "2026-08-01T10:05:00.000Z",
      betPlacedAt: "2026-08-01T10:05:00.000Z",
      generation: {
        permutation: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
        slotAssignments: {},
        games: [
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20],
          [1, 2, 3, 4, 5, 11, 12, 13, 14, 15, 21, 22, 23, 24, 25],
          [6, 7, 8, 9, 10, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
          [1, 2, 6, 7, 11, 12, 16, 17, 21, 22, 3, 8, 13, 18, 23],
        ],
      },
    };

    const db = await openDatabase(options);
    const tx = db.transaction(CONTEST_STORE_NAME, "readwrite");
    await promisifyRequest(tx.objectStore(CONTEST_STORE_NAME).put(legacyRecord));
    closeDatabase(db);

    // Gerar e confirmar nova aposta C5-Memory
    const d = await generateMemoryDraft(3501, undefined, options, repo);
    if (d.status === "READY") await confirmMemoryDraft(3501, d.draft, options, repo);

    // Verificar que o registro 2500 continua sem memoryPayload
    const rec2500 = await repo.getContestRecord(2500);
    assert(rec2500?.algorithmVersion === "C5-1.0.0", "Mantém C5-1.0.0");
    assert(rec2500?.memoryPayload === undefined, "Zero injeção retroativa de memoryPayload");
    console.log("  ✓ [PASS] Zero mutação retroativa em registros legados.");
  }

  // ---------------------------------------------------------------------------
  // 21. Nenhuma auto-regeneração
  // ---------------------------------------------------------------------------
  console.log("\n▶ [21] Nenhuma auto-regeneração");
  {
    const { options, repo } = createTestEnv("ui1c-test-21");
    const d = await generateMemoryDraft(3501, undefined, options, repo);
    let originalHash = "";
    if (d.status === "READY") {
      const c = await confirmMemoryDraft(3501, d.draft, options, repo);
      originalHash = c.integrityHash || "";
    }

    // Tentar gerar novamente para o concurso 3501
    const d2 = await generateMemoryDraft(3501, undefined, options, repo);
    assert(d2.status === "CONTEST_ALREADY_CONFIRMED", "Geração recusada: concurso já confirmado");

    const checkRecord = await repo.getContestRecord(3501);
    assert(checkRecord?.integrityHash === originalHash, "Hash e apostas inalteradas");
    console.log("  ✓ [PASS] Zero auto-regeneração de concursos já confirmados.");
  }

  // ---------------------------------------------------------------------------
  // 22. Nenhuma geração automática no carregamento
  // ---------------------------------------------------------------------------
  console.log("\n▶ [22] Nenhuma geração automática no carregamento");
  {
    const { options, repo } = createTestEnv("ui1c-test-22");
    // Consultar estado da tela repetidamente
    await getMemoryOperationalState(3501, options, repo);
    await getMemoryOperationalState(3502, options, repo);
    await getMemoryOperationalState(3503, options, repo);

    const dbState = await getMemoryHistoryState(options);
    assert(dbState.recordsCount === 0, "IndexedDB deve permanecer 100% vazio");
    console.log("  ✓ [PASS] Zero geração automática no carregamento.");
  }

  // ---------------------------------------------------------------------------
  // 23. Nenhuma chamada direta da UI ao domínio/storage
  // ---------------------------------------------------------------------------
  console.log("\n▶ [23] Nenhuma chamada direta da UI ao domínio/storage");
  {
    const c5MemoryViewPath = path.resolve("src/components/C5MemoryView.tsx");
    const generatorViewPath = path.resolve("src/components/GeneratorView.tsx");

    const c5MemoryContent = fs.readFileSync(c5MemoryViewPath, "utf-8");
    const generatorContent = fs.readFileSync(generatorViewPath, "utf-8");

    // Verificar ausência de createDraft direto
    assert(!/\bcreateDraft\s*\(/.test(c5MemoryContent), "C5MemoryView não pode chamar createDraft");
    assert(!/\bcreateDraft\s*\(/.test(generatorContent), "GeneratorView não pode chamar createDraft");

    // Verificar ausência de confirmMemoryBetAtomic direto
    assert(!/\bconfirmMemoryBetAtomic\s*\(/.test(c5MemoryContent), "C5MemoryView não pode chamar confirmMemoryBetAtomic");
    assert(!/\bconfirmMemoryBetAtomic\s*\(/.test(generatorContent), "GeneratorView não pode chamar confirmMemoryBetAtomic");

    // Verificar ausência de createContestDraft (C5-1.0.0) na experiência ativa
    assert(!/createContestDraft/.test(c5MemoryContent), "C5MemoryView não referencia createContestDraft");
    assert(!/createContestDraft/.test(generatorContent), "GeneratorView não referencia createContestDraft");

    console.log("  ✓ [PASS] Isolamento arquitetural rigoroso: UI consome somente a Application Layer.");
  }

  // ---------------------------------------------------------------------------
  // 24. Reload completo do ciclo N → N+1
  // ---------------------------------------------------------------------------
  console.log("\n▶ [24] Reload completo do ciclo N → N+1");
  {
    const idb = new IDBFactory();
    const options = { idbFactory: idb, dbName: "ui1c-test-24" };

    // SESSÃO 1: Operar concurso N (3501)
    const repoSession1 = new ContestRepository(options);
    const dN = await generateMemoryDraft(3501, undefined, options, repoSession1);
    assert(dN.status === "READY", "Sessão 1: Draft gerado para 3501");
    if (dN.status === "READY") {
      await confirmMemoryDraft(3501, dN.draft, options, repoSession1);
    }

    // SESSÃO 2: Reabrir aplicação, verificar FROZEN e pontuar
    const repoSession2 = new ContestRepository(options);
    const recN = await repoSession2.getContestRecord(3501);
    assert(recN?.status === "FROZEN", "Sessão 2: 3501 é FROZEN pós-reload");

    const drawN = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 2, 4, 6];
    await repoSession2.scoreStoredContest(3501, drawN);
    const scoredN = await repoSession2.getContestRecord(3501);
    assert(scoredN?.status === "SCORED", "Sessão 2: 3501 é SCORED (COMPLETED)");

    // SESSÃO 3: Reabrir aplicação, operar concurso N+1 (3502)
    const repoSession3 = new ContestRepository(options);
    const opStateNext = await getMemoryOperationalState(3502, options, repoSession3);
    assert(opStateNext.canGenerateMemoryBet === true, "Sessão 3: 3502 é AVAILABLE");
    assert(opStateNext.historyRevision === 1, "Sessão 3: historyRevision reflete o 3501");
    assert(opStateNext.eligibleGamesCountInH === 5, "Sessão 3: H possui 5 jogos");

    const dNext = await generateMemoryDraft(3502, undefined, options, repoSession3);
    assert(dNext.status === "READY", "Sessão 3: Draft gerado para 3502");
    if (dNext.status === "READY") {
      await confirmMemoryDraft(3502, dNext.draft, options, repoSession3);
    }

    // SESSÃO 4: Reabrir e verificar ambos no histórico
    const repoSession4 = new ContestRepository(options);
    const allRecords = await repoSession4.getAllContestRecords();
    assert(allRecords.length === 2, "Sessão 4: Exatamente 2 concursos no histórico");

    const r3501 = allRecords.find((r) => r.contestNumber === 3501);
    const r3502 = allRecords.find((r) => r.contestNumber === 3502);

    assert(r3501?.status === "SCORED", "3501 é COMPLETED");
    assert(r3502?.status === "FROZEN", "3502 é FROZEN");
    assert(r3501?.generation.games.length === 5, "3501 preserva 5 jogos");
    assert(r3502?.generation.games.length === 5, "3502 preserva 5 jogos");
    console.log("  ✓ [PASS] Ciclo operacional diário completo N → N+1 resistente a múltiplos reloads.");
  }

  console.log("\n===============================================================================");
  console.log("TODOS OS 24 TESTES DO CICLO OPERACIONAL DIÁRIO (UI-1C) PASSARAM COM SUCESSO (24/24)");
  console.log("===============================================================================");
}

runUI1CTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("FATAL ERROR IN UI-1C TESTS:", err);
    process.exit(1);
  });
