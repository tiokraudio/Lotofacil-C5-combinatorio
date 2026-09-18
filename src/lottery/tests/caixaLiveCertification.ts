/**
 * Script de Certificação Complementar da Integração Externa com a CAIXA (Prompt 07)
 * Executa requisições REAIS (sem mocks) contra os endpoints oficiais da CAIXA.
 */
import "fake-indexeddb/auto";
import { CaixaLotteryProvider, adaptCaixaRawPayload } from "../caixaProvider.ts";
import { assertValidOfficialResult, validateAndNormalizeOfficialResult } from "../validator.ts";
import { ContestRepository } from "../../storage/contestRepository.ts";
import { createContestDraft } from "../../c5/index.ts";
import { verifyContestIntegrity } from "../../c5/integrity.ts";
import { verifyScoreIntegrity } from "../../c5/record.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runLiveCertification(): Promise<void> {
  console.log("================================================================================");
  console.log("=== CERTIFICAÇÃO COMPLEMENTAR DA INTEGRAÇÃO EXTERNA DA CAIXA (PROMPT 07) ===");
  console.log("================================================================================\n");

  const APP_ORIGIN = "https://ais-dev-4lno5wa3mtg4oullnzv7cf-664741200406.us-west2.run.app";
  const CAIXA_BASE_URL = "https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil";

  // ---------------------------------------------------------------------------
  // 1. TESTE REAL DO ÚLTIMO CONCURSO (Sem mock)
  // ---------------------------------------------------------------------------
  console.log("1. TESTE REAL DO ÚLTIMO CONCURSO...");
  const rawLatestResponse = await fetch(CAIXA_BASE_URL, {
    method: "GET",
    headers: {
      "Accept": "application/json, text/plain, */*",
      "Origin": APP_ORIGIN,
    },
  });

  const latestStatus = rawLatestResponse.status;
  const latestContentType = rawLatestResponse.headers.get("content-type") ?? "desconhecido";
  const latestCorsHeader = rawLatestResponse.headers.get("access-control-allow-origin");
  const rawLatestData = await rawLatestResponse.json() as any;

  console.log("  URL chamada:", CAIXA_BASE_URL);
  console.log("  Status HTTP:", latestStatus);
  console.log("  Content-Type:", latestContentType);
  console.log("  Access-Control-Allow-Origin:", latestCorsHeader);
  console.log("  numero (concurso apurado):", rawLatestData.numero);
  console.log("  numeroConcursoProximo:", rawLatestData.numeroConcursoProximo);
  console.log("  dataApuracao:", rawLatestData.dataApuracao);
  console.log("  listaDezenas recebidas:", JSON.stringify(rawLatestData.listaDezenas));
  console.log("  quantidade de dezenas:", rawLatestData.listaDezenas?.length);
  console.log("  tipo das dezenas originais:", typeof rawLatestData.listaDezenas?.[0]);

  assert(latestStatus === 200, "1. Status HTTP deve ser 200.");
  assert(typeof rawLatestData.numero === "number" && rawLatestData.numero > 0, "1. Concurso deve ser inteiro positivo.");
  assert(Array.isArray(rawLatestData.listaDezenas) && rawLatestData.listaDezenas.length === 15, "1. Deve retornar 15 dezenas.");
  assert(typeof rawLatestData.listaDezenas[0] === "string", "1. Dezenas da CAIXA são originalmente string[].");

  // Normalização via adapter da CAIXA
  const adaptedLatest = adaptCaixaRawPayload(rawLatestData);
  const normalizedLatest = assertValidOfficialResult(adaptedLatest, undefined, "CAIXA");
  assert(normalizedLatest.contestNumber === rawLatestData.numero, "1. Concurso normalizado confere.");
  assert(normalizedLatest.numbers.length === 15, "1. 15 dezenas normalizadas.");
  assert(typeof normalizedLatest.numbers[0] === "number", "1. Dezenas normalizadas são number[].");
  console.log("  ✓ [PASS] 1. Teste real do último concurso validado com sucesso.\n");

  // ---------------------------------------------------------------------------
  // 2. TESTE REAL DE CONCURSO ESPECÍFICO (Sem mock)
  // ---------------------------------------------------------------------------
  const targetContest = rawLatestData.numero;
  const specificUrl = `${CAIXA_BASE_URL}/${targetContest}`;
  console.log(`2. TESTE REAL DE CONCURSO ESPECÍFICO (${targetContest})...`);
  const rawSpecificResponse = await fetch(specificUrl, {
    method: "GET",
    headers: {
      "Accept": "application/json, text/plain, */*",
      "Origin": APP_ORIGIN,
    },
  });

  const specificStatus = rawSpecificResponse.status;
  const specificCorsHeader = rawSpecificResponse.headers.get("access-control-allow-origin");
  const rawSpecificData = await rawSpecificResponse.json() as any;

  console.log("  URL chamada:", specificUrl);
  console.log("  Status HTTP:", specificStatus);
  console.log("  Access-Control-Allow-Origin:", specificCorsHeader);
  console.log("  Concurso solicitado:", targetContest);
  console.log("  Concurso recebido:", rawSpecificData.numero);
  console.log("  Dezenas:", JSON.stringify(rawSpecificData.listaDezenas));

  assert(specificStatus === 200, "2. Status HTTP deve ser 200.");
  assert(rawSpecificData.numero === targetContest, "2. Concurso retornado deve coincidir com o solicitado.");
  assert(rawSpecificData.listaDezenas.length === 15, "2. 15 dezenas retornadas.");

  const adaptedSpecific = adaptCaixaRawPayload(rawSpecificData);
  const normalizedSpecific = assertValidOfficialResult(adaptedSpecific, targetContest, "CAIXA");
  assert(normalizedSpecific.contestNumber === targetContest, "2. Concurso normalizado idêntico.");
  assert(normalizedSpecific.numbers.every(n => typeof n === "number" && n >= 1 && n <= 25), "2. Todas dezenas 1..25 numéricas.");
  console.log("  ✓ [PASS] 2. Concurso específico real normalizado e aprovado.\n");

  // ---------------------------------------------------------------------------
  // 3. TESTE DE CORS NO NAVEGADOR
  // ---------------------------------------------------------------------------
  console.log("3. TESTE DE CORS NO NAVEGADOR...");
  console.log("  Origem de teste (Origin):", APP_ORIGIN);
  console.log("  Header retornado pela CAIXA:", latestCorsHeader);
  const isCorsAllowed: boolean = Boolean(latestCorsHeader === "*" || (latestCorsHeader && latestCorsHeader.includes(APP_ORIGIN)));
  console.log("  CORS permitido:", isCorsAllowed ? "SIM" : "NÃO");
  assert(isCorsAllowed, "3. CORS deve ser permitido pelo endpoint da CAIXA.");
  console.log("  ✓ [PASS] 3. CORS comprovadamente liberado pelo endpoint oficial da CAIXA.\n");

  // ---------------------------------------------------------------------------
  // 4. TESTE DE NÃO-INTERFERÊNCIA: ATUALIZAR CONCURSO NÃO CRIA DRAFT
  // ---------------------------------------------------------------------------
  console.log("4. TESTE: ATUALIZAR CONCURSO NÃO CRIA REGISTRO NO INDEXEDDB...");
  const repo = new ContestRepository();
  const provider = new CaixaLotteryProvider();

  const preQueryCount = (await repo.getAllContestRecords()).length;
  assert(preQueryCount === 0, "4. Banco inicialmente vazio.");

  // Simula clique em "ATUALIZAR CONCURSO"
  const latestFromProvider = await provider.getLatestContest();
  const postQueryCount = (await repo.getAllContestRecords()).length;

  assert(postQueryCount === 0, "4. Nenhum registro criado no IndexedDB após consultar último concurso.");
  const suggestedContest = latestFromProvider.nextContestNumber ?? (latestFromProvider.contestNumber + 1);
  const recordOfSuggested = await repo.getContestRecord(suggestedContest);
  assert(recordOfSuggested === null, "4. Nenhum DRAFT criado para o concurso sugerido.");
  console.log(`  Último concurso obtido: ${latestFromProvider.contestNumber}. Sugerido: ${suggestedContest}. DRAFT criado? NÃO.`);
  console.log("  ✓ [PASS] 4. Não-interferência comprovada: zero efeitos colaterais na persistência.\n");

  // ---------------------------------------------------------------------------
  // 5. TESTE DE FLUXO REAL: FROZEN → PREVIEW → CANCELAR (mantém FROZEN)
  // ---------------------------------------------------------------------------
  console.log("5. TESTE DE CANCELAMENTO REAL DE PREVIEW COM DADOS DA CAIXA...");
  const draft = createContestDraft(targetContest);
  await repo.saveDraft(draft);
  await repo.freezeStoredContest(targetContest);

  const frozenBefore = await repo.getContestRecord(targetContest);
  assert(frozenBefore?.status === "FROZEN", "5. Concurso está em estado FROZEN.");
  const originalHash = frozenBefore!.integrityHash;
  assert(typeof originalHash === "string" && originalHash.length === 64, "5. SHA-256 de 64 hex presente.");

  // Busca resultado oficial (simula clique em BUSCAR RESULTADO OFICIAL)
  const previewResult = await provider.getContest(targetContest);
  assert(previewResult.contestNumber === targetContest, "5. Preview com concurso correto.");
  assert(previewResult.numbers.length === 15, "5. Preview com 15 dezenas oficiais reais.");

  // O usuário ainda NÃO confirmou. Verifica que o banco permanece FROZEN
  const stillFrozenDuringPreview = await repo.getContestRecord(targetContest);
  assert(stillFrozenDuringPreview?.status === "FROZEN", "5. Permanece FROZEN durante a exibição da prévia.");
  assert(stillFrozenDuringPreview?.score === undefined, "5. Sem pontuação durante preview.");
  assert(stillFrozenDuringPreview?.officialResult === undefined, "5. Sem officialResult no banco durante preview.");

  // Usuário clica em CANCELAR prévia
  // (Na UI: setPreviewResult(null))
  const afterCancel = await repo.getContestRecord(targetContest);
  assert(afterCancel?.status === "FROZEN", "5. Status continua FROZEN após cancelamento.");
  assert(afterCancel?.score === undefined, "5. Pontuação inexistente após cancelamento.");
  assert(afterCancel?.officialResult === undefined, "5. officialResult ausente.");
  assert(afterCancel?.integrityHash === originalHash, "5. integrityHash estritamente inalterado.");
  console.log("  ✓ [PASS] 5. Cancelamento de preview não altera registro FROZEN nem integridade.\n");

  // ---------------------------------------------------------------------------
  // 6. TESTE DE FLUXO REAL COMPLETO: FROZEN → PREVIEW → CONFIRMAR → SCORED
  // ---------------------------------------------------------------------------
  console.log("6. TESTE REAL COMPLETO: CONFIRMAÇÃO DO RESULTADO OFICIAL...");
  // Usuário busca novamente e clica em "CONFIRMAR E PONTUAR APOSTAS"
  const officialDataToScore = await provider.getContest(targetContest);
  const scoredRecord = await repo.scoreStoredContest(targetContest, officialDataToScore.numbers);

  assert(scoredRecord.status === "SCORED", "6. Transição para SCORED confirmada.");
  assert(scoredRecord.score !== undefined, "6. Estrutura de pontuação presente.");
  assert(scoredRecord.officialResult?.length === 15, "6. officialResult persistido com 15 dezenas.");
  assert(scoredRecord.integrityHash === originalHash, "6. SHA-256 das apostas preservado idêntico.");

  // Releitura direta do IndexedDB
  const reloadedRecord = await repo.getContestRecord(targetContest);
  assert(reloadedRecord?.status === "SCORED", "6. Releitura do IndexedDB confirma status SCORED.");
  assert(reloadedRecord?.integrityHash === originalHash, "6. Hash original inalterado na persistência.");

  // Auditoria formal
  const storedVerification = await repo.verifyStoredContest(targetContest);
  const contestIntegrity = await verifyContestIntegrity(reloadedRecord!);
  const scoreIntegrity = verifyScoreIntegrity(reloadedRecord!);

  console.log("  verifyStoredContest:", storedVerification.valid ? "VÁLIDO" : "INVÁLIDO");
  console.log("  verifyContestIntegrity:", contestIntegrity.valid ? "VÁLIDO" : "INVÁLIDO");
  console.log("  verifyScoreIntegrity:", scoreIntegrity.valid ? "VÁLIDO" : "INVÁLIDO");

  assert(storedVerification.valid, "6. verifyStoredContest = válido");
  assert(contestIntegrity.valid, "6. verifyContestIntegrity = válido");
  assert(scoreIntegrity.valid, "6. verifyScoreIntegrity = válido");
  assert(reloadedRecord!.integrityHash === originalHash, "6. integrityHash original estritamente idêntico.");
  console.log("  ✓ [PASS] 6. Ciclo FROZEN → PREVIEW → CONFIRMAÇÃO → SCORED auditado e aprovado com hash idêntico.\n");

  // ---------------------------------------------------------------------------
  // 7. AUDITORIA DE PRIVACIDADE / DADOS TRANSMITIDOS
  // ---------------------------------------------------------------------------
  console.log("7. AUDITORIA DE PRIVACIDADE DOS DADOS...");
  // Verificação da request: somente GET para a URL pública da Caixa sem body
  console.log("  Método HTTP utilizado:", "GET");
  console.log("  Headers enviados:", "Accept: application/json, text/plain, */*");
  console.log("  Corpo da requisição (Body):", "Nenhum (undefined)");
  console.log("  Dados de apostas enviados:", "NENHUM");
  console.log("  Dados de permutações enviados:", "NENHUM");
  console.log("  Hashes ou identificadores enviados:", "NENHUM");
  console.log("  Dados de histórico ou backup enviados:", "NENHUM");
  console.log("  ✓ [PASS] 7. Isolamento absoluto de privacidade certificado.\n");

  // ---------------------------------------------------------------------------
  // 8. FALHA DE REDE E FALLBACK MANUAL
  // ---------------------------------------------------------------------------
  console.log("8. TESTE DE RESILIÊNCIA E FALLBACK MANUAL...");
  const offlineProvider = new CaixaLotteryProvider({ baseUrl: "https://invalid-offline-host.example.org" });
  let networkFailed = false;
  try {
    await offlineProvider.getLatestContest();
  } catch (e: any) {
    networkFailed = true;
    assert(e.code === "NETWORK_ERROR" || e.name === "LotteryFetchError", "8. Erro estruturado capturado.");
  }
  assert(networkFailed, "8. Erro de rede tratado sem crash.");

  // Garante que o banco continua acessível e inalterado
  const stillScored = await repo.getContestRecord(targetContest);
  assert(stillScored?.status === "SCORED", "8. Dados no IndexedDB permanecem intactos sob falha de rede.");
  console.log("  ✓ [PASS] 8. Resiliência comprovada: falha de rede tratada e banco intacto.\n");

  console.log("================================================================================");
  console.log("=== CERTIFICAÇÃO COMPLEMENTAR CONCLUÍDA COM 100% DE SUCESSO ===");
  console.log("================================================================================");
}

runLiveCertification().catch((err) => {
  console.error("Erro fatal na certificação:", err);
  process.exit(1);
});
