import { IDBFactory } from "fake-indexeddb";
import { ContestRepository } from "../storage/contestRepository.ts";
import { createContestDraft } from "../c5/index.ts";
import { COST_PER_CONTEST } from "../storage/types.ts";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FALHA NO TESTE DE UI/FLUXO: ${message}`);
  }
}

async function runUITests() {
  console.log("=== INICIANDO TESTES DO FLUXO DE OPERAÇÃO DA UI (UI.TEST) ===");
  const fakeIdb = new IDBFactory();
  const repo = new ContestRepository({ idbFactory: fakeIdb });

  // 1. Fluxo Novo Concurso -> Gerar C5 (DRAFT)
  console.log("1. Testando geração de novo concurso na UI (DRAFT)...");
  const draft3400 = createContestDraft(3400);
  await repo.saveDraft(draft3400);

  const loadedDraft = await repo.getContestRecord(3400);
  assert(loadedDraft !== null, "Concurso 3400 deve existir no banco.");
  assert(loadedDraft?.status === "DRAFT", "Status inicial deve ser DRAFT.");
  assert(loadedDraft?.generation.games.length === 5, "Devem ser 5 jogos.");
  assert(!loadedDraft?.integrityHash, "DRAFT não deve possuir hash de integridade.");
  console.log("  ✓ [PASS] Concurso 3400 criado como DRAFT com 5 jogos.");

  // 2. Proteção contra duplicidade no formulário da UI
  console.log("2. Testando proteção contra substituição de concurso existente...");
  const checkExisting = await repo.getContestRecord(3400);
  assert(checkExisting !== null, "Deve detectar que o concurso 3400 já existe.");
  // Garantir que a UI não sobrescreve
  let duplicatePrevented = false;
  try {
    await repo.saveDraft(createContestDraft(3400));
  } catch {
    duplicatePrevented = true;
  }
  assert(duplicatePrevented, "Tentativa de sobrescrever 3400 deve ser impedida.");
  console.log("  ✓ [PASS] Concurso existente preservado contra sobrescrita.");

  // 3. Descarte de rascunho
  console.log("3. Testando descarte de rascunho...");
  const draftTemp = createContestDraft(3401);
  await repo.saveDraft(draftTemp);
  assert((await repo.getContestRecord(3401)) !== null, "3401 criado.");
  await repo.deleteDraft(3401);
  assert((await repo.getContestRecord(3401)) === null, "3401 descartado com sucesso.");
  console.log("  ✓ [PASS] Descarte de rascunho executado com sucesso.");

  // 4. Congelar Jogos (FROZEN)
  console.log("4. Testando congelamento de jogos...");
  await repo.freezeStoredContest(3400);
  const frozenRecord = await repo.getContestRecord(3400);
  assert(frozenRecord?.status === "FROZEN", "Status deve transicionar para FROZEN.");
  assert(Boolean(frozenRecord?.integrityHash), "Hash SHA-256 deve ser gerado no congelamento.");
  assert(Boolean(frozenRecord?.frozenAt), "frozenAt deve ser preenchido.");

  // Tentativa de excluir concurso congelado deve falhar
  let freezeDeletePrevented = false;
  try {
    await repo.deleteDraft(3400);
  } catch {
    freezeDeletePrevented = true;
  }
  assert(freezeDeletePrevented, "Exclusão de concurso FROZEN deve ser terminantemente rejeitada.");
  console.log("  ✓ [PASS] Concurso congelado com SHA-256 e imutável.");

  // 5. Registrar e Pontuar Resultado Oficial (SCORED)
  console.log("5. Testando conferência do resultado oficial na UI...");
  // Resultado oficial de exemplo (15 dezenas ordenadas)
  const officialResult = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  await repo.scoreStoredContest(3400, officialResult);

  const scoredRecord = await repo.getContestRecord(3400);
  assert(scoredRecord?.status === "SCORED", "Status deve transicionar para SCORED.");
  assert(scoredRecord?.score !== undefined, "Objeto score deve estar presente.");
  assert(scoredRecord?.score?.result.length === 15, "Resultado oficial deve ter 15 dezenas.");
  assert(scoredRecord?.score?.games.length === 5, "5 jogos devem estar pontuados.");
  assert(typeof scoredRecord?.score?.maxHits === "number", "maxHits deve ser calculado.");
  console.log(`  ✓ [PASS] Concurso pontuado com sucesso. maxHits = ${scoredRecord?.score?.maxHits}.`);

  // 6. Auditoria Individual e Integridade
  console.log("6. Testando auditoria individual e de todo o histórico...");
  const singleVerification = await repo.verifyStoredContest(3400);
  assert(singleVerification.valid, "Concurso 3400 deve ser 100% íntegro.");
  assert(singleVerification.generationIntegrity?.hashMatches === true, "Hash SHA-256 da geração deve bater.");
  assert(singleVerification.scoreIntegrity?.scoreMatches === true, "Pontuação oficial deve bater.");

  const globalAudit = await repo.auditEntireHistory();
  assert(globalAudit.valid, "Auditoria de todo o histórico deve ser válida.");
  assert(globalAudit.totalRecords >= 1, "Pelo menos 1 registro auditado.");
  assert(globalAudit.invalidRecords === 0, "Zero registros inválidos.");
  console.log("  ✓ [PASS] Auditoria global e individual 100% aprovada.");

  // 7. Métricas do Histórico
  console.log("7. Testando cálculo das métricas acumuladas do histórico...");
  const summary = await repo.getHistorySummary();
  assert(summary.contestsPlayed === 1, "Exatamente 1 concurso jogado.");
  assert(summary.totalSpent === COST_PER_CONTEST, `Custo correspondente deve ser ${COST_PER_CONTEST}.`);
  assert(summary.bestMaxHits === scoredRecord?.score?.maxHits, "bestMaxHits coincide com o melhor jogo.");
  console.log("  ✓ [PASS] Resumo estatístico do histórico validado.");

  // 8. Exportação de Backup
  console.log("8. Testando exportação de backup...");
  const backup = await repo.exportHistory();
  assert(backup.schemaVersion === 1, "Versão do schema deve ser 1.");
  assert(backup.records.length === 1, "Backup deve conter o registro 3400.");
  assert(backup.records[0].contestNumber === 3400, "Concurso 3400 no backup.");
  assert(backup.records[0].integrityHash === scoredRecord?.integrityHash, "Hash idêntico no backup.");
  console.log("  ✓ [PASS] Exportação de backup aprovada.");

  // 9. Importação de Backup
  console.log("9. Testando ciclo completo de importação na UI...");
  const repoB = new ContestRepository({ idbFactory: new IDBFactory() });
  const jsonStr = JSON.stringify(backup);
  const { parseHistoryBackup, prepareHistoryImport, importHistory } = await import("../storage/import.ts");
  const parsed = parseHistoryBackup(jsonStr);
  const plan = await prepareHistoryImport(parsed, repoB);
  assert(plan.valid && plan.newRecords === 1 && plan.conflicts === 0, "Prévia de importação limpa sem conflitos.");
  const importResult = await importHistory(plan, repoB);
  assert(importResult.success && importResult.importedCount === 1, "Importação atômica realizada.");
  const auditB = await repoB.auditEntireHistory();
  assert(auditB.valid && auditB.totalRecords === 1, "Auditoria do banco importado 100% íntegra.");
  console.log("  ✓ [PASS] Importação de backup aprovada.");

  // 10. Consulta Externa de Concurso e Resultado Oficial
  console.log("10. Testando fluxo de consulta externa de concurso e resultado oficial na UI...");
  const { FakeLotteryResultProvider, setLotteryProvider } = await import("../lottery/index.ts");
  const testProvider = new FakeLotteryResultProvider();
  setLotteryProvider(testProvider);

  // 10.1 Descoberta do próximo concurso
  testProvider.setLatestContest({
    contestNumber: 3405,
    drawDate: "16/09/2026",
    numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    source: "CAIXA",
    fetchedAt: new Date().toISOString(),
  });
  const latestInfo = await testProvider.getLatestContest();
  assert(latestInfo.contestNumber === 3405, "Último concurso obtido.");
  const suggestedContest = latestInfo.contestNumber + 1;
  assert(suggestedContest === 3406, "Próximo concurso sugerido é 3406.");
  // Garante que NENHUM DRAFT foi gravado automaticamente
  assert((await repo.getContestRecord(3406)) === null, "Nenhum DRAFT gravado automaticamente ao consultar.");

  // 10.2 Gera e congela concurso 3406
  const draft3406 = createContestDraft(3406);
  await repo.saveDraft(draft3406);
  await repo.freezeStoredContest(3406);
  const frozen3406 = await repo.getContestRecord(3406);
  assert(frozen3406?.status === "FROZEN", "3406 em estado FROZEN.");

  // 10.3 Consulta resultado oficial com prévia
  testProvider.setContestResult(3406, {
    contestNumber: 3406,
    drawDate: "17/09/2026",
    numbers: [2, 3, 5, 7, 11, 13, 17, 19, 21, 22, 23, 24, 25, 1, 4],
    source: "CAIXA",
    fetchedAt: new Date().toISOString(),
  });
  const preview = await testProvider.getContest(3406);
  assert(preview.contestNumber === 3406, "Prévia com concurso correto.");
  // Antes da confirmação explícita, o status continua FROZEN
  const beforeConfirm = await repo.getContestRecord(3406);
  assert(beforeConfirm?.status === "FROZEN", "Registro permanece FROZEN antes da confirmação.");

  // 10.4 Usuário confirma a prévia: pontua
  await repo.scoreStoredContest(3406, preview.numbers);
  const scored3406 = await repo.getContestRecord(3406);
  assert(scored3406?.status === "SCORED", "Registro transiciona para SCORED após confirmação.");
  assert(scored3406?.score !== undefined, "Score devidamente persistido.");
  console.log("  ✓ [PASS] Fluxo de consulta externa e prévia de resultado oficial aprovado.");

  console.log("=== TODOS OS TESTES DO FLUXO DE OPERAÇÃO DA UI PASSARAM COM SUCESSO ===");
}

runUITests().catch((err) => {
  console.error("ERRO NO TESTE DE UI:", err);
  process.exit(1);
});
