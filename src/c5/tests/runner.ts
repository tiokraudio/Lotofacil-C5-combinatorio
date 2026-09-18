/**
 * Executor unificado de todos os testes do motor C₅.
 */
import { runUnitTests } from "./unit.test.ts";
import { runGoldenTest } from "./golden.test.ts";
import { runScorerUnitTests } from "./scorer.test.ts";
import { runRecordTests } from "./record.test.ts";
import { runIntegrityTests } from "./integrity.test.ts";
import { runStorageTests } from "../../storage/tests/storage.test.ts";
import { runImportTests } from "../../storage/tests/import.test.ts";
import { runRandomSanityTest } from "./randomSanity.test.ts";
import { runMassiveTest } from "./massive.test.ts";
import { runExhaustiveTests } from "./exhaustive.test.ts";

export async function runAll() {
  console.log("===============================================================================");
  console.log(" CERTIFICAÇÃO COMPLETA: MOTOR COMBINATÓRIO, SCORER, REGISTRO E INDEXEDDB (P1-P4)");
  console.log("===============================================================================\n");

  // 1. Testes unitários e negativos do validador/gerador (14 casos obrigatórios)
  const unitResults = runUnitTests();
  if (unitResults.failed > 0) {
    console.error("Falha nos testes unitários do validador. Abortando.");
    process.exit(1);
  }

  // 1b. Golden Test Canônico C5 (Permutação identidade e mapeamento estrito)
  const goldenResults = runGoldenTest();
  if (!goldenResults.allPassed) {
    console.error("Falha no Golden Test Canônico C5. Abortando.");
    process.exit(1);
  }

  // 2. Testes unitários e negativos do scorer (12 casos obrigatórios)
  const scorerResults = runScorerUnitTests();
  if (scorerResults.failed > 0) {
    console.error("Falha nos testes unitários do scorer. Abortando.");
    process.exit(1);
  }

  // 3. Testes do ciclo de vida, imutabilidade e transições do registro (20 casos)
  const recordResults = await runRecordTests();
  if (recordResults.failed > 0) {
    console.error("Falha nos testes de ciclo de vida do registro. Abortando.");
    process.exit(1);
  }

  // 4. Testes de auditoria de integridade e detecção de adulteração (11 casos)
  const integrityResults = await runIntegrityTests();
  if (integrityResults.failed > 0) {
    console.error("Falha nos testes de integridade e adulteração. Abortando.");
    process.exit(1);
  }

  // 5. Testes da camada de persistência IndexedDB (24 casos)
  const storageResults = await runStorageTests();
  if (storageResults.failed > 0) {
    console.error("Falha nos testes de persistência IndexedDB. Abortando.");
    process.exit(1);
  }

  // 6. Testes de importação segura de backups JSON (37 casos)
  const importResults = await runImportTests();
  if (importResults.failed > 0) {
    console.error("Falha nos testes de importação segura de backups JSON. Abortando.");
    process.exit(1);
  }

  // 7. Teste estatístico de sanidade de randomização (50.000 amostras)
  const sanityResult = runRandomSanityTest(50_000);
  if (!sanityResult.passed) {
    console.error("Falha no teste de sanidade de randomização. Abortando.");
    process.exit(1);
  }

  // 8. Teste massivo de 100.000 gerações independentes (Invariantes C5)
  const massiveResult = runMassiveTest(100_000);
  if (massiveResult.invalid > 0) {
    console.error("Falha no teste massivo de 100.000 gerações. Abortando.");
    process.exit(1);
  }

  // 9. Teste exaustivo de C(25, 15) = 3.268.760 combinações em 5 rotulagens
  const exhaustivePassed = runExhaustiveTests([101, 202, 303, 404, 505]);
  if (!exhaustivePassed) {
    console.error("Falha na certificação exaustiva. Abortando.");
    process.exit(1);
  }

  console.log("===============================================================================");
  console.log("     TODAS AS CERTIFICAÇÕES (P1, P2, P3, P4 E P6) FORAM CONCLUÍDAS COM ÊXITO   ");
  console.log("===============================================================================");
}

runAll().catch((err) => {
  console.error("Erro fatal na execução dos testes:", err);
  process.exit(1);
});

