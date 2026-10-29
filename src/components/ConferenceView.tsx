import React, { useState, useEffect, useMemo } from "react";
import {
  CheckCircle2,
  AlertCircle,
  Save,
  ArrowRight,
  RotateCcw,
  Globe,
  Loader2,
  ShieldCheck,
  Coins,
  TrendingUp,
  AlertTriangle,
  RefreshCw,
  FileCheck2,
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
} from "../c5-memory/application/uiService";
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
    initialContestNumber || 3505
  );
  const [currentRecord, setCurrentRecord] = useState<ContestRecord | null>(null);
  const [selectedBalls, setSelectedBalls] = useState<number[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isFetchingOnline, setIsFetchingOnline] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Metadados de proveniência do resultado
  const [resultSource, setResultSource] = useState<ResultSource>("MANUAL_CONFERENCE");
  const [drawDate, setDrawDate] = useState<string | null>(null);
  const [prizeValues, setPrizeValues] = useState<Record<number, number>>({
    11: 7.0,
    12: 14.0,
    13: 35.0,
  });

  // Estado para confirmação manual de rateios variáveis (14 e 15 acertos)
  const [manual14Prize, setManual14Prize] = useState<string>("");
  const [manual15Prize, setManual15Prize] = useState<string>("");
  const [confirmedManualRateio, setConfirmedManualRateio] = useState<boolean>(false);

  // P1 (Quinta Rodada): Identificação explícita do operador e flag de conferência humana
  const [operatorId, setOperatorId] = useState<string>("OPERADOR_LOCAL");
  const [isHumanConfirmed, setIsHumanConfirmed] = useState<boolean>(true);

  useEffect(() => {
    loadContests();
  }, []);

  useEffect(() => {
    if (initialContestNumber) {
      setSelectedContestNumber(initialContestNumber);
    }
  }, [initialContestNumber]);

  useEffect(() => {
    loadSelectedContest(selectedContestNumber);
  }, [selectedContestNumber]);

  const loadContests = async () => {
    const list = await getAllContestRecordsUI();
    const sorted = list.sort((a, b) => b.contestNumber - a.contestNumber);
    setContests(sorted);
    if (sorted.length > 0 && !initialContestNumber) {
      // Prioriza concurso que seja FROZEN (pendente de conferência)
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
    setSuccessMsg(null);
    setInfoMsg(null);
    try {
      const state = await getMemoryOperationalStateUI(cNum);
      if (state.status !== "AVAILABLE" || state.draft || state.frozenPayload) {
        const rec: ContestRecord = {
          contestNumber: state.contestNumber,
          contestDate: new Date().toISOString().split("T")[0],
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
          prizeBreakdown: (state as any).prizeBreakdown,
          resultSource: (state as any).resultSource ?? "MANUAL_CONFERENCE",
          resultFetchedAt: (state as any).resultFetchedAt,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setCurrentRecord(rec);

        if (rec.officialResult && rec.officialResult.length === 15) {
          setSelectedBalls([...rec.officialResult]);
          setResultSource(rec.resultSource ?? "MANUAL_CONFERENCE");

          if (rec.prizeBreakdown?.["14"]?.unitValue) {
            setManual14Prize(String(rec.prizeBreakdown["14"].unitValue));
          } else {
            setManual14Prize("");
          }
          if (rec.prizeBreakdown?.["15"]?.unitValue) {
            setManual15Prize(String(rec.prizeBreakdown["15"].unitValue));
          } else {
            setManual15Prize("");
          }
          const isConfirmed =
            (rec.prizeBreakdown?.["14"] && !rec.prizeBreakdown["14"].pendingRateio) ||
            (rec.prizeBreakdown?.["15"] && !rec.prizeBreakdown["15"].pendingRateio);
          setConfirmedManualRateio(Boolean(isConfirmed));
        } else {
          setSelectedBalls([]);
          setResultSource("MANUAL_CONFERENCE");
          setManual14Prize("");
          setManual15Prize("");
          setConfirmedManualRateio(false);
        }
      } else {
        setCurrentRecord(null);
        setSelectedBalls([]);
      }
    } catch {
      setCurrentRecord(null);
      setSelectedBalls([]);
    }
  };

  const handleFetchOnline = async () => {
    setIsFetchingOnline(true);
    setErrorMsg(null);
    setInfoMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetchOfficialLotofacilResult(selectedContestNumber);
      setSelectedBalls([...res.drawnNumbers]);
      setResultSource(res.source);
      setDrawDate(res.drawDate);
      setPrizeValues({ 11: 7.0, 12: 14.0, 13: 35.0 });
      setManual14Prize("");
      setManual15Prize("");
      setConfirmedManualRateio(false);
      setInfoMsg(
        `Resultado obtido via ${res.sourceDescription} (Sorteio: ${res.drawDate}). As 15 dezenas foram preenchidas automaticamente. Atenção: Esta é uma fonte intermediária de terceiros; confira as dezenas e o rateio com os canais oficiais da Caixa.`
      );
    } catch (err: any) {
      setErrorMsg(err.message || "Não foi possível obter o resultado online. Utilize a seleção manual.");
    } finally {
      setIsFetchingOnline(false);
    }
  };

  const toggleBall = (num: number) => {
    setResultSource("MANUAL_CONFERENCE");
    setInfoMsg(null);
    if (selectedBalls.includes(num)) {
      setSelectedBalls(selectedBalls.filter(n => n !== num));
    } else {
      if (selectedBalls.length < 15) {
        setSelectedBalls([...selectedBalls, num].sort((a, b) => a - b));
      }
    }
  };

  const handleClear = () => {
    setSelectedBalls([]);
    setResultSource("MANUAL_CONFERENCE");
    setManual14Prize("");
    setManual15Prize("");
    setConfirmedManualRateio(false);
    setInfoMsg(null);
  };

  // Detecção de jogos com 14 ou 15 acertos
  const has14Hits = useMemo(() => {
    if (!currentRecord?.games) return false;
    return currentRecord.games.some(g => g.filter(n => selectedBalls.includes(n)).length === 14);
  }, [currentRecord, selectedBalls]);

  const has15Hits = useMemo(() => {
    if (!currentRecord?.games) return false;
    return currentRecord.games.some(g => g.filter(n => selectedBalls.includes(n)).length === 15);
  }, [currentRecord, selectedBalls]);

  // Cálculo financeiro em tempo real da apuração
  const liveFinancialSummary = useMemo(() => {
    const ruleSet = getLotofacilRuleSet(currentRecord?.contestNumber, currentRecord?.contestDate);
    const standardCost = ruleSet.costPerContest;

    if (!currentRecord || !currentRecord.games) {
      return {
        cost: standardCost,
        totalPrize: 0,
        netBalance: -standardCost,
        winningGames: 0,
        hasPendingRateio: false,
        hitsPerGame: [],
      };
    }

    let hasPendingRateio = false;
    const hitsPerGame = currentRecord.games.map(game => {
      const hits = game.filter(n => selectedBalls.includes(n)).length;
      let prize = 0;
      let isPendingRateio = false;

      if (hits >= 11 && hits <= 13) {
        prize = getFixedLotofacilPrize(hits, currentRecord.contestNumber, currentRecord.contestDate) ?? 0;
      } else if (hits === 14) {
        const val14 = parseFloat(manual14Prize);
        if (confirmedManualRateio && !isNaN(val14) && val14 > 0) {
          prize = val14;
        } else {
          isPendingRateio = true;
          hasPendingRateio = true;
        }
      } else if (hits === 15) {
        const val15 = parseFloat(manual15Prize);
        if (confirmedManualRateio && !isNaN(val15) && val15 > 0) {
          prize = val15;
        } else {
          isPendingRateio = true;
          hasPendingRateio = true;
        }
      }

      return { hits, prize, isPendingRateio };
    });

    const cost = currentRecord.totalCost ?? standardCost;
    const totalPrize = hitsPerGame.reduce((acc, g) => acc + g.prize, 0);
    const netBalance = totalPrize - cost;
    const winningGames = hitsPerGame.filter(g => g.hits >= 11).length;

    return { cost, totalPrize, netBalance, winningGames, hasPendingRateio, hitsPerGame };
  }, [currentRecord, selectedBalls, prizeValues, manual14Prize, manual15Prize, confirmedManualRateio]);

  const handleSaveResult = async () => {
    if (!currentRecord) return;
    if (currentRecord.contestNumber !== selectedContestNumber) {
      setErrorMsg("Divergência de segurança: o concurso selecionado não corresponde ao registro carregado.");
      return;
    }
    if (selectedBalls.length !== 15) {
      setErrorMsg("Selecione exatamente 15 dezenas para o resultado oficial.");
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);
    try {
      const isAlreadyCompleted = currentRecord.status === "COMPLETED";

      if (isHumanConfirmed && (!operatorId || operatorId.trim().length === 0)) {
        setErrorMsg("Identificador do operador responsável é obrigatório para confirmar o resultado.");
        setIsSaving(false);
        return;
      }

      const confirmedVariablePrizes: Record<number, any> = {};
      if (confirmedManualRateio) {
        const val14 = parseFloat(manual14Prize);
        if (has14Hits && !isNaN(val14) && val14 > 0) {
          confirmedVariablePrizes[14] = {
            contestNumber: currentRecord.contestNumber,
            tier: 14,
            unitValue: val14,
            confirmationSource: "MANUAL_ENTRY",
            confirmedAt: new Date().toISOString(),
            operatorId: operatorId.trim() || "OPERADOR_LOCAL",
            notes: "Rateio oficial de 14 acertos conferido e confirmado manualmente",
          };
        }
        const val15 = parseFloat(manual15Prize);
        if (has15Hits && !isNaN(val15) && val15 > 0) {
          confirmedVariablePrizes[15] = {
            contestNumber: currentRecord.contestNumber,
            tier: 15,
            unitValue: val15,
            confirmationSource: "MANUAL_ENTRY",
            confirmedAt: new Date().toISOString(),
            operatorId: operatorId.trim() || "OPERADOR_LOCAL",
            notes: "Rateio oficial de 15 acertos conferido e confirmado manualmente",
          };
        }
      }

      const updatedRecord = await scoreContestOperationUI(
        currentRecord.contestNumber,
        selectedBalls,
        {
          allowCorrection: isAlreadyCompleted,
          resultSource,
          resultFetchedAt: new Date().toISOString(),
          resultConfirmed: isHumanConfirmed,
          resultConfirmedBy: isHumanConfirmed ? operatorId.trim() : undefined,
          resultConfirmedAt: isHumanConfirmed ? new Date().toISOString() : undefined,
          confirmedVariablePrizes,
        }
      );

      setCurrentRecord(updatedRecord);
      setSuccessMsg(
        isAlreadyCompleted
          ? "Conferência corrigida e atualizada com sucesso no banco auditável!"
          : isHumanConfirmed
          ? "Concurso conferido com sucesso e homologado na memória histórica!"
          : "Concurso registrado em estado PENDENTE de homologação (prêmios computarão R$ 0,00 até confirmação)."
      );
      onContestUpdated();
      loadContests();
    } catch (err: any) {
      setErrorMsg("Erro ao salvar resultado: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const isCompleted = currentRecord?.status === "COMPLETED";

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-16">
      {/* Topo da Conferência */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs uppercase font-mono tracking-wider text-indigo-400 font-semibold">
                Conferência Oficial
              </span>
              <span className="text-slate-600">•</span>
              <span className="text-xs text-slate-400">Apuração Automatizada e Manual</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-100">
              Conferir Resultados C5
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Validação das 5 apostas contra o resultado oficial com cálculo financeiro automático.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">Concurso:</span>
            <select
              value={selectedContestNumber}
              onChange={e => setSelectedContestNumber(Number(e.target.value))}
              className="bg-slate-950 border border-slate-700 text-slate-100 font-mono font-bold text-sm rounded-lg px-3 py-1.5 focus:ring-1 focus:ring-emerald-500 outline-none"
            >
              {contests.map(c => (
                <option key={c.contestNumber} value={c.contestNumber}>
                  #{c.contestNumber} ({c.status === "COMPLETED" ? (c.financialStatus === "PENDING_HOMOLOGATION" ? "Apurado (Pendente)" : "Homologado") : c.status === "FROZEN" ? "Aposta Confirmada" : c.status})
                </option>
              ))}
            </select>

            <button
              onClick={handleFetchOnline}
              disabled={isFetchingOnline}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
              title="Consultar servidores oficiais da Caixa online"
            >
              {isFetchingOnline ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Buscando...</span>
                </>
              ) : (
                <>
                  <Globe className="w-3.5 h-3.5" />
                  <span>Buscar Resultado Online</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {infoMsg && (
        <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-300 text-sm flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold text-blue-200">Origem Verificada:</span> {infoMsg}
          </div>
        </div>
      )}

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
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Grid de Seleção das 15 Dezenas Oficiais */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-100">
                Dezenas Sorteadas (1 a 25)
              </h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                Fonte: {resultSource === "API_TERCEIROS" ? "API Terceiros (Intermediária)" : resultSource === "API_LOTERIAS" ? "API Loterias (Terceiros)" : resultSource === "API_CAIXA" ? "API Caixa Oficial" : "Conferência Manual"}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {selectedBalls.length} de 15 dezenas selecionadas {selectedBalls.length === 15 ? "✓" : `(faltam ${15 - selectedBalls.length})`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleClear}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Limpar</span>
            </button>
            <button
              id="btn-save-official-result"
              data-testid="btn-save-result"
              onClick={handleSaveResult}
              disabled={selectedBalls.length !== 15 || isSaving}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 disabled:opacity-50 transition-all cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>
                {isSaving
                  ? "Gravando..."
                  : isCompleted
                  ? "Atualizar Conferência"
                  : "Salvar Apuração Oficial"}
              </span>
            </button>
          </div>
        </div>

        {/* P1: Identificação do Operador e Homologação Humana */}
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-mono">Operador:</span>
            <input
              type="text"
              id="input-conference-operator"
              value={operatorId}
              onChange={e => setOperatorId(e.target.value)}
              placeholder="Ex: OPERADOR_LOCAL"
              className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-200 font-mono text-xs focus:border-emerald-500 outline-none w-44"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="check-human-confirmed"
              checked={isHumanConfirmed}
              onChange={e => setIsHumanConfirmed(e.target.checked)}
              className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
            />
            <label htmlFor="check-human-confirmed" className="text-slate-300 cursor-pointer select-none">
              Homologar resultado (confirmação humana válida)
            </label>
          </div>
        </div>

        {!isHumanConfirmed && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              Atenção: Sem homologação humana explícita, nenhum prêmio (fixo ou variável) será somado ao total financeiro confirmado (R$ 0,00).
            </span>
          </div>
        )}

        {/* 25 Bolas Clicáveis */}
        <div className="grid grid-cols-5 sm:grid-cols-10 gap-2 sm:gap-3 py-2 justify-items-center">
          {Array.from({ length: 25 }, (_, i) => i + 1).map(n => {
            const isSelected = selectedBalls.includes(n);
            return (
              <Ball
                key={n}
                number={n}
                isSelected={isSelected}
                size="md"
                onClick={() => toggleBall(n)}
              />
            );
          })}
        </div>

        {/* Card de Homologação Manual para Faixas Variáveis (14 e 15 acertos) */}
        {(has14Hits || has15Hits) && (
          <div className="bg-amber-950/20 border border-amber-500/30 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-amber-300 font-bold text-xs">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Faixa de Rateio Variável Detectada ({has15Hits && "15 acertos"}{has14Hits && has15Hits && " e "}{has14Hits && "14 acertos"})</span>
            </div>
            <p className="text-[11px] text-amber-200/80 leading-relaxed">
              Conforme a regra oficial da Lotofácil, prêmios de 14 e 15 acertos dependem de rateio da Caixa por concurso e <strong>não podem ser aceitos automaticamente de APIs terceiras</strong>. Sem comprovação homologada, permanecem como <em>Rateio Pendente</em> sem compor saldo ou ROI.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {has14Hits && (
                <div>
                  <label className="text-[10px] text-slate-300 block mb-1 font-mono">
                    Rateio Unitário Oficial — 14 Acertos (R$):
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Ex: 1540.20"
                    value={manual14Prize}
                    onChange={e => setManual14Prize(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono outline-none focus:border-emerald-500"
                  />
                </div>
              )}
              {has15Hits && (
                <div>
                  <label className="text-[10px] text-slate-300 block mb-1 font-mono">
                    Rateio Unitário Oficial — 15 Acertos (R$):
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Ex: 1845230.40"
                    value={manual15Prize}
                    onChange={e => setManual15Prize(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono outline-none focus:border-emerald-500"
                  />
                </div>
              )}
            </div>
            <div className="flex items-start gap-2 pt-1 border-t border-amber-500/20">
              <input
                type="checkbox"
                id="check-confirm-rateio"
                checked={confirmedManualRateio}
                onChange={e => setConfirmedManualRateio(e.target.checked)}
                className="mt-0.5 rounded border-slate-700 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
              />
              <label htmlFor="check-confirm-rateio" className="text-[11px] text-slate-300 cursor-pointer">
                Confirmo que verifiquei o rateio oficial nos canais da Caixa Econômica Federal e homologo esta entrada manual com valor comprovado.
              </label>
            </div>
          </div>
        )}

        {/* Painel Financeiro em Tempo Real da Conferência */}
        {selectedBalls.length > 0 && (
          <div className="pt-4 border-t border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
              <span className="text-[11px] text-slate-400 block">Custo Total (5 Jogos)</span>
              <span className="text-base font-bold text-slate-200 font-mono mt-0.5 block">
                R$ {liveFinancialSummary.cost.toFixed(2)}
              </span>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
              <span className="text-[11px] text-slate-400 block">Prêmios Confirmados</span>
              <span className="text-base font-bold text-emerald-400 font-mono mt-0.5 block">
                R$ {liveFinancialSummary.totalPrize.toFixed(2)}
              </span>
              {liveFinancialSummary.hasPendingRateio && (
                <span className="text-[10px] text-amber-400 block font-mono">
                  + Rateio Pendente (14/15 acertos)
                </span>
              )}
            </div>
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
              <span className="text-[11px] text-slate-400 block">Saldo Líquido</span>
              <span
                className={`text-base font-bold font-mono mt-0.5 block ${
                  liveFinancialSummary.netBalance >= 0 ? "text-emerald-400" : "text-amber-400"
                }`}
              >
                {liveFinancialSummary.netBalance >= 0 ? "+" : ""}R$ {liveFinancialSummary.netBalance.toFixed(2)}
              </span>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
              <span className="text-[11px] text-slate-400 block">Apostas Premiadas</span>
              <span className="text-base font-bold text-slate-100 font-mono mt-0.5 block">
                {liveFinancialSummary.winningGames} de 5
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Jogos do Concurso e Acertos em Tempo Real */}
      {currentRecord && currentRecord.games && currentRecord.games.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-200">
              Conferência dos 5 Jogos do Concurso #{currentRecord.contestNumber}
            </h3>
            {currentRecord.frozenPayload && (
              <span className="text-[11px] font-mono text-slate-500">
                SHA-256: {currentRecord.frozenPayload.sha256.substring(0, 12)}...
              </span>
            )}
          </div>

          <div className="space-y-3">
            {currentRecord.games.map((game, idx) => {
              const liveHits = game.filter(n => selectedBalls.includes(n)).length;
              let prize = 0;
              let isPending = false;
              if (liveHits >= 11 && liveHits <= 13) {
                prize = prizeValues[liveHits] || 0;
              } else if (liveHits === 14) {
                const val = parseFloat(manual14Prize);
                if (confirmedManualRateio && !isNaN(val) && val > 0) prize = val;
                else isPending = true;
              } else if (liveHits === 15) {
                const val = parseFloat(manual15Prize);
                if (confirmedManualRateio && !isNaN(val) && val > 0) prize = val;
                else isPending = true;
              }
              const isHigh = liveHits >= 11;
              return (
                <div
                  key={idx}
                  className={`border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md transition-all ${
                    isHigh
                      ? "bg-slate-900/95 border-emerald-500/40 ring-1 ring-emerald-500/20"
                      : "bg-slate-900 border-slate-800"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-lg bg-slate-800 text-slate-200 font-mono font-bold text-xs flex items-center justify-center">
                      J{idx + 1}
                    </span>
                    <span
                      className={`text-xs font-bold font-mono px-2.5 py-1 rounded-md ${
                        liveHits >= 11
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {liveHits} acertos
                    </span>
                    {prize > 0 && (
                      <span className="text-xs font-bold font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                        +R$ {prize.toFixed(2)} {liveHits >= 14 ? "(Manual Homologado)" : ""}
                      </span>
                    )}
                    {isPending && (
                      <span className="text-xs font-bold font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                        Rateio Pendente (Oficial CAIXA)
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5 justify-end">
                    {game.map(num => {
                      const isHit = selectedBalls.includes(num);
                      return <Ball key={num} number={num} isHit={isHit} size="sm" />;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(!currentRecord || !currentRecord.games || currentRecord.games.length === 0) && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center shadow-xl space-y-4">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="max-w-md mx-auto space-y-2">
            <h3 className="text-base font-bold text-slate-100">
              Nenhuma aposta encontrada para o Concurso #{selectedContestNumber}
            </h3>
            <p className="text-xs text-slate-400">
              Para realizar a conferência e calcular os acertos e prêmios, gere e confirme previamente os 5 jogos combinatórios C5 deste concurso.
            </p>
          </div>
          {onNavigateToGenerator && (
            <button
              onClick={onNavigateToGenerator}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
            >
              <span>Ir para o Gerador C5</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
