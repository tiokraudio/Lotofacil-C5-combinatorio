import React, { useState, useMemo } from "react";
import {
  Activity,
  Award,
  Calendar,
  CheckCircle2,
  Clock,
  Sparkles,
  TrendingUp,
  Info,
  Lock,
  ArrowRight,
  BarChart3,
  FileSpreadsheet,
} from "lucide-react";
import { ContestRecord, ContestStatus } from "../c5-memory/types";
import {
  buildC5Dashboard,
  buildC5MonthlyReport,
} from "../c5-memory/application/uiService";
import { Ball } from "./Ball";

interface C5DashboardViewProps {
  records: readonly ContestRecord[];
  currentContestNumber: number;
  onNavigateToGenerator: () => void;
  onNavigateToConference: () => void;
}

export const C5DashboardView: React.FC<C5DashboardViewProps> = ({
  records,
  currentContestNumber,
  onNavigateToGenerator,
  onNavigateToConference,
}) => {
  // Estado para o seletor do Relatório Mensal (UI-1D requisito 9)
  const [selectedYear, setSelectedYear] = useState<number>(2026);
  const [selectedMonth, setSelectedMonth] = useState<number>(10);

  // DTOs puros de Analytics
  const dashboardDTO = useMemo(() => {
    return buildC5Dashboard(records, currentContestNumber);
  }, [records, currentContestNumber]);

  const monthlyReportDTO = useMemo(() => {
    return buildC5MonthlyReport(records, selectedYear, selectedMonth);
  }, [records, selectedYear, selectedMonth]);

  // Status visual formatado
  const getStatusBadge = (status: ContestStatus) => {
    switch (status) {
      case "AVAILABLE":
        return {
          label: "C5 disponível",
          classes: "bg-blue-500/10 text-blue-400 border-blue-500/30",
          icon: <Sparkles className="w-3.5 h-3.5" />,
        };
      case "PREVIEW":
        return {
          label: "Preview aguardando confirmação",
          classes: "bg-amber-500/10 text-amber-400 border-amber-500/30",
          icon: <Clock className="w-3.5 h-3.5" />,
        };
      case "FROZEN":
        return {
          label: "Aposta confirmada",
          classes: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
          icon: <Lock className="w-3.5 h-3.5" />,
        };
      case "COMPLETED":
        return {
          label: "Concurso encerrado",
          classes: "bg-purple-500/10 text-purple-400 border-purple-500/30",
          icon: <CheckCircle2 className="w-3.5 h-3.5" />,
        };
      default:
        return {
          label: "Aguardando resultado",
          classes: "bg-slate-500/10 text-slate-400 border-slate-500/30",
          icon: <Clock className="w-3.5 h-3.5" />,
        };
    }
  };

  const currentBadge = getStatusBadge(dashboardDTO.currentStatus);

  return (
    <div className="space-y-8 pb-16">
      {/* Topo Informativo */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs uppercase font-mono tracking-wider text-emerald-400 font-semibold">
                Painel C5-Memory
              </span>
              <span className="text-slate-600">•</span>
              <span className="text-xs text-slate-400">Camada Analítica Auditável</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-100 tracking-tight">
              Painel Operacional & Desempenho
            </h1>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl">
              Acompanhamento de desempenho real das apostas C5 observadas. Camada pura de leitura e agregação retrospectiva sem retroalimentação de geração.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onNavigateToGenerator}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition-all shadow-lg shadow-emerald-600/20 cursor-pointer"
            >
              <span>Ir para Gerador C5</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Grid Superior: Concurso Atual & Último Resultado */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card: Concurso Atual */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between shadow-lg">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-400" />
                <h2 className="text-lg font-bold text-slate-100">
                  Concurso {dashboardDTO.currentContestNumber}
                </h2>
              </div>
              <div
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${currentBadge.classes}`}
              >
                {currentBadge.icon}
                <span>{currentBadge.label}</span>
              </div>
            </div>

            {dashboardDTO.currentRecord?.status === "FROZEN" ? (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">
                  Jogos congelados com hash SHA-256 e prontos para apuração:
                </p>
                <div className="space-y-1.5 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                  {dashboardDTO.currentRecord.games.map((g, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs">
                      <span className="font-mono text-slate-400 font-semibold">Jogo {idx + 1}</span>
                      <span className="font-mono text-slate-200">
                        {g.map(n => n.toString().padStart(2, "0")).join(" ")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : dashboardDTO.currentRecord?.status === "COMPLETED" ? (
              <p className="text-sm text-slate-400">
                Este concurso já foi concluído e apurado. Avance para o próximo concurso no Gerador.
              </p>
            ) : (
              <div className="py-4 text-center">
                <p className="text-sm text-slate-400">
                  Nenhuma aposta congelada ainda para o concurso {dashboardDTO.currentContestNumber}.
                </p>
                <button
                  onClick={onNavigateToGenerator}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300"
                >
                  <span>Gerar C5 agora</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
            <span>Algoritmo: <strong className="text-slate-200 font-mono">C5-Memory-2.0.0</strong></span>
            {dashboardDTO.currentRecord?.frozenPayload && (
              <span className="font-mono text-[11px] text-slate-500">
                SHA: {dashboardDTO.currentRecord.frozenPayload.sha256.substring(0, 8)}...
              </span>
            )}
          </div>
        </div>

        {/* Card: Último Resultado */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between shadow-lg">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-400" />
                <h2 className="text-lg font-bold text-slate-100">Último Resultado</h2>
              </div>
              {dashboardDTO.lastCompletedPerformance && (
                <span className="font-mono text-xs text-slate-400">
                  Concurso {dashboardDTO.lastCompletedPerformance.contestNumber}
                </span>
              )}
            </div>

            {dashboardDTO.lastCompletedPerformance ? (
              <div className="space-y-4">
                {/* Dezenas Sorteadas */}
                <div>
                  <span className="text-xs text-slate-400 block mb-2">Resultado oficial:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {dashboardDTO.lastCompletedPerformance.officialResult?.map(n => (
                      <Ball key={n} number={n} isOfficial size="sm" />
                    ))}
                  </div>
                </div>

                {/* Desempenho dos 5 Jogos */}
                <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80 space-y-2">
                  <div className="grid grid-cols-5 gap-2 text-center text-xs">
                    {dashboardDTO.lastCompletedPerformance.gameDetails.map(g => {
                      const isBest = g.hits === dashboardDTO.lastCompletedPerformance?.bestHits;
                      return (
                        <div
                          key={g.gameIndex}
                          className={`p-2 rounded-lg border ${
                            isBest
                              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300 font-bold"
                              : "bg-slate-900/60 border-slate-800 text-slate-300"
                          }`}
                        >
                          <div className="text-[10px] text-slate-400 font-mono">J{g.gameIndex}</div>
                          <div className="text-sm mt-0.5">{g.hits}</div>
                          <div className="text-[9px] text-slate-500">acertos</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Destaque do Melhor Resultado */}
                  <div className="mt-3 pt-2 border-t border-slate-800 flex items-center justify-between text-xs">
                    <span className="text-slate-400">Melhor resultado:</span>
                    <span className="font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                      {dashboardDTO.lastCompletedPerformance.bestHits} acertos
                      {dashboardDTO.lastCompletedPerformance.bestHitsCount > 1 &&
                        ` — ${dashboardDTO.lastCompletedPerformance.bestHitsCount} jogos`}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-slate-500 text-sm">
                Ainda não há concursos C5 apurados.
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-800/80">
            <span>Critério: Retrospectivo</span>
            <button
              onClick={onNavigateToConference}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
            >
              Conferir outro concurso
            </button>
          </div>
        </div>
      </div>

      {/* Card: Resumo do Período */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-400" />
            <h2 className="text-xl font-bold text-slate-100">Resumo Geral de Desempenho</h2>
          </div>
          <span className="text-xs font-mono text-slate-400">
            {dashboardDTO.scoredContests} concursos apurados de {dashboardDTO.confirmedContests} confirmados
          </span>
        </div>

        {dashboardDTO.scoredContests === 0 ? (
          <div className="p-8 text-center bg-slate-950/40 rounded-xl border border-slate-800/60">
            <p className="text-base text-slate-400 font-medium">Ainda não há concursos C5 apurados.</p>
            <p className="text-xs text-slate-500 mt-1">
              Conclua a conferência de ao menos um concurso oficial para visualizar as estatísticas agregadas.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Indicadores Principais */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800">
                <span className="text-xs text-slate-400 block">Concursos Confirmados</span>
                <span className="text-2xl font-black text-slate-100 font-mono mt-1 block">
                  {dashboardDTO.confirmedContests}
                </span>
                <span className="text-[11px] text-slate-500">
                  {dashboardDTO.confirmedGames} jogos gerados
                </span>
              </div>

              <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800">
                <span className="text-xs text-slate-400 block">Concursos Apurados</span>
                <span className="text-2xl font-black text-emerald-400 font-mono mt-1 block">
                  {dashboardDTO.scoredContests}
                </span>
                <span className="text-[11px] text-slate-500">
                  {dashboardDTO.scoredGames} jogos auditados
                </span>
              </div>

              <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800">
                <span className="text-xs text-slate-400 block">Melhor Acerto Observado</span>
                <span className="text-2xl font-black text-amber-400 font-mono mt-1 block">
                  {dashboardDTO.overallBestHits} <span className="text-xs font-normal text-slate-400">acertos</span>
                </span>
                <span className="text-[11px] text-slate-500">
                  {dashboardDTO.overallBestHitsCount} ocorrência(s)
                </span>
              </div>

              <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800">
                <span className="text-xs text-slate-400 block">Jogos Premiados (11+)</span>
                <span className="text-2xl font-black text-indigo-400 font-mono mt-1 block">
                  {dashboardDTO.tiers.tier11.count +
                    dashboardDTO.tiers.tier12.count +
                    dashboardDTO.tiers.tier13.count +
                    dashboardDTO.tiers.tier14.count +
                    dashboardDTO.tiers.tier15.count}
                </span>
                <span className="text-[11px] text-slate-500">
                  em {dashboardDTO.scoredGames} jogos
                </span>
              </div>
            </div>

            {/* Faixas Relevantes de Premiação (11, 12, 13, 14, 15) com Denominador Explicito */}
            <div>
              <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <span>Faixas de Premiação Oficiais</span>
                <span className="text-[11px] text-slate-500 font-normal">
                  (Denominador: {dashboardDTO.scoredGames} jogos apurados)
                </span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                {[
                  { tier: 11, data: dashboardDTO.tiers.tier11, color: "text-slate-200", border: "border-slate-700" },
                  { tier: 12, data: dashboardDTO.tiers.tier12, color: "text-blue-300", border: "border-blue-500/30" },
                  { tier: 13, data: dashboardDTO.tiers.tier13, color: "text-emerald-300", border: "border-emerald-500/30" },
                  { tier: 14, data: dashboardDTO.tiers.tier14, color: "text-amber-300", border: "border-amber-500/30" },
                  { tier: 15, data: dashboardDTO.tiers.tier15, color: "text-purple-300", border: "border-purple-500/30" },
                ].map(item => (
                  <div
                    key={item.tier}
                    className={`bg-slate-950/70 p-4 rounded-xl border ${item.border} flex flex-col justify-between`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm text-slate-200">{item.tier} acertos</span>
                        <span className="text-[10px] font-mono text-slate-400">
                          {item.data.percentage.toFixed(2)}%
                        </span>
                      </div>
                      <div className={`text-xl font-black font-mono mt-2 ${item.color}`}>
                        {item.data.count}{" "}
                        <span className="text-xs font-normal text-slate-400">
                          de {item.data.total}
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-800/80 text-[10px] text-slate-500 flex justify-between">
                      <span>Teórico:</span>
                      <span className="font-mono">{item.data.theoreticalProbability.toFixed(3)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Distribuição Completa de Acertos (0 a 15) */}
            <div className="bg-slate-950/60 p-5 rounded-xl border border-slate-800">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-200">
                    Distribuição Completa de Acertos (0 a 15)
                  </h3>
                  <p className="text-xs text-slate-400">
                    Todas as pontuações observadas mantêm a integridade matemática dos denominadores.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs font-mono bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400">Soma verificada:</span>
                  <span className="text-emerald-400 font-bold">
                    {dashboardDTO.totalDistributionSum} de {dashboardDTO.scoredGames} jogos
                  </span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                </div>
              </div>

              {/* Tabela Horizontal da Distribuição */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-center border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-mono">
                      {Array.from({ length: 16 }, (_, i) => (
                        <th key={i} className="py-2 px-1 font-semibold">
                          {i}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="font-mono text-slate-200">
                      {Array.from({ length: 16 }, (_, i) => {
                        const count = dashboardDTO.hitDistribution[i] || 0;
                        const isHighlight = i >= 11 && count > 0;
                        return (
                          <td
                            key={i}
                            className={`py-2 px-1 ${
                              isHighlight
                                ? "bg-emerald-500/10 text-emerald-300 font-bold border-t border-b border-emerald-500/30"
                                : ""
                            }`}
                          >
                            {count}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Evolução por Concurso */}
            <div className="bg-slate-950/60 p-5 rounded-xl border border-slate-800">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    <span>Evolução do Melhor Resultado C5 por Concurso</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Série puramente retrospectiva dos acertos observados. Sem projeções ou falácia do apostador.
                  </p>
                </div>
              </div>

              {/* Mini gráfico visual por barras */}
              <div className="flex items-end gap-2 sm:gap-4 h-36 pt-6 px-2 border-b border-slate-800 overflow-x-auto">
                {dashboardDTO.evolutionSeries.map(pt => {
                  const heightPercent = Math.max(15, (pt.bestHits / 15) * 100);
                  const isHigh = pt.bestHits >= 11;
                  return (
                    <div
                      key={pt.contestNumber}
                      className="flex-1 min-w-[36px] max-w-[60px] flex flex-col items-center justify-end h-full group"
                    >
                      <span className="text-[10px] font-mono text-slate-300 font-bold mb-1 opacity-90 group-hover:scale-110 transition-transform">
                        {pt.bestHits}
                      </span>
                      <div
                        style={{ height: `${heightPercent}%` }}
                        className={`w-full rounded-t-md transition-all ${
                          pt.bestHits >= 14
                            ? "bg-gradient-to-t from-purple-600 to-amber-400 shadow-md shadow-amber-400/20"
                            : isHigh
                            ? "bg-emerald-500"
                            : "bg-slate-700"
                        }`}
                      />
                      <span className="text-[9px] font-mono text-slate-400 mt-2 rotate-[-45deg] sm:rotate-0 origin-center">
                        {pt.contestNumber}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Relatório Mensal (UI-1D Requisitos 9 e 10) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="w-5 h-5 text-indigo-400" />
            <div>
              <h2 className="text-xl font-bold text-slate-100">Relatório Mensal C5</h2>
              <p className="text-xs text-slate-400">
                Detalhamento por concurso e faixas observadas do período selecionado.
              </p>
            </div>
          </div>

          {/* Seletores de Ano e Mês */}
          <div className="flex items-center gap-2">
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(Number(e.target.value))}
              className="bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-lg px-3 py-2 focus:ring-1 focus:ring-emerald-500 outline-none"
            >
              {[
                { v: 1, l: "Janeiro" },
                { v: 2, l: "Fevereiro" },
                { v: 3, l: "Março" },
                { v: 4, l: "Abril" },
                { v: 5, l: "Maio" },
                { v: 6, l: "Junho" },
                { v: 7, l: "Julho" },
                { v: 8, l: "Agosto" },
                { v: 9, l: "Setembro" },
                { v: 10, l: "Outubro" },
                { v: 11, l: "Novembro" },
                { v: 12, l: "Dezembro" },
              ].map(m => (
                <option key={m.v} value={m.v}>
                  {m.l}
                </option>
              ))}
            </select>

            <select
              value={selectedYear}
              onChange={e => setSelectedYear(Number(e.target.value))}
              className="bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-lg px-3 py-2 focus:ring-1 focus:ring-emerald-500 outline-none"
            >
              {[2025, 2026, 2027].map(y => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        {monthlyReportDTO.scoredContests === 0 ? (
          <div className="p-8 text-center bg-slate-950/40 rounded-xl border border-slate-800/60">
            <p className="text-sm text-slate-400 font-medium">
              Nenhum concurso C5 apurado em {monthlyReportDTO.monthLabel}.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Concursos realizados encontrados no banco: {monthlyReportDTO.totalContestsInMonth}.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Resumo do Mês */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
              <div>
                <span className="text-xs text-slate-400">Concursos no Mês:</span>
                <span className="text-lg font-bold text-slate-100 font-mono block mt-0.5">
                  {monthlyReportDTO.totalContestsInMonth}
                </span>
                <span className="text-[10px] text-slate-500">
                  {monthlyReportDTO.confirmedContests} confirmados / {monthlyReportDTO.scoredContests} apurados
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-400">Jogos Apurados:</span>
                <span className="text-lg font-bold text-emerald-400 font-mono block mt-0.5">
                  {monthlyReportDTO.scoredGames}
                </span>
                <span className="text-[10px] text-slate-500">
                  de {monthlyReportDTO.confirmedGames} apostados
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-400">Melhor Resultado do Mês:</span>
                <span className="text-lg font-bold text-amber-400 font-mono block mt-0.5">
                  {monthlyReportDTO.bestHitsOfMonth} acertos
                </span>
                <span className="text-[10px] text-slate-500">
                  {monthlyReportDTO.bestHitsOccurrences} ocorrência(s)
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-400">Concursos com Melhor:</span>
                <span className="text-sm font-semibold text-slate-200 font-mono block mt-1">
                  {monthlyReportDTO.bestHitsContests.join(", ") || "-"}
                </span>
              </div>
            </div>

            {/* Tabela do Mês por Concurso */}
            <div className="overflow-x-auto bg-slate-950/80 rounded-xl border border-slate-800">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-900/80 text-slate-400 uppercase font-mono text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Concurso</th>
                    <th className="py-3 px-4">Data</th>
                    <th className="py-3 px-3 text-center">J1</th>
                    <th className="py-3 px-3 text-center">J2</th>
                    <th className="py-3 px-3 text-center">J3</th>
                    <th className="py-3 px-3 text-center">J4</th>
                    <th className="py-3 px-3 text-center">J5</th>
                    <th className="py-3 px-4 text-right">Melhor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {monthlyReportDTO.contestRows.map(row => (
                    <tr key={row.contestNumber} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4 font-bold text-slate-100">
                        {row.contestNumber}
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {row.contestDate}
                      </td>
                      <td className="py-3 px-3 text-center text-slate-300">{row.j1Hits}</td>
                      <td className="py-3 px-3 text-center text-slate-300">{row.j2Hits}</td>
                      <td className="py-3 px-3 text-center text-slate-300">{row.j3Hits}</td>
                      <td className="py-3 px-3 text-center text-slate-300">{row.j4Hits}</td>
                      <td className="py-3 px-3 text-center text-slate-300">{row.j5Hits}</td>
                      <td className="py-3 px-4 text-right">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            row.bestHits >= 11
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                              : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {row.bestHits}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Nota Metodológica e Separação de Probabilidades (Requisitos 11 e 12) */}
      <div className="bg-slate-900/50 border border-slate-800/80 rounded-xl p-5 flex items-start gap-3 text-xs text-slate-400">
        <Info className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <strong className="text-slate-200 block">
            Isolamento Causal & Separação de Probabilidades Teóricas:
          </strong>
          <p>
            O algoritmo <strong>C5-Memory-2.0.0</strong> opera com critério de memória determinística para maximizar o afastamento combinatório relativo (MAX-LEXIMIN).
            As métricas deste painel são exclusivamente descritivas e retrospectivas. O histórico observado de acertos <strong>jamais alimenta ou modifica</strong> a geração de apostas futuras nem altera as probabilidades matemáticas dos sorteios da Lotofácil.
          </p>
        </div>
      </div>
    </div>
  );
};
