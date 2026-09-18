import { computePrimaryAction } from "../primaryAction.ts";
import type { ContestSyncState } from "../types.ts";

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ [PASS] ${testName}`);
  } else {
    console.error(`  ✗ [FAIL] ${testName}${detail ? ` - ${detail}` : ""}`);
    throw new Error(`Falha no teste: ${testName}`);
  }
}

function makeState(overrides: Partial<ContestSyncState> = {}): ContestSyncState {
  return {
    status: "ONLINE",
    providerName: "CAIXA",
    fetchedAt: new Date().toISOString(),
    latestOfficialContest: 3350,
    latestDrawDate: "17/09/2026",
    nextSuggestedContest: 3351,
    localLatestContest: null,
    drafts: [],
    staleDrafts: [],
    pendingFrozenContests: [],
    waitingResultContests: [],
    availableResultContests: [],
    scoredContests: [],
    aheadContests: [],
    notices: [],
    recommendedActions: [],
    ...overrides,
  };
}

async function runPrimaryActionTests() {
  console.log("=== INICIANDO TESTES DA AÇÃO PRINCIPAL (PROMPT 09) ===");

  // 1. Cenário: Nenhum registro local, sugerir próximo concurso
  {
    const state = makeState();
    const action = computePrimaryAction(state);
    assert(action.category === "EMPTY_SYSTEM", "1.1 Categoria EMPTY_SYSTEM");
    assert(action.actionType === "PREPARE_CONTEST", "1.2 Tipo de ação PREPARE_CONTEST");
    assert(action.contestNumber === 3351, "1.3 Aponta para o próximo concurso 3351");
  }

  // 2. Cenário: Rascunho existente para o próximo concurso
  {
    const state = makeState({
      localLatestContest: 3351,
      drafts: [3351],
    });
    const action = computePrimaryAction(state);
    assert(action.category === "DRAFT_PENDING", "2.1 Categoria DRAFT_PENDING");
    assert(action.actionType === "OPEN_DRAFT", "2.2 Recomenda abrir rascunho");
    assert(action.contestNumber === 3351, "2.3 Concurso 3351");
    assert(action.badge === "RASCUNHO", "2.4 Badge RASCUNHO");
  }

  // 3. Cenário: Rascunho obsoleto (staleDraft)
  {
    const state = makeState({
      localLatestContest: 3348,
      drafts: [3348],
      staleDrafts: [3348],
    });
    const action = computePrimaryAction(state);
    assert(action.category === "STALE_DRAFT", "3.1 Categoria STALE_DRAFT");
    assert(action.actionType === "OPEN_DRAFT", "3.2 Ação OPEN_DRAFT para inspecionar");
    assert(action.contestNumber === 3348, "3.3 Concurso 3348");
    assert(action.badge === "OBSOLETO", "3.4 Badge OBSOLETO");
  }

  // 4. Cenário: Jogos congelados aguardando apuração
  {
    const state = makeState({
      localLatestContest: 3351,
      pendingFrozenContests: [3351],
      waitingResultContests: [3351],
    });
    const action = computePrimaryAction(state);
    assert(action.category === "FROZEN_WAITING", "4.1 Categoria FROZEN_WAITING");
    assert(action.actionType === "VIEW_CONTEST", "4.2 Permite ver jogos congelados");
    assert(action.contestNumber === 3351, "4.3 Concurso 3351");
    assert(action.badge === "CONGELADO", "4.4 Badge CONGELADO");
  }

  // 5. Cenário: Resultado oficial disponível para conferência
  {
    const state = makeState({
      localLatestContest: 3350,
      pendingFrozenContests: [3350],
      availableResultContests: [3350],
    });
    const action = computePrimaryAction(state);
    assert(action.category === "RESULT_AVAILABLE", "5.1 Prioridade máxima: RESULT_AVAILABLE");
    assert(action.actionType === "CHECK_RESULT", "5.2 Tipo CHECK_RESULT");
    assert(action.contestNumber === 3350, "5.3 Concurso 3350");
    assert(action.actionLabel === "CONFERIR RESULTADO (3350)", "5.4 Botão claro de conferência");
  }

  // 6. Cenário: Concurso mais antigo com resultado disponível tem prioridade
  {
    const state = makeState({
      localLatestContest: 3350,
      pendingFrozenContests: [3348, 3349],
      availableResultContests: [3349, 3348], // Desordenado
    });
    const action = computePrimaryAction(state);
    assert(action.category === "RESULT_AVAILABLE", "6.1 Prioriza conferência");
    assert(action.actionType === "CHECK_RESULT", "6.2 Ação CHECK_RESULT");
    assert(action.contestNumber === 3348, "6.3 Seleciona o concurso pendente mais antigo (3348)");
  }

  // 7. Cenário: Todos conferidos
  {
    const state = makeState({
      localLatestContest: 3350,
      scoredContests: [3350],
    });
    const action = computePrimaryAction(state);
    assert(action.category === "ALL_SCORED", "7.1 Todos conferidos, categoria ALL_SCORED");
    assert(action.actionType === "PREPARE_CONTEST", "7.2 Sugere preparar concurso futuro");
    assert(action.contestNumber === 3351, "7.3 Próximo concurso 3351");
  }

  console.log("=== TODOS OS 21 TESTES DA AÇÃO PRINCIPAL PASSARAM COM SUCESSO ===");
}

runPrimaryActionTests().catch((err) => {
  console.error("Erro nos testes de primary action:", err);
  process.exit(1);
});
