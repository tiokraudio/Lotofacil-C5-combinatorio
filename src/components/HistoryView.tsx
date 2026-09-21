import React, { useState, useEffect } from "react";
import {
  History,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Award,
  Layers,
  CheckCircle2,
  Lock,
  FileText,
  ChevronRight,
  RefreshCw,
  Eye,
} from "lucide-react";
import type { ContestRecord } from "../c5/types.ts";
import type { HistorySummary, StoredContestVerification } from "../storage/types.ts";
import { repository, formatLocalDate } from "../storage/service.ts";
import { formatBRLFromCents, formatSignedBRLFromCents } from "../utils/money.ts";
import { ContestDetailModal } from "./ContestDetailModal.tsx";
import { refreshCoordinator } from "../system/refreshCoordinator.ts";
import { classifyOperationalError } from "../system/operationalErrors.ts";
import { AlertCircle } from "lucide-react";

interface HistoryViewProps {
  onSelectContest?: (contestNumber: number) => void;
  updateTrigger?: number;
}

export const HistoryView: React.FC<HistoryViewProps> = ({ updateTrigger = 0 }) => {
  const [records, setRecords] = useState<ContestRecord[]>([]);
  const [summary, setSummary] = useState<HistorySummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<ContestRecord | null>(null);

  const loadHistoryData = async () => {
    setIsLoading(true);
    try {
      const [allRecords, sum] = await Promise.all([
        repository.getAllContestRecords(),
        repository.getHistorySummary(),
      ]);
      setRecords(allRecords);
      setSummary(sum);
      setStorageError(null);
    } catch (err: any) {
      const classified = classifyOperationalError(err, "STORAGE_UNAVAILABLE");
      setStorageError(classified.userMessage);
      setRecords([]);
      setSummary(null);
      console.error("Erro ao carregar histórico:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadHistoryData();
  }, [updateTrigger]);

  useEffect(() => {
    const unsubscribe = refreshCoordinator.subscribe(() => {
      loadHistoryData();
    });
    return unsubscribe;
  }, []);

  const handleVerifyIndividual = async (contestNumber: number): Promise<StoredContestVerification> => {
    return await repository.verifyStoredContest(contestNumber);
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(val);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Topo do Histórico */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-zinc-100 font-mono flex items-center gap-2">
            <History className="w-6 h-6 text-emerald-400" />
            <span>HISTÓRICO PROSPECTIVO</span>
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            Registro oficial e auditável de todos os concursos persistidos localmente.
          </p>
        </div>

        <button
          type="button"
          id="btn-refresh-history"
          onClick={loadHistoryData}
          disabled={isLoading}
          className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-zinc-100 text-xs font-medium inline-flex items-center gap-2 transition-colors self-start sm:self-auto disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          <span>Atualizar</span>
        </button>
      </div>

      {/* Erro de Armazenamento Local (Prompt 14 #31) */}
      {storageError && (
        <div
          role="alert"
          id="history-storage-error-alert"
          className="p-6 rounded-2xl bg-rose-950/30 border border-rose-500/50 text-rose-200 text-sm flex items-center gap-3 shadow-lg"
        >
          <AlertCircle className="w-6 h-6 text-rose-400 shrink-0" />
          <div>
            <h3 className="font-bold font-mono text-zinc-100">Falha de Acesso ao Armazenamento</h3>
            <p className="text-xs text-rose-300 mt-1">{storageError}</p>
          </div>
        </div>
      )}

      {/* Cards de Métricas Superiores */}
      {!storageError && summary && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* Concursos Conferidos */}
            <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 shadow-sm">
              <span className="text-xs text-zinc-400 block font-medium">Concursos conferidos</span>
              <span className="text-2xl font-bold font-mono text-zinc-100 mt-1 block">
                {summary.contestsPlayed}
              </span>
              <span className="text-[11px] text-zinc-400 mt-1 block">
                {summary.drafts} rascunho(s) • {summary.frozen} congelado(s)
              </span>
            </div>

            {/* Custo Correspondente */}
            <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 shadow-sm">
              <span className="text-xs text-zinc-400 block font-medium">Custo correspondente</span>
              <span className="text-2xl font-bold font-mono text-emerald-400 mt-1 block">
                {formatCurrency(summary.totalSpent)}
              </span>
              <span className="text-[11px] text-zinc-400 mt-1 block">
                R$ 17,50 por concurso conferido
              </span>
            </div>

            {/* Apostas Confirmadas */}
            <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 shadow-sm">
              <span className="text-xs text-zinc-400 block font-medium">Apostas confirmadas</span>
              <span className="text-2xl font-bold font-mono text-emerald-400 mt-1 block">
                {summary.confirmedBets}
              </span>
              <span className="text-[11px] text-zinc-400 mt-1 block">
                {formatCurrency(summary.confirmedSpent)} total apostado
              </span>
            </div>

            {/* Total de Prêmios (V1.8) */}
            <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 shadow-sm">
              <span className="text-xs text-zinc-400 block font-medium">Total de Prêmios</span>
              <span className="text-2xl font-bold font-mono text-emerald-400 mt-1 block">
                {formatBRLFromCents(summary.totalPrizeCents)}
              </span>
              <span className="text-[11px] text-zinc-400 mt-1 block">
                {summary.prizesRecorded} concurso(s) com prêmio registrado
              </span>
            </div>

            {/* Resultado Líquido (V1.8) */}
            <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 shadow-sm">
              <span className="text-xs text-zinc-400 block font-medium">Resultado Líquido</span>
              <span
                className={`text-2xl font-bold font-mono mt-1 block flex items-center gap-1.5 ${
                  summary.netResultCents > 0
                    ? "text-emerald-400"
                    : summary.netResultCents < 0
                    ? "text-rose-400"
                    : "text-zinc-300"
                }`}
              >
                {summary.netResultCents > 0 && <TrendingUp className="w-5 h-5 shrink-0" />}
                {summary.netResultCents < 0 && <TrendingDown className="w-5 h-5 shrink-0" />}
                <span>{formatSignedBRLFromCents(summary.netResultCents)}</span>
              </span>
              <span className="text-[11px] text-zinc-400 mt-1 block">
                {summary.financialHistoryComplete
                  ? "Fechamento 100% auditado"
                  : `${summary.pendingFinancialClosures} concurso(s) pendente(s)`}
              </span>
            </div>

            {/* Melhor Resultado */}
            <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 shadow-sm">
              <span className="text-xs text-zinc-400 block font-medium">Melhor resultado</span>
              <span className="text-2xl font-bold font-mono text-emerald-400 mt-1 block">
                {typeof summary.bestMaxHits === "number" && summary.bestMaxHits > 0
                  ? `${summary.bestMaxHits} acertos`
                  : "—"}
              </span>
              <span className="text-[11px] text-zinc-400 mt-1 block">
                Média do melhor:{" "}
                {typeof summary.averageMaxHits === "number" && summary.averageMaxHits > 0
                  ? summary.averageMaxHits.toFixed(2)
                  : "—"}
              </span>
            </div>

            {/* Concursos com 11+ */}
            <div
              className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 shadow-sm group relative"
              title="Número de concursos em que pelo menos um dos cinco jogos atingiu essa quantidade de acertos ou mais."
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400 block font-medium">11+</span>
                <span className="text-[10px] text-zinc-500 font-mono">≥11</span>
              </div>
              <span className="text-2xl font-bold font-mono text-zinc-100 mt-1 block">
                {summary.contestsWith11Plus}
              </span>
              <span className="text-[11px] text-zinc-400 mt-1 block">
                {summary.contestsPlayed > 0
                  ? `${((summary.contestsWith11Plus / summary.contestsPlayed) * 100).toFixed(1)}% dos concursos`
                  : "Aguardando apuração"}
              </span>
            </div>

            {/* Concursos com 12+ */}
            <div
              className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 shadow-sm"
              title="Número de concursos em que pelo menos um dos cinco jogos atingiu essa quantidade de acertos ou mais."
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400 block font-medium">12+</span>
                <span className="text-[10px] text-zinc-500 font-mono">≥12</span>
              </div>
              <span className="text-2xl font-bold font-mono text-zinc-100 mt-1 block">
                {summary.contestsWith12Plus}
              </span>
              <span className="text-[11px] text-zinc-400 mt-1 block">concursos com ≥12</span>
            </div>

            {/* Concursos com 13+ */}
            <div
              className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 shadow-sm"
              title="Número de concursos em que pelo menos um dos cinco jogos atingiu essa quantidade de acertos ou mais."
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400 block font-medium">13+</span>
                <span className="text-[10px] text-zinc-500 font-mono">≥13</span>
              </div>
              <span className="text-2xl font-bold font-mono text-zinc-100 mt-1 block">
                {summary.contestsWith13Plus}
              </span>
              <span className="text-[11px] text-zinc-400 mt-1 block">concursos com ≥13</span>
            </div>

            {/* Concursos com 14+ */}
            <div
              className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 shadow-sm"
              title="Número de concursos em que pelo menos um dos cinco jogos atingiu essa quantidade de acertos ou mais."
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400 block font-medium">14+</span>
                <span className="text-[10px] text-zinc-500 font-mono">≥14</span>
              </div>
              <span className="text-2xl font-bold font-mono text-zinc-100 mt-1 block">
                {summary.contestsWith14Plus}
              </span>
              <span className="text-[11px] text-zinc-400 mt-1 block">concursos com ≥14</span>
            </div>

            {/* Concursos com 15 */}
            <div
              className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 shadow-sm"
              title="Número de concursos em que pelo menos um dos cinco jogos atingiu 15 acertos."
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400 block font-medium">15</span>
                <span className="text-[10px] text-emerald-400 font-mono">15 acertos</span>
              </div>
              <span className="text-2xl font-bold font-mono text-emerald-400 mt-1 block">
                {summary.contestsWith15}
              </span>
              <span className="text-[11px] text-zinc-400 mt-1 block">pontuação máxima</span>
            </div>
          </div>

          {/* Seção de Cobertura Combinatória C5 (Prompt 09 - Seção 24) */}
          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-xs">
            <span className="text-[11px] font-mono font-bold tracking-widest text-emerald-400 uppercase block">
              COBERTURA COMBINATÓRIA DA CARTEIRA C₅
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-2.5 font-mono text-zinc-200">
              <div className="p-2 rounded bg-zinc-950/60 border border-zinc-800/60">
                <span className="text-zinc-500 text-[10px] block">≥11 ACERTOS</span>
                <span className="font-semibold text-zinc-100">49,7629%</span>
              </div>
              <div className="p-2 rounded bg-zinc-950/60 border border-zinc-800/60">
                <span className="text-zinc-500 text-[10px] block">≥12 ACERTOS</span>
                <span className="font-semibold text-zinc-100">9,0976%</span>
              </div>
              <div className="p-2 rounded bg-zinc-950/60 border border-zinc-800/60">
                <span className="text-zinc-500 text-[10px] block">≥13 ACERTOS</span>
                <span className="font-semibold text-zinc-100">0,7459%</span>
              </div>
              <div className="p-2 rounded bg-zinc-950/60 border border-zinc-800/60">
                <span className="text-zinc-500 text-[10px] block">≥14 ACERTOS</span>
                <span className="font-semibold text-zinc-100">0,02310%</span>
              </div>
              <div className="p-2 rounded bg-zinc-950/60 border border-zinc-800/60">
                <span className="text-emerald-400 text-[10px] block">15 ACERTOS</span>
                <span className="font-semibold text-emerald-300">1 em 653.752</span>
              </div>
            </div>
            <p className="text-[11px] text-zinc-500 mt-2.5">
              Probabilidades estruturais sob sorteio uniforme. Não são previsão do próximo concurso.
            </p>
          </div>
        </div>
      )}

      {/* Lista / Tabela de Concursos */}
      {!storageError && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden shadow-xl">
        <div className="p-4 sm:p-5 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="text-base font-bold font-mono text-zinc-100">
            Concursos Registrados ({records.length})
          </h3>
          <span className="text-xs text-zinc-400">
            Ordenação: Mais recente primeiro
          </span>
        </div>

        {records.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 rounded-2xl bg-zinc-800/80 border border-zinc-700 mx-auto flex items-center justify-center text-zinc-400 mb-3">
              <History className="w-6 h-6" />
            </div>
            <h4 className="text-base font-semibold text-zinc-200">
              Nenhum concurso registrado ainda.
            </h4>
            <p className="text-xs sm:text-sm text-zinc-400 mt-1 max-w-sm mx-auto">
              Gere o primeiro conjunto oficial C₅ na aba "Gerador" para iniciar o histórico auditável.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {records.map((rec) => {
              const isScored = rec.status === "SCORED";
              const isFrozen = rec.status === "FROZEN";
              const maxHits = rec.score?.maxHits;

              return (
                <div
                  key={`hist-rec-${rec.contestNumber}`}
                  className="p-4 hover:bg-zinc-800/40 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-center font-mono font-bold text-sm text-zinc-200 shrink-0">
                      {rec.contestNumber}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold font-mono text-zinc-100">
                          Concurso {rec.contestNumber}
                        </span>
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full border font-mono font-medium ${
                            rec.status === "DRAFT"
                              ? "bg-amber-950/60 border-amber-500/40 text-amber-300"
                              : rec.status === "FROZEN"
                              ? "bg-blue-950/60 border-blue-500/40 text-blue-300"
                              : "bg-emerald-950/60 border-emerald-500/40 text-emerald-300"
                          }`}
                        >
                          {rec.status === "DRAFT"
                            ? "RASCUNHO"
                            : rec.status === "FROZEN"
                            ? "CONGELADO"
                            : "CONFERIDO"}
                        </span>
                        {rec.betPlacedAt ? (
                          <span
                            id={`badge-bet-confirmed-${rec.contestNumber}`}
                            className="text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/50 bg-emerald-950/40 text-emerald-300 font-mono font-medium flex items-center gap-1"
                            title={`Aposta confirmada em ${formatLocalDate(rec.betPlacedAt)}`}
                          >
                            <DollarSign className="w-3 h-3" />
                            <span>APOSTADO</span>
                          </span>
                        ) : (
                          rec.status !== "DRAFT" && (
                            <span
                              className="text-[10px] px-2 py-0.5 rounded-full border border-zinc-700 bg-zinc-800/60 text-zinc-400 font-mono"
                              title="Aposta não confirmada na lotérica"
                            >
                              NÃO CONFIRMADO
                            </span>
                          )
                        )}

                        {/* Status de Prêmio (V1.8) */}
                        {rec.prize !== undefined ? (
                          <span
                            id={`badge-prize-${rec.contestNumber}`}
                            className="text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/50 bg-emerald-950/50 text-emerald-300 font-mono font-medium flex items-center gap-1"
                            title={`Prêmio registrado: ${formatBRLFromCents(rec.prize.amountCents)}`}
                          >
                            <Award className="w-3 h-3 text-emerald-400" />
                            <span>PRÊMIO: {formatBRLFromCents(rec.prize.amountCents)}</span>
                          </span>
                        ) : (
                          isScored && rec.betPlacedAt && (
                            <span
                              id={`badge-pending-prize-${rec.contestNumber}`}
                              className="text-[10px] px-2 py-0.5 rounded-full border border-amber-500/50 bg-amber-950/40 text-amber-300 font-mono font-medium"
                              title="Concurso apostado aguardando registro do prêmio recebido"
                            >
                              FECHAMENTO PENDENTE
                            </span>
                          )
                        )}
                      </div>
                      <span className="text-xs text-zinc-400 mt-0.5 block">
                        {isScored && rec.scoredAt
                          ? `Conferido em ${formatLocalDate(rec.scoredAt)}`
                          : isFrozen && rec.frozenAt
                          ? `Congelado em ${formatLocalDate(rec.frozenAt)}`
                          : `Gerado em ${formatLocalDate(rec.generatedAt)}`}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4">
                    {isScored && typeof maxHits === "number" ? (
                      <div className="text-left sm:text-right">
                        <span className="text-[11px] text-zinc-400 block font-medium">Melhor resultado:</span>
                        <span
                          className={`text-sm font-mono font-bold ${
                            maxHits >= 11 ? "text-emerald-400" : "text-zinc-300"
                          }`}
                        >
                          {maxHits} ACERTOS
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-400 italic">
                        {isFrozen ? "Aguardando resultado oficial" : "Rascunho não congelado"}
                      </span>
                    )}

                    <button
                      type="button"
                      id={`btn-open-details-${rec.contestNumber}`}
                      onClick={() => setSelectedRecord(rec)}
                      className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white text-xs font-medium border border-zinc-700 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>VER DETALHES</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* Modal de Detalhes do Concurso */}
      <ContestDetailModal
        isOpen={Boolean(selectedRecord)}
        record={selectedRecord}
        onClose={() => setSelectedRecord(null)}
        onVerify={handleVerifyIndividual}
      />
    </div>
  );
};
