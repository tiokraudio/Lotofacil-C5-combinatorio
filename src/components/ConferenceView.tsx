import React, { useState, useEffect, useCallback } from "react";
import {
  Search,
  CheckCircle2,
  AlertCircle,
  Clock,
  Award,
  Globe,
  DollarSign,
  Layers,
  Lock,
  ChevronRight,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import type { ContestRecord } from "../c5/types.ts";
import { ContestRepository, repository as defaultRepository } from "../storage/contestRepository.ts";
import {
  OfficialSnapshotCoordinator,
  officialSnapshotCoordinator as defaultSnapshotCoordinator,
} from "../sync/officialSnapshotCoordinator.ts";
import { refreshCoordinator } from "../system/refreshCoordinator.ts";
import { GamesDisplay } from "./GamesDisplay.tsx";
import { Ball } from "./Ball.tsx";
import { OfficialResultAuditPanel } from "./OfficialResultAuditPanel.tsx";
import { OfficialPrizeReconciliationPanel } from "./OfficialPrizeReconciliationPanel.tsx";
import { PrizeRecordModal } from "./PrizeRecordModal.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { isEligibleForFinancialReconciliation } from "../sync/index.ts";
import { formatLocalDate } from "../storage/service.ts";
import { formatBRLFromCents, formatSignedBRLFromCents } from "../utils/money.ts";
import { validateOfficialResult } from "../sync/operationalState.ts";
import { classifyOperationalError } from "../system/operationalErrors.ts";
import { actionLockController } from "../system/actionLock.ts";

export interface ConferenceViewProps {
  initialContestNumber?: number;
  coordinator?: OfficialSnapshotCoordinator;
  repository?: ContestRepository;
  onRecordUpdated?: () => void;
}

export interface OfficialPreviewData {
  contestNumber: number;
  numbers: number[];
  drawDate: string;
  source: string;
}

export const ConferenceView: React.FC<ConferenceViewProps> = ({
  initialContestNumber,
  coordinator = defaultSnapshotCoordinator,
  repository = defaultRepository,
  onRecordUpdated,
}) => {
  const [contestInput, setContestInput] = useState<string>(
    initialContestNumber ? String(initialContestNumber) : ""
  );
  const [activeRecord, setActiveRecord] = useState<ContestRecord | null>(null);
  const [allRecords, setAllRecords] = useState<ContestRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isConsulting, setIsConsulting] = useState<boolean>(false);
  const [isScoring, setIsScoring] = useState<boolean>(false);
  const [preview, setPreview] = useState<OfficialPreviewData | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "warning" | "info";
    title?: string;
    message: string;
  } | null>(null);

  const [showPrizeModal, setShowPrizeModal] = useState<boolean>(false);
  const [showLegacyBetModal, setShowLegacyBetModal] = useState<boolean>(false);
  const [showScoreModal, setShowScoreModal] = useState<boolean>(false);

  // Carrega lista local de concursos gravados (ZERO consultas externas de rede)
  const loadLocalRecords = useCallback(async () => {
    try {
      const records = await repository.getAllContestRecords();
      setAllRecords(records);
    } catch {
      // Ignorar falha transitória
    }
  }, [repository]);

  // Carga inicial exclusivamente local no mount (ZERO HTTP)
  useEffect(() => {
    loadLocalRecords();
    if (initialContestNumber) {
      handleSelectContest(initialContestNumber);
    }
  }, [loadLocalRecords, initialContestNumber]);

  // Atualização reativa de mutações persistidas
  useEffect(() => {
    const unsub = refreshCoordinator.subscribe((_rev, _reason, contestNum) => {
      loadLocalRecords();
      if (activeRecord && contestNum === activeRecord.contestNumber) {
        repository.getContestRecord(activeRecord.contestNumber).then((fresh) => {
          if (fresh) setActiveRecord(fresh);
        });
      }
    });
    return unsub;
  }, [repository, activeRecord, loadLocalRecords]);

  // Carrega concurso específico
  const handleSelectContest = async (contestNum: number) => {
    setIsLoading(true);
    setFeedback(null);
    setPreview(null);
    try {
      const rec = await repository.getContestRecord(contestNum);
      if (rec) {
        setActiveRecord(rec);
        setContestInput(String(contestNum));
      } else {
        setActiveRecord(null);
        setFeedback({
          type: "warning",
          title: "Concurso Não Encontrado",
          message: `Nenhum registro encontrado para o concurso ${contestNum} no histórico local.`,
        });
      }
    } catch (err: any) {
      const classified = classifyOperationalError(err);
      setFeedback({
        type: "error",
        title: "Erro ao Carregar",
        message: classified.userMessage,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseInt(contestInput.trim(), 10);
    if (isNaN(num) || num <= 0) {
      setFeedback({
        type: "error",
        title: "Número Inválido",
        message: "Informe um número inteiro positivo para pesquisar o concurso.",
      });
      return;
    }
    handleSelectContest(num);
  };

  // Consulta explícita da CAIXA acionada pelo usuário (FLOW06)
  const handleConsultCaixa = async () => {
    if (!activeRecord) return;
    const num = activeRecord.contestNumber;

    if (!actionLockController.acquire("CAIXA_QUERY")) {
      return;
    }

    setIsConsulting(true);
    setFeedback(null);

    try {
      // Consulta coordenada de sessão usando o coordinator oficial da sessão
      const result = await coordinator.consultContest(num);

      if (result.contestNumber !== num) {
        setFeedback({
          type: "error",
          title: "Divergência de Concurso",
          message: `A fonte oficial retornou o concurso ${result.contestNumber}, esperado ${num}.`,
        });
        return;
      }

      const validatedNumbers = validateOfficialResult(result.numbers);

      // Estabelece prévia oficial (FLOW07: NÃO pontua automaticamente, registro continua FROZEN)
      setPreview({
        contestNumber: result.contestNumber,
        numbers: validatedNumbers,
        drawDate: result.drawDate || "",
        source: result.source || "CAIXA_OFFICIAL_API",
      });

      setFeedback({
        type: "info",
        title: "Resultado Obtido com Sucesso",
        message: `Apuração oficial da CAIXA obtida para o concurso ${num}. Confira as 15 dezenas e confirme a conferência para pontuar.`,
      });
    } catch (err: any) {
      const classified = classifyOperationalError(err, "CAIXA_TEMPORARY_ERROR");
      setFeedback({
        type: "warning",
        title: "Consulta CAIXA Indisponível",
        message: classified.userMessage,
      });
    } finally {
      actionLockController.release("CAIXA_QUERY");
      setIsConsulting(false);
    }
  };

  // Confirmação explícita da conferência / pontuação (FLOW08)
  const handleConfirmScore = async () => {
    if (!activeRecord || !preview || activeRecord.status !== "FROZEN") return;
    const num = activeRecord.contestNumber;

    if (!actionLockController.acquire("SCORE")) {
      return;
    }

    setIsScoring(true);
    setFeedback(null);

    try {
      const scored = await repository.scoreStoredContest(num, preview.numbers);
      setActiveRecord(scored);
      setPreview(null);
      setShowScoreModal(false);
      setFeedback({
        type: "success",
        title: "Concurso Conferido e Pontuado",
        message: `O concurso ${num} foi pontuado com sucesso. Melhor resultado: ${scored.score?.maxHits} acertos.`,
      });
      if (onRecordUpdated) onRecordUpdated();
      loadLocalRecords();
    } catch (err: any) {
      const classified = classifyOperationalError(err);
      setFeedback({
        type: "error",
        title: "Falha na Conferência",
        message: classified.userMessage,
      });
    } finally {
      actionLockController.release("SCORE");
      setIsScoring(false);
    }
  };

  // Confirmação legada de aposta (LEGACY03, LEGACY05)
  const handleConfirmLegacyBet = async () => {
    if (!activeRecord || activeRecord.status !== "FROZEN" || activeRecord.betPlacedAt) return;
    const num = activeRecord.contestNumber;

    if (!actionLockController.acquire("CONFIRM_BET")) return;

    try {
      const confirmed = await repository.confirmBetPlaced(num);
      setActiveRecord(confirmed);
      setShowLegacyBetModal(false);
      setFeedback({
        type: "success",
        title: "Aposta Confirmada (Legado)",
        message: `Aposta do concurso legado ${num} confirmada com sucesso. Agora está apto para conferência.`,
      });
      if (onRecordUpdated) onRecordUpdated();
      loadLocalRecords();
    } catch (err: any) {
      const classified = classifyOperationalError(err);
      setFeedback({
        type: "error",
        title: "Erro ao Confirmar Aposta",
        message: classified.userMessage,
      });
    } finally {
      actionLockController.release("CONFIRM_BET");
    }
  };

  // Registro manual de prêmio financeiro
  const handleRecordPrize = async (amountCents: number) => {
    if (!activeRecord || activeRecord.status !== "SCORED") return;
    const num = activeRecord.contestNumber;

    if (!actionLockController.acquire("RECORD_PRIZE")) return;

    try {
      const updated = await repository.recordPrize(num, amountCents);
      setActiveRecord(updated);
      setShowPrizeModal(false);
      setFeedback({
        type: "success",
        title: "Prêmio Registrado",
        message: `O valor do prêmio do concurso ${num} foi registrado com sucesso no histórico financeiro.`,
      });
      if (onRecordUpdated) onRecordUpdated();
      loadLocalRecords();
    } catch (err: any) {
      const classified = classifyOperationalError(err);
      setFeedback({
        type: "error",
        title: "Erro ao Registrar Prêmio",
        message: classified.userMessage,
      });
    } finally {
      actionLockController.release("RECORD_PRIZE");
    }
  };

  const isLegacyFrozenWithoutBet =
    activeRecord?.status === "FROZEN" && !activeRecord.betPlacedAt;

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Topo da Aba Conferência */}
      <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-zinc-800">
          <div>
            <span className="text-xs font-mono font-bold tracking-widest text-emerald-400 uppercase">
              Conferência Oficial C₅
            </span>
            <h2 className="text-2xl font-bold text-zinc-100 mt-1 font-mono">
              Apuração, Acertos e Auditoria Oficial
            </h2>
            <p className="text-sm text-zinc-400 mt-1">
              Consulte a base oficial da CAIXA, confira suas apostas confirmadas e audite os resultados.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="px-3.5 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs">
              <span className="text-zinc-400 block font-medium">Apostas por concurso:</span>
              <span className="text-zinc-200 font-mono font-semibold">5 jogos (R$ 17,50)</span>
            </div>
          </div>
        </div>

        {/* Barra de Seleção / Pesquisa de Concurso */}
        <form onSubmit={handleSearchSubmit} className="mt-6">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3 max-w-2xl">
            <div className="grow">
              <label htmlFor="conference-contest-input" className="text-xs font-semibold text-zinc-300 block mb-1.5">
                Número do Concurso para Conferir:
              </label>
              <input
                id="conference-contest-input"
                type="number"
                min="1"
                step="1"
                placeholder="Ex: 3350"
                value={contestInput}
                onChange={(e) => setContestInput(e.target.value)}
                disabled={isLoading || isConsulting || isScoring}
                className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-700 focus:border-emerald-500 rounded-xl text-zinc-100 placeholder-zinc-500 text-sm font-mono focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 transition-all disabled:opacity-50"
              />
            </div>

            <button
              type="submit"
              id="btn-search-conference"
              disabled={isLoading || isConsulting || isScoring || !contestInput.trim()}
              className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm tracking-wide transition-all shadow-md inline-flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              <Search className="w-4 h-4" />
              <span>CARREGAR</span>
            </button>
          </div>

          {/* Atalhos para concursos locais gravados */}
          {allRecords.length > 0 && (
            <div className="mt-4 pt-3 border-t border-zinc-800/60 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-zinc-400 font-medium">Concursos gravados:</span>
              {allRecords.slice(0, 8).map((rec) => (
                <button
                  key={`quick-conf-${rec.contestNumber}`}
                  type="button"
                  onClick={() => handleSelectContest(rec.contestNumber)}
                  className={`px-2.5 py-1 rounded-lg font-mono text-xs border transition-colors cursor-pointer ${
                    activeRecord?.contestNumber === rec.contestNumber
                      ? "bg-emerald-950/60 border-emerald-500/60 text-emerald-300 font-bold"
                      : "bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-300"
                  }`}
                >
                  {rec.contestNumber} ({rec.status})
                </button>
              ))}
            </div>
          )}
        </form>

        {/* Feedback visual */}
        {feedback && (
          <div
            id="conference-feedback-banner"
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
              onClick={() => setFeedback(null)}
              aria-label="Fechar notificação"
              className="text-xs opacity-70 hover:opacity-100 transition-opacity p-1 rounded-md cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Painel do Concurso Ativo na Conferência */}
      {activeRecord && (
        <div id="conference-active-panel" className="space-y-6">
          {/* Header de Status */}
          <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-lg">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-xl font-bold font-mono text-zinc-100">
                    CONCURSO {activeRecord.contestNumber}
                  </h3>

                  {activeRecord.status === "DRAFT" && (
                    <span
                      id="conf-status-draft"
                      className="px-3 py-1 rounded-full bg-amber-950/60 border border-amber-500/50 text-amber-300 font-mono text-xs font-semibold"
                    >
                      RASCUNHO
                    </span>
                  )}

                  {activeRecord.status === "FROZEN" && (
                    <span
                      id="conf-status-frozen"
                      className="px-3 py-1 rounded-full bg-blue-950/60 border border-blue-500/50 text-blue-300 font-mono text-xs font-semibold flex items-center gap-1.5"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>CONGELADO</span>
                    </span>
                  )}

                  {activeRecord.status === "SCORED" && (
                    <span
                      id="conf-status-scored"
                      className="px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/50 text-emerald-300 font-mono text-xs font-semibold flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>CONFERIDO</span>
                    </span>
                  )}

                  {activeRecord.betPlacedAt && (
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-950/40 border border-emerald-500/40 text-emerald-400 font-mono text-[11px] font-medium flex items-center gap-1">
                      <DollarSign className="w-3.5 h-3.5" />
                      <span>Aposta Registrada</span>
                    </span>
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

              {/* Botões operacionais contextuais */}
              <div className="flex flex-wrap items-center gap-2.5">
                {/* DRAFT: Alerta de aposta não confirmada */}
                {activeRecord.status === "DRAFT" && (
                  <div className="px-3.5 py-2 rounded-xl bg-amber-950/30 border border-amber-500/40 text-amber-300 text-xs">
                    Rascunho não apostado. A conferência só é permitida após a confirmação da aposta no Gerador.
                  </div>
                )}

                {/* FROZEN Legado sem aposta: Confirmação legada */}
                {isLegacyFrozenWithoutBet && (
                  <button
                    type="button"
                    id="btn-confirm-legacy-bet"
                    onClick={() => setShowLegacyBetModal(true)}
                    className="px-4 py-2 text-xs font-semibold text-amber-200 bg-amber-900/60 hover:bg-amber-800 border border-amber-500/50 rounded-xl transition-all inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <DollarSign className="w-3.5 h-3.5" />
                    <span>CONFIRMAR APOSTA (LEGADO)</span>
                  </button>
                )}

                {/* FROZEN com aposta: Ação explícita de consulta à CAIXA (FLOW06) */}
                {activeRecord.status === "FROZEN" && activeRecord.betPlacedAt && (
                  <button
                    type="button"
                    id="btn-consult-caixa"
                    onClick={handleConsultCaixa}
                    disabled={isConsulting}
                    className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl shadow-md transition-all inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                  >
                    {isConsulting ? (
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Globe className="w-3.5 h-3.5" />
                    )}
                    <span>{isConsulting ? "CONSULTANDO..." : "CONSULTAR RESULTADO CAIXA"}</span>
                  </button>
                )}

                {/* SCORED com aposta e sem prêmio: Registrar prêmio */}
                {activeRecord.status === "SCORED" && activeRecord.betPlacedAt && (
                  activeRecord.prize === undefined ? (
                    <button
                      type="button"
                      id="btn-open-record-prize"
                      onClick={() => setShowPrizeModal(true)}
                      className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl shadow-md transition-all inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Award className="w-3.5 h-3.5" />
                      <span>REGISTRAR PRÊMIO</span>
                    </button>
                  ) : (
                    <div
                      id="badge-prize-recorded"
                      title="Registrado manualmente via formulário de encerramento financeiro (MANUAL)"
                      className="px-3.5 py-2 rounded-xl bg-emerald-950/60 border border-emerald-500/60 text-emerald-300 font-mono text-xs font-semibold inline-flex items-center gap-1.5"
                    >
                      <Award className="w-3.5 h-3.5 text-emerald-400" />
                      <span>PRÊMIO: {formatBRLFromCents(activeRecord.prize.amountCents)}</span>
                    </div>
                  )
                )}
              </div>
            </div>

            {/* Aviso explícito para registros legados sem aposta */}
            {isLegacyFrozenWithoutBet && (
              <div id="banner-legacy-unconfirmed" className="mt-4 p-3 rounded-xl bg-amber-950/30 border border-amber-500/40 text-xs text-amber-200">
                ⚠️ <strong>APOSTA AINDA NÃO CONFIRMADA</strong>: Este registro foi congelado em versão legada sem registro de confirmação de pagamento na lotérica. Confirme a realização da aposta para prosseguir com a conferência.
              </div>
            )}
          </div>

          {/* Prévia Oficial Obtida da CAIXA (FLOW07: Prévia não pontua automaticamente) */}
          {preview && activeRecord.status === "FROZEN" && (
            <div id="preview-official-card" className="p-6 rounded-2xl bg-zinc-900 border border-blue-500/50 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
                <div>
                  <span className="text-xs font-mono font-bold tracking-widest text-blue-400 uppercase">
                    Prévia Oficial da CAIXA • Concurso {preview.contestNumber}
                  </span>
                  <h3 className="text-xl font-bold text-zinc-100 mt-0.5">
                    15 Dezenas Sorteadas ({preview.drawDate || "Data oficial"})
                  </h3>
                  <p className="text-xs text-zinc-400 mt-1">
                    Fonte: {preview.source}. O registro permanece CONGELADO até sua confirmação definitiva.
                  </p>
                </div>

                <button
                  type="button"
                  id="btn-confirm-conference"
                  onClick={() => setShowScoreModal(true)}
                  disabled={isScoring}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs tracking-wide transition-all shadow-md inline-flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>CONFIRMAR CONFERÊNCIA</span>
                </button>
              </div>

              {/* Bolas da Prévia */}
              <div className="flex flex-wrap gap-2">
                {preview.numbers.map((num) => (
                  <Ball key={`preview-ball-${num}`} number={num} variant="official" size="md" />
                ))}
              </div>
            </div>
          )}

          {/* Destaque do Resultado Oficial Persistido quando SCORED */}
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

              {/* 15 Dezenas Sorteadas */}
              <div className="mt-4 flex flex-wrap gap-2">
                {activeRecord.officialResult.map((num) => (
                  <Ball key={`scored-conf-ball-${num}`} number={num} variant="official" size="md" />
                ))}
              </div>

              {/* Faixas Obtidas */}
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

              {/* Fechamento Financeiro */}
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
                </div>
              </div>
            </div>
          )}

          {/* Exibição das 5 Apostas e Acertos */}
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

          {/* Auditoria Oficial Pós-Score CAIXA (se SCORED) */}
          {activeRecord.status === "SCORED" && (
            <div className="mt-8">
              <OfficialResultAuditPanel
                record={activeRecord}
                coordinator={coordinator}
              />
            </div>
          )}

          {/* Reconciliação Financeira Oficial CAIXA (se elegível: SCORED + betPlacedAt + score) */}
          {isEligibleForFinancialReconciliation(activeRecord) && (
            <div className="mt-8">
              <OfficialPrizeReconciliationPanel
                contestNumber={activeRecord.contestNumber}
                score={activeRecord.score}
                prize={activeRecord.prize}
                betPlacedAt={activeRecord.betPlacedAt}
                status={activeRecord.status}
                record={activeRecord}
                coordinator={coordinator}
              />
            </div>
          )}
        </div>
      )}

      {/* Modal de Confirmação de Conferência / Score */}
      <ConfirmDialog
        isOpen={showScoreModal}
        title="Confirmar Conferência Oficial"
        description={`Confirmar o resultado oficial para o concurso ${activeRecord?.contestNumber}?\n\nApós a confirmação, o concurso será marcado como CONFERIDO (SCORED) e a pontuação será selada com auditoria criptográfica.`}
        confirmLabel={isScoring ? "PONTUANDO..." : "CONFIRMAR E PONTUAR"}
        cancelLabel="VOLTAR"
        variant="primary"
        isLoading={isScoring}
        onConfirm={handleConfirmScore}
        onCancel={() => setShowScoreModal(false)}
      />

      {/* Modal de Confirmação de Aposta Legada */}
      <ConfirmDialog
        isOpen={showLegacyBetModal}
        title="Confirmar Aposta Legada"
        description={`Confirmar que os 5 jogos do concurso legado ${activeRecord?.contestNumber} foram registrados e pagos na lotérica (Custo: R$ 17,50)?`}
        confirmLabel="CONFIRMAR APOSTA"
        cancelLabel="VOLTAR"
        variant="primary"
        onConfirm={handleConfirmLegacyBet}
        onCancel={() => setShowLegacyBetModal(false)}
      />

      {/* Modal de Registro de Prêmio */}
      <PrizeRecordModal
        isOpen={showPrizeModal}
        record={activeRecord}
        isLoading={actionLockController.isLocked() && actionLockController.getCurrentOperation() === "RECORD_PRIZE"}
        onClose={() => setShowPrizeModal(false)}
        onRecordPrize={handleRecordPrize}
      />
    </div>
  );
};
