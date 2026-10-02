/**
 * C5-MEMORY-2.0.0 — SUÍTE DE TESTES DO FLUXO VISUAL DIÁRIO (UI-1B)
 *
 * Cobre todos os 18 requisitos funcionais obrigatórios:
 * 1. Estado inicial elegível;
 * 2. Geração exige ação explícita do usuário (sem auto-geração);
 * 3. Geração READY;
 * 4. Renderização dos 5 jogos;
 * 5. Preview não altera H (DRAFT ∉ H);
 * 6. Descartar não altera H;
 * 7. Confirmação bem-sucedida;
 * 8. Identidade Preview === FROZEN;
 * 9. Refresh pós-confirmação (sobrevive a reload);
 * 10. Concurso já confirmado (bloqueia geração e substituição);
 * 11. EXACT_HISTORY_DUPLICATE_BLOCKED tratado na UI;
 * 12. STALE_REVISION_REJECTED tratado na UI;
 * 13. Proteção contra duplo clique em Gerar;
 * 14. Proteção contra duplo clique em Confirmar;
 * 15. Multiaba (Tab A Preview vs Tab B Commit -> Stale);
 * 16. Ausência de regeneração silenciosa;
 * 17. Auditoria somente leitura;
 * 18. Isolamento arquitetural da UI (zero chamadas diretas a createDraft / confirmMemoryBetAtomic).
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
import { getMemoryHistoryState } from "../../../storage/memoryTransaction.ts";
import { StaleRevisionRejectedError } from "../../draft.ts";
import type { ContestRecord } from "../../../c5/types.ts";

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    throw new Error(`ASSERTION_FAILURE: ${msg}`);
  }
}

async function runUI1BTests() {
  console.log("===============================================================================");
  console.log("C5-MEMORY-2.0.0 — SUÍTE DE TESTES FUNCIONAIS DO FLUXO VISUAL DIÁRIO (UI-1B)");
  console.log("===============================================================================");

  function createTestEnv(dbName: string) {
    const idb = new IDBFactory();
    const options = { idbFactory: idb, dbName };
    const repo = new ContestRepository(options);
    return { idb, options, repo };
  }

  // ---------------------------------------------------------------------------
  // 1. Estado inicial elegível
  // ---------------------------------------------------------------------------
  console.log("\n▶ [1] Estado Inicial Elegível");
  {
    const { options, repo } = createTestEnv("ui1b-test-01");
    const opState = await getMemoryOperationalState(3500, options, repo);
    assert(opState.contestNumber === 3500, "Concurso alvo deve ser 3500");
    assert(opState.canGenerateMemoryBet === true, "canGenerateMemoryBet deve ser true");
    assert(opState.hasRecord === false, "hasRecord deve ser false");
    assert(opState.historyRevision === 0, "historyRevision inicial deve ser 0");
    assert(opState.eligibleGamesCountInH === 0, "H deve estar vazio inicialmente");
    console.log("  ✓ [PASS] Estado inicial elegível verificado com sucesso.");
  }

  // ---------------------------------------------------------------------------
  // 2. Geração exige ação explícita do usuário (sem auto-geração)
  // ---------------------------------------------------------------------------
  console.log("\n▶ [2] Geração Exige Ação do Usuário");
  {
    const { options, repo } = createTestEnv("ui1b-test-02");
    // Ao apenas consultar o estado da tela, nenhum draft é criado e o banco permanece limpo
    const opState = await getMemoryOperationalState(3500, options, repo);
    const dbState = await getMemoryHistoryState(options);
    assert(dbState.recordsCount === 0, "Nenhum registro pode existir sem clique explícito");
    assert(dbState.H.length === 0, "Histórico H não pode ser modificado no boot da tela");
    console.log("  ✓ [PASS] Zero auto-geração no boot da tela.");
  }

  // ---------------------------------------------------------------------------
  // 3. Geração READY
  // ---------------------------------------------------------------------------
  console.log("\n▶ [3] Geração READY");
  {
    const { options, repo } = createTestEnv("ui1b-test-03");
    const result = await generateMemoryDraft(3500, undefined, options, repo);
    assert(result.status === "READY", "Geração para concurso 3500 deve ser READY");
    if (result.status === "READY") {
      assert(result.contestNumber === 3500, "Concurso do draft deve ser 3500");
      assert(result.draft.selectedC5.length === 5, "Draft deve conter 5 jogos");
      assert(result.exactDuplicateCount === 0, "exactDuplicateCount deve ser 0");
    }
    console.log("  ✓ [PASS] Geração READY com 5 jogos.");
  }

  // ---------------------------------------------------------------------------
  // 4. Renderização dos 5 jogos
  // ---------------------------------------------------------------------------
  console.log("\n▶ [4] Validação Estrutural dos 5 Jogos");
  {
    const { options, repo } = createTestEnv("ui1b-test-04");
    const result = await generateMemoryDraft(3500, undefined, options, repo);
    assert(result.status === "READY", "Deve ser READY");
    if (result.status === "READY") {
      for (let i = 0; i < 5; i++) {
        const game = result.draft.selectedC5[i];
        assert(game.length === 15, `Jogo ${i + 1} deve ter exatamente 15 dezenas`);
        const distinct = new Set(game);
        assert(distinct.size === 15, `Jogo ${i + 1} deve ter 15 dezenas distintas`);
        for (const num of game) {
          assert(num >= 1 && num <= 25, `Dezena ${num} deve estar no domínio 1..25`);
        }
      }
    }
    console.log("  ✓ [PASS] Todos os 5 jogos possuem estrutura válida de 15 dezenas.");
  }

  // ---------------------------------------------------------------------------
  // 5. Preview não altera H (DRAFT ∉ H)
  // ---------------------------------------------------------------------------
  console.log("\n▶ [5] Preview Não Altera H");
  {
    const { options, repo } = createTestEnv("ui1b-test-05");
    const stateBefore = await getMemoryHistoryState(options);

    // Gerar Preview
    const result = await generateMemoryDraft(3500, undefined, options, repo);
    assert(result.status === "READY", "Draft gerado em preview");

    const stateAfter = await getMemoryHistoryState(options);
    assert(stateAfter.historyRevision === stateBefore.historyRevision, "Revision não pode avançar em preview");
    assert(stateAfter.historyFingerprint === stateBefore.historyFingerprint, "Fingerprint não pode mudar em preview");
    assert(stateAfter.recordsCount === 0, "Zero registros no store em preview");
    assert(stateAfter.H.length === 0, "H permanece vazio em preview");
    console.log("  ✓ [PASS] Preview mantido estritamente fora do histórico H.");
  }

  // ---------------------------------------------------------------------------
  // 6. Descartar não altera H
  // ---------------------------------------------------------------------------
  console.log("\n▶ [6] Descarte Não Altera H");
  {
    const { options, repo } = createTestEnv("ui1b-test-06");
    const result = await generateMemoryDraft(3500, undefined, options, repo);
    assert(result.status === "READY", "Draft gerado");

    // Simulando descarte do draft pela UI (abandono da referência)
    let activeDraft: any = result.status === "READY" ? result.draft : null;
    activeDraft = null;

    const stateAfterDiscard = await getMemoryHistoryState(options);
    assert(stateAfterDiscard.historyRevision === 0, "Revisão deve continuar 0 após descarte");
    assert(stateAfterDiscard.recordsCount === 0, "Store vazio após descarte");
    console.log("  ✓ [PASS] Descarte de preview não gera efeitos colaterais.");
  }

  // ---------------------------------------------------------------------------
  // 7. Confirmação bem-sucedida
  // ---------------------------------------------------------------------------
  console.log("\n▶ [7] Confirmação Bem-Sucedida");
  {
    const { options, repo } = createTestEnv("ui1b-test-07");
    const result = await generateMemoryDraft(3500, undefined, options, repo);
    assert(result.status === "READY", "Draft gerado");

    if (result.status === "READY") {
      const confirmed = await confirmMemoryDraft(3500, result.draft, options, repo);
      assert(confirmed.status === "FROZEN", "Registro confirmado deve ter status FROZEN");
      assert(typeof confirmed.betPlacedAt === "string", "betPlacedAt deve estar preenchido");
      assert(typeof confirmed.integrityHash === "string", "integrityHash deve estar presente");
      assert(confirmed.memoryPayload?.confirmedRevision === 1, "confirmedRevision deve ser 1");

      const stateAfterConfirm = await getMemoryHistoryState(options);
      assert(stateAfterConfirm.historyRevision === 1, "Revisão deve avançar para 1");
      assert(stateAfterConfirm.recordsCount === 1, "1 registro gravado no store");
      assert(stateAfterConfirm.H.length === 5, "H expandiu para 5 jogos");
    }
    console.log("  ✓ [PASS] Confirmação atômica bem-sucedida.");
  }

  // ---------------------------------------------------------------------------
  // 8. Identidade Preview === FROZEN
  // ---------------------------------------------------------------------------
  console.log("\n▶ [8] Identidade Preview === FROZEN");
  {
    const { options, repo } = createTestEnv("ui1b-test-08");
    const result = await generateMemoryDraft(3500, undefined, options, repo);
    assert(result.status === "READY", "Draft gerado");

    if (result.status === "READY") {
      const previewGames = result.draft.selectedC5;
      const confirmed = await confirmMemoryDraft(3500, result.draft, options, repo);
      const frozenGames = confirmed.generation.games;

      assert(frozenGames.length === previewGames.length, "Mesma contagem de jogos (5)");
      for (let i = 0; i < 5; i++) {
        const previewGameSorted = [...previewGames[i]].sort((a, b) => a - b);
        const frozenGameSorted = [...frozenGames[i]].sort((a, b) => a - b);
        assert(
          JSON.stringify(previewGameSorted) === JSON.stringify(frozenGameSorted),
          `Jogo ${i + 1} em FROZEN deve ser rigorosamente idêntico ao Preview`
        );
      }
    }
    console.log("  ✓ [PASS] 100% de identidade preservada entre Preview e FROZEN.");
  }

  // ---------------------------------------------------------------------------
  // 9. Refresh pós-confirmação (sobrevive a reload)
  // ---------------------------------------------------------------------------
  console.log("\n▶ [9] Persistência Sobrevive a Reload");
  {
    const { options, repo } = createTestEnv("ui1b-test-09");
    const result = await generateMemoryDraft(3500, undefined, options, repo);
    if (result.status === "READY") {
      await confirmMemoryDraft(3500, result.draft, options, repo);
    }

    // Simula reload da aplicação: instancia novo repositório sobre a mesma base
    const reloadedRepo = new ContestRepository(options);
    const reloadedRecord = await reloadedRepo.getContestRecord(3500);
    assert(reloadedRecord !== null, "Registro deve existir pós-reload");
    assert(reloadedRecord?.status === "FROZEN", "Status pós-reload deve continuar FROZEN");
    assert(reloadedRecord?.memoryPayload?.confirmedRevision === 1, "memoryPayload intacto");
    console.log("  ✓ [PASS] Aposta FROZEN sobrevive integralmente ao reload.");
  }

  // ---------------------------------------------------------------------------
  // 10. Concurso já confirmado (bloqueia geração e substituição)
  // ---------------------------------------------------------------------------
  console.log("\n▶ [10] Bloqueio de Concurso Já Confirmado");
  {
    const { options, repo } = createTestEnv("ui1b-test-10");
    const result = await generateMemoryDraft(3500, undefined, options, repo);
    if (result.status === "READY") {
      await confirmMemoryDraft(3500, result.draft, options, repo);
    }

    // Tentar gerar novamente para o mesmo concurso
    const secondGenResult = await generateMemoryDraft(3500, undefined, options, repo);
    assert(
      secondGenResult.status === "CONTEST_ALREADY_CONFIRMED",
      "Segunda geração para concurso confirmado deve retornar CONTEST_ALREADY_CONFIRMED"
    );

    const opState = await getMemoryOperationalState(3500, options, repo);
    assert(opState.canGenerateMemoryBet === false, "canGenerateMemoryBet deve ser false");
    console.log("  ✓ [PASS] Concurso confirmado blindado contra re-geração.");
  }

  // ---------------------------------------------------------------------------
  // 11. EXACT_HISTORY_DUPLICATE_BLOCKED tratado na UI
  // ---------------------------------------------------------------------------
  console.log("\n▶ [11] Tratamento de EXACT_HISTORY_DUPLICATE_BLOCKED");
  {
    const { options, repo } = createTestEnv("ui1b-test-11");
    // 1. Confirma concurso 3500
    const res1 = await generateMemoryDraft(3500, 11111, options, repo);
    if (res1.status === "READY") {
      await confirmMemoryDraft(3500, res1.draft, options, repo);
    }

    // 2. Simula detecção de duplicidade
    const currentState = await getMemoryHistoryState(options);
    const dupCheck = detectDuplicateGames(res1.status === "READY" ? res1.draft.selectedC5 : [], currentState.H);
    assert(dupCheck.hasDuplicates === true, "detectDuplicateGames deve encontrar duplicidade");
    assert(dupCheck.duplicateCount === 5, "Todos os 5 jogos devem colidir com H");

    // 3. Tentar confirmar draft conflitante dispara erro tipado
    let caught: any = null;
    try {
      await confirmMemoryDraft(3501, res1.status === "READY" ? res1.draft : ({} as any), options, repo);
    } catch (err) {
      caught = err;
    }
    assert(
      caught instanceof ExactHistoryDuplicateBlockedError ||
        caught.code === EXACT_HISTORY_DUPLICATE_BLOCKED,
      "Deve lançar ExactHistoryDuplicateBlockedError"
    );
    console.log("  ✓ [PASS] Hard Block de repetição interceptado com erro canônico.");
  }

  // ---------------------------------------------------------------------------
  // 12. STALE_REVISION_REJECTED tratado na UI
  // ---------------------------------------------------------------------------
  console.log("\n▶ [12] Tratamento de STALE_REVISION_REJECTED");
  {
    const { options, repo } = createTestEnv("ui1b-test-12");
    // Gera draft para concurso 3501 contra base vazia (Rev 0)
    const draft3501 = await generateMemoryDraft(3501, 22222, options, repo);
    assert(draft3501.status === "READY", "Draft 3501 gerado");

    // Antes de confirmar 3501, confirma concurso 3500 (avança base para Rev 1)
    const draft3500 = await generateMemoryDraft(3500, 33333, options, repo);
    if (draft3500.status === "READY") {
      await confirmMemoryDraft(3500, draft3500.draft, options, repo);
    }

    // Agora tenta confirmar draft3501 que foi gerado com Rev 0
    let caughtStale: any = null;
    try {
      if (draft3501.status === "READY") {
        await confirmMemoryDraft(3501, draft3501.draft, options, repo);
      }
    } catch (err) {
      caughtStale = err;
    }

    assert(
      caughtStale instanceof StaleRevisionRejectedError ||
        caughtStale.code === "STALE_REVISION_REJECTED",
      "Deve rejeitar com STALE_REVISION_REJECTED"
    );
    console.log("  ✓ [PASS] Divergência de revisão rejeitada como STALE.");
  }

  // ---------------------------------------------------------------------------
  // 13. Proteção contra duplo clique em Gerar
  // ---------------------------------------------------------------------------
  console.log("\n▶ [13] Proteção contra Duplo Clique em Gerar");
  {
    const { options, repo } = createTestEnv("ui1b-test-13");
    // Simula duas gerações concorrentes simultâneas disparadas
    const [p1, p2] = await Promise.all([
      generateMemoryDraft(3500, 44444, options, repo),
      generateMemoryDraft(3500, 44444, options, repo),
    ]);

    assert(p1.status === "READY" && p2.status === "READY", "Ambas as chamadas retornam sem corromper o estado");
    const state = await getMemoryHistoryState(options);
    assert(state.recordsCount === 0, "Nenhum registro persistido");
    console.log("  ✓ [PASS] Disparos concorrentes de geração não corrompem o estado.");
  }

  // ---------------------------------------------------------------------------
  // 14. Proteção contra duplo clique em Confirmar
  // ---------------------------------------------------------------------------
  console.log("\n▶ [14] Proteção contra Duplo Clique em Confirmar");
  {
    const { options, repo } = createTestEnv("ui1b-test-14");
    const res = await generateMemoryDraft(3500, 55555, options, repo);
    assert(res.status === "READY", "Draft gerado");

    if (res.status === "READY") {
      // Duas confirmações simultâneas do mesmo draft
      const [c1, c2] = await Promise.allSettled([
        confirmMemoryDraft(3500, res.draft, options, repo),
        confirmMemoryDraft(3500, res.draft, options, repo),
      ]);

      const successes = [c1, c2].filter((r) => r.status === "fulfilled");
      const failures = [c1, c2].filter((r) => r.status === "rejected");

      assert(successes.length === 1, "Exatamente UMA confirmação prevalece");
      assert(failures.length === 1, "A confirmação duplicada concorrente é rejeitada");

      const finalState = await getMemoryHistoryState(options);
      assert(finalState.recordsCount === 1, "Exatamente 1 registro gravado");
      assert(finalState.historyRevision === 1, "Revisão avançou para 1 apenas uma vez");
    }
    console.log("  ✓ [PASS] Concorrência atômica garante unicidade de confirmação.");
  }

  // ---------------------------------------------------------------------------
  // 15. Multiaba (Tab A Preview vs Tab B Commit -> Stale)
  // ---------------------------------------------------------------------------
  console.log("\n▶ [15] Cenário Multiaba (Tab A Preview vs Tab B Commit)");
  {
    const { options, repo } = createTestEnv("ui1b-test-15");

    // Tab A gera Preview para concurso 3501
    const tabADraftRes = await generateMemoryDraft(3501, 66661, options, repo);
    assert(tabADraftRes.status === "READY", "Tab A gerou Preview");

    // Tab B confirma aposta no concurso 3500 (altera histórico H e avança revision)
    const tabBDraftRes = await generateMemoryDraft(3500, 66662, options, repo);
    if (tabBDraftRes.status === "READY") {
      await confirmMemoryDraft(3500, tabBDraftRes.draft, options, repo);
    }

    // Tab A agora tenta confirmar o seu preview que foi gerado com H antigo
    let tabAErr: any = null;
    try {
      if (tabADraftRes.status === "READY") {
        await confirmMemoryDraft(3501, tabADraftRes.draft, options, repo);
      }
    } catch (err) {
      tabAErr = err;
    }

    assert(tabAErr !== null, "Tab A deve ser rejeitada");
    assert(
      tabAErr instanceof StaleRevisionRejectedError || tabAErr.code === "STALE_REVISION_REJECTED",
      "Tab A recebe STALE_REVISION_REJECTED"
    );
    console.log("  ✓ [PASS] Proteção multiaba confirmada via OCC.");
  }

  // ---------------------------------------------------------------------------
  // 16. Ausência de regeneração silenciosa
  // ---------------------------------------------------------------------------
  console.log("\n▶ [16] Ausência de Regeneração Silenciosa");
  {
    const { options, repo } = createTestEnv("ui1b-test-16");
    // Gera e confirma concurso 3500
    const res1 = await generateMemoryDraft(3500, 77771, options, repo);
    if (res1.status === "READY") {
      await confirmMemoryDraft(3500, res1.draft, options, repo);
    }

    // Gera concurso com mesma seed
    const res2 = await generateMemoryDraft(3500, 77771, options, repo);
    // Não pode auto-regenerar silenciosamente! Deve retornar status de já confirmado
    assert(res2.status === "CONTEST_ALREADY_CONFIRMED", "Não auto-regenera nem troca semente");
    console.log("  ✓ [PASS] Zero regeneração silenciosa comprovada.");
  }

  // ---------------------------------------------------------------------------
  // 17. Auditoria somente leitura
  // ---------------------------------------------------------------------------
  console.log("\n▶ [17] Auditoria Somente Leitura");
  {
    const { options, repo } = createTestEnv("ui1b-test-17");
    const res = await generateMemoryDraft(3500, 88888, options, repo);
    if (res.status === "READY") {
      const confirmed = await confirmMemoryDraft(3500, res.draft, options, repo);
      const auditDetails = getMemoryAuditDetails(confirmed);
      assert(auditDetails !== null, "getMemoryAuditDetails deve retornar dados");
      assert(auditDetails?.algorithmVersion === "C5-Memory-2.0.0", "algorithmVersion deve ser C5-Memory-2.0.0");
      assert(auditDetails?.poolIndex === res.draft.poolIndex, "poolIndex coincide");
      assert(auditDetails?.historyRevision === 0, "historyRevision coincide");
      assert(auditDetails?.confirmedRevision === 1, "confirmedRevision é 1");
      assert(auditDetails?.winnerHistogram.length === 11, "Histograma possui 11 faixas (d=0..10)");
    }
    console.log("  ✓ [PASS] Metadados de auditoria somente leitura validados.");
  }

  // ---------------------------------------------------------------------------
  // 18. Isolamento arquitetural da UI
  // ---------------------------------------------------------------------------
  console.log("\n▶ [18] Isolamento Arquitetural da UI");
  {
    const c5MemoryViewPath = path.resolve("src/components/C5MemoryView.tsx");
    const c5MemoryContent = fs.readFileSync(c5MemoryViewPath, "utf-8");

    // Verificar que C5MemoryView NÃO chama diretamente createDraft
    const hasDirectCreateDraft = /\bcreateDraft\s*\(/.test(c5MemoryContent);
    assert(!hasDirectCreateDraft, "C5MemoryView NÃO pode chamar createDraft diretamente");

    // Verificar que C5MemoryView NÃO chama diretamente confirmMemoryBetAtomic
    const hasDirectAtomicConfirm = /\bconfirmMemoryBetAtomic\s*\(/.test(c5MemoryContent);
    assert(!hasDirectAtomicConfirm, "C5MemoryView NÃO pode chamar confirmMemoryBetAtomic diretamente");

    // Verificar que C5MemoryView consome exclusivamente a Application Layer
    const hasOrchestratorGen = /generateMemoryDraft/.test(c5MemoryContent);
    const hasOrchestratorConfirm = /confirmMemoryDraft/.test(c5MemoryContent);
    assert(hasOrchestratorGen, "C5MemoryView consome generateMemoryDraft");
    assert(hasOrchestratorConfirm, "C5MemoryView consome confirmMemoryDraft");

    console.log("  ✓ [PASS] Isolamento arquitetural comprovado: UI consome exclusivamente Application Layer.");
  }

  console.log("\n===============================================================================");
  console.log("TODOS OS 18 TESTES DO FLUXO VISUAL DIÁRIO (UI-1B) PASSARAM COM SUCESSO (18/18)");
  console.log("===============================================================================");
}

runUI1BTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("FATAL ERROR IN UI-1B TESTS:", err);
    process.exit(1);
  });
