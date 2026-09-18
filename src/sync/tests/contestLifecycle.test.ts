/**
 * Bateria de Testes Canônicos de Ciclo Operacional e Reconciliação com Fonte Oficial CAIXA (v1.4.0).
 * 
 * Cobre:
 * 1. Derivação determinística de ContestOperationalState (Regras 8 a 14)
 * 2. Validação estrita de resultado oficial validateOfficialResult (Regra 17)
 * 3. Reconciliação matemática reconcileOfficialResult (Regras 25 a 31)
 * 4. Mapeamento de Ação Principal getOperationalPrimaryAction (Regra 37)
 * 5. Proteção contra Concurso Divergente (Regras 15 e 16 - Mismatch 3900 vs 3901)
 * 6. Preservação de Estado Local perante Falha Externa (Regra 14)
 * 7. Prioridade Absoluta da Quarentena sobre qualquer status (Regra 8)
 * 8. Ciclo Completo com ContestRepository (NO_RECORD -> DRAFT -> FROZEN -> SCORED)
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
import { createContestDraft } from "../../c5/record.ts";
import { scoreC5 } from "../../c5/scorer.ts";
import { ContestRepository } from "../../storage/contestRepository.ts";
import type { ContestRecord } from "../../c5/types.ts";

async function runContestLifecycleTests() {
  console.log("=== INICIANDO TESTES DO CICLO OPERACIONAL E RECONCILIAÇÃO (v1.4.0) ===");

  // -------------------------------------------------------------
  // GRUPO 1: Validação Rigorosa de Resultado Oficial (Regra 17)
  // -------------------------------------------------------------
  console.log("1. Testando validação estrita de resultado oficial...");

  const validNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const sorted = validateOfficialResult(validNumbers);
  assert.equal(sorted.length, 15);
  assert.deepEqual(sorted, validNumbers);
  assert.equal(isValidOfficialResult(validNumbers), true);

  // Ordenação automática
  const unsorted = [15, 1, 14, 2, 13, 3, 12, 4, 11, 5, 10, 6, 9, 7, 8];
  assert.deepEqual(validateOfficialResult(unsorted), validNumbers);

  // Rejeição: Menos de 15
  assert.throws(
    () => validateOfficialResult([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]),
    /15 dezenas/
  );
  assert.equal(
    isValidOfficialResult([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]),
    false
  );

  // Rejeição: Mais de 15
  assert.throws(
    () => validateOfficialResult([...validNumbers, 16]),
    /15 dezenas/
  );

  // Rejeição: Duplicatas
  assert.throws(
    () => validateOfficialResult([1, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
    /duplicadas/
  );

  // Rejeição: Dezena fora do intervalo 1..25
  assert.throws(
    () => validateOfficialResult([0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
    /fora do intervalo/
  );
  assert.throws(
    () => validateOfficialResult([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 26]),
    /fora do intervalo/
  );

  // Rejeição: Tipos não numéricos ou não inteiros
  assert.throws(
    () => validateOfficialResult([1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
    /inteiro/
  );
  assert.throws(
    () => validateOfficialResult(["1", 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as any),
    /inteiro/
  );
  assert.throws(() => validateOfficialResult(null), /lista/);

  console.log("✓ Validação de dezenas oficiais em conformidade estrita.");

  // -------------------------------------------------------------
  // GRUPO 2: Derivação de Estado Operacional (Regras 8 a 14)
  // -------------------------------------------------------------
  console.log("2. Testando derivação pura de ContestOperationalState...");

  // NO_RECORD
  assert.equal(
    deriveContestOperationalState({ localRecord: null }),
    "NO_RECORD"
  );
  assert.equal(
    deriveContestOperationalState({
      localRecord: null,
      isExternalUnavailable: true,
    }),
    "EXTERNAL_UNAVAILABLE"
  );

  // DRAFT
  const draftRecord = createContestDraft(3900);
  assert.equal(
    deriveContestOperationalState({ localRecord: draftRecord }),
    "DRAFT"
  );

  // FROZEN_WAITING_RESULT (sem snapshot externo)
  const frozenRecord: ContestRecord = {
    ...draftRecord,
    status: "FROZEN",
    frozenAt: new Date().toISOString(),
  };
  assert.equal(
    deriveContestOperationalState({ localRecord: frozenRecord }),
    "FROZEN_WAITING_RESULT"
  );

  // Regra 14: FROZEN com falha externa mantém FROZEN_WAITING_RESULT
  assert.equal(
    deriveContestOperationalState({
      localRecord: frozenRecord,
      externalSnapshot: null,
      isExternalUnavailable: true,
    }),
    "FROZEN_WAITING_RESULT",
    "FROZEN com fonte indisponível deve preservar estado operacional local"
  );

  // Regra 15 & 16: Concurso Divergente (Local 3900, Externo 3901)
  const externalSnapshot3901 = createOfficialResultPreview({
    contestNumber: 3901,
    numbers: validNumbers,
    drawDate: "18/09/2026",
  });
  assert.equal(
    deriveContestOperationalState({
      localRecord: frozenRecord, // 3900
      externalSnapshot: externalSnapshot3901, // 3901
    }),
    "FROZEN_WAITING_RESULT",
    "Snapshot de outro concurso não pode disponibilizar resultado para o concurso local"
  );

  // FROZEN_RESULT_AVAILABLE (Concurso Exato 3900 e 15 dezenas válidas)
  const externalSnapshot3900 = createOfficialResultPreview({
    contestNumber: 3900,
    numbers: validNumbers,
    drawDate: "18/09/2026",
  });
  assert.equal(
    deriveContestOperationalState({
      localRecord: frozenRecord,
      externalSnapshot: externalSnapshot3900,
    }),
    "FROZEN_RESULT_AVAILABLE"
  );

  // SCORED
  const scoredRecord: ContestRecord = {
    ...frozenRecord,
    status: "SCORED",
    officialResult: validNumbers,
    scoredAt: new Date().toISOString(),
    score: scoreC5(frozenRecord.generation, validNumbers),
  };
  assert.equal(
    deriveContestOperationalState({ localRecord: scoredRecord }),
    "SCORED"
  );

  // Regra 8: Prioridade Absoluta da Quarentena
  assert.equal(
    deriveContestOperationalState({
      localRecord: scoredRecord,
      localAudit: { valid: false },
      externalSnapshot: externalSnapshot3900,
    }),
    "QUARANTINED",
    "Quarentena deve ter prioridade máxima sobre qualquer status"
  );
  assert.equal(
    deriveContestOperationalState({
      localRecord: draftRecord,
      localAudit: { valid: false },
    }),
    "QUARANTINED"
  );

  console.log("✓ Derivação de estados operacionais 100% determinística.");

  // -------------------------------------------------------------
  // GRUPO 3: Reconciliação com Fonte Oficial CAIXA (Regras 25 a 31)
  // -------------------------------------------------------------
  console.log("3. Testando reconciliação matemática com a CAIXA...");

  // Sem registro local ou DRAFT -> NOT_APPLICABLE
  assert.equal(reconcileOfficialResult(null, externalSnapshot3900), "NOT_APPLICABLE");
  assert.equal(reconcileOfficialResult(draftRecord, externalSnapshot3900), "NOT_APPLICABLE");

  // FROZEN sem snapshot ou com snapshot de outro concurso -> WAITING_EXTERNAL
  assert.equal(reconcileOfficialResult(frozenRecord, null), "WAITING_EXTERNAL");
  assert.equal(reconcileOfficialResult(frozenRecord, externalSnapshot3901), "WAITING_EXTERNAL");
  assert.equal(reconcileOfficialResult(frozenRecord, externalSnapshot3900), "WAITING_EXTERNAL");

  // Snapshot com estrutura inválida -> INVALID_EXTERNAL
  assert.equal(
    reconcileOfficialResult(scoredRecord, { contestNumber: 3900, numbers: [1, 2] }),
    "INVALID_EXTERNAL"
  );
  assert.equal(
    reconcileOfficialResult(scoredRecord, "invalid payload"),
    "INVALID_EXTERNAL"
  );

  // SCORED idêntico ao snapshot da CAIXA -> MATCH (Regra 25)
  assert.equal(
    reconcileOfficialResult(scoredRecord, externalSnapshot3900),
    "MATCH"
  );

  // SCORED divergente da CAIXA -> MISMATCH (Regra 26 e 30)
  const divergentNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16]; // 16 em vez de 15
  const divergentSnapshot = createOfficialResultPreview({
    contestNumber: 3900,
    numbers: divergentNumbers,
  });
  assert.equal(
    reconcileOfficialResult(scoredRecord, divergentSnapshot),
    "MISMATCH"
  );

  console.log("✓ Reconciliação oficial operando conforme especificação.");

  // -------------------------------------------------------------
  // GRUPO 4: Mapeamento de Ação Principal (Regra 37)
  // -------------------------------------------------------------
  console.log("4. Testando mapeamento determinístico de Ação Principal...");

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
    assert.equal(act.actionKey, expectedKey, `Falha na ação para ${state}`);
    assert(act.label.length > 0);
    assert(act.description.length > 0);
  }

  console.log("✓ Ações principais canônicas verificadas com sucesso.");

  // -------------------------------------------------------------
  // GRUPO 5: Ciclo Completo no ContestRepository com TOCTOU e Reconciliação
  // -------------------------------------------------------------
  console.log("5. Testando ciclo completo ponta a ponta no repositório...");

  const repo = new ContestRepository({ dbName: `test-lifecycle-${Date.now()}` });

  // Passo 1: SEM REGISTRO
  let currentRec = await repo.getContestRecord(3900);
  let state = deriveContestOperationalState({ localRecord: currentRec });
  assert.equal(state, "NO_RECORD");

  // Passo 2: GERAR DRAFT
  const newDraft = createContestDraft(3900);
  await repo.saveDraft(newDraft);
  currentRec = await repo.getContestRecord(3900);
  assert(currentRec !== null);
  assert.equal(currentRec.status, "DRAFT");
  state = deriveContestOperationalState({ localRecord: currentRec });
  assert.equal(state, "DRAFT");

  // Passo 3: CONGELAR
  const frozen = await repo.freezeStoredContest(3900);
  assert.equal(frozen.status, "FROZEN");
  assert(frozen.integrityHash && frozen.integrityHash.length === 64);
  currentRec = await repo.getContestRecord(3900);
  state = deriveContestOperationalState({ localRecord: currentRec });
  assert.equal(state, "FROZEN_WAITING_RESULT");

  // Passo 4: CONSULTA COM MISMATCH DE CONCURSO (3901)
  state = deriveContestOperationalState({
    localRecord: currentRec,
    externalSnapshot: externalSnapshot3901,
  });
  assert.equal(state, "FROZEN_WAITING_RESULT", "Snapshot 3901 não deve ativar pontuação para 3900");

  // Passo 5: CONSULTA VÁLIDA PARA O CONCURSO 3900
  state = deriveContestOperationalState({
    localRecord: currentRec,
    externalSnapshot: externalSnapshot3900,
  });
  assert.equal(state, "FROZEN_RESULT_AVAILABLE");

  // Passo 6: PONTUAR
  const scored = await repo.scoreStoredContest(3900, validNumbers);
  assert.equal(scored.status, "SCORED");
  assert.deepEqual(scored.officialResult, validNumbers);
  assert(typeof scored.score?.maxHits === "number" && scored.score.maxHits >= 0);

  currentRec = await repo.getContestRecord(3900);
  state = deriveContestOperationalState({ localRecord: currentRec });
  assert.equal(state, "SCORED");

  // Passo 7: RECONCILIAÇÃO FINAL COM A CAIXA
  const reconStatus = reconcileOfficialResult(currentRec, externalSnapshot3900);
  assert.equal(reconStatus, "MATCH");

  // Passo 8: Nova tentativa de pontuar concurso SCORED é rejeitada
  await assert.rejects(
    async () => repo.scoreStoredContest(3900, validNumbers),
    /Apenas registros em estado FROZEN podem ser pontuados/
  );

  console.log("✓ Ciclo completo de vida e reconciliação validado com êxito.");
  console.log("=== TODOS OS TESTES DO CICLO OPERACIONAL (v1.4.0) PASSARAM COM SUCESSO ===");
}

runContestLifecycleTests().catch((err) => {
  console.error("FALHA NOS TESTES DE CICLO OPERACIONAL:", err);
  process.exit(1);
});
