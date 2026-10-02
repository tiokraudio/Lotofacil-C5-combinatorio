import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Lock,
  RotateCcw,
  Copy,
  Printer,
  Info,
  Check,
  Ban,
  Layers,
  ChevronRight,
  ChevronLeft,
  Award,
  Calendar,
  History,
  Eye,
} from "lucide-react";
import type { ContestRecord, GameScore } from "../c5/types.ts";
import type { StorageOptions } from "../storage/types.ts";
import { repository as defaultRepository, ContestRepository } from "../storage/contestRepository.ts";
import {
  getMemoryOperationalState,
  generateMemoryDraft,
  confirmMemoryDraft,
  ExactHistoryDuplicateBlockedError,
  EXACT_HISTORY_DUPLICATE_BLOCKED,
} from "../c5-memory/application/memoryBetOrchestrator.ts";
import type {
  MemoryOperationalState,
  GenerateMemoryDraftResult,
  ConflictingGameDetail,
} from "../c5-memory/application/types.ts";
import type { C5MemoryDraft } from "../c5-memory/draft.ts";
import { StaleRevisionRejectedError } from "../c5-memory/draft.ts";
import { C5MemoryAuditModal } from "./C5MemoryAuditModal.tsx";
import { Ball } from "./Ball.tsx";
import { copyGamesToClipboard } from "../utils/clipboard.ts";
import { refreshCoordinator } from "../system/refreshCoordinator.ts";
import { formatLocalDate } from "../storage/service.ts";

export type C5OperationalStatus =
  | "AVAILABLE"
  | "PREVIEW"
  | "FROZEN"
  | "RESULT_PENDING"
  | "COMPLETED";

interface C5MemoryViewProps {
  onRecordUpdated?: () => void;
  options?: StorageOptions;
  repository?: ContestRepository;
  initialContestNumber?: number;
}

export const C5MemoryView: React.FC<C5MemoryViewProps> = ({
  onRecordUpdated,
  options,
  repository: propRepository,
  initialContestNumber,
}) => {
  const repo = propRepository ?? defaultRepository;

  // Estado do Concurso Alvo
  const [contestInput, setContestInput] = useState<string>(
    initialContestNumber ? String(initialContestNumber) : "3500"
  );
  const [targetContest, setTargetContest] = useState<number>(
    initialContestNumber ?? 3500
  );

  // Estados Operacionais
  const [opState, setOpState] = useState<MemoryOperationalState | null>(null);
  const [persistedRecord, setPersistedRecord] = useState<ContestRecord | null>(null);
  const [activeDraft, setActiveDraft] = useState<C5MemoryDraft | null>(null);
  const [recentRecords, setRecentRecords] = useState<ContestRecord[]>([]);

  // Estados de Processamento e Trava contra Duplo Disparo
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [isLoadingState, setIsLoadingState] = useState<boolean>(false);

  // Modais e Auditoria
  const [isAuditModalOpen, setIsAuditModalOpen] = useState<boolean>(false);
  const [auditTargetRecord, setAuditTargetRecord] = useState<ContestRecord | null>(null);

  // Tratamento de Erros de Domínio
  const [staleError, setStaleError] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<{
    message: string;
    conflictingGames: readonly ConflictingGameDetail[];
  } | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "info" | "success" | "warning" | "error";
    title?: string;
    message: string;
  } | null>(null);

  // Referência para evitar atualizações pós-desmonte
  const isMountedRef = useRef<boolean>(true);

  // 1. Carregamento do estado operacional e do registro persistido do concurso
  const loadContestState = useCallback(
    async (contestNumber: number) => {
      if (!Number.isInteger(contestNumber) || contestNumber <= 0) return;
      setIsLoadingState(true);

      try {
        const [state, record, all] = await Promise.all([
          getMemoryOperationalState(contestNumber, options, repo),
          repo.getContestRecord(contestNumber),
          repo.getAllContestRecords(),
        ]);

        if (!isMountedRef.current) return;

        setOpState(state);
        setPersistedRecord(record);
        setRecentRecords(all);

        // Se o concurso já está confirmado na base, não mantém Draft em memória
        if (record && (record.status === "FROZEN" || record.status === "SCORED")) {
          setActiveDraft(null);
          setStaleError(null);
          setDuplicateError(null);
        }
      } catch (err: any) {
        if (!isMountedRef.current) return;
        setFeedback({
          type: "error",
          title: "Erro ao Carregar Estado do Concurso",
          message: err?.message || "Não foi possível consultar o armazenamento local.",
        });
      } finally {
        if (isMountedRef.current) {
          setIsLoadingState(false);
        }
      }
    },
    [options, repo]
  );

  // Carregar concurso mais recente na inicialização caso nenhum seja passado
  useEffect(() => {
    isMountedRef.current = true;

    async function initContest() {
      try {
        const all = await repo.getAllContestRecords();
        if (all.length > 0 && !initialContestNumber) {
          const maxNum = Math.max(...all.map((r) => r.contestNumber));
          const nextNum = maxNum + 1;
          setContestInput(String(nextNum));
          setTargetContest(nextNum);
          loadContestState(nextNum);
          return;
        }
      } catch {
        // Fallback para valor inicial
      }
      loadContestState(targetContest);
    }

    initContest();

    return () => {
      isMountedRef.current = false;
    };
  }, [loadContestState, initialContestNumber, repo, targetContest]);

  // Inscrição no coordenador de refresh local e sincronização multiaba
  useEffect(() => {
    const unsubRefresh = refreshCoordinator.subscribe((_rev, reason, contestNum) => {
      if (contestNum === targetContest || reason === "BET_CONFIRMED" || reason === "IMPORT" || reason === "SCORE") {
        loadContestState(targetContest);
      }
    });

    return () => {
      unsubRefresh();
    };
  }, [targetContest, loadContestState]);

  // Navegação entre concursos
  const handleNavigateToContest = (num: number) => {
    if (num <= 0) return;
    setActiveDraft(null);
    setStaleError(null);
    setDuplicateError(null);
    setFeedback(null);
    setContestInput(String(num));
    setTargetContest(num);
    loadContestState(num);
  };

  // Manipulador de mudança de número de concurso via formulário
  const handleApplyContestNumber = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const parsed = parseInt(contestInput.trim(), 10);
    if (isNaN(parsed) || parsed <= 0) {
      setFeedback({
        type: "error",
        title: "Número Inválido",
        message: "Por favor, informe um número inteiro positivo para o concurso.",
      });
      return;
    }
    handleNavigateToContest(parsed);
  };

  // 2. Ação: GERAR C5 (Geração consentida explícita do usuário)
  const handleGenerate = async () => {
    if (isGenerating || isConfirming) return; // Proteção contra duplo clique/disparo concorrente

    setIsGenerating(true);
    setFeedback(null);
    setStaleError(null);
    setDuplicateError(null);

    try {
      // Chamada EXCLUSIVAMENTE via Application Layer
      const result: GenerateMemoryDraftResult = await generateMemoryDraft(
        targetContest,
        undefined, // seed determinística padrão (concurso >>> 0)
        options,
        repo
      );

      if (!isMountedRef.current) return;

      if (result.status === "READY") {
        setActiveDraft(result.draft);
        setFeedback({
          type: "info",
          title: "Preview Gerado com Sucesso",
          message: "5 jogos candidatos selecionados pelo algoritmo MAX-LEXIMIN. Confira os jogos abaixo antes de confirmar a aposta.",
        });
      } else if (result.status === "EXACT_HISTORY_DUPLICATE_BLOCKED") {
        setActiveDraft(null);
        setDuplicateError({
          message: "O C5 selecionou um jogo que já existe na memória. Esta geração não pode ser confirmada.",
          conflictingGames: result.conflictingGames,
        });
      } else if (result.status === "CONTEST_ALREADY_CONFIRMED") {
        setActiveDraft(null);
        await loadContestState(targetContest);
        setFeedback({
          type: "warning",
          title: "Aposta Já Confirmada",
          message: result.message,
        });
      } else if (result.status === "CONTEST_NOT_ELIGIBLE") {
        setActiveDraft(null);
        setFeedback({
          type: "error",
          title: "Concurso Não Elegível",
          message: result.reason,
        });
      }
    } catch (err: any) {
      if (!isMountedRef.current) return;
      setFeedback({
        type: "error",
        title: "Falha na Geração",
        message: err?.message || "Ocorreu um erro ao gerar a aposta C5.",
      });
    } finally {
      if (isMountedRef.current) {
        setIsGenerating(false);
      }
    }
  };

  // 3. Ação: DESCARTAR PREVIEW (Elimina rascunho sem qualquer efeito em H ou storage)
  const handleDiscard = () => {
    setActiveDraft(null);
    setDuplicateError(null);
    setStaleError(null);
    setFeedback({
      type: "info",
      title: "Preview Descartado",
      message: "O candidato foi descartado. Nenhum dado foi gravado na memória.",
    });
  };

  // 4. Ação: CONFIRMAR APOSTA (Persistência Atômica FROZEN + Avanço de H)
  const handleConfirm = async () => {
    if (isConfirming || isGenerating || !activeDraft) return; // Bloqueio estrito de reentrância

    setIsConfirming(true);
    setFeedback(null);

    try {
      // Chamada EXCLUSIVAMENTE via Application Layer
      const confirmed = await confirmMemoryDraft(
        targetContest,
        activeDraft,
        options,
        repo
      );

      if (!isMountedRef.current) return;

      // Sucesso definitivo no commit
      setPersistedRecord(confirmed);
      setActiveDraft(null);
      setStaleError(null);
      setDuplicateError(null);

      setFeedback({
        type: "success",
        title: "Aposta C5 Confirmada e Congelada",
        message: `Concurso ${targetContest} confirmado com sucesso (R$ 17,50). Os 5 jogos agora integram oficialmente a memória histórica.`,
      });

      if (onRecordUpdated) {
        onRecordUpdated();
      }

      await loadContestState(targetContest);
    } catch (err: any) {
      if (!isMountedRef.current) return;

      if (err instanceof StaleRevisionRejectedError || err.code === "STALE_REVISION_REJECTED") {
        // Invalidação imediata do preview em caso de divergência de revisão (concorrência/multiaba)
        setActiveDraft(null);
        setStaleError(
          "A memória do C5 mudou desde que estes jogos foram gerados. Por segurança, esta aposta não pode mais ser confirmada."
        );
      } else if (
        err instanceof ExactHistoryDuplicateBlockedError ||
        err.code === EXACT_HISTORY_DUPLICATE_BLOCKED
      ) {
        // Bloqueio atômico de duplicidade
        setActiveDraft(null);
        setDuplicateError({
          message: "O C5 selecionou um jogo que já existe na memória. Esta geração não pode ser confirmada.",
          conflictingGames: [],
        });
      } else {
        setFeedback({
          type: "error",
          title: "Erro ao Confirmar Aposta",
          message: err?.message || "Ocorreu um erro na transação de confirmação.",
        });
      }
    } finally {
      if (isMountedRef.current) {
        setIsConfirming(false);
      }
    }
  };

  // 5. Utilitários de Cópia e Impressão
  const handleCopyGames = async (games: readonly (readonly number[])[]) => {
    const res = await copyGamesToClipboard(games as number[][]);
    setFeedback({
      type: res.success ? "info" : "warning",
      title: res.success ? "Jogos Copiados" : "Atenção ao Copiar",
      message: res.message,
    });
  };

  const handlePrintGames = () => {
    window.print();
  };

  // Derivação explícita do estado operacional (UI-1C #3)
  const isScored = persistedRecord && persistedRecord.status === "SCORED";
  const isFrozen = persistedRecord && persistedRecord.status === "FROZEN";
  const isPreview = Boolean(activeDraft && !isFrozen && !isScored);

  let operationalStatus: C5OperationalStatus;
  if (isScored) {
    operationalStatus = "COMPLETED";
  } else if (isFrozen) {
    operationalStatus = "FROZEN";
  } else if (isPreview) {
    operationalStatus = "PREVIEW";
  } else {
    operationalStatus = "AVAILABLE";
  }

  const isConfirmedState = operationalStatus === "FROZEN" || operationalStatus === "COMPLETED";

  const displayGames: readonly (readonly number[])[] = isConfirmedState && persistedRecord
    ? persistedRecord.generation.games
    : activeDraft
    ? activeDraft.selectedC5
    : [];

  // Verificação de acertos dos jogos se houver resultado oficial
  const officialResult = persistedRecord?.officialResult;
  const officialScore = persistedRecord?.score;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Topo Informativo C5 */}
      <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-zinc-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold tracking-widest text-emerald-400 uppercase">
                Motor Combinatório com Memória
              </span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-mono font-semibold">
                C5-Memory
              </span>
            </div>
            <h2 className="text-2xl font-bold text-zinc-100 mt-1.5 font-mono">
              Portfólio com Diversificação Histórica MAX-LEXIMIN
            </h2>
            <p className="text-sm text-zinc-400 mt-1">
              5 apostas simples com garantia matemática de cobertura das 25 dezenas e anti-repetição exata.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="px-3.5 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs">
              <span className="text-zinc-400 block font-medium">Revisão de Memória:</span>
              <span className="text-emerald-400 font-mono font-semibold">
                Rev {opState?.historyRevision ?? 0} ({opState?.eligibleGamesCountInH ?? 0} jogos em H)
              </span>
            </div>
            <div className="px-3.5 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs">
              <span className="text-zinc-400 block font-medium">Custo Oficial:</span>
              <span className="text-emerald-400 font-mono font-semibold">R$ 17,50 (5 jogos)</span>
            </div>
          </div>
        </div>

        {/* Seleção e Navegação do Concurso Alvo */}
        <form onSubmit={handleApplyContestNumber} className="mt-6">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-end justify-between gap-3">
            <div className="grow max-w-md">
              <label
                htmlFor="contest-number-input"
                className="text-xs font-semibold text-zinc-300 block mb-1.5"
              >
                Concurso Alvo (somente inteiro positivo):
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="contest-number-input"
                  data-testid="c5-memory-contest-input"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="Ex: 3500"
                  value={contestInput}
                  onChange={(e) => setContestInput(e.target.value)}
                  disabled={isGenerating || isConfirming || isLoadingState}
                  className="w-full px-4 py-2 bg-zinc-950 border border-zinc-700 focus:border-emerald-500 rounded-xl text-zinc-100 placeholder-zinc-500 text-sm font-mono focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 transition-all disabled:opacity-50"
                />
                <button
                  type="submit"
                  id="btn-apply-contest"
                  disabled={isGenerating || isConfirming || isLoadingState || !contestInput.trim()}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold text-xs tracking-wide transition-all border border-zinc-700 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
                >
                  <span>IR</span>
                </button>
              </div>
            </div>

            {/* Controles de Navegação Entre Concursos */}
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                type="button"
                id="btn-nav-prev-contest"
                onClick={() => handleNavigateToContest(targetContest - 1)}
                disabled={targetContest <= 1 || isGenerating || isConfirming}
                className="px-3 py-2 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-zinc-100 text-xs font-medium inline-flex items-center gap-1 transition-colors disabled:opacity-40 cursor-pointer"
                title="Ir para o concurso anterior"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Anterior ({targetContest - 1})</span>
              </button>
              <button
                type="button"
                id="btn-nav-next-contest"
                onClick={() => handleNavigateToContest(targetContest + 1)}
                disabled={isGenerating || isConfirming}
                className="px-3 py-2 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-zinc-100 text-xs font-medium inline-flex items-center gap-1 transition-colors cursor-pointer"
                title="Ir para o próximo concurso"
              >
                <span>Próximo ({targetContest + 1})</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Feedback contextual / avisos */}
      {feedback && (
        <div
          id="c5-memory-feedback-banner"
          role="alert"
          className={`p-4 rounded-xl border text-xs sm:text-sm flex items-start justify-between gap-3 shadow-md animate-in fade-in duration-200 ${
            feedback.type === "success"
              ? "bg-emerald-950/40 border-emerald-500/50 text-emerald-200"
              : feedback.type === "error"
              ? "bg-rose-950/40 border-rose-500/50 text-rose-200"
              : feedback.type === "warning"
              ? "bg-amber-950/40 border-amber-500/50 text-amber-200"
              : "bg-zinc-900 border-zinc-700 text-zinc-300"
          }`}
        >
          <div className="flex items-start gap-2.5">
            {feedback.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            ) : feedback.type === "error" ? (
              <Ban className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            ) : feedback.type === "warning" ? (
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            ) : (
              <Info className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            )}
            <div>
              {feedback.title && <strong className="block font-semibold">{feedback.title}</strong>}
              <p className="leading-relaxed">{feedback.message}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-zinc-400 hover:text-zinc-200 text-xs cursor-pointer"
          >
            Fechar
          </button>
        </div>
      )}

      {/* Erro de Repetição (Hard Block UI-1A.1) */}
      {duplicateError && (
        <div
          id="c5-memory-duplicate-banner"
          role="alert"
          className="p-5 rounded-2xl bg-rose-950/40 border border-rose-500/60 text-rose-100 shadow-xl space-y-3"
        >
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-rose-900/60 border border-rose-500/40 flex items-center justify-center text-rose-400 shrink-0">
              <Ban className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm font-mono text-rose-200">
                HARD BLOCK DE REPETIÇÃO ACIONADO
              </h3>
              <p className="text-xs text-rose-300 mt-1 leading-relaxed">
                {duplicateError.message}
              </p>
            </div>
          </div>

          {duplicateError.conflictingGames.length > 0 && (
            <div className="p-3 rounded-xl bg-zinc-950/80 border border-rose-900/50 space-y-1.5 font-mono text-xs">
              <span className="text-[11px] text-zinc-400 block font-semibold">
                Jogos conflitantes detectados contra a memória:
              </span>
              {duplicateError.conflictingGames.map((cg) => (
                <div key={`dup-game-${cg.gameIndex}`} className="text-rose-300">
                  Jogo {cg.gameIndex + 1}: {cg.canonicalGame}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              id="btn-duplicate-generate-again"
              onClick={handleGenerate}
              disabled={isGenerating}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs transition-colors cursor-pointer"
            >
              Gerar novamente
            </button>
            <button
              type="button"
              id="btn-duplicate-discard"
              onClick={handleDiscard}
              className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium text-xs transition-colors cursor-pointer"
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      {/* Erro de Revisão Stale (Invalidação de Concorrência) */}
      {staleError && (
        <div
          id="c5-memory-stale-banner"
          role="alert"
          className="p-5 rounded-2xl bg-amber-950/40 border border-amber-500/60 text-amber-100 shadow-xl space-y-3"
        >
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-900/60 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm font-mono text-amber-200">
                PREVIEW INVALIDADO POR DESATUALIZAÇÃO (STALE)
              </h3>
              <p className="text-xs text-amber-300 mt-1 leading-relaxed">
                {staleError}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              id="btn-stale-generate-new"
              onClick={handleGenerate}
              disabled={isGenerating}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors cursor-pointer"
            >
              Gerar novo C5
            </button>
          </div>
        </div>
      )}

      {/* Painel Central: Operação do Concurso (AVAILABLE / PREVIEW / FROZEN / COMPLETED) */}
      <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-xs shrink-0 ${
                operationalStatus === "COMPLETED"
                  ? "bg-purple-950/80 border border-purple-500/40 text-purple-400"
                  : operationalStatus === "FROZEN"
                  ? "bg-emerald-950/80 border border-emerald-500/40 text-emerald-400"
                  : operationalStatus === "PREVIEW"
                  ? "bg-amber-950/80 border border-amber-500/40 text-amber-400"
                  : "bg-zinc-800 border border-zinc-700 text-zinc-300"
              }`}
            >
              {operationalStatus === "COMPLETED" ? (
                <Award className="w-5 h-5" />
              ) : operationalStatus === "FROZEN" ? (
                <Lock className="w-5 h-5" />
              ) : operationalStatus === "PREVIEW" ? (
                <Layers className="w-5 h-5" />
              ) : (
                <Sparkles className="w-5 h-5" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-zinc-100 font-mono">
                  Concurso {targetContest}
                </h3>
                <span
                  id="c5-memory-status-badge"
                  className={`text-xs px-2.5 py-0.5 rounded-full font-mono font-semibold border ${
                    operationalStatus === "COMPLETED"
                      ? "bg-purple-950/60 border-purple-500/40 text-purple-300"
                      : operationalStatus === "FROZEN"
                      ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-300"
                      : operationalStatus === "PREVIEW"
                      ? "bg-amber-950/60 border-amber-500/40 text-amber-300"
                      : "bg-zinc-800 border-zinc-700 text-zinc-300"
                  }`}
                >
                  {operationalStatus === "COMPLETED"
                    ? "Concurso Encerrado"
                    : operationalStatus === "FROZEN"
                    ? "Aposta C5 confirmada"
                    : operationalStatus === "PREVIEW"
                    ? "C5-Memory — Preview"
                    : "C5 disponível"}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                {operationalStatus === "COMPLETED"
                  ? `Resultado apurado em ${formatLocalDate(persistedRecord?.scoredAt || "")}`
                  : operationalStatus === "FROZEN"
                  ? `Confirmado em ${formatLocalDate(persistedRecord?.frozenAt || persistedRecord?.betPlacedAt || "")}`
                  : operationalStatus === "PREVIEW"
                  ? "Candidato aguardando decisão do apostador"
                  : "Concurso apto a receber uma nova aposta C5"}
              </p>
            </div>
          </div>

          {/* Botão de Acesso à Auditoria C5 (para registros existentes ou preview) */}
          <div className="flex items-center gap-2">
            {(isConfirmedState || isPreview) && (
              <button
                type="button"
                id="btn-view-audit"
                onClick={() => {
                  setAuditTargetRecord(persistedRecord);
                  setIsAuditModalOpen(true);
                }}
                className="px-3.5 py-2 rounded-xl bg-zinc-950 hover:bg-zinc-800 text-zinc-300 hover:text-zinc-100 border border-zinc-800 text-xs font-mono font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Ver auditoria</span>
              </button>
            )}
          </div>
        </div>

        {/* CENÁRIO 1: Estado AVAILABLE (Concurso apto a receber novo C5) */}
        {operationalStatus === "AVAILABLE" && !duplicateError && !staleError && (
          <div className="py-8 text-center space-y-4">
            <div className="max-w-md mx-auto space-y-2">
              <p className="text-sm text-zinc-300">
                O concurso <strong>{targetContest}</strong> está disponível para uma nova aposta C5.
              </p>
              <p className="text-xs text-zinc-500">
                A geração avalia 500 candidatos no pool, calcula a diversificação lexicográfica contra os {opState?.eligibleGamesCountInH ?? 0} jogos de H e apresenta o vencedor em modo Preview.
              </p>
            </div>

            <div className="pt-2">
              <button
                type="button"
                id="btn-generate-c5"
                onClick={handleGenerate}
                disabled={isGenerating || isConfirming || isLoadingState}
                className="px-8 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm tracking-wide transition-all shadow-lg hover:shadow-emerald-950/50 inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus:ring-2 focus:ring-emerald-400"
              >
                {isGenerating ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                <span>{isGenerating ? "AVALIANDO POOL (500)..." : "Gerar C5"}</span>
              </button>
            </div>
          </div>
        )}

        {/* CENÁRIO 2: Estado PREVIEW (Candidato Gerado, Ainda Não Adicionado à Memória) */}
        {operationalStatus === "PREVIEW" && (
          <div id="c5-memory-preview-container" className="space-y-6">
            {/* Aviso Obrigatório de Preview (UI-1B #4) */}
            <div
              id="c5-memory-preview-disclaimer"
              className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/40 text-amber-200 text-xs flex items-start gap-2.5 shadow-sm"
            >
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong>CANDIDATO / PREVIEW:</strong> Estes jogos ainda não foram adicionados à memória.
                Somente a confirmação autoritativa transforma os 5 jogos em memória histórica.
              </div>
            </div>

            {/* Visualização dos 5 Jogos em Preview */}
            <div className="space-y-3">
              {displayGames.map((game, idx) => {
                const gameNum = idx + 1;
                return (
                  <div
                    key={`preview-game-${gameNum}`}
                    id={`preview-game-card-${gameNum}`}
                    className="p-4 rounded-xl bg-zinc-950/70 border border-zinc-800 space-y-2.5"
                  >
                    <div className="flex items-center justify-between text-xs font-mono">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-md bg-zinc-800 flex items-center justify-center text-zinc-300 font-bold">
                          {gameNum}
                        </span>
                        <span className="font-semibold text-zinc-200 uppercase">
                          Jogo {gameNum}
                        </span>
                        <span className="text-zinc-500">(15 dezenas)</span>
                      </div>
                      <span className="text-[11px] text-zinc-400 font-mono">
                        {[...game].sort((a, b) => a - b).map((n) => String(n).padStart(2, "0")).join(" ")}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1.5 sm:gap-2">
                      {[...game].sort((a, b) => a - b).map((num) => (
                        <Ball key={`g${gameNum}-n${num}`} number={num} size="md" />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Barra de Ações do Preview: Confirmar vs Descartar */}
            <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-zinc-400 font-mono">
                Custo total da aposta: <span className="text-emerald-400 font-bold">R$ 17,50</span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  id="btn-discard-draft"
                  onClick={handleDiscard}
                  disabled={isConfirming || isGenerating}
                  className="px-5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50"
                >
                  Descartar
                </button>

                <button
                  type="button"
                  id="btn-confirm-bet"
                  onClick={handleConfirm}
                  disabled={isConfirming || isGenerating}
                  className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs tracking-wide transition-all shadow-md inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 focus:ring-2 focus:ring-emerald-400"
                >
                  {isConfirming ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  <span>{isConfirming ? "CONFIRMANDO..." : "Confirmar aposta"}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* CENÁRIO 3: Estado FROZEN / RESULT_PENDING (Aposta Confirmada, Aguardando Resultado) */}
        {operationalStatus === "FROZEN" && (
          <div id="c5-memory-frozen-container" className="space-y-6">
            <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/40 text-emerald-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-sm">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  <strong>Aposta confirmada:</strong> Os 5 jogos abaixo foram persistidos no armazenamento local e pertencem à memória histórica C5. Aguardando realização e resultado oficial do concurso.
                </span>
              </div>
              <div className="font-mono text-emerald-400 font-semibold text-[11px] whitespace-nowrap">
                R$ 17,50 CONFIRMADO
              </div>
            </div>

            {/* Visualização dos 5 Jogos Congelados */}
            <div className="space-y-3">
              {displayGames.map((game, idx) => {
                const gameNum = idx + 1;
                return (
                  <div
                    key={`frozen-game-${gameNum}`}
                    id={`frozen-game-card-${gameNum}`}
                    className="p-4 rounded-xl bg-zinc-950/70 border border-zinc-800 space-y-2.5"
                  >
                    <div className="flex items-center justify-between text-xs font-mono">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-md bg-emerald-950/80 border border-emerald-500/30 flex items-center justify-center text-emerald-300 font-bold">
                          {gameNum}
                        </span>
                        <span className="font-semibold text-zinc-200 uppercase">
                          Jogo {gameNum}
                        </span>
                        <span className="text-zinc-500">(15 dezenas)</span>
                      </div>
                      <span className="text-[11px] text-zinc-400 font-mono">
                        {[...game].sort((a, b) => a - b).map((n) => String(n).padStart(2, "0")).join(" ")}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1.5 sm:gap-2">
                      {[...game].sort((a, b) => a - b).map((num) => (
                        <Ball key={`fg${gameNum}-n${num}`} number={num} size="md" />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Ações e Transição Natural para o Próximo Concurso (UI-1C #7) */}
            <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  id="btn-copy-frozen-games"
                  onClick={() => handleCopyGames(displayGames)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar Jogos</span>
                </button>
                <button
                  type="button"
                  id="btn-print-frozen-games"
                  onClick={handlePrintGames}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Imprimir</span>
                </button>
              </div>

              {/* Transição para o Próximo Concurso */}
              <button
                type="button"
                id="btn-next-cycle-from-frozen"
                onClick={() => handleNavigateToContest(targetContest + 1)}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs tracking-wide transition-all shadow-md inline-flex items-center gap-2 cursor-pointer"
              >
                <span>Próximo Concurso ({targetContest + 1})</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* CENÁRIO 4: Estado COMPLETED (Concurso Encerrado com Resultado Oficial e Desempenho) */}
        {operationalStatus === "COMPLETED" && (
          <div id="c5-memory-completed-container" className="space-y-6">
            {/* Banner de Concurso Encerrado */}
            <div className="p-4 rounded-xl bg-purple-950/30 border border-purple-500/40 text-purple-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-sm">
              <div className="flex items-center gap-2">
                <Award className="w-4 h-4 text-purple-400 shrink-0" />
                <span>
                  <strong>Concurso Encerrado:</strong> Resultado oficial registrado pela CAIXA. Desempenho dos 5 jogos apurado e histórico atualizado.
                </span>
              </div>
              {officialScore && (
                <div className="font-mono text-purple-300 font-bold text-xs">
                  MELHOR JOGO: {officialScore.maxHits} ACERTOS
                </div>
              )}
            </div>

            {/* Resultado Oficial da Lotofácil (15 Dezenas da CAIXA) */}
            {officialResult && (
              <div className="p-5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold tracking-wider text-purple-300 uppercase">
                    Resultado Oficial Sorteado (15 Dezenas CAIXA)
                  </span>
                  <span className="text-[11px] text-zinc-400">
                    Fonte oficial integrada
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                  {[...officialResult].sort((a, b) => a - b).map((num) => (
                    <Ball key={`official-res-${num}`} number={num} variant="official" size="md" />
                  ))}
                </div>
              </div>
            )}

            {/* Desempenho dos 5 Jogos Congelados (UI-1C #6) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-mono text-zinc-400">
                <span>DESEMPENHO DOS 5 JOGOS (INFORMATIVO)</span>
                <span>Dezenas acertadas em destaque</span>
              </div>

              {displayGames.map((game, idx) => {
                const gameNum = idx + 1;
                const gameScore: GameScore | undefined = officialScore?.games[idx];
                const hits = gameScore ? gameScore.hits : (officialResult ? game.filter((n) => officialResult.includes(n)).length : 0);
                const isPrized = hits >= 11;

                return (
                  <div
                    key={`completed-game-${gameNum}`}
                    id={`completed-game-card-${gameNum}`}
                    className={`p-4 rounded-xl border space-y-2.5 transition-colors ${
                      isPrized
                        ? "bg-emerald-950/20 border-emerald-500/40"
                        : "bg-zinc-950/70 border-zinc-800"
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-mono">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-5 h-5 rounded-md flex items-center justify-center font-bold text-xs ${
                            isPrized
                              ? "bg-emerald-500 text-zinc-950"
                              : "bg-zinc-800 text-zinc-300"
                          }`}
                        >
                          {gameNum}
                        </span>
                        <span className="font-semibold text-zinc-200 uppercase">
                          Jogo {gameNum}
                        </span>
                        <span className="text-zinc-500">—</span>
                        <span
                          className={`font-bold ${
                            isPrized ? "text-emerald-400" : "text-zinc-300"
                          }`}
                        >
                          {hits} ACERTOS
                        </span>
                        {isPrized && (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-mono text-[10px]">
                            PREMIADO ({hits} DEZENAS)
                          </span>
                        )}
                      </div>

                      <span className="text-[11px] text-zinc-400 font-mono">
                        {[...game].sort((a, b) => a - b).map((n) => String(n).padStart(2, "0")).join(" ")}
                      </span>
                    </div>

                    {/* Dezenas com destaque para acertos */}
                    <div className="flex flex-wrap gap-1.5 sm:gap-2">
                      {[...game].sort((a, b) => a - b).map((num) => {
                        const isHit = officialResult?.includes(num);
                        return (
                          <Ball
                            key={`cg${gameNum}-n${num}`}
                            number={num}
                            size="md"
                            variant={isHit ? "hit" : "default"}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Aviso de Isolamento Matemático */}
            <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800/80 text-[11px] text-zinc-400 space-y-1">
              <span className="font-semibold text-zinc-300 block">Isolamento Exógeno Garantido:</span>
              <p>
                Os dados de sorteio oficial e acertos são estritamente informativos. Eles não alteram a seleção histórica, não modificam a semente determinística nem afetam o algoritmo C5.
              </p>
            </div>

            {/* Ações e Transição Natural para o Próximo Concurso (UI-1C #7) */}
            <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  id="btn-copy-completed-games"
                  onClick={() => handleCopyGames(displayGames)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar Jogos</span>
                </button>
                <button
                  type="button"
                  id="btn-print-completed-games"
                  onClick={handlePrintGames}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Imprimir</span>
                </button>
              </div>

              {/* Botão de Transição para o Próximo Concurso Elegível */}
              <button
                type="button"
                id="btn-next-cycle-from-completed"
                onClick={() => handleNavigateToContest(targetContest + 1)}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs tracking-wide transition-all shadow-md inline-flex items-center gap-2 cursor-pointer"
              >
                <span>Avançar para o Concurso {targetContest + 1} (Novo Ciclo)</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* SEÇÃO: HISTÓRICO C5 (UI-1C #10) */}
      <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
          <div className="flex items-center gap-2.5">
            <History className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-bold font-mono text-zinc-100">
              Histórico de Concursos C5
            </h3>
          </div>
          <span className="text-xs text-zinc-400 font-mono">
            {recentRecords.length} concurso(s) registrado(s)
          </span>
        </div>

        {recentRecords.length === 0 ? (
          <div className="py-8 text-center text-xs text-zinc-400">
            Nenhum concurso gravado localmente ainda. Gere e confirme o primeiro C5 acima.
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/80">
            {recentRecords
              .slice()
              .sort((a, b) => b.contestNumber - a.contestNumber)
              .map((rec) => {
                const isRecScored = rec.status === "SCORED";
                const isRecFrozen = rec.status === "FROZEN";
                const isMemory = rec.memoryPayload?.algorithmVersion === "C5-Memory-2.0.0";
                const isSelected = rec.contestNumber === targetContest;

                return (
                  <div
                    key={`c5-hist-${rec.contestNumber}`}
                    className={`py-3.5 px-3 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                      isSelected ? "bg-zinc-800/40 border border-zinc-700/60" : "hover:bg-zinc-950/40"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center font-mono font-bold text-xs text-zinc-200 shrink-0">
                        {rec.contestNumber}
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold font-mono text-xs text-zinc-200">
                            Concurso {rec.contestNumber}
                          </span>

                          {/* Status */}
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold border ${
                              isRecScored
                                ? "bg-purple-950/60 border-purple-500/40 text-purple-300"
                                : isRecFrozen
                                ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-300"
                                : "bg-amber-950/60 border-amber-500/40 text-amber-300"
                            }`}
                          >
                            {isRecScored ? "ENCERRADO" : isRecFrozen ? "CONFIRMADO" : "RASCUNHO"}
                          </span>

                          {/* Tag de Algoritmo */}
                          {isMemory ? (
                            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-950/40 border border-emerald-500/30 text-emerald-400 font-mono">
                              C5-Memory
                            </span>
                          ) : (
                            <span
                              className="text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 font-mono"
                              title="Registro histórico gerado na versão anterior"
                            >
                              C5 legado
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] text-zinc-400 mt-0.5 flex items-center gap-3">
                          <span>
                            {rec.betPlacedAt
                              ? `Apostado em ${formatLocalDate(rec.betPlacedAt)}`
                              : rec.frozenAt
                              ? `Congelado em ${formatLocalDate(rec.frozenAt)}`
                              : `Gerado em ${formatLocalDate(rec.generatedAt)}`}
                          </span>

                          {isRecScored && rec.score && (
                            <span className="font-mono text-purple-300 font-semibold">
                              Melhor: {rec.score.maxHits} acertos
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      {/* Botão de Auditoria para C5-Memory */}
                      {isMemory && (
                        <button
                          type="button"
                          id={`btn-audit-hist-${rec.contestNumber}`}
                          onClick={() => {
                            setAuditTargetRecord(rec);
                            setIsAuditModalOpen(true);
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-zinc-100 text-[11px] font-mono inline-flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <ShieldCheck className="w-3 h-3 text-emerald-400" />
                          <span>Auditoria</span>
                        </button>
                      )}

                      {/* Botão para carregar concurso no painel */}
                      <button
                        type="button"
                        id={`btn-load-hist-${rec.contestNumber}`}
                        onClick={() => handleNavigateToContest(rec.contestNumber)}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-zinc-700 text-zinc-200 cursor-default"
                            : "bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                        }`}
                      >
                        {isSelected ? "Em Exibição" : "Ver no Painel"}
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Modal de Auditoria C5-Memory (Somente Leitura) */}
      <C5MemoryAuditModal
        isOpen={isAuditModalOpen}
        onClose={() => {
          setIsAuditModalOpen(false);
          setAuditTargetRecord(null);
        }}
        contestNumber={auditTargetRecord?.contestNumber ?? targetContest}
        draft={auditTargetRecord ? null : activeDraft}
        record={auditTargetRecord ?? persistedRecord}
      />
    </div>
  );
};
