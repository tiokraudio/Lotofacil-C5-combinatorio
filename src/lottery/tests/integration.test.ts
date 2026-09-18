/**
 * Testes de Integração da Camada de Consulta Externa (Prompt 07)
 * Cenários A a G + Teste de Segurança e Privacidade
 */
import "fake-indexeddb/auto";
import { ContestRepository } from "../../storage/contestRepository.ts";
import { createContestDraft } from "../../c5/index.ts";
import { FakeLotteryResultProvider } from "../fakeProvider.ts";
import { OfficialContestResult, LotteryFetchError } from "../types.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runIntegrationTests(): Promise<void> {
  console.log("=== INICIANDO TESTES DE INTEGRAÇÃO DA CONSULTA EXTERNA (INTEGRATION.TEST) ===");

  const repo = new ContestRepository({ idbFactory: new IDBFactory() });
  const provider = new FakeLotteryResultProvider();

  const validNumbers3782 = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 22, 23, 24, 25];

  // =========================================================================
  // CENÁRIO A: Sugestão de Concurso
  // Provider retorna último: 3781 -> Sugestão: 3782 -> Nenhum DRAFT criado no banco
  // =========================================================================
  console.log("A. Testando sugestão de concurso...");
  provider.setLatestContest({
    contestNumber: 3781,
    drawDate: "16/09/2026",
    numbers: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 21, 22, 23, 24, 25],
    source: "CAIXA",
    fetchedAt: new Date().toISOString(),
  });

  const latest = await provider.getLatestContest();
  const suggestedNext = latest.contestNumber + 1;
  assert(suggestedNext === 3782, "A. Próximo concurso sugerido deve ser 3782.");

  // Garante que nenhum registro foi persistido no banco de dados pela mera consulta
  const draftCheck = await repo.getContestRecord(3782);
  assert(draftCheck === null, "A. Nenhum DRAFT deve ser criado automaticamente no banco.");
  const allRecordsA = await repo.getAllContestRecords();
  assert(allRecordsA.length === 0, "A. Banco permanece vazio após consulta do último concurso.");
  console.log("  ✓ [PASS] A. Sugestão 3782 gerada sem persistência automática de DRAFT.");

  // =========================================================================
  // CENÁRIO B: Resultado Válido e Pontuação Confirmada
  // Registro 3782 em estado FROZEN -> Consulta resultado 3782 -> Preview -> Confirmação -> SCORED
  // =========================================================================
  console.log("B. Testando fluxo de resultado válido e pontuação confirmada...");
  // 1. Cria e congela concurso 3782
  const draft3782 = createContestDraft(3782);
  await repo.saveDraft(draft3782);
  const frozen3782 = await repo.freezeStoredContest(3782);
  assert(frozen3782.status === "FROZEN", "B. Concurso 3782 congelado.");
  const originalHash = frozen3782.integrityHash;

  // 2. Configura resposta do provider
  provider.setContestResult(3782, {
    contestNumber: 3782,
    drawDate: "17/09/2026",
    numbers: validNumbers3782,
    source: "CAIXA",
    fetchedAt: new Date().toISOString(),
  });

  // 3. Consulta (simulando a ação "BUSCAR RESULTADO OFICIAL")
  const fetchedResult = await provider.getContest(3782);
  assert(fetchedResult.contestNumber === 3782, "B. Resultado obtido para o concurso correto.");

  // 4. Antes da confirmação: status DEVE permanecer FROZEN
  const checkBeforeConfirm = await repo.getContestRecord(3782);
  assert(checkBeforeConfirm?.status === "FROZEN", "B. Antes da confirmação status deve permanecer FROZEN.");
  assert(checkBeforeConfirm?.score === undefined, "B. Antes da confirmação não possui pontuação.");
  assert(checkBeforeConfirm?.integrityHash === originalHash, "B. Hash inalterado antes da confirmação.");

  // 5. Confirmação pelo usuário: chama scoreStoredContest
  const scored3782 = await repo.scoreStoredContest(3782, fetchedResult.numbers);
  assert(scored3782.status === "SCORED", "B. Após confirmação status transiciona para SCORED.");
  assert(scored3782.score !== undefined, "B. Pontuação calculada.");
  assert(scored3782.integrityHash === originalHash, "B. Hash de integridade rigorosamente preservado.");

  // 6. Auditorias passam
  const auditB = await repo.auditEntireHistory();
  assert(auditB.valid && auditB.totalRecords === 1, "B. Auditoria global do histórico íntegra.");
  console.log("  ✓ [PASS] B. Resultado válido aplicado somente após confirmação, mantendo hash e integridade.");

  // =========================================================================
  // CENÁRIO C: Cancelar Preview
  // Registro permanece FROZEN intacto
  // =========================================================================
  console.log("C. Testando cancelamento de preview...");
  const draft3783 = createContestDraft(3783);
  await repo.saveDraft(draft3783);
  await repo.freezeStoredContest(3783);

  provider.setContestResult(3783, {
    contestNumber: 3783,
    drawDate: "18/09/2026",
    numbers: validNumbers3782,
    source: "CAIXA",
    fetchedAt: new Date().toISOString(),
  });

  // Usuário busca resultado (preview montado)
  const previewData = await provider.getContest(3783);
  assert(previewData.contestNumber === 3783, "C. Preview montado.");

  // Usuário cancela o preview (nenhuma chamada a scoreStoredContest)
  const afterCancel = await repo.getContestRecord(3783);
  assert(afterCancel?.status === "FROZEN", "C. Registro permanece FROZEN.");
  assert(afterCancel?.score === undefined, "C. Sem pontuação.");
  console.log("  ✓ [PASS] C. Cancelar preview não altera o registro congelado.");

  // =========================================================================
  // CENÁRIO D: Proteção Contra Concurso Divergente
  // Solicitado 3784, provider retorna 3785 -> Pontuação recusada
  // =========================================================================
  console.log("D. Testando proteção contra concurso divergente...");
  const draft3784 = createContestDraft(3784);
  await repo.saveDraft(draft3784);
  await repo.freezeStoredContest(3784);

  // Provider com dados de outro concurso (3785)
  provider.setRawPayload(3784, {
    numero: 3785, // DIVERGENTE!
    dataApuracao: "19/09/2026",
    listaDezenas: validNumbers3782.map(String),
  });

  let mismatchCaught = false;
  try {
    await provider.getContest(3784);
  } catch (err: any) {
    mismatchCaught = true;
    assert(err instanceof LotteryFetchError, "D. Deve lançar LotteryFetchError.");
    assert(err.code === "CONTEST_MISMATCH", "D. Código CONTEST_MISMATCH.");
    assert(err.message.includes("Divergência de concurso"), "D. Mensagem explicativa.");
  }
  assert(mismatchCaught, "D. Divergência bloqueada com exceção.");

  const afterMismatch = await repo.getContestRecord(3784);
  assert(afterMismatch?.status === "FROZEN", "D. Concurso 3784 permanece FROZEN sem alteração.");
  console.log("  ✓ [PASS] D. Concurso divergente bloqueado sem pontuar.");

  // =========================================================================
  // CENÁRIO E: Payload Inválido da Fonte
  // Nenhuma persistência
  // =========================================================================
  console.log("E. Testando payload inválido da fonte externa...");
  provider.setRawPayload(3784, {
    numero: 3784,
    dataApuracao: "19/09/2026",
    listaDezenas: ["01", "02"], // Apenas 2 dezenas!
  });

  let invalidCaught = false;
  try {
    await provider.getContest(3784);
  } catch (err: any) {
    invalidCaught = true;
    assert(err instanceof LotteryFetchError, "E. Deve lançar LotteryFetchError.");
    assert(err.code === "INVALID_PAYLOAD", "E. Código INVALID_PAYLOAD.");
  }
  assert(invalidCaught, "E. Payload inválido rejeitado.");

  const afterInvalid = await repo.getContestRecord(3784);
  assert(afterInvalid?.status === "FROZEN", "E. Nenhuma persistência após payload inválido.");
  console.log("  ✓ [PASS] E. Payload inválido rejeitado sem afetar o banco.");

  // =========================================================================
  // CENÁRIO F: Timeout da Requisição
  // Nenhuma persistência
  // =========================================================================
  console.log("F. Testando timeout na consulta externa...");
  provider.simulateError(3784, "TIMEOUT", "Tempo limite da consulta excedido (10s).");

  let timeoutCaught = false;
  try {
    await provider.getContest(3784);
  } catch (err: any) {
    timeoutCaught = true;
    assert(err.code === "TIMEOUT", "F. Código TIMEOUT.");
  }
  assert(timeoutCaught, "F. Timeout capturado.");

  const afterTimeout = await repo.getContestRecord(3784);
  assert(afterTimeout?.status === "FROZEN", "F. Nenhuma alteração após timeout.");
  console.log("  ✓ [PASS] F. Timeout tratado sem efeitos colaterais na persistência.");

  // =========================================================================
  // CENÁRIO G: Entrada Manual de Resultado Permanece Intacta
  // Continua pontuando pelo mesmo scoreStoredContest()
  // =========================================================================
  console.log("G. Testando via de fallback manual...");
  const draft3785 = createContestDraft(3785);
  await repo.saveDraft(draft3785);
  await repo.freezeStoredContest(3785);

  const manualNumbers = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 21, 22, 23, 24, 25];
  const scoredManual = await repo.scoreStoredContest(3785, manualNumbers);
  assert(scoredManual.status === "SCORED", "G. Concurso pontuado manualmente com sucesso.");
  assert(scoredManual.score?.maxHits !== undefined, "G. Pontuação manual calculada.");
  console.log("  ✓ [PASS] G. Fallback manual permanece plenamente funcional.");

  // =========================================================================
  // SEGURANÇA E PRIVACIDADE:
  // Inspeciona as chamadas realizadas para garantir que NENHUM dado sensível
  // (jogos, hash, permutações, histórico) foi enviado para a fonte externa
  // =========================================================================
  console.log("H. Testando privacidade e isolamento dos parâmetros de consulta...");
  assert(provider.calls.length > 0, "H. Houve chamadas registradas.");
  for (const call of provider.calls) {
    // Verifica que o único parâmetro passado ao provider foi contestNumber (número inteiro)
    if (call.method === "getContest") {
      assert(typeof call.contestNumber === "number", "H. Apenas contestNumber é enviado.");
      assert(Number.isInteger(call.contestNumber), "H. contestNumber é inteiro.");
    }
    // Confirma que não existem propriedades de jogos vazando
    assert(!("games" in call), "H. Nenhum 'games' enviado.");
    assert(!("hash" in call), "H. Nenhum 'hash' enviado.");
    assert(!("permutation" in call), "H. Nenhuma 'permutation' enviada.");
    assert(!("slotAssignments" in call), "H. Nenhum 'slotAssignments' enviado.");
  }
  console.log("  ✓ [PASS] H. Isolamento estrito de privacidade comprovado (zero telemetria de apostas).");

  console.log("=== TODOS OS TESTES DE INTEGRAÇÃO DA CONSULTA EXTERNA PASSARAM COM SUCESSO ===");
}

runIntegrationTests().catch((err) => {
  console.error("Erro fatal nos testes de integração:", err);
  process.exit(1);
});
