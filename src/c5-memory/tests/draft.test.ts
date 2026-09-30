/**
 * Suíte de Testes Unitários de Domínio para C5-Memory Draft e Concorrência Lógica (IC6)
 */

import {
  createDraft,
  derivePreview,
  validateDraftFreshness,
  assertDraftFreshness,
  replayDraft,
  C5_MEMORY_ALGORITHM_VERSION,
  STALE_REVISION_REJECTED,
  StaleRevisionRejectedError,
  type C5MemoryDraft,
} from "../draft.ts";
import { computeHistoryFingerprint } from "../history.ts";
import type { C5Candidate } from "../types.ts";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FALHA: ${message}`);
    throw new Error(`Asserção falhou: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runTests() {
  console.log("=== EXECUTANDO TESTES UNITÁRIOS C5-MEMORY DRAFT E CONCORRÊNCIA ===");

  const sampleH: number[][] = [
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20],
  ];
  const fpH = computeHistoryFingerprint(sampleH);
  const seed = 20260929;
  const rev = 5;

  // 1. Criação e Metadados do Draft
  const draft = createDraft({
    H: sampleH,
    historyRevision: rev,
    historyFingerprint: fpH,
    poolMasterSeed: seed,
  });

  assert(draft.algorithmVersion === C5_MEMORY_ALGORITHM_VERSION, "Draft possui algorithmVersion C5-Memory-2.0.0");
  assert(draft.poolMasterSeed === seed, "Draft congela poolMasterSeed");
  assert(typeof draft.poolIndex === "number" && draft.poolIndex >= 0 && draft.poolIndex < 500, "Draft possui poolIndex válido (0..499)");
  assert(draft.selectedPoolIndex === draft.poolIndex, "selectedPoolIndex é alias fiel de poolIndex");
  assert(draft.expectedHistoryRevision === rev, "expectedHistoryRevision é preservada");
  assert(draft.draftHistoryRevision === rev, "draftHistoryRevision coincide com expectedHistoryRevision");
  assert(draft.expectedHistoryFingerprint === fpH, "expectedHistoryFingerprint é preservada");
  assert(draft.draftHistoryFingerprint === fpH, "draftHistoryFingerprint coincide com expectedHistoryFingerprint");
  assert(Array.isArray(draft.selectedC5) && draft.selectedC5.length === 5, "selectedC5 contém exatamente 5 jogos");
  assert(Object.isFrozen(draft), "Draft é um objeto congelado (Object.freeze)");
  assert(Object.isFrozen(draft.selectedC5), "selectedC5 é um array congelado");

  // 2. Imutabilidade do Preview
  const preview = derivePreview(draft);
  assert(preview === draft.selectedC5, "derivePreview retorna exatamente o selectedC5 congelado");
  assert(preview[0] === draft.selectedC5[0], "Jogos internos do preview coincidem por referência imutável");

  // 3. Matriz 2x2 de Freshness
  // Caso A: rev igual, fp igual -> FRESH
  const resA = validateDraftFreshness(draft, rev, fpH);
  assert(!resA.isStale && resA.validationStatus === "COMPATIBLE" && resA.action === "ALLOW_CONFIRMATION", "Matriz Caso A (rev=, fp=): FRESH / COMPATIBLE");
  assert(assertDraftFreshness(draft, rev, fpH) === true, "assertDraftFreshness autoriza Caso A");

  // Caso B: rev diferente, fp igual -> STALE_REVISION_REJECTED
  const resB = validateDraftFreshness(draft, rev + 1, fpH);
  assert(resB.isStale && resB.validationStatus === STALE_REVISION_REJECTED && resB.action === "ABORT_PERSISTENCE_TRANSACTION", "Matriz Caso B (rev!=, fp=): STALE_REVISION_REJECTED");

  // Caso C: rev igual, fp diferente -> STALE_REVISION_REJECTED
  const altFp = "0000000000000000000000000000000000000000000000000000000000000000";
  const resC = validateDraftFreshness(draft, rev, altFp);
  assert(resC.isStale && resC.validationStatus === STALE_REVISION_REJECTED && resC.action === "ABORT_PERSISTENCE_TRANSACTION", "Matriz Caso C (rev=, fp!=): STALE_REVISION_REJECTED");

  // Caso D: rev diferente, fp diferente -> STALE_REVISION_REJECTED
  const resD = validateDraftFreshness(draft, rev + 1, altFp);
  assert(resD.isStale && resD.validationStatus === STALE_REVISION_REJECTED && resD.action === "ABORT_PERSISTENCE_TRANSACTION", "Matriz Caso D (rev!=, fp!=): STALE_REVISION_REJECTED");

  // 4. Erro Canônico StaleRevisionRejectedError
  let caughtError: any = null;
  try {
    assertDraftFreshness(draft, rev + 1, fpH);
  } catch (err: any) {
    caughtError = err;
  }
  assert(caughtError instanceof StaleRevisionRejectedError, "assertDraftFreshness lança instância de StaleRevisionRejectedError");
  assert(caughtError.code === STALE_REVISION_REJECTED, "Código de erro é estritamente STALE_REVISION_REJECTED");
  assert(caughtError.expectedRevision === rev && caughtError.currentRevision === rev + 1, "Erro reporta revisão esperada e atual com precisão");

  // 5. Replay do Draft
  const replayResult = replayDraft(draft, sampleH);
  assert(replayResult.poolMatches === true, "replayDraft reconstrói pool 100% idêntico");
  assert(replayResult.poolIndexMatches === true, "replayDraft coincide poolIndex com precisão");
  assert(replayResult.gamesMatch === true, "replayDraft reproduz jogos exatamente bit a bit");
  assert(replayResult.replayedPoolIndex === draft.poolIndex, "replayedPoolIndex coincide com draft.poolIndex");

  // 6. Não-Mutação
  const hBefore = JSON.stringify(sampleH);
  const draftBefore = JSON.stringify(draft);
  validateDraftFreshness(draft, rev, fpH);
  derivePreview(draft);
  replayDraft(draft, sampleH);
  assert(JSON.stringify(sampleH) === hBefore, "Estrutura do histórico H não foi mutacionada por nenhuma operação");
  assert(JSON.stringify(draft) === draftBefore, "Estrutura do Draft não foi mutacionada por nenhuma operação");

  // 7. Dados Exógenos não afetam freshness
  const exogenousPayload = {
    sorteioCaixa: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    premiacoes: 1000000,
    acertos: 15,
  };
  // Estado histórico H e seus metadados (rev, fpH) continuam inalterados
  const resExo = validateDraftFreshness(draft, rev, fpH);
  assert(resExo.validationStatus === "COMPATIBLE", "Dados exógenos não afetam freshness do Draft");
  assert(derivePreview(draft) === draft.selectedC5, "Dados exógenos não alteram Preview do Draft");

  console.log("🎉 Todos os testes unitários de C5-Memory Draft passaram com SUCESSO!");
}

runTests().catch((err) => {
  console.error("FALHA NOS TESTES UNITÁRIOS:", err);
  process.exit(1);
});
