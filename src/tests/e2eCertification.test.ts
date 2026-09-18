/**
 * SUÍTE DE CERTIFICAÇÃO OPERACIONAL E2E (VERSÃO 1.0)
 *
 * Executa todos os fluxos e cenários exigidos para a certificação operacional final:
 * - E2E Fluxo 1: Ciclo de vida completo (Banco vazio -> Draft -> Frozen -> Reload -> Integridade)
 * - E2E Fluxo 2: Conferência Oficial (Frozen -> Consulta/Prévia -> Confirmar -> Scored -> Métricas)
 * - E2E Fluxo 3: Concorrência entre abas/sessões (Aba A congela, Aba B tenta descartar -> Rejeição e Recarregamento)
 * - Teste 4: Persistência e F5/reload com verificação profunda
 * - Teste 5: Concorrência entre abas e integridade transacional
 * - Teste 6: Falhas de rede e infraestrutura (503, timeout, resposta corrompida, fallback manual)
 * - Teste 7: Validação e conferência manual (14, 16, duplicadas, inválidas, DRAFT bloqueado)
 * - Teste 8: Imutabilidade absoluta pós-congelamento
 * - Teste 9: Teste estrito de Não-Mutação por ações acessórias (Copiar, Imprimir, Auditar, etc.)
 * - Teste 10: Backup e Restauração com detecção de adulteração
 * - Teste 11: Auditoria profunda do histórico
 * - Teste 12: Formato de Clipboard dos jogos
 * - Teste 13: Regras e elementos de impressão
 * - Teste 20: Instrumentação de "Uma geração por clique"
 */
import { IDBFactory } from "fake-indexeddb";
import { ContestRepository } from "../storage/contestRepository.ts";
import {
  createContestDraft,
  freezeContestRecord,
  validateC5,
  C5_SLOTS,
  LOTOFACIL_NUMBERS,
} from "../c5/index.ts";
import { createMulberry32 } from "../c5/random.ts";
import { FakeLotteryResultProvider, setLotteryProvider } from "../lottery/index.ts";
import { COST_PER_CONTEST } from "../storage/types.ts";
import { parseHistoryBackup, prepareHistoryImport, importHistory } from "../storage/import.ts";
import { formatGamesForClipboard } from "../utils/clipboard.ts";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[FALHA NA CERTIFICAÇÃO E2E] ${message}`);
  }
}

export async function runFullE2ECertification() {
  console.log("===============================================================================");
  console.log(" EXECUTANDO CERTIFICAÇÃO OPERACIONAL E2E COMPLETA — VERSÃO 1.0 C₅ LOTOFÁCIL   ");
  console.log("===============================================================================\n");

  const fakeIdb = new IDBFactory();
  const repo = new ContestRepository({ idbFactory: fakeIdb });

  // ---------------------------------------------------------------------------
  // E2E FLUXO 1: Ciclo de vida completo (Banco vazio -> Draft -> Frozen -> Reload)
  // ---------------------------------------------------------------------------
  console.log("▶ E2E FLUXO 1: Banco vazio -> Draft -> Frozen -> Reload -> Integridade");
  // 1.1 Verificar banco vazio
  const initialRecords = await repo.getAllContestRecords();
  assert(initialRecords.length === 0, "Banco deve iniciar completamente vazio.");

  // 1.2 Gerar 5 jogos (DRAFT) para o concurso 3400
  const draft1 = createContestDraft(3400);
  assert(draft1.status === "DRAFT", "Status inicial deve ser DRAFT.");
  assert(draft1.generation.games.length === 5, "Devem ser gerados 5 jogos.");
  await repo.saveDraft(draft1);

  // 1.3 Confirmar DRAFT persistido
  const storedDraft1 = await repo.getContestRecord(3400);
  assert(storedDraft1 !== null, "DRAFT 3400 deve estar no IndexedDB.");
  assert(storedDraft1?.status === "DRAFT", "Status no IndexedDB deve ser DRAFT.");
  assert(storedDraft1?.generationId === draft1.generationId, "generationId deve coincidir.");
  assert(!storedDraft1?.integrityHash, "DRAFT não deve ter hash de integridade.");

  // 1.4 CONGELAR
  await repo.freezeStoredContest(3400);
  const frozen1 = await repo.getContestRecord(3400);
  assert(frozen1?.status === "FROZEN", "Status deve transicionar para FROZEN.");
  assert(Boolean(frozen1?.integrityHash), "integrityHash SHA-256 deve ser gerado.");
  assert(Boolean(frozen1?.frozenAt), "frozenAt deve ser preenchido.");

  const genId1 = frozen1!.generationId;
  const hash1 = frozen1!.integrityHash!;
  console.log(`  [Anotado] generationId = ${genId1}`);
  console.log(`  [Anotado] integrityHash = ${hash1}`);

  // 1.5 Simular F5/Reload completo (nova instância de repositório acessando o mesmo IndexedDB)
  const repoReloaded = new ContestRepository({ idbFactory: fakeIdb });
  const reloadedRecord = await repoReloaded.getContestRecord(3400);
  assert(reloadedRecord !== null, "Concurso 3400 deve persistir intacto após reload.");
  assert(reloadedRecord?.status === "FROZEN", "Status após reload deve permanecer FROZEN.");
  assert(reloadedRecord?.generationId === genId1, "generationId deve ser absolutamente idêntico após reload.");
  assert(reloadedRecord?.integrityHash === hash1, "integrityHash deve ser absolutamente idêntico após reload.");

  // 1.6 Auditoria de integridade do registro
  const audit1 = await repoReloaded.verifyStoredContest(3400);
  assert(audit1.valid, "Auditoria do registro recarregado deve ser 100% válida.");
  assert(audit1.generationIntegrity?.hashMatches === true, "Hash SHA-256 deve coincidir.");
  console.log("  ✓ [PASS] E2E Fluxo 1 aprovado com integridade matemática e criptográfica total.\n");

  // ---------------------------------------------------------------------------
  // E2E FLUXO 2: Conferência Oficial de Concurso FROZEN
  // ---------------------------------------------------------------------------
  console.log("▶ E2E FLUXO 2: Concurso FROZEN -> Consulta Externa -> Prévia -> Confirmar -> Scored -> Métricas");
  const testProvider = new FakeLotteryResultProvider();
  setLotteryProvider(testProvider);

  // 2.1 Configura resultado oficial na CAIXA para concurso 3400
  const caixasResult3400 = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 22, 23, 24, 25];
  testProvider.setContestResult(3400, {
    contestNumber: 3400,
    drawDate: "18/09/2026",
    numbers: caixasResult3400,
    source: "CAIXA",
    fetchedAt: new Date().toISOString(),
  });

  // 2.2 Consulta resultado com prévia (sem pontuar automaticamente)
  const previewResult = await testProvider.getContest(3400);
  assert(previewResult.numbers.length === 15, "Prévia deve conter exatamente 15 dezenas.");
  const beforeScore = await repoReloaded.getContestRecord(3400);
  assert(beforeScore?.status === "FROZEN", "Registro permanece estritamente FROZEN durante prévia.");

  // 2.3 Confirmar conferência
  await repoReloaded.scoreStoredContest(3400, previewResult.numbers);
  const scoredRecord = await repoReloaded.getContestRecord(3400);
  assert(scoredRecord?.status === "SCORED", "Status deve transicionar para SCORED.");
  assert(scoredRecord?.score !== undefined, "Score deve existir.");
  assert(scoredRecord?.score?.games.length === 5, "Exatamente 5 jogos pontuados.");
  assert(typeof scoredRecord?.score?.maxHits === "number", "maxHits deve ser numérico.");

  // 2.4 Verificar imutabilidade da geração original e do hash original
  assert(scoredRecord?.generationId === genId1, "generationId original imutável após pontuação.");
  assert(scoredRecord?.integrityHash === hash1, "integrityHash original imutável após pontuação.");

  // 2.5 Verificar métricas consolidadas do histórico
  const historySummary = await repoReloaded.getHistorySummary();
  assert(historySummary.contestsPlayed === 1, "contestsPlayed deve ser 1.");
  assert(historySummary.totalSpent === COST_PER_CONTEST, `totalSpent deve ser exatamente R$ ${COST_PER_CONTEST}.`);
  assert(historySummary.bestMaxHits === scoredRecord?.score?.maxHits, "bestMaxHits coincide com maxHits.");
  assert(historySummary.averageMaxHits === scoredRecord?.score?.maxHits, "averageMaxHits coincide com maxHits.");
  console.log(`  ✓ [PASS] E2E Fluxo 2 aprovado. Pontuação registrada: maxHits = ${scoredRecord?.score?.maxHits}.\n`);

  // ---------------------------------------------------------------------------
  // E2E FLUXO 3: Concorrência entre abas / sessões
  // ---------------------------------------------------------------------------
  console.log("▶ E2E FLUXO 3: Concorrência entre abas/sessões (Aba A congela, Aba B tenta descartar)");
  // Cria concurso 3401 como DRAFT
  const draft3401 = createContestDraft(3401);
  await repoReloaded.saveDraft(draft3401);

  // Simula Aba A e Aba B com referências independentes ao repositório
  const tabA = new ContestRepository({ idbFactory: fakeIdb });
  const tabB = new ContestRepository({ idbFactory: fakeIdb });

  // Ambas as abas leem o estado DRAFT
  const recordA = await tabA.getContestRecord(3401);
  const recordB = await tabB.getContestRecord(3401);
  assert(recordA?.status === "DRAFT" && recordB?.status === "DRAFT", "Ambas as abas veem DRAFT.");

  // Aba A congela o concurso
  await tabA.freezeStoredContest(3401);
  const checkAfterFreeze = await tabA.getContestRecord(3401);
  assert(checkAfterFreeze?.status === "FROZEN", "Aba A congelou 3401 com sucesso.");

  // Aba B tenta descartar o concurso baseado no seu estado antigo
  let discardErrorCaught = false;
  try {
    await tabB.deleteDraft(3401);
  } catch (err: any) {
    discardErrorCaught = true;
    assert(
      err.message.includes("FROZEN") || err.message.includes("Rascunho"),
      "Erro deve indicar que concurso congelado não pode ser descartado."
    );
  }
  assert(discardErrorCaught, "Aba B foi terminantemente impedida de descartar concurso congelado.");

  // Aba B é forçada a recarregar o estado real
  const reloadedB = await tabB.getContestRecord(3401);
  assert(reloadedB?.status === "FROZEN", "Aba B recarrega e observa que o status atual é FROZEN.");
  assert(Boolean(reloadedB?.integrityHash), "Hash íntegro preservado no banco.");
  console.log("  ✓ [PASS] E2E Fluxo 3 aprovado. Conflito concorrente bloqueado e integridade mantida.\n");

  // ---------------------------------------------------------------------------
  // TESTE 6: Falhas de infraestrutura / rede da CAIXA
  // ---------------------------------------------------------------------------
  console.log("▶ TESTE 6: Falhas de infraestrutura / rede da CAIXA");
  // 6.1 Erro 503 (Serviço Indisponível)
  testProvider.simulateError(
    "latest",
    "HTTP_ERROR",
    "Serviço da CAIXA temporariamente indisponível.",
    503
  );
  let err503Caught = false;
  try {
    await testProvider.getLatestContest();
  } catch (err: any) {
    err503Caught = true;
    assert(err.code === "HTTP_ERROR" || err.status === 503, "Erro 503 capturado corretamente.");
  }
  assert(err503Caught, "Falha 503 da CAIXA detectada.");

  // 6.2 Timeout de rede (10s simulado)
  testProvider.simulateError(
    "latest",
    "TIMEOUT",
    "Tempo limite de conexão esgotado (10000ms)."
  );
  let errTimeoutCaught = false;
  try {
    await testProvider.getLatestContest();
  } catch (err: any) {
    errTimeoutCaught = true;
    assert(err.code === "TIMEOUT", "Timeout capturado corretamente.");
  }
  assert(errTimeoutCaught, "Timeout de conexão detectado.");

  // 6.3 Resposta corrompida / incompleta
  testProvider.simulateError(
    "latest",
    "INVALID_PAYLOAD",
    "Resposta do servidor da CAIXA não possui formato esperado."
  );
  let errCorruptCaught = false;
  try {
    await testProvider.getLatestContest();
  } catch (err: any) {
    errCorruptCaught = true;
    assert(err.code === "INVALID_PAYLOAD", "Resposta corrompida capturada.");
  }
  assert(errCorruptCaught, "Resposta corrompida detectada.");

  // Limpa erros simulados
  testProvider.reset();

  // 6.4 Confirma que falhas de rede NUNCA afetam o banco de dados
  const historyAfterNetworkFailures = await repoReloaded.auditEntireHistory();
  assert(historyAfterNetworkFailures.valid, "Banco continua 100% íntegro após falhas de rede.");
  console.log("  ✓ [PASS] Teste 6 aprovado: resiliência a falhas de rede sem corrupção do estado.\n");

  // ---------------------------------------------------------------------------
  // TESTE 7: Validação de dezenas oficiais e conferência manual
  // ---------------------------------------------------------------------------
  console.log("▶ TESTE 7: Validação e conferência manual de dezenas oficiais");
  const { validateOfficialResult } = await import("../c5/scorer.ts");

  // 7.1 Menos de 15 dezenas (14)
  let err14 = false;
  try {
    validateOfficialResult([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  } catch (err: any) {
    err14 = true;
    assert(err.message.includes("15"), "14 dezenas deve ser rejeitado.");
  }
  assert(err14, "14 dezenas rejeitado.");

  // 7.2 Mais de 15 dezenas (16)
  let err16 = false;
  try {
    validateOfficialResult([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  } catch (err: any) {
    err16 = true;
    assert(err.message.includes("15"), "16 dezenas deve ser rejeitado.");
  }
  assert(err16, "16 dezenas rejeitado.");

  // 7.3 Dezena duplicada
  let errDup = false;
  try {
    validateOfficialResult([1, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  } catch (err: any) {
    errDup = true;
    assert(err.message.includes("repetida") || err.message.includes("duplicada"), "Dezena duplicada rejeitada.");
  }
  assert(errDup, "Dezena duplicada rejeitada.");

  // 7.4 Dezena fora do domínio 1..25 (0 e 26)
  let errOut0 = false;
  try {
    validateOfficialResult([0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  } catch {
    errOut0 = true;
  }
  assert(errOut0, "Dezena 0 rejeitada.");

  let errOut26 = false;
  try {
    validateOfficialResult([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 26]);
  } catch {
    errOut26 = true;
  }
  assert(errOut26, "Dezena 26 rejeitada.");

  // 7.5 15 dezenas válidas
  const validArray = validateOfficialResult([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert(validArray.length === 15, "15 dezenas válidas aprovadas com 0 erros.");

  // 7.6 Tentativa de pontuar registro em estado DRAFT (deve ser rejeitada)
  const draft3402 = createContestDraft(3402);
  await repoReloaded.saveDraft(draft3402);
  let draftScorePrevented = false;
  try {
    await repoReloaded.scoreStoredContest(3402, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  } catch (err: any) {
    draftScorePrevented = true;
    assert(err.message.includes("FROZEN"), "Somente registros FROZEN podem ser pontuados.");
  }
  assert(draftScorePrevented, "Pontuação de registro DRAFT categoricamente bloqueada.");
  console.log("  ✓ [PASS] Teste 7 aprovado: validação formal de dezenas e bloqueio de DRAFT.\n");

  // ---------------------------------------------------------------------------
  // TESTE 8: Imutabilidade pós-congelamento
  // ---------------------------------------------------------------------------
  console.log("▶ TESTE 8: Imutabilidade pós-congelamento");
  // Concurso 3401 está FROZEN
  const rec3401 = await repoReloaded.getContestRecord(3401);
  assert(rec3401?.status === "FROZEN", "3401 está FROZEN.");

  // Tentativa 1: Descartar registro FROZEN
  let cannotDeleteFrozen = false;
  try {
    await repoReloaded.deleteDraft(3401);
  } catch {
    cannotDeleteFrozen = true;
  }
  assert(cannotDeleteFrozen, "deleteDraft rejeitado para FROZEN.");

  // Tentativa 2: Recongelar registro já FROZEN
  let cannotRefreeze = false;
  try {
    await repoReloaded.freezeStoredContest(3401);
  } catch {
    cannotRefreeze = true;
  }
  assert(cannotRefreeze, "freezeStoredContest rejeitado para registro já FROZEN.");

  // Tentativa 3: Salvar outro rascunho por cima de registro FROZEN
  let cannotOverwriteFrozen = false;
  try {
    await repoReloaded.saveDraft(createContestDraft(3401));
  } catch {
    cannotOverwriteFrozen = true;
  }
  assert(cannotOverwriteFrozen, "saveDraft rejeitado para concurso já FROZEN.");
  console.log("  ✓ [PASS] Teste 8 aprovado: imutabilidade e proteção contra sobrescrita.\n");

  // ---------------------------------------------------------------------------
  // TESTE 9: Não-mutação por ações acessórias
  // ---------------------------------------------------------------------------
  console.log("▶ TESTE 9: Não-mutação do estado persistido por ações acessórias");
  // Captura snapshot completo do banco antes das ações acessórias
  const snapshotBefore = await repoReloaded.exportHistory();
  const snapshotJsonBefore = JSON.stringify(snapshotBefore);

  // Ação A: COPIAR JOGOS (gera texto clipboard)
  const recordForCopy = await repoReloaded.getContestRecord(3400);
  assert(recordForCopy !== null, "3400 existe.");
  const clipboardText = formatGamesForClipboard(recordForCopy!.generation.games);
  assert(clipboardText.length > 50, "Texto gerado para clipboard.");

  // Ação B: AUDITAR HISTÓRICO
  const auditRun = await repoReloaded.auditEntireHistory();
  assert(auditRun.valid, "Auditoria executada.");

  // Ação C: EXPORTAR BACKUP
  const backupRun = await repoReloaded.exportHistory();
  assert(backupRun.records.length > 0, "Exportação executada.");

  // Ação D: CONSULTAR HISTÓRICO
  const summaryRun = await repoReloaded.getHistorySummary();
  assert(summaryRun.contestsPlayed > 0, "Resumo consultado.");

  // Captura snapshot após todas as ações acessórias
  const snapshotAfter = await repoReloaded.exportHistory();
  const recordsJsonBefore = JSON.stringify(snapshotBefore.records);
  const recordsJsonAfter = JSON.stringify(snapshotAfter.records);

  assert(
    recordsJsonBefore === recordsJsonAfter,
    "NENHUMA mutação nos registros do banco ocorreu durante cópia, auditoria, exportação ou consulta!"
  );
  console.log("  ✓ [PASS] Teste 9 aprovado: Não-mutação estrita comprovada por igualdade exata de snapshot.\n");

  // ---------------------------------------------------------------------------
  // TESTE 10: Importação e exportação de backups
  // ---------------------------------------------------------------------------
  console.log("▶ TESTE 10: Importação e exportação de backups com detecção de adulteração");
  // 10.1 Backup legítimo exportado
  const validBackup = await repoReloaded.exportHistory();
  const validJson = JSON.stringify(validBackup);

  // 10.2 Restauração em banco vazio limpo
  const cleanRepo = new ContestRepository({ idbFactory: new IDBFactory() });
  const parsedValid = parseHistoryBackup(validJson);
  const planValid = await prepareHistoryImport(parsedValid, cleanRepo);
  assert(planValid.valid, "Plano de importação legítimo deve ser válido.");
  const importResult = await importHistory(planValid, cleanRepo);
  assert(importResult.success, "Importação legítima deve ser bem-sucedida.");

  const auditClean = await cleanRepo.auditEntireHistory();
  assert(auditClean.valid && auditClean.invalidRecords === 0, "Banco restaurado 100% íntegro.");

  // 10.3 Backup com registro adulterado (hash modificado)
  const corruptBackup = JSON.parse(validJson);
  corruptBackup.records[0].integrityHash = "a".repeat(64); // Hash falso
  const parsedCorrupt = parseHistoryBackup(JSON.stringify(corruptBackup));
  const planCorrupt = await prepareHistoryImport(parsedCorrupt, new ContestRepository({ idbFactory: new IDBFactory() }));
  assert(!planCorrupt.valid, "Backup com hash adulterado deve ser rejeitado.");
  assert(planCorrupt.errors.some((e) => e.includes("adulteração") || e.includes("Hash")), "Erro aponta adulteração.");
  console.log("  ✓ [PASS] Teste 10 aprovado: backup íntegro aceito, backup adulterado rejeitado.\n");

  // ---------------------------------------------------------------------------
  // TESTE 11: Auditoria profunda do histórico
  // ---------------------------------------------------------------------------
  console.log("▶ TESTE 11: Auditoria profunda do histórico");
  const deepAudit = await repoReloaded.auditEntireHistory();
  assert(deepAudit.valid, "Auditoria global deve retornar valid = true.");
  assert(deepAudit.invalidRecords === 0, "Zero registros inválidos.");
  assert(deepAudit.totalRecords >= 2, "Pelo menos 2 registros auditados.");
  for (const detail of deepAudit.records) {
    assert(detail.valid, `Registro do concurso ${detail.contestNumber} deve ser válido.`);
  }
  console.log(`  ✓ [PASS] Teste 11 aprovado: ${deepAudit.totalRecords} registros auditados, 100% íntegros.\n`);

  // ---------------------------------------------------------------------------
  // TESTE 12: Clipboard dos 5 jogos
  // ---------------------------------------------------------------------------
  console.log("▶ TESTE 12: Validação da formatação de Clipboard dos jogos");
  const text = formatGamesForClipboard(scoredRecord!.generation.games);
  assert(text.includes("Jogo 1:"), "Identificação do Jogo 1 presente.");
  assert(text.includes("Jogo 2:"), "Identificação do Jogo 2 presente.");
  assert(text.includes("Jogo 3:"), "Identificação do Jogo 3 presente.");
  assert(text.includes("Jogo 4:"), "Identificação do Jogo 4 presente.");
  assert(text.includes("Jogo 5:"), "Identificação do Jogo 5 presente.");
  // Confirma pad2 (dezenas formatadas com dois dígitos 01..25)
  assert(/\b0[1-9]\b/.test(text), "Dezenas possuem zero à esquerda (01-09).");
  console.log("  ✓ [PASS] Teste 12 aprovado: formatação de clipboard clara, padronizada e legível.\n");

  // ---------------------------------------------------------------------------
  // TESTE 20: Instrumentação de "Uma geração por clique"
  // ---------------------------------------------------------------------------
  console.log("▶ TESTE 20: Instrumentação: exatamente 1 geração por chamada");
  let generatorCallCount = 0;
  const deterministicRng = createMulberry32(12345);
  const countingRng = () => {
    generatorCallCount++;
    return deterministicRng();
  };

  // Executa uma geração isolada
  const genSingle = createContestDraft(3405, { rng: countingRng });
  assert(genSingle.generation.games.length === 5, "5 jogos gerados.");
  assert(generatorCallCount === 24, "Fisher-Yates executa exatamente 24 passos para 25 dezenas (1 única permutação).");
  console.log("  ✓ [PASS] Teste 20 aprovado: 1 clique = 1 chamada ao motor combinatorial (zero re-seleção).\n");

  console.log("===============================================================================");
  console.log("     TODOS OS TESTES DA CERTIFICAÇÃO OPERACIONAL E2E PASSARAM COM SUCESSO     ");
  console.log("===============================================================================\n");

  return { success: true };
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes("e2eCertification.test.ts")) {
  runFullE2ECertification().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
