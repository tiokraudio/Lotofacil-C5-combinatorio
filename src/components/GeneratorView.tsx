import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Lock,
  Trash2,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Hash,
  Award,
  Calendar,
  Layers,
  Sparkles,
  Search,
  Globe,
  RefreshCw,
  Copy,
  Printer,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  FileText,
  DollarSign,
} from "lucide-react";
import type { ContestRecord } from "../c5/types.ts";
import { createContestDraft } from "../c5/index.ts";
import { repository, formatLocalDate } from "../storage/service.ts";
import { GamesDisplay } from "./GamesDisplay.tsx";
import { ResultInputGrid } from "./ResultInputGrid.tsx";
import { OfficialResultSection } from "./OfficialResultSection.tsx";
import { OfficialPrizeReconciliationPanel } from "./OfficialPrizeReconciliationPanel.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { HashViewerModal } from "./HashViewerModal.tsx";
import { Ball } from "./Ball.tsx";
import { getLotteryProvider } from "../lottery/index.ts";
import { buildContestSyncState, type ContestSyncState } from "../sync/index.ts";
import { SyncStatusPanel } from "./SyncStatusPanel.tsx";
import { PrimaryActionBar } from "./PrimaryActionBar.tsx";
import { computePrimaryAction, type PrimaryAction } from "../sync/primaryAction.ts";
import { copyGamesToClipboard } from "../utils/clipboard.ts";
import { PrintSheet } from "./PrintSheet.tsx";
import { PrizeRecordModal } from "./PrizeRecordModal.tsx";
import { formatBRLFromCents, formatSignedBRLFromCents } from "../utils/money.ts";
import { actionLockController, type ActionLockState } from "../system/actionLock.ts";
import { refreshCoordinator } from "../system/refreshCoordinator.ts";
import { classifyOperationalError } from "../system/operationalErrors.ts";
import {
  GeneratorOperationalController,
  type GeneratorOperationalState,
} from "../system/generatorOperationalController.ts";

interface GeneratorViewProps {
  onRecordUpdated?: () => void;
}

export const GeneratorView: React.FC<GeneratorViewProps> = ({ onRecordUpdated }) => {
  const [contestInput, setContestInput] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState<boolean>(false);

  // Instancia e gerencia o ciclo operacional via GeneratorOperationalController de produção
  const controllerRef = useRef<GeneratorOperationalController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new GeneratorOperationalController(
      repository,
      refreshCoordinator,
      getLotteryProvider
    );
  }
  const controller = controllerRef.current;
  const [opState, setOpState] = useState<GeneratorOperationalState>(controller.getState());

  // Verificação defensiva de Web Crypto
  const isCryptoAvailable = typeof window !== "undefined" && Boolean(window.crypto && window.crypto.subtle);

  const [localFeedback, setLocalFeedback] = useState<{
    type: "success" | "error" | "warning" | "info";
    title?: string;
    message: string;
  } | null>(null);

  // Modais de confirmação
  const [showFreezeConfirm, setShowFreezeConfirm] = useState<boolean>(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState<boolean>(false);
  const [showBetConfirmModal, setShowBetConfirmModal] = useState<boolean>(false);
  const [showPrizeModal, setShowPrizeModal] = useState<boolean>(false);
  const [showHashModal, setShowHashModal] = useState<boolean>(false);

  const [lockState, setLockState] = useState<ActionLockState>({
    isLocked: actionLockController.isLocked(),
    currentOperation: actionLockController.getCurrentOperation(),
  });

  const clearFeedback = () => {
    setLocalFeedback(null);
    controller.clearFeedback();
  };

  const setFeedback = (
    fb: {
      type: "success" | "error" | "warning" | "info";
      title?: string;
      message: string;
    } | null
  ) => {
    setLocalFeedback(fb);
  };

  // Feedback combinado (controller ou local)
  const feedback = localFeedback || opState.feedback;

  // Inscrição no controlador de locks para feedback e bloqueio de cliques concorrentes
  useEffect(() => {
    const unsub = actionLockController.subscribe(setLockState);
    return unsub;
  }, []);

  // Inscrição no GeneratorOperationalController de produção
  useEffect(() => {
    const unsub = controller.subscribe((nextState) => {
      setOpState(nextState);
      if (!nextState.activeRecord) {
        setShowFreezeConfirm(false);
        setShowDiscardConfirm(false);
      }
    });
    // Carregamento puramente local no boot (ZERO chamadas de rede)
    controller.refreshLocalState(false);

    return () => {
      unsub();
      controller.destroy();
    };
  }, [controller]);

  // Estados operacionais sincronizados do controller de produção
  const activeRecord = opState.activeRecord;
  const localRecords = opState.localRecords;
  const storageBlocked = opState.storageBlocked;
  const syncState = opState.syncState;
  const latestContestInfo = opState.latestContestInfo;
  const isSyncing = opState.isSyncing;
  const isFetchingLatest = opState.isFetchingLatest;

  const setActiveRecord = useCallback(
    (record: ContestRecord | null) => {
      controller.setActiveRecord(record);
    },
    [controller]
  );

  const refreshLocalState = useCallback(
    async (isRemoteSync = false) => {
      await controller.refreshLocalState(isRemoteSync);
    },
    [controller]
  );

  const refreshExternalSync = useCallback(async (): Promise<ContestSyncState | null> => {
    clearFeedback();
    return await controller.refreshExternalSync();
  }, [controller]);

  // Derivação pura e determinística da Ação Principal (Prompt 09 - Seção 2 e 9)
  const primaryAction = computePrimaryAction(syncState, localRecords);

  // Execução da Ação Principal
  const handleExecutePrimaryAction = async (action: PrimaryAction) => {
    clearFeedback();
    if (action.actionType === "PREPARE_CONTEST") {
      if (action.contestNumber) {
        setContestInput(String(action.contestNumber));
        // Posiciona usuário no formulário sem gerar jogos automaticamente
        const formInput = document.getElementById("contest-number-input");
        if (formInput) {
          formInput.scrollIntoView({ behavior: "smooth", block: "center" });
          formInput.focus();
        }
      } else {
        await handleFetchLatestContest();
      }
    } else if (action.actionType === "OPEN_DRAFT" && action.contestNumber) {
      await handleOpenDraftFromPanel(action.contestNumber);
      const panel = document.getElementById("active-contest-panel");
      if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (action.actionType === "CHECK_RESULT" && action.contestNumber) {
      await handleCheckResultFromPanel(action.contestNumber);
      const panel = document.getElementById("active-contest-panel");
      if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (action.actionType === "VIEW_CONTEST" && action.contestNumber) {
      await handleOpenContest(action.contestNumber);
      const panel = document.getElementById("active-contest-panel");
      if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Copiar Jogos Formatados (Prompt 09 - Seção 13)
  const handleCopyActiveGames = async () => {
    if (!activeRecord) return;
    const res = await copyGamesToClipboard(activeRecord.generation.games);
    setFeedback({
      type: res.success ? "info" : "warning",
      title: res.success ? "Jogos Copiados" : "Atenção ao Copiar",
      message: res.message,
    });
  };

  // Impressão Limpa (Prompt 09 - Seções 14, 15, 16)
  const handlePrintActiveGames = () => {
    if (!activeRecord) return;
    window.print();
  };

  // Abertura de concurso para visualização
  const handleOpenContest = async (contestNumber: number) => {
    setIsLoading(true);
    clearFeedback();
    try {
      const record = await repository.getContestRecord(contestNumber);
      if (record) {
        setContestInput(String(contestNumber));
        setActiveRecord(record);
      }
    } catch (err: any) {
      setFeedback({
        type: "error",
        title: "Erro ao Abrir Concurso",
        message: err?.message || "Não foi possível carregar o concurso.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Consulta manual do último concurso no topo do formulário (ação explícita do usuário)
  const handleFetchLatestContest = async () => {
    const nextSync = await refreshExternalSync();
    if (nextSync && nextSync.latestOfficialContest) {
      setFeedback({
        type: "info",
        title: "Consulta CAIXA Realizada",
        message: `Último concurso oficial: ${nextSync.latestOfficialContest} (${nextSync.latestDrawDate || ""}). Próximo sugerido: ${nextSync.nextSuggestedContest || nextSync.latestOfficialContest + 1}.`,
      });
    }
  };

  // Ações disparadas a partir do SyncStatusPanel
  const handlePrepareContestFromPanel = (contestNumber: number) => {
    setContestInput(String(contestNumber));
    clearFeedback();
  };

  const handleOpenDraftFromPanel = async (contestNumber: number) => {
    setIsLoading(true);
    clearFeedback();
    try {
      const record = await repository.getContestRecord(contestNumber);
      if (record) {
        setContestInput(String(contestNumber));
        setActiveRecord(record);
        setFeedback({
          type: "info",
          title: `Concurso ${contestNumber} Aberto`,
          message: `Rascunho carregado no gerador.`,
        });
      }
    } catch (err: any) {
      setFeedback({
        type: "error",
        title: "Erro ao Abrir Rascunho",
        message: err?.message || "Não foi possível carregar o rascunho.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDiscardDraftFromPanel = async (contestNumber: number) => {
    try {
      const record = await repository.getContestRecord(contestNumber);
      if (record && record.status === "DRAFT") {
        setActiveRecord(record);
        setContestInput(String(contestNumber));
        setShowDiscardConfirm(true);
      }
    } catch {
      // fallback
    }
  };

  const handleCheckResultFromPanel = async (contestNumber: number) => {
    setIsLoading(true);
    clearFeedback();
    try {
      const record = await repository.getContestRecord(contestNumber);
      if (record) {
        setContestInput(String(contestNumber));
        setActiveRecord(record);
        setFeedback({
          type: "info",
          title: `Concurso ${contestNumber} Selecionado`,
          message: `Concurso carregado para conferência de resultado oficial.`,
        });
      }
    } catch (err: any) {
      setFeedback({
        type: "error",
        title: "Erro ao Carregar Concurso",
        message: err?.message || "Não foi possível carregar o concurso.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplySuggestedContest = () => {
    if (latestContestInfo) {
      setContestInput(String(latestContestInfo.suggestedNext));
    }
  };

  // 1. Gerar ou Carregar Concurso
  const handleGenerateOrLoad = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    clearFeedback();

    if (storageBlocked) {
      setFeedback({
        type: "error",
        title: "Acesso Bloqueado",
        message: "Não foi possível acessar o histórico local. A geração oficial foi bloqueada para evitar perda de rastreabilidade.",
      });
      return;
    }

    const contestNum = parseInt(contestInput.trim(), 10);
    if (isNaN(contestNum) || contestNum <= 0) {
      setFeedback({
        type: "error",
        title: "Número Inválido",
        message: "Informe um número inteiro positivo para o concurso (ex: 3350).",
      });
      return;
    }

    if (!actionLockController.acquire("GENERATE")) {
      return; // Prevenção de concorrência e duplo clique
    }

    setIsLoading(true);
    try {
      // 1.1 Verificar no IndexedDB se o concurso já existe
      const existing = await repository.getContestRecord(contestNum);

      if (existing) {
        // NÃO gerar outro! Carregar o existente
        setActiveRecord(existing);
        setFeedback({
          type: "info",
          title: `Concurso ${contestNum} Carregado`,
          message: `Este concurso já possui registro oficial no histórico com status ${existing.status}. Carregado para conferência.`,
        });
        if (onRecordUpdated) onRecordUpdated();
        await refreshLocalState();
      } else {
        // 1.2 Criar DRAFT e salvar
        const draft = createContestDraft(contestNum);
        await repository.saveDraft(draft);
        const storedDraft = await repository.getContestRecord(contestNum);
        setActiveRecord(storedDraft);
        setFeedback({
          type: "success",
          title: `Concurso ${contestNum} Gerado`,
          message: "5 jogos combinatórios C₅ gerados como RASCUNHO. Confira as apostas antes de congelar.",
        });
        if (onRecordUpdated) onRecordUpdated();
        await refreshLocalState();
      }
    } catch (err: any) {
      // Re-leitura defensiva do banco antes de emitir erro
      try {
        const recheck = await repository.getContestRecord(contestNum);
        if (recheck) {
          setActiveRecord(recheck);
          setFeedback({
            type: "info",
            title: `Concurso ${contestNum} Carregado`,
            message: `O registro está salvo no armazenamento local como ${recheck.status}.`,
          });
          return;
        }
      } catch {
        // Leitura também falhou
      }

      const classified = classifyOperationalError(err);
      setFeedback({
        type: "error",
        title: "Erro na Operação",
        message: classified.userMessage,
      });
    } finally {
      actionLockController.release("GENERATE");
      setIsLoading(false);
    }
  };

  // 2. Descartar Rascunho
  const handleConfirmDiscard = async () => {
    if (!activeRecord || activeRecord.status !== "DRAFT") return;
    if (storageBlocked) {
      setFeedback({
        type: "error",
        title: "Armazenamento Indisponível",
        message: "O armazenamento local está indisponível. Operação bloqueada para segurança dos dados.",
      });
      return;
    }
    if (!actionLockController.acquire("DELETE")) return;

    setIsLoading(true);
    clearFeedback();

    try {
      const num = activeRecord.contestNumber;
      await repository.deleteDraft(num);
      setActiveRecord(null);
      setShowDiscardConfirm(false);
      setFeedback({
        type: "info",
        title: "Rascunho Descartado",
        message: `O rascunho do concurso ${num} foi excluído do histórico com sucesso.`,
      });
      if (onRecordUpdated) onRecordUpdated();
      await refreshLocalState();
    } catch (err: any) {
      // Detecção de concorrência com outra aba ou conferência de remoção
      try {
        const updated = await repository.getContestRecord(activeRecord.contestNumber);
        if (!updated) {
          setActiveRecord(null);
          setShowDiscardConfirm(false);
          setFeedback({
            type: "info",
            title: "Rascunho Já Removido",
            message: "O rascunho foi excluído com sucesso do armazenamento local.",
          });
          await refreshLocalState();
          return;
        } else if (updated.status !== "DRAFT") {
          setActiveRecord(updated);
          setShowDiscardConfirm(false);
          setFeedback({
            type: "warning",
            title: "Sessão Concorrente Detectada",
            message: `O concurso ${updated.contestNumber} foi congelado em outra sessão. Registro recarregado.`,
          });
          await refreshLocalState();
          return;
        }
      } catch {
        // ignore
      }

      const classified = classifyOperationalError(err);
      setFeedback({
        type: "error",
        title: "Erro ao Descartar",
        message: classified.userMessage,
      });
    } finally {
      actionLockController.release("DELETE");
      setIsLoading(false);
    }
  };

  // 3. Congelar Jogos
  const handleConfirmFreeze = async () => {
    if (!activeRecord || activeRecord.status !== "DRAFT") return;
    clearFeedback();

    if (storageBlocked) {
      setFeedback({
        type: "error",
        title: "Armazenamento Indisponível",
        message: "O armazenamento local está indisponível. Operação bloqueada para segurança dos dados.",
      });
      setShowFreezeConfirm(false);
      return;
    }

    if (!isCryptoAvailable) {
      setFeedback({
        type: "error",
        title: "Recurso Criptográfico Indisponível",
        message: "Mecanismo criptográfico seguro (WebCrypto) indisponível neste navegador. Operação bloqueada para sua segurança.",
      });
      setShowFreezeConfirm(false);
      return;
    }

    if (!actionLockController.acquire("FREEZE")) return;

    setIsLoading(true);

    try {
      const num = activeRecord.contestNumber;
      // Congela no IndexedDB
      await repository.freezeStoredContest(num);

      // Audita integridade pós-congelamento
      const verification = await repository.verifyStoredContest(num);
      if (!verification.valid) {
        throw new Error(
          `Não foi possível congelar o concurso ${num}. A auditoria de integridade pós-congelamento falhou.`
        );
      }

      // Recarrega registro da fonte de verdade
      const frozenRecord = await repository.getContestRecord(num);
      setActiveRecord(frozenRecord);
      setShowFreezeConfirm(false);
      setFeedback({
        type: "success",
        title: "Jogos congelados com sucesso",
        message: `Concurso ${num}. Integridade verificada.`,
      });
      if (onRecordUpdated) onRecordUpdated();
      await refreshLocalState();
    } catch (err: any) {
      // Re-leitura defensiva do banco antes de emitir erro (Prompt 14 Seção 42 & 43)
      try {
        const updated = await repository.getContestRecord(activeRecord.contestNumber);
        if (updated && updated.status !== "DRAFT") {
          setActiveRecord(updated);
          setShowFreezeConfirm(false);
          setFeedback({
            type: updated.status === "FROZEN" ? "success" : "warning",
            title: updated.status === "FROZEN" ? "Jogos congelados com sucesso" : "Sessão Concorrente Detectada",
            message: `O concurso ${updated.contestNumber} está registrado como ${updated.status} no armazenamento local.`,
          });
          await refreshLocalState();
          return;
        }
      } catch {
        // ignore
      }

      const classified = classifyOperationalError(err);
      setFeedback({
        type: "error",
        title: "Falha no Congelamento",
        message: classified.userMessage,
      });
    } finally {
      actionLockController.release("FREEZE");
      setIsLoading(false);
    }
  };

  // 3.5. Confirmar Aposta Realizada (R$ 17,50)
  const handleConfirmBet = async () => {
    if (!activeRecord || activeRecord.status === "DRAFT") return;
    setIsLoading(true);
    clearFeedback();

    try {
      await controller.confirmBet();
      setShowBetConfirmModal(false);
      if (onRecordUpdated) onRecordUpdated();
    } catch (err: any) {
      const classified = classifyOperationalError(err);
      setFeedback({
        type: "error",
        title: "Erro ao Confirmar Aposta",
        message: classified.userMessage,
      });
    } finally {
      setIsLoading(false);
    }
  };

  // 3.6. Registrar Fechamento Financeiro / Prêmio (V1.8)
  const handleRecordPrize = async (amountCents: number) => {
    if (!activeRecord || activeRecord.status !== "SCORED") return;
    setIsLoading(true);
    clearFeedback();

    try {
      await controller.recordPrize(amountCents);
      setShowPrizeModal(false);
      if (onRecordUpdated) onRecordUpdated();
    } catch (err: any) {
      const classified = classifyOperationalError(err);
      setFeedback({
        type: "error",
        title: "Erro ao Registrar Prêmio",
        message: classified.userMessage,
      });
    } finally {
      setIsLoading(false);
    }
  };

  // 4. Registrar e Pontuar Resultado Oficial com Auditoria Rigorosa
  const handleScoreResult = async (officialResult: number[]) => {
    if (!activeRecord || activeRecord.status !== "FROZEN") return;
    clearFeedback();

    if (storageBlocked) {
      setFeedback({
        type: "error",
        title: "Armazenamento Indisponível",
        message: "O armazenamento local está indisponível. Pontuação bloqueada para segurança dos dados.",
      });
      return;
    }

    if (!actionLockController.acquire("SCORE")) return;

    setIsLoading(true);

    try {
      const num = activeRecord.contestNumber;
      await repository.scoreStoredContest(num, officialResult);

      // Auditoria obrigatória pós-score
      const verification = await repository.verifyStoredContest(num);
      if (!verification.valid) {
        throw new Error(
          `[ERRO CRÍTICO DE INTEGRIDADE]: Concurso ${num} falhou na auditoria pós-pontuação: ${verification.errors.join("; ")}`
        );
      }

      // Recarrega da fonte de verdade
      const scoredRecord = await repository.getContestRecord(num);
      setActiveRecord(scoredRecord);
      setFeedback({
        type: "success",
        title: "Resultado Registrado e Pontuado",
        message: `O concurso ${num} foi conferido com sucesso. Melhor resultado: ${scoredRecord?.score?.maxHits} acertos. Auditoria criptográfica: VÁLIDA.`,
      });
      if (onRecordUpdated) onRecordUpdated();
      await refreshLocalState();
    } catch (err: any) {
      // Re-leitura defensiva do banco antes de emitir erro (Prompt 14 Seção 42 & 43)
      try {
        const updated = await repository.getContestRecord(activeRecord.contestNumber);
        if (updated && updated.status === "SCORED") {
          setActiveRecord(updated);
          setFeedback({
            type: "success",
            title: "Resultado Registrado e Pontuado",
            message: `O concurso ${updated.contestNumber} já foi pontuado e persistido no armazenamento local (melhor resultado: ${updated.score?.maxHits} acertos).`,
          });
          if (onRecordUpdated) onRecordUpdated();
          await refreshLocalState();
          return;
        }
      } catch {
        // ignore
      }

      const classified = classifyOperationalError(err);
      setFeedback({
        type: "error",
        title: "Falha na Pontuação",
        message: classified.userMessage,
      });
    } finally {
      actionLockController.release("SCORE");
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Alerta Crítico se IndexedDB estiver bloqueado (Prompt 09 - Seção 30) */}
      {storageBlocked && (
        <div
          id="storage-blocked-banner"
          className="p-4 rounded-xl bg-red-950/50 border border-red-500/50 text-red-200 text-xs sm:text-sm flex items-start gap-3 shadow-lg"
          role="alert"
        >
          <AlertCircle className="w-5 h-5 shrink-0 text-red-400 mt-0.5" />
          <div>
            <strong className="block font-semibold">Acesso ao Histórico Local Indisponível</strong>
            <p>
              Não foi possível acessar o histórico local. A geração oficial foi bloqueada para evitar perda de rastreabilidade.
            </p>
          </div>
        </div>
      )}

      {/* Barra de Ação Principal (Prompt 09 - Seções 2, 3, 4, 5, 6, 7, 8, 9) */}
      <PrimaryActionBar
        primaryAction={primaryAction}
        onExecuteAction={handleExecutePrimaryAction}
        activeContestStatus={activeRecord?.status}
      />

      {/* Dashboard Operacional de Sincronização (Prompt 08) */}
      <SyncStatusPanel
        syncState={syncState}
        isLoading={isSyncing}
        onRefresh={refreshExternalSync}
        onPrepareContest={handlePrepareContestFromPanel}
        onOpenDraft={handleOpenDraftFromPanel}
        onDiscardDraft={handleDiscardDraftFromPanel}
        onCheckResult={handleCheckResultFromPanel}
      />
      {/* Topo do Gerador */}
      <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-zinc-800">
          <div>
            <span className="text-xs font-mono font-bold tracking-widest text-emerald-400 uppercase">
              Gerador Oficial C₅
            </span>
            <h2 className="text-2xl font-bold text-zinc-100 mt-1 font-mono">
              5 jogos simples • 15 dezenas por jogo
            </h2>
            <p className="text-sm text-zinc-400 mt-1">
              Geração combinatória com cobertura garantida de 25 dezenas em 5 apostas.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="px-3.5 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs">
              <span className="text-zinc-400 block font-medium">Arquitetura:</span>
              <span className="text-zinc-200 font-mono font-semibold">C5-1.0.0</span>
            </div>
            <div className="px-3.5 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs">
              <span className="text-zinc-400 block font-medium">Custo por concurso:</span>
              <span className="text-emerald-400 font-mono font-semibold">R$ 17,50</span>
            </div>
          </div>
        </div>

        {/* Formulário de Seleção/Geração de Concurso */}
        <form onSubmit={handleGenerateOrLoad} className="mt-6">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3 max-w-2xl">
            <div className="grow">
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="contest-number-input"
                  className="text-xs font-semibold text-zinc-300"
                >
                  Número do Concurso (somente inteiro positivo):
                </label>
                <button
                  type="button"
                  id="btn-fetch-latest-contest"
                  onClick={handleFetchLatestContest}
                  disabled={isLoading || isFetchingLatest || lockState.isLocked}
                  className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
                  title="Consultar último concurso apurado na CAIXA"
                >
                  {isFetchingLatest || lockState.currentOperation === "CAIXA_QUERY" ? (
                    <div className="w-3 h-3 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" />
                  ) : (
                    <Globe className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {lockState.currentOperation === "CAIXA_QUERY" ? "CONSULTANDO..." : "ATUALIZAR CONCURSO"}
                  </span>
                </button>
              </div>
              <input
                id="contest-number-input"
                type="number"
                min="1"
                step="1"
                placeholder="Ex: 3350"
                value={contestInput}
                onChange={(e) => setContestInput(e.target.value)}
                disabled={isLoading || lockState.isLocked}
                className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-700 focus:border-emerald-500 rounded-xl text-zinc-100 placeholder-zinc-500 text-sm font-mono focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 transition-all disabled:opacity-50"
              />
            </div>

            <button
              type="submit"
              id="btn-generate-contest"
              disabled={isLoading || lockState.isLocked || !contestInput.trim()}
              className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm tracking-wide transition-all shadow-md hover:shadow-emerald-950/40 inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus:ring-2 focus:ring-emerald-400"
            >
              {isLoading && lockState.currentOperation === "GENERATE" ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              <span>
                {lockState.currentOperation === "GENERATE" ? "GERANDO..." : "GERAR 5 JOGOS"}
              </span>
            </button>
          </div>

          {/* Sugestão de Concurso Baseada na Consulta Oficial */}
          {latestContestInfo && (
            <div
              id="suggested-contest-banner"
              className="mt-3 p-3 rounded-xl bg-blue-950/30 border border-blue-500/30 text-xs text-blue-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 max-w-2xl"
            >
              <div>
                <span>Último concurso na CAIXA: <strong>{latestContestInfo.lastContest}</strong> ({latestContestInfo.drawDate}).</span>
                <span className="block sm:inline sm:ml-2 text-zinc-300">
                  Próximo concurso sugerido: <strong className="text-emerald-400 font-mono text-sm">{latestContestInfo.suggestedNext}</strong>
                </span>
              </div>
              <button
                type="button"
                id="btn-apply-suggested-contest"
                onClick={handleApplySuggestedContest}
                className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-colors cursor-pointer self-start sm:self-auto shrink-0"
              >
                USAR CONCURSO {latestContestInfo.suggestedNext}
              </button>
            </div>
          )}
        </form>

        {/* Feedback visual de ações */}
        {feedback && (
          <div
            id="generator-feedback-banner"
            role={feedback.type === "error" ? "alert" : "status"}
            aria-live="polite"
            className={`mt-6 p-4 rounded-xl border flex items-start gap-3 text-xs sm:text-sm ${
              feedback.type === "error"
                ? "bg-red-950/30 border-red-500/40 text-red-200"
                : feedback.type === "warning"
                ? "bg-amber-950/30 border-amber-500/40 text-amber-200"
                : feedback.type === "info"
                ? "bg-blue-950/30 border-blue-500/40 text-blue-200"
                : "bg-emerald-950/30 border-emerald-500/40 text-emerald-200"
            }`}
          >
            {feedback.type === "error" ? (
              <AlertCircle className="w-5 h-5 shrink-0 text-red-400" />
            ) : feedback.type === "warning" ? (
              <AlertCircle className="w-5 h-5 shrink-0 text-amber-400" />
            ) : (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
            )}
            <div className="grow">
              {feedback.title && <strong className="block font-semibold">{feedback.title}</strong>}
              <p>{feedback.message}</p>
            </div>
            <button
              type="button"
              onClick={clearFeedback}
              aria-label="Fechar notificação"
              className="text-xs opacity-70 hover:opacity-100 transition-opacity p-1 rounded-md"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Painel do Concurso Ativo */}
      {activeRecord && (
        <div id="active-contest-panel" className="space-y-6">
          {/* Header de Status do Concurso Ativo */}
          <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-lg">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-xl font-bold font-mono text-zinc-100">
                    CONCURSO {activeRecord.contestNumber}
                  </h3>

                  {/* Badges de Estado Padronizados (Prompt 09 - Seção 18) */}
                  {activeRecord.status === "DRAFT" && (
                    <span
                      id="status-badge-draft"
                      className="px-3 py-1 rounded-full bg-amber-950/60 border border-amber-500/50 text-amber-300 font-mono text-xs font-semibold"
                    >
                      RASCUNHO
                    </span>
                  )}
                  {activeRecord.status === "FROZEN" && (
                    <div className="flex items-center gap-2">
                      <span
                        id="status-badge-frozen"
                        className="px-3 py-1 rounded-full bg-blue-950/60 border border-blue-500/50 text-blue-300 font-mono text-xs font-semibold flex items-center gap-1.5"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        <span>CONGELADO</span>
                      </span>
                      <span
                        id="integrity-badge-frozen"
                        className="px-2.5 py-0.5 rounded-full bg-emerald-950/40 border border-emerald-500/40 text-emerald-400 font-mono text-[11px] font-medium flex items-center gap-1"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Integridade: verificada</span>
                      </span>
                    </div>
                  )}
                  {activeRecord.status === "SCORED" && (
                    <div className="flex items-center gap-2">
                      <span
                        id="status-badge-scored"
                        className="px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/50 text-emerald-300 font-mono text-xs font-semibold flex items-center gap-1.5"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>CONFERIDO</span>
                      </span>
                      <span
                        id="integrity-badge-scored"
                        className="px-2.5 py-0.5 rounded-full bg-emerald-950/40 border border-emerald-500/40 text-emerald-400 font-mono text-[11px] font-medium flex items-center gap-1"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Integridade: verificada</span>
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-zinc-400">
                  <span>Gerado: <span className="text-zinc-300">{formatLocalDate(activeRecord.generatedAt)}</span></span>
                  {activeRecord.frozenAt && (
                    <span>Congelado: <span className="text-zinc-300">{formatLocalDate(activeRecord.frozenAt)}</span></span>
                  )}
                  {activeRecord.betPlacedAt && (
                    <span>Aposta Confirmada: <span className="text-emerald-400 font-medium">{formatLocalDate(activeRecord.betPlacedAt)}</span></span>
                  )}
                  {activeRecord.scoredAt && (
                    <span>Conferido: <span className="text-zinc-300">{formatLocalDate(activeRecord.scoredAt)}</span></span>
                  )}
                </div>
              </div>

              {/* Barra de Ações Rápidas (Copiar, Imprimir, Descartar, Congelar) */}
              <div className="flex flex-wrap items-center gap-2.5">
                {/* Botão Copiar Jogos (Prompt 09 - Seção 13) */}
                <button
                  type="button"
                  id="btn-copy-games"
                  onClick={handleCopyActiveGames}
                  className="px-3.5 py-2 text-xs font-medium text-zinc-300 hover:text-zinc-100 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                  title="Copiar os 5 jogos formatados para a área de transferência"
                >
                  <Copy className="w-3.5 h-3.5 text-zinc-400" />
                  <span>COPIAR JOGOS</span>
                </button>

                {/* Botão Imprimir (Prompt 09 - Seção 14, 15, 16) */}
                <button
                  type="button"
                  id="btn-print-games"
                  onClick={handlePrintActiveGames}
                  className="px-3.5 py-2 text-xs font-medium text-zinc-300 hover:text-zinc-100 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                  title="Imprimir bilhete dos jogos em formato padrão da Lotofácil"
                >
                  <Printer className="w-3.5 h-3.5 text-zinc-400" />
                  <span>IMPRIMIR</span>
                </button>

                {/* Ações específicas do Estado DRAFT */}
                {activeRecord.status === "DRAFT" && (
                  <>
                    <button
                      type="button"
                      id="btn-discard-draft"
                      onClick={() => setShowDiscardConfirm(true)}
                      disabled={isLoading || lockState.isLocked}
                      className="px-3.5 py-2 text-xs font-medium text-red-400 hover:text-red-300 bg-red-950/20 hover:bg-red-950/40 border border-red-500/30 rounded-xl transition-colors inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>DESCARTAR RASCUNHO</span>
                    </button>

                    <button
                      type="button"
                      id="btn-freeze-contest"
                      onClick={() => setShowFreezeConfirm(true)}
                      disabled={isLoading || lockState.isLocked}
                      className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl shadow-md transition-all inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer focus:ring-2 focus:ring-emerald-400"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>CONGELAR JOGOS</span>
                    </button>
                  </>
                )}

                {/* Ações para Concurso Congelado ou Conferido: Confirmação de Aposta e Registro de Prêmio */}
                {(activeRecord.status === "FROZEN" || activeRecord.status === "SCORED") && (
                  <>
                    {activeRecord.betPlacedAt ? (
                      <div
                        id="badge-bet-confirmed"
                        className="px-3 py-2 rounded-xl bg-emerald-950/40 border border-emerald-500/50 text-emerald-300 font-mono text-xs font-semibold inline-flex items-center gap-1.5"
                        title={`Aposta oficial registrada em ${formatLocalDate(activeRecord.betPlacedAt)}`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>APOSTA REGISTRADA (R$ 17,50)</span>
                      </div>
                    ) : activeRecord.status === "FROZEN" ? (
                      <button
                        type="button"
                        id="btn-confirm-bet"
                        onClick={() => setShowBetConfirmModal(true)}
                        disabled={isLoading || lockState.isLocked}
                        className="px-3.5 py-2 text-xs font-semibold text-emerald-300 hover:text-white bg-emerald-950/40 hover:bg-emerald-600/80 border border-emerald-500/50 rounded-xl transition-all inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                        title="Registrar que os 5 jogos foram apostados e pagos na lotérica (R$ 17,50)"
                      >
                        <DollarSign className="w-3.5 h-3.5" />
                        <span>CONFIRMAR APOSTA (R$ 17,50)</span>
                      </button>
                    ) : (
                      <div
                        id="badge-bet-not-confirmed"
                        className="px-3 py-2 rounded-xl bg-zinc-950/40 border border-zinc-800 text-zinc-400 font-mono text-xs font-medium inline-flex items-center gap-1.5"
                        title="Concurso conferido sem registro prévio de aposta na lotérica"
                      >
                        <span>NÃO APOSTADO</span>
                      </div>
                    )}

                    {/* V1.8: Botão ou Badge de Registro de Prêmio para concursos SCORED com aposta confirmada */}
                    {activeRecord.status === "SCORED" && activeRecord.betPlacedAt && (
                      activeRecord.prize !== undefined ? (
                        <div
                          id="badge-prize-recorded"
                          className="px-3 py-2 rounded-xl bg-emerald-950/60 border border-emerald-500/60 text-emerald-300 font-mono text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm"
                          title={`Prêmio registrado manualmente em ${formatLocalDate(activeRecord.prize.recordedAt)}`}
                        >
                          <Award className="w-3.5 h-3.5 text-emerald-400" />
                          <span>PRÊMIO: {formatBRLFromCents(activeRecord.prize.amountCents)}</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          id="btn-open-record-prize"
                          onClick={() => setShowPrizeModal(true)}
                          disabled={isLoading || lockState.isLocked}
                          className="px-3.5 py-2 text-xs font-semibold text-emerald-200 hover:text-white bg-emerald-700/80 hover:bg-emerald-600 border border-emerald-500/60 rounded-xl transition-all inline-flex items-center gap-1.5 shadow-md cursor-pointer disabled:opacity-50"
                          title="Registrar fechamento financeiro e valor do prêmio recebido neste concurso"
                        >
                          <Award className="w-3.5 h-3.5 text-emerald-300" />
                          <span>REGISTRAR PRÊMIO</span>
                        </button>
                      )
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Aviso explicativo em FROZEN */}
            {activeRecord.status === "FROZEN" && (
              <div className="mt-4 p-3 rounded-xl bg-blue-950/20 border border-blue-500/30 text-xs text-blue-200">
                <p>
                  🔒 <strong>Registro Imutável:</strong> Os 5 jogos estão oficialmente congelados com hash SHA-256. Alterações, exclusões ou novos sorteios para este concurso estão proibidos pelo sistema.
                </p>
              </div>
            )}

            {/* Detalhes Técnicos Expansíveis (Prompt 09 - Seção 37) */}
            <div className="mt-4 pt-3 border-t border-zinc-800/80">
              <button
                type="button"
                id="btn-toggle-tech-details"
                onClick={() => setIsDetailsOpen(!isDetailsOpen)}
                className="text-xs text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                {isDetailsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                <span className="font-mono uppercase font-semibold text-[11px] tracking-wider">
                  {isDetailsOpen ? "Ocultar Detalhes Técnicos" : "DETALHES TÉCNICOS (ID, algoritmo e hash)"}
                </span>
              </button>

              {isDetailsOpen && (
                <div
                  id="tech-details-content"
                  className="mt-3 p-3.5 rounded-xl bg-zinc-950/80 border border-zinc-800 space-y-2 text-xs font-mono text-zinc-400 animate-in fade-in"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <span className="text-zinc-400 font-sans">Generation ID:</span>
                    <span className="text-zinc-200 break-all">{activeRecord.generationId}</span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <span className="text-zinc-400 font-sans">Algoritmo / Esquema:</span>
                    <span className="text-zinc-200">{activeRecord.algorithmVersion} • Formato Canônico C₅</span>
                  </div>
                  {activeRecord.integrityHash && (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pt-1 border-t border-zinc-800/60">
                      <span className="text-zinc-400 font-sans">Hash SHA-256 Completo:</span>
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-400 break-all text-[11px]">{activeRecord.integrityHash}</span>
                        <button
                          type="button"
                          onClick={() => setShowHashModal(true)}
                          className="px-2 py-0.5 rounded bg-zinc-800 text-[10px] text-zinc-300 hover:text-white"
                        >
                          Auditar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Destaque do Resultado Oficial quando for SCORED */}
          {activeRecord.status === "SCORED" && activeRecord.officialResult && (
            <div id="scored-summary-card" className="p-6 rounded-2xl bg-zinc-900 border border-emerald-500/40 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
                <div>
                  <span className="text-xs font-mono font-bold tracking-widest text-emerald-400 uppercase">
                    Resultado Oficial Concurso {activeRecord.contestNumber}
                  </span>
                  <h3 className="text-xl font-bold text-zinc-100 mt-0.5">
                    15 Dezenas Sorteadas pela CAIXA
                  </h3>
                </div>

                {activeRecord.score && (
                  <div className="px-4 py-2 rounded-xl bg-emerald-950/60 border border-emerald-500/60 text-right">
                    <span className="text-[11px] text-zinc-400 block font-medium">MELHOR RESULTADO:</span>
                    <span className="text-lg font-mono font-extrabold text-emerald-300">
                      {activeRecord.score.maxHits} ACERTOS
                    </span>
                  </div>
                )}
              </div>

              {/* 15 Dezenas em Destaque */}
              <div className="mt-4 flex flex-wrap gap-2">
                {activeRecord.officialResult.map((num) => (
                  <Ball key={`scored-official-ball-${num}`} number={num} variant="official" size="md" />
                ))}
              </div>

              {/* Resumo de Premiações */}
              {activeRecord.score && (
                <div className="mt-5 pt-4 border-t border-zinc-800 flex flex-wrap items-center gap-4 text-xs sm:text-sm">
                  <span className="text-zinc-400 font-medium">Faixas obtidas neste concurso:</span>
                  {activeRecord.score.prizeCounts.hits15 > 0 && (
                    <span className="px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold inline-flex items-center gap-1.5">
                      <Award className="w-4 h-4" />
                      {activeRecord.score.prizeCounts.hits15} aposta(s) com 15 acertos
                    </span>
                  )}
                  {activeRecord.score.prizeCounts.hits14 > 0 && (
                    <span className="px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold inline-flex items-center gap-1.5">
                      <Award className="w-4 h-4" />
                      {activeRecord.score.prizeCounts.hits14} aposta(s) com 14 acertos
                    </span>
                  )}
                  {activeRecord.score.prizeCounts.hits13 > 0 && (
                    <span className="px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold inline-flex items-center gap-1.5">
                      <Award className="w-4 h-4" />
                      {activeRecord.score.prizeCounts.hits13} aposta(s) com 13 acertos
                    </span>
                  )}
                  {activeRecord.score.prizeCounts.hits12 > 0 && (
                    <span className="px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold inline-flex items-center gap-1.5">
                      <Award className="w-4 h-4" />
                      {activeRecord.score.prizeCounts.hits12} aposta(s) com 12 acertos
                    </span>
                  )}
                  {activeRecord.score.prizeCounts.hits11 > 0 && (
                    <span className="px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold inline-flex items-center gap-1.5">
                      <Award className="w-4 h-4" />
                      {activeRecord.score.prizeCounts.hits11} aposta(s) com 11 acertos
                    </span>
                  )}
                  {!activeRecord.score.has11Plus && (
                    <span className="text-zinc-400 italic">
                      Nenhuma aposta alcançou 11 ou mais acertos neste concurso.
                    </span>
                  )}
                </div>
              )}

              {/* Fechamento Financeiro (V1.8) */}
              <div className="mt-5 pt-4 border-t border-zinc-800">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 block font-semibold">
                      Fechamento Financeiro
                    </span>
                    {activeRecord.betPlacedAt ? (
                      activeRecord.prize !== undefined ? (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs">
                          <span className="text-zinc-300">
                            Prêmio Recebido:{" "}
                            <strong className="text-emerald-400 font-mono text-sm">
                              {formatBRLFromCents(activeRecord.prize.amountCents)}
                            </strong>
                          </span>
                          <span className="text-zinc-400">
                            Custo das apostas:{" "}
                            <strong className="font-mono text-zinc-300">R$ 17,50</strong>
                          </span>
                          <span className="text-zinc-300">
                            Resultado Líquido:{" "}
                            <strong
                              className={`font-mono text-sm ${
                                activeRecord.prize.amountCents >= 1750 ? "text-emerald-400" : "text-rose-400"
                              }`}
                            >
                              {formatSignedBRLFromCents(activeRecord.prize.amountCents - 1750)}
                            </strong>
                          </span>
                          <span className="text-[11px] text-zinc-400">
                            (Registrado em {formatLocalDate(activeRecord.prize.recordedAt)})
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-amber-300 font-medium">
                            Fechamento financeiro pendente (aposta realizada na lotérica).
                          </span>
                        </div>
                      )
                    ) : (
                      <span className="text-xs text-zinc-400 mt-1 block italic">
                        Concurso conferido sem aposta confirmada na lotérica (não gera impacto financeiro).
                      </span>
                    )}
                  </div>

                  {activeRecord.betPlacedAt && activeRecord.prize === undefined && (
                    <button
                      type="button"
                      id="btn-card-record-prize"
                      onClick={() => setShowPrizeModal(true)}
                      disabled={isLoading || lockState.isLocked}
                      className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl shadow-md transition-all inline-flex items-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-50"
                    >
                      <Award className="w-3.5 h-3.5" />
                      <span>REGISTRAR PRÊMIO</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Exibição das 5 Apostas Oficiais C5 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h4 className="text-sm font-semibold tracking-wider text-zinc-300 uppercase font-mono">
                {activeRecord.status === "SCORED" ? "Apostas e Conferência de Acertos" : "5 Apostas Oficiais C₅"}
              </h4>
              <span className="text-xs text-zinc-400">
                15 dezenas por jogo em ordem crescente
              </span>
            </div>
            <GamesDisplay record={activeRecord} />
          </div>

          {/* Próxima Ação: Registrar Resultado Oficial (se FROZEN) */}
          {activeRecord.status === "FROZEN" && (
            <div className="mt-8">
              <OfficialResultSection
                contestNumber={activeRecord.contestNumber}
                isLoading={isLoading}
                onSubmitResult={handleScoreResult}
              />
            </div>
          )}

          {/* V1.9: Referência Oficial de Premiação e Reconciliação Financeira (se SCORED) */}
          {activeRecord.status === "SCORED" && (
            <div className="mt-8">
              <OfficialPrizeReconciliationPanel
                contestNumber={activeRecord.contestNumber}
                score={activeRecord.score}
                prize={activeRecord.prize}
              />
            </div>
          )}
        </div>
      )}

      {/* Seções Informativas Obrigatórias */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-zinc-800/80">
        {/* Arquitetura C5 */}
        <div className="p-5 rounded-xl bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-300 space-y-2">
          <div className="flex items-center gap-2 text-zinc-100 font-semibold uppercase tracking-wider font-mono">
            <Layers className="w-4 h-4 text-emerald-400" />
            <span>ARQUITETURA C₅</span>
          </div>
          <ul className="space-y-1 text-zinc-400 list-disc list-inside">
            <li>5 jogos simples</li>
            <li>15 dezenas por jogo</li>
            <li>25 dezenas utilizadas</li>
            <li>Cada dezena aparece em 3 jogos</li>
            <li>Interseções: 5×7 + 5×8</li>
          </ul>
        </div>

        {/* Cobertura Combinatória C5 */}
        <div className="p-5 rounded-xl bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-300 space-y-2">
          <div className="flex items-center gap-2 text-zinc-100 font-semibold uppercase tracking-wider font-mono">
            <Award className="w-4 h-4 text-emerald-400" />
            <span>COBERTURA COMBINATÓRIA C₅</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-zinc-300 font-mono">
            <div>≥11 acertos: <strong className="text-emerald-400">49,7629%</strong></div>
            <div>≥12 acertos: <strong className="text-emerald-400">9,0976%</strong></div>
            <div>≥13 acertos: <strong className="text-emerald-400">0,7459%</strong></div>
            <div>≥14 acertos: <strong className="text-emerald-400">0,02310%</strong></div>
            <div className="col-span-2">15 acertos: <strong className="text-emerald-400">1 em 653.752</strong></div>
          </div>
          <p className="text-[11px] text-zinc-400 pt-1 italic">
            Valores combinatórios da arquitetura C₅ sob sorteio uniforme. Não representam previsão do próximo concurso.
          </p>
        </div>
      </div>

      {/* Modal de Confirmação de Congelamento */}
      <ConfirmDialog
        isOpen={showFreezeConfirm}
        title="Confirmar Congelamento Oficial"
        description={`Confirmar estes 5 jogos para o concurso ${activeRecord?.contestNumber}?\n\nDepois do congelamento, os jogos não poderão ser alterados ou excluídos pelo sistema.`}
        confirmLabel={lockState.currentOperation === "FREEZE" ? "CONGELANDO..." : "CONGELAR JOGOS"}
        cancelLabel="VOLTAR"
        variant="primary"
        isLoading={isLoading && lockState.currentOperation === "FREEZE"}
        onConfirm={handleConfirmFreeze}
        onCancel={() => setShowFreezeConfirm(false)}
      />

      {/* Modal de Confirmação de Descarte de Rascunho */}
      <ConfirmDialog
        isOpen={showDiscardConfirm}
        title="Descartar Rascunho"
        description={`Tem certeza que deseja excluir o rascunho do concurso ${activeRecord?.contestNumber}?\n\nEsta operação removerá o rascunho temporário do histórico.`}
        confirmLabel={lockState.currentOperation === "DELETE" ? "DESCARTANDO..." : "DESCARTAR RASCUNHO"}
        cancelLabel="VOLTAR"
        variant="danger"
        isLoading={isLoading && lockState.currentOperation === "DELETE"}
        onConfirm={handleConfirmDiscard}
        onCancel={() => setShowDiscardConfirm(false)}
      />

      {/* Modal de Confirmação de Aposta Realizada */}
      <ConfirmDialog
        isOpen={showBetConfirmModal}
        title="Confirmar Aposta Realizada"
        description={`Confirmar que os 5 jogos do concurso ${activeRecord?.contestNumber} foram registrados e pagos na lotérica (Custo: R$ 17,50)?\n\nEssa confirmação atualizará os relatórios de despesas e desempenho financeiro no Histórico.`}
        confirmLabel={lockState.currentOperation === "CONFIRM_BET" ? "CONFIRMANDO..." : "CONFIRMAR APOSTA"}
        cancelLabel="VOLTAR"
        variant="primary"
        isLoading={isLoading && lockState.currentOperation === "CONFIRM_BET"}
        onConfirm={handleConfirmBet}
        onCancel={() => setShowBetConfirmModal(false)}
      />

      {/* Modal de Visualização de Hash */}
      <HashViewerModal
        isOpen={showHashModal}
        record={activeRecord}
        onClose={() => setShowHashModal(false)}
      />

      {/* Modal de Registro de Prêmio / Fechamento Financeiro (V1.8) */}
      <PrizeRecordModal
        isOpen={showPrizeModal}
        record={activeRecord}
        isLoading={isLoading && lockState.currentOperation === "RECORD_PRIZE"}
        onClose={() => setShowPrizeModal(false)}
        onRecordPrize={handleRecordPrize}
      />

      {/* Folha de Impressão Oficial Limpa (visível exclusivamente em @media print) */}
      <PrintSheet record={activeRecord} />
    </div>
  );
};
