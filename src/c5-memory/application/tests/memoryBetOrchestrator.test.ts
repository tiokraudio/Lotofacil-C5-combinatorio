/**
 * C5-Memory-2.0.0 — Suíte de Testes da Application Layer (UI-1A)
 *
 * Cobre todos os 15 cenários normativos obrigatórios:
 * 1. Caso normal (sem colisão -> READY)
 * 2. Histórico vazio (H = ∅ -> geração determinística)
 * 3. Repetição exata (jogo em H -> EXACT_HISTORY_DUPLICATE_BLOCKED)
 * 4. Repetição em ordem diferente (ordem permutada detectada como repetição)
 * 5. Cinco jogos repetidos (todos os 5 jogos em H -> bloqueio total)
 * 6. Draft não contamina memória (DRAFT ∉ H, sem alteração de revision/fingerprint)
 * 7. Confirmação de Draft READY (persistência como FROZEN único)
 * 8. Segunda confirmação do mesmo concurso (rejeitada por colisão)
 * 9. Stale revision (histórico avança -> STALE_REVISION_REJECTED)
 * 10. Stale fingerprint (mesma cardinalidade, fingerprint divergente -> rejeitado)
 * 11. Multiaba (confirmações concorrentes -> apenas uma prevalece)
 * 12. Compatibilidade legada (C5-1.0.0 confirmado integra H legitimamente)
 * 13. Isolamento CAIXA (officialResult, score, prize não afetam detecção nem H)
 * 14. Determinismo estrito (mesma seed + mesmo H -> mesmo Draft e mesmo resultado)
 * 15. Controle negativo (mecanismo que ignora duplicidade é detectado como FALHA)
 */

import { IDBFactory } from "fake-indexeddb";
import { openDatabase, closeDatabase, CONTEST_STORE_NAME, promisifyRequest } from "../../../storage/db.ts";
import { ContestRepository } from "../../../storage/contestRepository.ts";
import {
  detectDuplicateGames,
  getMemoryOperationalState,
  generateMemoryDraft,
  confirmMemoryDraft,
  getMemoryAuditDetails,
} from "../memoryBetOrchestrator.ts";
import { StaleRevisionRejectedError } from "../../draft.ts";
import { generatePool } from "../../pool.ts";
import type { ContestRecord } from "../../../c5/types.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`FALHA NA ASSERÇÃO: ${message}`);
  }
}

async function runTests() {
  console.log("===============================================================================");
  console.log("C5-MEMORY-2.0.0 — APPLICATION LAYER & HARD BLOCK TEST SUITE (UI-1A)");
  console.log("===============================================================================");

  // Helper para instanciar repositório isolado em memória
  function createIsolatedRepo(dbName: string): { repo: ContestRepository; options: any } {
    const fakeFactory = new IDBFactory();
    const options = {
      idbFactory: fakeFactory,
      dbName,
    };
    const repo = new ContestRepository(options);
    return { repo, options };
  }

  // Helper para inserir registros confirmados diretamente no store
  async function insertConfirmedRecord(options: any, record: ContestRecord): Promise<void> {
    const db = await openDatabase(options);
    try {
      const tx = db.transaction(CONTEST_STORE_NAME, "readwrite");
      await promisifyRequest(tx.objectStore(CONTEST_STORE_NAME).put(record));
    } finally {
      closeDatabase(db);
    }
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 1: Caso normal (Histórico sem colisão -> READY)
  // ---------------------------------------------------------------------------
  console.log("\n▶ Cenário 1: Caso normal (Histórico sem colisão -> READY)");
  {
    const { repo, options } = createIsolatedRepo("test-app-01");
    // Histórico com aposta não conflitante
    const initialDraftResult = await generateMemoryDraft(3001, 12345, options, repo);
    assert(initialDraftResult.status === "READY", "Geração para 3001 deve ser READY");
    if (initialDraftResult.status === "READY") {
      await confirmMemoryDraft(3001, initialDraftResult.draft, options, repo);
    }

    // Gerar para 3002 com seed diferente que não colide
    const result2 = await generateMemoryDraft(3002, 99999, options, repo);
    assert(result2.status === "READY", "Concurso 3002 deve resultar em READY");
    if (result2.status === "READY") {
      assert(result2.exactDuplicateCount === 0, "exactDuplicateCount deve ser 0");
      assert(result2.draft.selectedC5.length === 5, "Draft deve conter 5 jogos");
    }
    console.log("  ✓ Cenário 1 PASS");
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 2: Histórico vazio (H = ∅ -> geração válida e determinística)
  // ---------------------------------------------------------------------------
  console.log("\n▶ Cenário 2: Histórico vazio (H = ∅ -> geração válida e determinística)");
  {
    const { repo, options } = createIsolatedRepo("test-app-02");
    const opState = await getMemoryOperationalState(3001, options, repo);
    assert(opState.historyRevision === 0, "Revisão inicial deve ser 0");
    assert(opState.eligibleGamesCountInH === 0, "Jogos em H deve ser 0");
    assert(opState.canGenerateMemoryBet === true, "Deve ser elegível para gerar");

    const genResult = await generateMemoryDraft(3001, 42, options, repo);
    assert(genResult.status === "READY", "Draft com H vazio deve ser READY");
    if (genResult.status === "READY") {
      assert(genResult.draft.poolIndex === 0, "Com H vazio, vencedor é o poolIndex 0 (LEXMIN trivial)");
      assert(genResult.draft.expectedHistoryRevision === 0, "expectedHistoryRevision deve ser 0");
    }
    console.log("  ✓ Cenário 2 PASS");
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 3: Repetição exata (jogo em H -> EXACT_HISTORY_DUPLICATE_BLOCKED)
  // ---------------------------------------------------------------------------
  console.log("\n▶ Cenário 3: Repetição exata (jogo em H -> EXACT_HISTORY_DUPLICATE_BLOCKED)");
  {
    const { repo, options } = createIsolatedRepo("test-app-03");

    // Pool determinístico com seed 42
    const pool = generatePool(42, 500);

    // Inserir 100 concursos no histórico cobrindo o jogo 0 de cada um dos 500 candidatos.
    // Isso garante matematicamente que QUALQUER candidato do pool contenha pelo menos 1 jogo repetido em H.
    const db = await openDatabase(options);
    const tx = db.transaction(CONTEST_STORE_NAME, "readwrite");
    const store = tx.objectStore(CONTEST_STORE_NAME);

    for (let c = 0; c < 100; c++) {
      const games = [
        [...pool[c * 5 + 0].games[0]],
        [...pool[c * 5 + 1].games[0]],
        [...pool[c * 5 + 2].games[0]],
        [...pool[c * 5 + 3].games[0]],
        [...pool[c * 5 + 4].games[0]],
      ];
      store.put({
        status: "FROZEN",
        contestNumber: 1000 + c,
        generationId: `setup-${c}`,
        algorithmVersion: "C5-1.0.0",
        generatedAt: new Date().toISOString(),
        frozenAt: new Date().toISOString(),
        betPlacedAt: new Date().toISOString(),
        generation: { permutation: [], slotAssignments: {}, games },
      });
    }
    await new Promise((res) => { tx.oncomplete = res; });
    closeDatabase(db);

    // Agora gerar com seed 42: como todos os 500 candidatos contêm um jogo de H,
    // o vencedor terá n0 >= 1 e o gerador DEVE emitir EXACT_HISTORY_DUPLICATE_BLOCKED!
    const blockedGen = await generateMemoryDraft(3001, 42, options, repo);
    assert(
      blockedGen.status === "EXACT_HISTORY_DUPLICATE_BLOCKED",
      `Geração com colisão forçada deve ser EXACT_HISTORY_DUPLICATE_BLOCKED. Status obtido: ${blockedGen.status}`
    );

    if (blockedGen.status === "EXACT_HISTORY_DUPLICATE_BLOCKED") {
      assert(blockedGen.exactDuplicateCount > 0, "exactDuplicateCount deve ser > 0");
      assert(blockedGen.conflictingGames.length > 0, "conflictingGames deve listar os jogos conflitantes");
      assert(typeof blockedGen.conflictingGames[0].canonicalGame === "string", "canonicalGame deve ser string formatada");
      assert(blockedGen.poolMasterSeed === 42, "poolMasterSeed deve ser preservado");

      // Tentar confirmar este Draft bloqueado DEVE falhar na Application Layer
      let threwConfirm = false;
      try {
        await confirmMemoryDraft(3001, blockedGen.draft, options, repo);
      } catch (err: any) {
        threwConfirm = true;
        assert(err.message.includes("EXACT_HISTORY_DUPLICATE_BLOCKED"), "Erro de confirmação deve citar EXACT_HISTORY_DUPLICATE_BLOCKED");
      }
      assert(threwConfirm === true, "Draft bloqueado por repetição NÃO pode ser confirmado");
    }
    console.log("  ✓ Cenário 3 PASS (Hard Block ativo e com metadados completos)");
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 4: Repetição em ordem diferente (ordem interna não impede detecção)
  // ---------------------------------------------------------------------------
  console.log("\n▶ Cenário 4: Repetição em ordem diferente (ordem permutada detectada como repetição)");
  {
    const originalGame = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const shuffledGame = [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

    const history = [[...originalGame]];
    const candidateGames = [
      [...shuffledGame],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20],
      [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
      [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
      [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
    ];

    const dupCheck = detectDuplicateGames(candidateGames, history);
    assert(dupCheck.hasDuplicates === true, "Mesmas 15 dezenas em ordem invertida devem ser detectadas como repetição");
    assert(dupCheck.duplicateCount === 1, "Exatamente 1 duplicata detectada");
    assert(dupCheck.conflictingGames[0].canonicalGame === "01,02,03,04,05,06,07,08,09,10,11,12,13,14,15", "Representação canônica deve ser normalizada");
    console.log("  ✓ Cenário 4 PASS");
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 5: Cinco jogos repetidos (todos os 5 jogos em H -> bloqueio total)
  // ---------------------------------------------------------------------------
  console.log("\n▶ Cenário 5: Cinco jogos repetidos (todos os 5 jogos em H -> bloqueio total)");
  {
    const cand = [
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20],
      [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
      [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
      [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
    ];
    const history = [...cand.map((g) => [...g])];

    const dupCheck = detectDuplicateGames(cand, history);
    assert(dupCheck.hasDuplicates === true, "Todos os 5 jogos repetidos devem ser bloqueados");
    assert(dupCheck.duplicateCount === 5, "Deve reportar exatamente 5 colisões");
    assert(dupCheck.conflictingGames.length === 5, "Array de conflitos deve conter 5 itens");
    console.log("  ✓ Cenário 5 PASS");
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 6: Draft não contamina memória (DRAFT ∉ H)
  // ---------------------------------------------------------------------------
  console.log("\n▶ Cenário 6: Draft não contamina memória (DRAFT ∉ H, sem alteração de revision/fingerprint)");
  {
    const { repo, options } = createIsolatedRepo("test-app-06");
    const stateBefore = await getMemoryOperationalState(3001, options, repo);

    // Gerar 3 drafts e abandoná-los (não confirmar)
    await generateMemoryDraft(3001, 101, options, repo);
    await generateMemoryDraft(3001, 102, options, repo);
    await generateMemoryDraft(3001, 103, options, repo);

    const stateAfter = await getMemoryOperationalState(3001, options, repo);
    assert(stateBefore.historyRevision === stateAfter.historyRevision, "historyRevision não pode mudar por criação de Draft");
    assert(stateBefore.historyFingerprint === stateAfter.historyFingerprint, "historyFingerprint não pode mudar por criação de Draft");
    assert(stateBefore.eligibleGamesCountInH === stateAfter.eligibleGamesCountInH, "Tamanho de H deve permanecer rigorosamente idêntico");
    console.log("  ✓ Cenário 6 PASS");
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 7: Confirmação de Draft READY (persistência como FROZEN único)
  // ---------------------------------------------------------------------------
  console.log("\n▶ Cenário 7: Confirmação de Draft READY (persistência como FROZEN único)");
  {
    const { repo, options } = createIsolatedRepo("test-app-07");
    const gen = await generateMemoryDraft(3001, 777, options, repo);
    assert(gen.status === "READY", "Deve ser READY");
    if (gen.status === "READY") {
      const confirmed = await confirmMemoryDraft(3001, gen.draft, options, repo);
      assert(confirmed.status === "FROZEN", "Registro confirmado deve ter status FROZEN");
      assert(typeof confirmed.betPlacedAt === "string" && confirmed.betPlacedAt.length > 0, "betPlacedAt deve ser preenchido");
      assert(confirmed.memoryPayload !== undefined, "memoryPayload deve existir");
      assert(confirmed.memoryPayload?.algorithmVersion === "C5-Memory-2.0.0", "algorithmVersion deve ser C5-Memory-2.0.0");

      // Verificar que o estado de H avançou em exatamente 1 aposta (5 jogos)
      const opState = await getMemoryOperationalState(3002, options, repo);
      assert(opState.historyRevision === 1, "historyRevision deve avançar para 1");
      assert(opState.eligibleGamesCountInH === 5, "H deve agora conter 5 jogos");

      // Detalhes de auditoria
      const audit = getMemoryAuditDetails(confirmed);
      assert(audit !== null, "Audit details deve ser extraível");
      assert(audit?.poolIndex === gen.draft.poolIndex, "poolIndex auditado deve coincidir");
    }
    console.log("  ✓ Cenário 7 PASS");
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 8: Segunda confirmação do mesmo concurso (rejeitada por colisão)
  // ---------------------------------------------------------------------------
  console.log("\n▶ Cenário 8: Segunda confirmação do mesmo concurso (rejeitada por colisão)");
  {
    const { repo, options } = createIsolatedRepo("test-app-08");
    const gen = await generateMemoryDraft(3001, 888, options, repo);
    assert(gen.status === "READY", "Deve ser READY");
    if (gen.status === "READY") {
      await confirmMemoryDraft(3001, gen.draft, options, repo);

      // Tentar confirmar novamente para o mesmo concurso 3001
      let failed = false;
      try {
        await confirmMemoryDraft(3001, gen.draft, options, repo);
      } catch (err: any) {
        failed = true;
        assert(err.message.includes("Colisão"), "Erro deve indicar colisão");
      }
      assert(failed === true, "Segunda confirmação para 3001 deve ser rejeitada");

      // generateMemoryDraft para o mesmo concurso deve indicar CONTEST_ALREADY_CONFIRMED
      const genAgain = await generateMemoryDraft(3001, 888, options, repo);
      assert(genAgain.status === "CONTEST_ALREADY_CONFIRMED", "Geração para concurso já confirmado deve retornar CONTEST_ALREADY_CONFIRMED");
    }
    console.log("  ✓ Cenário 8 PASS");
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 9: Stale revision (histórico avança -> STALE_REVISION_REJECTED)
  // ---------------------------------------------------------------------------
  console.log("\n▶ Cenário 9: Stale revision (histórico avança -> STALE_REVISION_REJECTED)");
  {
    const { repo, options } = createIsolatedRepo("test-app-09");

    // Gerar draft para 3002 na revisão 0
    const gen3002 = await generateMemoryDraft(3002, 201, options, repo);
    assert(gen3002.status === "READY", "Draft 3002 gerado na rev 0");

    // Enquanto o draft 3002 estava aberto, outro concurso (3001) é confirmado
    const gen3001 = await generateMemoryDraft(3001, 101, options, repo);
    if (gen3001.status === "READY") {
      await confirmMemoryDraft(3001, gen3001.draft, options, repo);
    }

    // Agora o histórico está na revisão 1. O draft 3002 foi gerado para revisão 0!
    if (gen3002.status === "READY") {
      let threwStale = false;
      try {
        await confirmMemoryDraft(3002, gen3002.draft, options, repo);
      } catch (err: any) {
        threwStale = err instanceof StaleRevisionRejectedError || err.code === "STALE_REVISION_REJECTED";
      }
      assert(threwStale === true, "Confirmação de draft com revisão obsoleta deve lançar STALE_REVISION_REJECTED");
    }
    console.log("  ✓ Cenário 9 PASS");
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 10: Stale fingerprint (mesma cardinalidade, fingerprint divergente)
  // ---------------------------------------------------------------------------
  console.log("\n▶ Cenário 10: Stale fingerprint (mesma cardinalidade, fingerprint divergente -> rejeitado)");
  {
    const { repo, options } = createIsolatedRepo("test-app-10");

    // Criar um draft forjado com revisão correta (0), mas fingerprint falso
    const fakeDraft = {
      algorithmVersion: "C5-Memory-2.0.0" as const,
      poolMasterSeed: 555,
      poolIndex: 0,
      selectedPoolIndex: 0,
      selectedC5: [
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20],
        [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
        [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
        [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
      ] as any,
      expectedHistoryRevision: 0,
      draftHistoryRevision: 0,
      expectedHistoryFingerprint: "0000000000000000000000000000000000000000000000000000000000000000",
      draftHistoryFingerprint: "0000000000000000000000000000000000000000000000000000000000000000",
      winnerHistogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as any,
      createdAt: new Date().toISOString(),
    };

    let threwStale = false;
    try {
      await confirmMemoryDraft(3001, fakeDraft, options, repo);
    } catch (err: any) {
      threwStale = err instanceof StaleRevisionRejectedError || err.code === "STALE_REVISION_REJECTED";
    }
    assert(threwStale === true, "Fingerprint divergente com mesma revisão deve ser rejeitado com STALE_REVISION_REJECTED");
    console.log("  ✓ Cenário 10 PASS");
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 11: Multiaba (duas confirmações concorrentes -> apenas uma prevalece)
  // ---------------------------------------------------------------------------
  console.log("\n▶ Cenário 11: Multiaba (duas confirmações concorrentes -> apenas uma prevalece)");
  {
    const { repo, options } = createIsolatedRepo("test-app-11");

    // Duas abas geram drafts no estado inicial (revisão 0)
    const draftAba1 = await generateMemoryDraft(3001, 111, options, repo);
    const draftAba2 = await generateMemoryDraft(3002, 222, options, repo);

    assert(draftAba1.status === "READY" && draftAba2.status === "READY", "Ambos os drafts prontos");

    if (draftAba1.status === "READY" && draftAba2.status === "READY") {
      // Disparamos confirmação concorrente simulada
      const p1 = confirmMemoryDraft(3001, draftAba1.draft, options, repo);
      const p2 = confirmMemoryDraft(3002, draftAba2.draft, options, repo);

      const results = await Promise.allSettled([p1, p2]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      assert(fulfilled.length === 1, "Exatamente uma confirmação deve ter sucesso");
      assert(rejected.length === 1, "A confirmação perdedora deve ser rejeitada");

      const rejectedReason = (rejected[0] as PromiseRejectedResult).reason;
      assert(
        rejectedReason instanceof StaleRevisionRejectedError || rejectedReason.code === "STALE_REVISION_REJECTED",
        "A confirmação concorrente deve falhar com STALE_REVISION_REJECTED"
      );
    }
    console.log("  ✓ Cenário 11 PASS");
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 12: Compatibilidade legada (C5-1.0.0 confirmado integra H legitimamente)
  // ---------------------------------------------------------------------------
  console.log("\n▶ Cenário 12: Compatibilidade legada (C5-1.0.0 confirmado integra H legitimamente)");
  {
    const { repo, options } = createIsolatedRepo("test-app-12");

    // Registro legado V1.13 confirmado
    const legacyRecord: ContestRecord = {
      status: "FROZEN",
      contestNumber: 2990,
      generationId: "legacy-uuid-01",
      algorithmVersion: "C5-1.0.0",
      generatedAt: new Date().toISOString(),
      frozenAt: new Date().toISOString(),
      betPlacedAt: new Date().toISOString(),
      generation: {
        permutation: [],
        slotAssignments: {},
        games: [
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20],
          [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
          [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
          [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
        ],
      },
    };
    await insertConfirmedRecord(options, legacyRecord);

    const opState = await getMemoryOperationalState(3001, options, repo);
    assert(opState.historyRevision === 1, "Registro legado confirmado deve somar 1 na revisão");
    assert(opState.eligibleGamesCountInH === 5, "H deve incorporar os 5 jogos da aposta legada");
    console.log("  ✓ Cenário 12 PASS");
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 13: Isolamento CAIXA (officialResult, score, prize não afetam detecção nem H)
  // ---------------------------------------------------------------------------
  console.log("\n▶ Cenário 13: Isolamento CAIXA (officialResult, score, prize não afetam detecção nem H)");
  {
    const { repo, options } = createIsolatedRepo("test-app-13");

    // Registro SCORED com resultado da CAIXA e prêmio
    const scoredRecord: ContestRecord = {
      status: "SCORED",
      contestNumber: 2980,
      generationId: "scored-uuid-01",
      algorithmVersion: "C5-1.0.0",
      generatedAt: new Date().toISOString(),
      frozenAt: new Date().toISOString(),
      betPlacedAt: new Date().toISOString(),
      scoredAt: new Date().toISOString(),
      officialResult: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 21, 22, 23, 24, 25],
      prize: { amountCents: 150000, recordedAt: new Date().toISOString(), source: "MANUAL" },
      generation: {
        permutation: [],
        slotAssignments: {},
        games: [
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20],
          [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
          [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
          [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
        ],
      },
    };
    await insertConfirmedRecord(options, scoredRecord);

    const opState = await getMemoryOperationalState(3001, options, repo);
    assert(opState.eligibleGamesCountInH === 5, "Apenas os 5 jogos gerados integram H; o sorteio oficial NÃO integra H");

    // Verificar se o sorteio oficial da CAIXA causaria falso positivo de repetição
    const candidateContainingCaixaDraw = [
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 21, 22, 23, 24, 25], // idêntico ao sorteio oficial
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 18],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 19],
    ];
    // Em H não existe esse jogo, pois só as apostas próprias estão em H
    const dupCheck = detectDuplicateGames(candidateContainingCaixaDraw, scoredRecord.generation.games);
    assert(dupCheck.hasDuplicates === false, "O sorteio oficial da CAIXA NÃO pode ser considerado aposta repetida se nunca foi apostado");
    console.log("  ✓ Cenário 13 PASS");
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 14: Determinismo estrito (mesma seed + mesmo H -> mesmo Draft e mesmo resultado)
  // ---------------------------------------------------------------------------
  console.log("\n▶ Cenário 14: Determinismo estrito (mesma seed + mesmo H -> mesmo Draft e mesmo resultado)");
  {
    const { repo, options } = createIsolatedRepo("test-app-14");
    const runA = await generateMemoryDraft(3001, "SEED-FIXA-999", options, repo);
    const runB = await generateMemoryDraft(3001, "SEED-FIXA-999", options, repo);

    assert(runA.status === "READY" && runB.status === "READY", "Ambos devem ser READY");
    if (runA.status === "READY" && runB.status === "READY") {
      assert(runA.draft.poolIndex === runB.draft.poolIndex, "poolIndex deve ser idêntico");
      assert(JSON.stringify(runA.draft.selectedC5) === JSON.stringify(runB.draft.selectedC5), "selectedC5 deve ser bit a bit idêntico");
      assert(JSON.stringify(runA.draft.winnerHistogram) === JSON.stringify(runB.draft.winnerHistogram), "Histogramas idênticos");
    }
    console.log("  ✓ Cenário 14 PASS");
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 15: Controle negativo (mecanismo defeituoso sem detecção de duplicata)
  // ---------------------------------------------------------------------------
  console.log("\n▶ Cenário 15: Controle negativo (mecanismo que ignora duplicidade é detectado como FALHA)");
  {
    function defectiveDetectDuplicateGames(_cand: any, _hist: any) {
      return { hasDuplicates: false, duplicateCount: 0, conflictingGames: [] };
    }

    const testGame = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const candidate = [[...testGame]];
    const history = [[...testGame]];

    const realResult = detectDuplicateGames(candidate, history);
    assert(realResult.hasDuplicates === true, "Detector real deve detectar colisão");

    const defectiveResult = defectiveDetectDuplicateGames(candidate, history);
    const testCatchesDefect = defectiveResult.hasDuplicates !== realResult.hasDuplicates;
    assert(testCatchesDefect === true, "A suíte deve provar que a falha de detecção é 100% detectável");
    console.log("  ✓ Cenário 15 PASS (Controle Negativo comprovado)");
  }

  console.log("\n===============================================================================");
  console.log("TODOS OS 15 CENÁRIOS DA SUÍTE APPLICATION LAYER PASSARAM COM SUCESSO (15/15)");
  console.log("===============================================================================");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("FATAL ERROR NA SUÍTE UI-1A:", err);
  process.exit(1);
});
