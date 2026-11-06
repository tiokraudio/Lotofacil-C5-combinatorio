import React, { useState, useEffect, useMemo } from "react";
import {
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Globe,
  Loader2,
  ShieldCheck,
  Coins,
  TrendingUp,
  AlertTriangle,
  RefreshCw,
  Clock,
  Sparkles,
  Award,
  ChevronRight,
} from "lucide-react";
import { ContestRecord, ResultSource } from "../c5-memory/types";
import {
  getLotofacilRuleSet,
  getFixedLotofacilPrize,
} from "../c5-memory/lotofacilRules";
import {
  getAllContestRecordsUI,
  getMemoryOperationalStateUI,
  scoreContestOperationUI,
  fetchOfficialLotofacilResult,
  autoScorePendingContestsUI,
  AutoScoreResultDTO,
} from "../c5-memory/application/uiService";
import { calculateContestFinancialBreakdown } from "../c5-memory/analytics/c5Analytics";
import { Ball } from "./Ball";

interface ConferenceViewProps {
  initialContestNumber?: number;
  onContestUpdated: () => void;
  onNavigateToDashboard: () => void;
  onNavigateToGenerator?: () => void;
}

export const ConferenceView: React.FC<ConferenceViewProps> = ({
  initialContestNumber,
  onContestUpdated,
  onNavigateToDashboard,
  onNavigateToGenerator,
}) => {
  const [contests, setContests] = useState<ContestRecord[]>([]);
  const [selectedContestNumber, setSelectedContestNumber] = useState<number>(
    initialContestNumber || 0
  );
  const [currentRecord, setCurrentRecord] = useState<ContestRecord | null>(null);
  const [isAutoScoring, setIsAutoScoring] = useState(false);
  const [autoScoreStatus, setAutoScoreStatus] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Carrega concursos ao montar o componente e executa apuração automática dos pendentes
  useEffect(() => {
    loadContestsAndAutoScore();
  }, []);

  useEffect(() => {
    if (initialContestNumber) {
      setSelectedContestNumber(initialContestNumber);
    }
  }, [initialContestNumber]);

  useEffect(() => {
    if (selectedContestNumber > 0) {
      loadSelectedContest(selectedContestNumber);
    }
  }, [selectedContestNumber]);

  const loadContestsAndAutoScore = async () => {
    await loadContests();
    // Executa apuração 100% automática ao acessar a tela
    handleAutoScore(false);
  };

  const loadContests = async () => {
    const list = await getAllContestRecordsUI();
    // Filtra apenas registros operacionais reais (exclui demo e fixtures)
    const sorted = list
      .filter(r => !r.isDemo && !r.isFixture)
      .sort((a, b) => b.contestNumber - a.contestNumber);
    setContests(sorted);

    if (sorted.length > 0 && (!selectedContestNumber || selectedContestNumber === 0)) {
      // Prioriza concurso que seja FROZEN (pendente de conferência) ou o mais recente
      const pending = sorted.find(c => c.status === "FROZEN");
      if (pending) {
        setSelectedContestNumber(pending.contestNumber);
      } else {
        setSelectedContestNumber(sorted[0].contestNumber);
      }
    }
  };

  const loadSelectedContest = async (cNum: number) => {
    setErrorMsg(null);
    try {
      const allRecords = await getAllContestRecordsUI();
      const existing = allRecords.find(r => r.contestNumber === cNum);
      if (existing) {
        setCurrentRecord(existing);
        return;
      }
      const state = await getMemoryOperationalStateUI(cNum);
      if (state.status !== "AVAILABLE" || state.draft || state.frozenPayload) {
        const rec: ContestRecord = {
          contestNumber: state.contestNumber,
          contestDate: (state as any).contestDate || "",
          status: state.status,
          algorithmVersion: state.algorithmVersion as any,
          games: state.games,
          draft: state.draft as any,
          frozenPayload: state.frozenPayload as any,
          officialResult: state.officialResult,
          gameHits: state.gameHits,
          bestHits: state.bestHits,
          bestHitsCount: state.bestHitsCount,
          totalCost: (state as any).totalCost ?? 17.50,
          totalPrize: (state as any).totalPrize,
          officialConfirmedPrize: (state as any).officialConfirmedPrize,
          manualConfirmedPrize: (state as any).manualConfirmedPrize,
          manualInformedPrize: (state as any).manualInformedPrize,
          officialValidatedPrize: (state as any).officialValidatedPrize,
          officialNetBalance: (state as any).officialNetBalance,
          officialRoiPercentage: (state as any).officialRoiPercentage,
          prizeBreakdown: (state as any).prizeBreakdown,
          resultSource: (state as any).resultSource,
          resultFetchedAt: (state as any).resultFetchedAt,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setCurrentRecord(rec);
      } else {
        setCurrentRecord(null);
      }
    } catch {
      setCurrentRecord(null);
    }
  };

  /**
   * Apuração 100% Automática
   * Consulta a API oficial da Caixa, valida o resultado, calcula os acertos e apura financeiramente.
   */
  // Separação entre concursos pendentes e apurados
  const pendingContests = useMemo(() => {
    return contests.filter(c => c.status === "FROZEN");
  }, [contests]);

  const completedContests = useMemo(() => {
    return contests.filter(c => c.status === "COMPLETED");
  }, [contests]);

  // Identifica se o concurso atual selecionado já está homologado e salvo no banco
  const isCurrentHomologated = useMemo(() => {
    if (currentRecord) {
      return (
        currentRecord.status === "COMPLETED" &&
        (currentRecord.financialStatus === "HOMOLOGATED" ||
          (Array.isArray(currentRecord.officialResult) && currentRecord.officialResult.length === 15))
      );
    }
    return contests.length > 0 && pendingContests.length === 0;
  }, [currentRecord, contests, pendingContests]);

  // Cálculos financeiros do concurso selecionado
  const selectedContestFinancial = useMemo(() => {
    if (!currentRecord) return null;
    return calculateContestFinancialBreakdown(currentRecord);
  }, [currentRecord]);

  /**
   * Apuração 100% Automática
   * Consulta a API oficial da Caixa, valida o resultado, calcula os acertos e apura financeiramente.
   * Se o concurso já estiver homologado e salvo, bloqueia reexecução imediatamente.
   */
  const handleAutoScore = async (showFeedback: boolean = true) => {
    // Bloqueio imediato no frontend se o concurso selecionado já estiver homologado
    if (isCurrentHomologated && pendingContests.length === 0) {
      if (showFeedback) {
        setAutoScoreStatus("Resultado já conferido e salvo.");
      }
      return;
    }

    setIsAutoScoring(true);
    setAutoScoreStatus("Consultando API oficial da Caixa...");
    setErrorMsg(null);
    if (showFeedback) setSuccessMsg(null);

    try {
      const targetContest = currentRecord && currentRecord.status === "FROZEN"
        ? currentRecord.contestNumber
        : undefined;

      const result: AutoScoreResultDTO = await autoScorePendingContestsUI(targetContest);
      if (result.scored > 0) {
        setSuccessMsg(
          `Apuração automática concluída: ${result.scored} concurso(s) conferido(s) e homologado(s) com a API da Caixa!`
        );
        onContestUpdated();
        await loadContests();
        if (selectedContestNumber > 0) {
          await loadSelectedContest(selectedContestNumber);
        }
      } else if (result.pending > 0 && showFeedback) {
        setAutoScoreStatus(
          `${result.pending} concurso(s) pendente(s) aguardando apuração oficial da Caixa.`
        );
      } else if (showFeedback) {
        setAutoScoreStatus("Resultado já conferido e salvo.");
        setSuccessMsg("Resultado já conferido e salvo.");
      }

      if (result.errors.length > 0 && showFeedback) {
        const firstErr = result.errors[0];
        setAutoScoreStatus(`Concurso #${firstErr.contestNumber}: ${firstErr.reason}`);
      }
    } catch (err: any) {
      if (showFeedback) {
        setErrorMsg("Falha na consulta automática da Caixa: " + (err?.message || "Indisponibilidade de rede."));
      }
    } finally {
      setIsAutoScoring(false);
      setTimeout(() => setAutoScoreStatus(null), 6000);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-16">
      {/* Cabeçalho da Seção com Ação Integrada e Status Compacto */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs uppercase font-mono tracking-wider text-emerald-400 font-semibold">
                Apuração 100% Automática
              </span>
              <span className="text-slate-600">•</span>
              <span className="text-xs text-slate-400">API Oficial Caixa Econômica Federal</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-100">
              Conferir Resultados C5
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Busca automática de resultados da Caixa, contagem de acertos e homologação financeira.
            </p>
          </div>

          {/* Botão de Busca e Status no Cabeçalho */}
          <div className="flex flex-wrap items-center gap-3">
            {isCurrentHomologated ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold font-mono">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Resultado já conferido e salvo</span>
              </span>
            ) : pendingContests.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold font-mono">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>{pendingContests.length} pendente(s)</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-semibold font-mono">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Todos apurados</span>
              </span>
            )}

            <button
              id="btn-auto-score"
              data-testid="btn-auto-score"
              onClick={() => handleAutoScore(true)}
              disabled={isAutoScoring || isCurrentHomologated}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                isCurrentHomologated
                  ? "bg-slate-800 text-slate-400 border border-slate-700/80 cursor-not-allowed opacity-75"
                  : isAutoScoring
                  ? "bg-slate-800 text-slate-400 border border-slate-700 cursor-wait opacity-80"
                  : "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-600/20 cursor-pointer"
              }`}
              title={
                isCurrentHomologated
                  ? "Resultado já conferido e salvo. Concurso homologado e imutável no banco de dados."
                  : isAutoScoring
                  ? "Consultando API oficial da Caixa..."
                  : "Buscar resultados da Caixa e apurar concurso"
              }
            >
              {isCurrentHomologated ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Resultado já conferido e salvo</span>
                </>
              ) : isAutoScoring ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                  <span>Consultando Caixa...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  <span>Buscar Resultado Caixa</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Mensagem de Progresso / Status do Botão */}
        {autoScoreStatus && (
          <div className="mt-4 pt-3 border-t border-slate-800 text-xs text-slate-300 flex items-center gap-2">
            <Globe className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>{autoScoreStatus}</span>
          </div>
        )}
      </div>

      {/* Alertas de Feedback */}
      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button
            onClick={onNavigateToDashboard}
            className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 hover:text-emerald-300 ml-4 cursor-pointer"
          >
            <span>Ver no Painel</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold text-amber-200">Aviso da Fonte Oficial:</span> {errorMsg}
          </div>
        </div>
      )}

      {/* Seletor Compacto de Concurso */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-mono">Concurso em visualização:</span>
          <select
            value={selectedContestNumber}
            onChange={e => setSelectedContestNumber(Number(e.target.value))}
            className="bg-slate-950 border border-slate-700 text-slate-100 font-mono font-bold text-sm rounded-lg px-3 py-1.5 focus:ring-1 focus:ring-emerald-500 outline-none"
          >
            {contests.map(c => (
              <option key={c.contestNumber} value={c.contestNumber}>
                #{c.contestNumber} — {c.status === "COMPLETED" ? `Apurado (${c.bestHits ?? 0} acertos)` : "Pendente (Aguardando Sorteio)"}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">Situação:</span>
          {isCurrentHomologated ? (
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-semibold font-mono text-[11px] flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              HOMOLOGADO OFICIAL — Resultado já conferido e salvo
            </span>
          ) : (
            <span className="px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 font-semibold font-mono text-[11px] flex items-center gap-1">
              <Clock className="w-3 h-3 text-amber-400" />
              PENDENTE DE APURAÇÃO
            </span>
          )}
        </div>
      </div>

      {/* Conteúdo do Concurso Selecionado */}
      {currentRecord ? (
        <div className="space-y-6">
          {/* Resultado Oficial da Caixa */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="text-xs uppercase font-mono tracking-wider text-emerald-400 font-semibold">
                  Resultado Oficial da Caixa Econômica Federal
                </span>
                <h3 className="text-lg font-bold text-slate-100">
                  Concurso #{currentRecord.contestNumber} {currentRecord.contestDate ? `• ${currentRecord.contestDate}` : ""}
                </h3>
              </div>

              <div className="text-right">
                <span className="text-xs text-slate-400 font-mono block">
                  Fonte: {currentRecord.resultSource === "API_CAIXA" ? "Caixa Oficial (servicebus2)" : currentRecord.resultSource || "API Oficial da Caixa"}
                </span>
                {currentRecord.resultFetchedAt && (
                  <span className="text-[10px] text-slate-500 block">
                    Atualizado em {new Date(currentRecord.resultFetchedAt).toLocaleTimeString("pt-BR")}
                  </span>
                )}
              </div>
            </div>

            {Array.isArray(currentRecord.officialResult) && currentRecord.officialResult.length === 15 ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2 justify-center sm:justify-start bg-slate-950/60 p-4 rounded-xl border border-slate-800">
                  {currentRecord.officialResult.map(n => (
                    <Ball key={n} number={n} isSelected={true} size="md" />
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-6 rounded-xl bg-amber-500/5 border border-amber-500/20 text-center space-y-3">
                <Clock className="w-8 h-8 text-amber-400 mx-auto" />
                <h4 className="text-sm font-bold text-slate-200">
                  Aguardando realização ou publicação do sorteio pela Caixa
                </h4>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Os 5 jogos C5 estão congelados no banco com SHA-256 intacto. Clique em "Buscar Resultado Caixa" assim que o sorteio for encerrado pela CEF.
                </p>
                <div>
                  <button
                    onClick={() => handleAutoScore(true)}
                    disabled={isAutoScoring}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
                  >
                    {isAutoScoring ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                        <span>Consultando Caixa...</span>
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Buscar Resultado Caixa</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Os 5 Jogos com Acertos e Destaque Visual */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-200 uppercase font-mono tracking-wider px-1">
              Conferência dos 5 Jogos C5-Memory
            </h3>

            {currentRecord.games.map((game, idx) => {
              const drawnSet = new Set(currentRecord.officialResult || []);
              const hits = currentRecord.officialResult
                ? game.filter(n => drawnSet.has(n)).length
                : 0;
              const isWinning = hits >= 11;

              let tierLabel = "";
              let prizeValue = 0;
              if (currentRecord.officialResult && isWinning) {
                const ruleSet = getLotofacilRuleSet(currentRecord.contestNumber, currentRecord.contestDate);
                if (hits <= 13) {
                  prizeValue = ruleSet.fixedPrizes[hits as 11 | 12 | 13] ?? 0;
                  tierLabel = `${hits} acertos (R$ ${prizeValue.toFixed(2)})`;
                } else {
                  tierLabel = `${hits} acertos (Rateio Oficial)`;
                }
              }

              return (
                <div
                  key={idx}
                  className={`bg-slate-900 border rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-md transition-all ${
                    isWinning
                      ? "border-emerald-500/40 bg-emerald-950/10"
                      : "border-slate-800"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-9 h-9 rounded-lg font-mono font-bold text-xs flex items-center justify-center ${
                        isWinning
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                          : "bg-slate-800 text-slate-400 border border-slate-700"
                      }`}
                    >
                      J{idx + 1}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-200">
                          Jogo {idx + 1}
                        </span>
                        {currentRecord.officialResult && (
                          <span
                            className={`text-xs font-bold font-mono px-2 py-0.5 rounded-full ${
                              isWinning
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                : "bg-slate-800 text-slate-400"
                            }`}
                          >
                            {hits} acertos
                          </span>
                        )}
                      </div>
                      {tierLabel && (
                        <span className="text-[11px] font-semibold text-emerald-400 block mt-0.5">
                          ★ Premiado: {tierLabel}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Dezenas do Jogo */}
                  <div className="flex flex-wrap gap-1.5 justify-end">
                    {game.map(num => {
                      const isHit = drawnSet.has(num);
                      return (
                        <div
                          key={num}
                          className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono font-bold transition-transform ${
                            isHit
                              ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/30 scale-105"
                              : "bg-slate-800 text-slate-300 border border-slate-700"
                          }`}
                        >
                          {String(num).padStart(2, "0")}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Resumo Financeiro da Apuração */}
          {selectedContestFinancial && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <h3 className="text-sm font-bold text-slate-200 uppercase font-mono tracking-wider mb-4">
                Demonstrativo Financeiro do Concurso #{currentRecord.contestNumber}
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
                <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block">Custo Total:</span>
                  <span className="text-slate-200 font-bold text-base">
                    R$ {(currentRecord.totalCost ?? 17.50).toFixed(2)}
                  </span>
                </div>

                <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block">Premiação Caixa:</span>
                  <span className="text-emerald-400 font-bold text-base">
                    R$ {selectedContestFinancial.officialTotalPrize.toFixed(2)}
                  </span>
                </div>

                <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block">Saldo Líquido:</span>
                  <span
                    className={`font-bold text-base ${
                      selectedContestFinancial.officialNetBalance >= 0
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {selectedContestFinancial.officialNetBalance >= 0 ? "+" : ""}
                    R$ {selectedContestFinancial.officialNetBalance.toFixed(2)}
                  </span>
                </div>

                <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block">Retorno (ROI):</span>
                  <span
                    className={`font-bold text-base ${
                      selectedContestFinancial.officialRoiPercentage >= 0
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {selectedContestFinancial.officialRoiPercentage >= 0 ? "+" : ""}
                    {selectedContestFinancial.officialRoiPercentage.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 space-y-3">
          <Clock className="w-8 h-8 text-slate-600 mx-auto" />
          <p className="text-sm font-medium">Nenhum concurso selecionado para conferência.</p>
        </div>
      )}
    </div>
  );
};
