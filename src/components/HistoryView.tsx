import React, { useState, useMemo } from "react";
import {
  Calendar,
  Filter,
  CheckCircle2,
  Clock,
  Lock,
  ChevronRight,
  ShieldCheck,
  Eye,
  X,
  Copy,
  Check,
  Coins,
  Download,
  FileSpreadsheet,
  TrendingUp,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { ContestRecord, ContestStatus } from "../c5-memory/types";
import {
  calculateContestPrize,
  calculateContestOfficialPrize,
  calculateContestFinancialBreakdown,
  COST_PER_CONTEST,
  isContestPendingVariableRateio,
  isContestPendingProvisionalRateio,
  isRecordFixture,
} from "../c5-memory/analytics/c5Analytics";
import { Ball } from "./Ball";

interface HistoryViewProps {
  records: readonly ContestRecord[];
}

export const HistoryView: React.FC<HistoryViewProps> = ({ records }) => {
  const [filterStatus, setFilterStatus] = useState<string>("ALL"); // ALL, PENDING, COMPLETED
  const [filterMonth, setFilterMonth] = useState<string>("ALL");
  const [selectedRecord, setSelectedRecord] = useState<ContestRecord | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);
  const [copiedReport, setCopiedReport] = useState(false);

  // Extrai lista única de meses disponíveis (YYYY-MM)
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => {
      if (r.contestDate && r.contestDate.length >= 7) {
        set.add(r.contestDate.substring(0, 7));
      }
    });
    return Array.from(set).sort().reverse();
  }, [records]);

  // Filtra registros
  const filteredRecords = useMemo(() => {
    return records
      .filter(r => {
        if (filterStatus === "PENDING") {
          return r.status !== "COMPLETED";
        }
        if (filterStatus === "COMPLETED") {
          return r.status === "COMPLETED";
        }
        return true;
      })
      .filter(r => {
        if (filterMonth === "ALL") return true;
        return r.contestDate && r.contestDate.startsWith(filterMonth);
      })
      .sort((a, b) => b.contestNumber - a.contestNumber);
  }, [records, filterStatus, filterMonth]);

  // Resumo financeiro e operacional do conjunto filtrado
  const financialSummary = useMemo(() => {
    const confirmed = filteredRecords.filter(r => r.status === "FROZEN" || r.status === "COMPLETED");
    const completed = filteredRecords.filter(
      r => r.status === "COMPLETED" && Array.isArray(r.officialResult) && r.officialResult.length === 15
    );

    // P0 & P1 (Oitava e Nona Rodadas): Isola registros usando o predicado canônico unificado
    const productionConfirmed = confirmed.filter(r => !isRecordFixture(r));
    const productionCompleted = completed.filter(r => !isRecordFixture(r));

    const totalCost = productionConfirmed.reduce((acc, r) => acc + (r.totalCost ?? COST_PER_CONTEST), 0);
    const totalPrize = productionCompleted.reduce((acc, r) => acc + calculateContestPrize(r), 0);
    const netBalance = totalPrize - totalCost;
    const roiPercentage = totalCost > 0 ? ((totalPrize - totalCost) / totalCost) * 100 : 0;

    const officialTotalPrize = productionCompleted.reduce((acc, r) => acc + calculateContestOfficialPrize(r), 0);
    const officialNetBalance = officialTotalPrize - totalCost;
    const officialRoiPercentage = totalCost > 0 ? (officialNetBalance / totalCost) * 100 : 0;

    let manualConfirmedPrize = 0;
    let manualInformedPrize = 0;
    let officialValidatedPrize = 0;
    for (const r of productionCompleted) {
      const fin = calculateContestFinancialBreakdown(r);
      manualConfirmedPrize += fin.manualConfirmedPrize;
      manualInformedPrize += fin.manualInformedPrize;
      officialValidatedPrize += fin.officialValidatedPrize;
    }

    const winningCount = productionCompleted.filter(
      r => r.financialStatus === "HOMOLOGATED" && (r.bestHits ?? 0) >= 11
    ).length;
    const provisionalWinningCount = productionCompleted.filter(
      r => r.financialStatus === "PENDING_HOMOLOGATION" && (r.bestHits ?? 0) >= 11
    ).length;
    const pendingRateioCount = productionCompleted.filter(isContestPendingVariableRateio).length;
    const hasPendingRateio = pendingRateioCount > 0;
    const provisionalPendingRateioCount = filteredRecords.filter(
      r => !isRecordFixture(r) && isContestPendingProvisionalRateio(r)
    ).length;
    const hasProvisionalPendingRateio = provisionalPendingRateioCount > 0;

    return {
      confirmedCount: confirmed.length,
      completedCount: completed.length,
      totalCost,
      totalPrize,
      netBalance,
      roiPercentage,
      officialTotalPrize,
      officialNetBalance,
      officialRoiPercentage,
      manualConfirmedPrize,
      manualInformedPrize,
      officialValidatedPrize,
      winningCount,
      provisionalWinningCount,
      pendingRateioCount,
      hasPendingRateio,
      provisionalPendingRateioCount,
      hasProvisionalPendingRateio,
    };
  }, [filteredRecords]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  const handleExportCSV = () => {
    const headers = [
      "Concurso",
      "Data",
      "Status",
      "Algoritmo",
      "Melhor_Acerto",
      "Custo_R$",
      "Premio_Oficial_Caixa_R$",
      "Saldo_Oficial_R$",
      "Premio_Manual_Auditado_R$",
      "Valor_Informado_Pendente_R$",
      "Premio_Total_Auditado_R$",
      "Saldo_Total_Auditado_R$",
      "Rateio_Pendente",
      "Origem_Resultado",
      "Hash_SHA256",
    ];

    const rows = filteredRecords.map(r => {
      const fin = calculateContestFinancialBreakdown(r);
      const cost = r.totalCost ?? COST_PER_CONTEST;
      const hasPending = isContestPendingVariableRateio(r);
      const hasProv = isContestPendingProvisionalRateio(r);
      return [
        r.contestNumber,
        r.contestDate,
        r.status,
        r.algorithmVersion,
        r.bestHits ?? 0,
        cost.toFixed(2),
        fin.officialTotalPrize.toFixed(2),
        fin.officialNetBalance.toFixed(2),
        fin.manualConfirmedPrize.toFixed(2),
        fin.manualInformedPrize.toFixed(2),
        fin.totalAuditedPrize.toFixed(2),
        fin.netBalance.toFixed(2),
        hasPending ? "RATEIO_PENDENTE" : hasProv ? "PROVISORIO" : "NAO",
        r.resultSource ?? "N/A",
        r.frozenPayload?.sha256 ?? "N/A",
      ].join(";");
    });

    const csvContent = "\uFEFF" + [headers.join(";"), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio-c5-memory-${filterMonth === "ALL" ? "geral" : filterMonth}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyFormattedReport = () => {
    let reportText = `=== RELATÓRIO OPERACIONAL E FINANCEIRO C5-MEMORY ===\n`;
    reportText += `Período: ${filterMonth === "ALL" ? "Geral (Todos os meses)" : filterMonth}\n`;
    reportText += `Concursos Confirmados: ${financialSummary.confirmedCount}\n`;
    reportText += `Concursos Apurados: ${financialSummary.completedCount}\n`;
    reportText += `Total Investido: R$ ${financialSummary.totalCost.toFixed(2)}\n`;
    reportText += `Prêmios Oficiais Caixa: R$ ${financialSummary.officialTotalPrize.toFixed(2)}\n`;
    reportText += `Saldo Oficial Caixa: ${financialSummary.officialNetBalance >= 0 ? "+" : ""}R$ ${financialSummary.officialNetBalance.toFixed(2)}\n`;
    reportText += `Retorno Oficial Caixa (ROI): ${financialSummary.officialRoiPercentage >= 0 ? "+" : ""}${financialSummary.officialRoiPercentage.toFixed(1)}%\n`;
    if (financialSummary.manualConfirmedPrize > 0) {
      reportText += `Prêmios com Confirmação Manual Auditada: R$ ${financialSummary.manualConfirmedPrize.toFixed(2)} (Segregados de saldo oficial até prova Caixa)\n`;
      reportText += `Prêmio Total Consolidado Auditado: R$ ${financialSummary.totalPrize.toFixed(2)}\n`;
      reportText += `Saldo Líquido Consolidado Auditado: ${financialSummary.netBalance >= 0 ? "+" : ""}R$ ${financialSummary.netBalance.toFixed(2)}\n`;
      reportText += `ROI Consolidado Auditado: ${financialSummary.roiPercentage >= 0 ? "+" : ""}${financialSummary.roiPercentage.toFixed(1)}%\n`;
    }
    if (financialSummary.manualInformedPrize > 0) {
      reportText += `Valores Informados Pendentes de Comprovação: R$ ${financialSummary.manualInformedPrize.toFixed(2)} (Excluídos de saldo e ROI)\n`;
    }
    reportText += `Concursos com Premiação Confirmada: ${financialSummary.winningCount} de ${financialSummary.completedCount}${financialSummary.provisionalWinningCount > 0 ? ` (+${financialSummary.provisionalWinningCount} provisório(s) aguardando homologação)` : ""}\n`;
    if (financialSummary.hasPendingRateio) {
      reportText += `Atenção: ${financialSummary.pendingRateioCount} concurso(s) com Rateio Oficial da Caixa Pendente (14/15 acertos). Saldo e ROI oficiais computam apenas valores homologados pela Caixa.\n`;
    }
    if (financialSummary.hasProvisionalPendingRateio) {
      reportText += `Aviso: ${financialSummary.provisionalPendingRateioCount} concurso(s) com acertos provisórios de 14/15 aguardando homologação do sorteio.\n`;
    }
    reportText += `\nDETALHAMENTO DOS CONCURSOS:\n`;
    reportText += `Concurso | Data       | Status    | Melhor | Custo (R$) | Pr. Oficial | Pr. Manual | Pr. Pendente | Pr. Total | Saldo Ofic. | Rateio\n`;
    reportText += `----------------------------------------------------------------------------------------------------------------------------\n`;

    filteredRecords.forEach(r => {
      const fin = calculateContestFinancialBreakdown(r);
      const cost = r.totalCost ?? COST_PER_CONTEST;
      const hasPending = isContestPendingVariableRateio(r);
      const hasProv = isContestPendingProvisionalRateio(r);
      const num = `#${r.contestNumber}`.padEnd(8, " ");
      const dt = r.contestDate.padEnd(10, " ");
      const st = r.status.padEnd(9, " ");
      const best = `${r.bestHits ?? 0} ac.`.padEnd(6, " ");
      const cStr = cost.toFixed(2).padStart(10, " ");
      const pOficStr = fin.officialTotalPrize.toFixed(2).padStart(11, " ");
      const pManStr = fin.manualConfirmedPrize.toFixed(2).padStart(10, " ");
      const pPendStr = fin.manualInformedPrize.toFixed(2).padStart(12, " ");
      const pTotStr = fin.totalAuditedPrize.toFixed(2).padStart(9, " ");
      const nOficStr = `${fin.officialNetBalance >= 0 ? "+" : ""}${fin.officialNetBalance.toFixed(2)}`.padStart(11, " ");
      const ratStr = hasPending ? "RATEIO PENDENTE" : hasProv ? "PROVISÓRIO" : "OK";
      reportText += `${num} | ${dt} | ${st} | ${best} | ${cStr} | ${pOficStr} | ${pManStr} | ${pPendStr} | ${pTotStr} | ${nOficStr} | ${ratStr}\n`;
    });

    navigator.clipboard.writeText(reportText);
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2000);
  };

  const getStatusBadge = (status: ContestStatus, financialStatus?: string) => {
    switch (status) {
      case "COMPLETED":
        if (financialStatus === "PENDING_HOMOLOGATION") {
          return { label: "Apurado (Pendente)", classes: "bg-amber-500/10 text-amber-300 border-amber-500/20" };
        }
        return { label: "Homologado", classes: "bg-purple-500/10 text-purple-300 border-purple-500/20" };
      case "FROZEN":
        return { label: "Confirmado", classes: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" };
      case "PREVIEW":
        return { label: "Preview", classes: "bg-amber-500/10 text-amber-300 border-amber-500/20" };
      default:
        return { label: "Disponível", classes: "bg-blue-500/10 text-blue-300 border-blue-500/20" };
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-16">
      {/* Topo do Histórico */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs uppercase font-mono tracking-wider text-emerald-400 font-semibold">
                Registro Histórico & Financeiro
              </span>
              <span className="text-slate-600">•</span>
              <span className="text-xs text-slate-400">Atividade Longitudinal e Contábil</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-100">
              Histórico de Concursos & Relatório Financeiro
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Registro auditável dos jogos C5, apuração de prêmios e demonstrativo de saldo do período.
            </p>
          </div>

          {/* Ações de Exportação */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleCopyFormattedReport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-all cursor-pointer"
              title="Copiar relatório formatado para a área de transferência"
            >
              {copiedReport ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedReport ? "Copiado!" : "Copiar Relatório"}</span>
            </button>

            <button
              onClick={handleExportCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
              title="Exportar planilha CSV dos concursos filtrados"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportar CSV</span>
            </button>
          </div>
        </div>

        {/* Filtros */}
        <div className="mt-6 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setFilterStatus("ALL")}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                filterStatus === "ALL" ? "bg-slate-800 text-emerald-400 font-bold" : "text-slate-400"
              }`}
            >
              Todos ({records.length})
            </button>
            <button
              onClick={() => setFilterStatus("PENDING")}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                filterStatus === "PENDING" ? "bg-slate-800 text-emerald-400 font-bold" : "text-slate-400"
              }`}
            >
              Em andamento ({records.filter(r => r.status !== "COMPLETED").length})
            </button>
            <button
              onClick={() => setFilterStatus("COMPLETED")}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                filterStatus === "COMPLETED" ? "bg-slate-800 text-emerald-400 font-bold" : "text-slate-400"
              }`}
            >
              Apurados ({records.filter(r => r.status === "COMPLETED").length})
            </button>
          </div>

          {availableMonths.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">Filtrar por Mês:</span>
              <select
                value={filterMonth}
                onChange={e => setFilterMonth(e.target.value)}
                className="bg-slate-950 border border-slate-700 text-slate-200 text-xs font-mono rounded-xl px-3 py-1.5 outline-none cursor-pointer"
              >
                <option value="ALL">Todos os meses ({availableMonths.length})</option>
                {availableMonths.map(m => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Painel Financeiro do Período Filtrado */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-slate-100">
              Demonstrativo Financeiro do Período {filterMonth !== "ALL" ? `(${filterMonth})` : "(Geral)"}
            </h2>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            {financialSummary.completedCount} apurados de {financialSummary.confirmedCount} confirmados
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
            <span className="text-[11px] text-slate-400 block">Total Investido</span>
            <span className="text-xl font-black font-mono text-slate-200 mt-1 block">
              R$ {financialSummary.totalCost.toFixed(2)}
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              R$ {COST_PER_CONTEST.toFixed(2)} por concurso
            </span>
          </div>

          <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
            <span className="text-[11px] text-slate-400 block">Prêmios Oficiais Caixa</span>
            <span className="text-xl font-black font-mono text-emerald-400 mt-1 block">
              R$ {financialSummary.officialTotalPrize.toFixed(2)}
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              {financialSummary.winningCount} confirmados
              {financialSummary.provisionalWinningCount > 0 && (
                <span className="text-amber-400 ml-1">
                  ({financialSummary.provisionalWinningCount} provisório{financialSummary.provisionalWinningCount > 1 ? "s" : ""})
                </span>
              )}
            </span>
          </div>

          <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
            <span className="text-[11px] text-slate-400 block">Saldo Oficial Caixa</span>
            <span
              className={`text-xl font-black font-mono mt-1 block ${
                financialSummary.officialNetBalance >= 0 ? "text-emerald-400" : "text-amber-400"
              }`}
            >
              {financialSummary.officialNetBalance >= 0 ? "+" : ""}R$ {financialSummary.officialNetBalance.toFixed(2)}
            </span>
            <span className="text-[10px] text-slate-500 font-mono">Prêmios Ofic. menos Custo</span>
          </div>

          <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
            <span className="text-[11px] text-slate-400 block">ROI Oficial Caixa</span>
            <span
              className={`text-xl font-black font-mono mt-1 block ${
                financialSummary.officialRoiPercentage >= 0 ? "text-emerald-400" : "text-amber-400"
              }`}
            >
              {financialSummary.officialRoiPercentage >= 0 ? "+" : ""}
              {financialSummary.officialRoiPercentage.toFixed(1)}%
            </span>
            <span className="text-[10px] text-slate-500 font-mono">(Prêmio Ofic. - Custo) / Custo</span>
          </div>
        </div>

        {financialSummary.manualConfirmedPrize > 0 && (
          <div className="mt-4 p-3 bg-slate-950/80 border border-slate-800 rounded-xl space-y-1.5 text-xs">
            <div className="flex items-center justify-between text-slate-300">
              <span className="font-semibold text-emerald-400">Oficial Caixa Confirmado:</span>
              <span className="font-mono">
                R$ {financialSummary.officialTotalPrize.toFixed(2)} (Saldo: R$ {financialSummary.officialNetBalance.toFixed(2)}, ROI: {financialSummary.officialRoiPercentage.toFixed(1)}%)
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span className="font-semibold text-amber-300">Confirmação Manual Auditada:</span>
              <span className="font-mono text-amber-300">
                R$ {financialSummary.manualConfirmedPrize.toFixed(2)} (Segregado de saldo oficial até prova Caixa)
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-400 border-t border-slate-800/60 pt-1">
              <span className="font-medium text-slate-400">Total Consolidado Auditado:</span>
              <span className="font-mono text-slate-300">
                R$ {financialSummary.totalPrize.toFixed(2)} (Saldo: {financialSummary.netBalance >= 0 ? "+" : ""}R$ {financialSummary.netBalance.toFixed(2)}, ROI: {financialSummary.roiPercentage.toFixed(1)}%)
              </span>
            </div>
          </div>
        )}

        {financialSummary.hasPendingRateio && (
          <div className="mt-3 flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-300 text-xs">
            <span className="font-bold">Rateio Oficial da Caixa Pendente:</span>
            <span>
              Existem {financialSummary.pendingRateioCount} concurso(s) homologado(s) com 14 ou 15 acertos aguardando confirmação do rateio oficial da Caixa. O saldo e o ROI computam apenas valores já homologados.
            </span>
          </div>
        )}

        {financialSummary.hasProvisionalPendingRateio && (
          <div className="mt-3 flex items-center gap-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-300 text-xs">
            <span className="font-bold">Apuração Provisória em Aberto:</span>
            <span>
              Existem {financialSummary.provisionalPendingRateioCount} concurso(s) com acertos provisórios de 14 ou 15 aguardando conferência e homologação do sorteio pelo operador.
            </span>
          </div>
        )}
      </div>

      {/* Lista de Concursos */}
      {filteredRecords.length === 0 ? (
        <div className="p-8 text-center bg-slate-900/60 rounded-2xl border border-slate-800 text-slate-400 text-sm">
          Nenhum registro encontrado para os filtros selecionados.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRecords.map(rec => {
            const badge = getStatusBadge(rec.status, rec.financialStatus);
            const prize = calculateContestPrize(rec);
            const cost = rec.totalCost ?? COST_PER_CONTEST;
            const net = prize - cost;
            const isCompleted = rec.status === "COMPLETED";

            return (
              <div
                key={rec.contestNumber}
                onClick={() => setSelectedRecord(rec)}
                className="bg-slate-900/90 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 rounded-xl p-4 transition-all cursor-pointer shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-slate-800 flex flex-col items-center justify-center font-mono shrink-0">
                    <span className="text-[10px] text-slate-400">Nº</span>
                    <span className="text-sm font-bold text-slate-100">{rec.contestNumber}</span>
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">{rec.contestDate}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${badge.classes}`}>
                        {badge.label}
                      </span>
                      {rec.resultSource && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                          {rec.resultSource === "API_TERCEIROS"
                            ? "API Terceiros"
                            : rec.resultSource === "API_LOTERIAS"
                            ? "API Terceiros (Loterias)"
                            : rec.resultSource === "API_CAIXA"
                            ? "API Caixa Oficial"
                            : "Manual"}
                        </span>
                      )}
                      {isContestPendingVariableRateio(rec) && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30 font-mono">
                          Rateio Oficial Pendente
                        </span>
                      )}
                      {isContestPendingProvisionalRateio(rec) && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/30 font-mono">
                          Apuração Provisória (14/15)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-300 mt-1 font-mono">
                      5 Jogos C5 • {isCompleted ? `Apurado (${rec.bestHits ?? 0} acertos)` : "Pendente de resultado"}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6 justify-between sm:justify-end">
                  {/* Bloco Financeiro por Concurso */}
                  <div className="text-right font-mono">
                    <span className="text-[10px] text-slate-400 block">
                      Custo: R$ {cost.toFixed(2)} {isCompleted && `• Prêmio Confirmado: R$ ${prize.toFixed(2)}`}
                    </span>
                    {isCompleted ? (
                      <span
                        className={`text-xs font-bold ${
                          net >= 0 ? "text-emerald-400" : "text-amber-400"
                        }`}
                      >
                        Saldo: {net >= 0 ? "+" : ""}R$ {net.toFixed(2)}
                        {isContestPendingVariableRateio(rec)
                          ? " (Rateio Oficial Pendente)"
                          : isContestPendingProvisionalRateio(rec)
                          ? " (Apuração Provisória)"
                          : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">Aguardando apuração</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 text-slate-400 text-xs shrink-0">
                    <span>Detalhes</span>
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Detalhes do Concurso */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <span className="text-xs font-mono uppercase text-emerald-400 font-bold">
                  Concurso #{selectedRecord.contestNumber}
                </span>
                <h3 className="text-xl font-bold text-slate-100">
                  Detalhes da Aposta e Auditoria
                </h3>
              </div>
              <button
                onClick={() => setSelectedRecord(null)}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Demonstrativo Financeiro do Concurso */}
            {(() => {
              const fin = calculateContestFinancialBreakdown(selectedRecord);
              return (
                <div className="space-y-3">
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 grid grid-cols-3 gap-3 text-center">
                    <div>
                      <span className="text-[10px] text-slate-400 block">Custo do Concurso</span>
                      <span className="text-sm font-bold font-mono text-slate-200 mt-0.5 block">
                        R$ {(selectedRecord.totalCost ?? COST_PER_CONTEST).toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">Prêmio Oficial Caixa</span>
                      <span className="text-sm font-bold font-mono text-emerald-400 mt-0.5 block">
                        R$ {fin.officialTotalPrize.toFixed(2)}
                      </span>
                      {isContestPendingVariableRateio(selectedRecord) && (
                        <span className="text-[9px] text-amber-400 font-mono block mt-0.5">+ Rateio Pendente</span>
                      )}
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">Saldo Oficial Caixa</span>
                      <span
                        className={`text-sm font-bold font-mono mt-0.5 block ${
                          fin.officialNetBalance >= 0 ? "text-emerald-400" : "text-amber-400"
                        }`}
                      >
                        {fin.officialNetBalance >= 0 ? "+" : ""}
                        R$ {fin.officialNetBalance.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {fin.manualConfirmedPrize > 0 && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-1 text-xs">
                      <div className="flex justify-between items-center text-amber-300">
                        <span className="font-semibold">Confirmação Manual Auditada:</span>
                        <span className="font-mono font-bold">R$ {fin.manualConfirmedPrize.toFixed(2)}</span>
                      </div>
                      <p className="text-[10px] text-amber-200/70">
                        Valor registrado pelo operador e auditado, porém segregado do saldo oficial até homologação documental independente da Caixa.
                      </p>
                      <div className="flex justify-between items-center text-slate-300 pt-1 border-t border-amber-500/20">
                        <span className="font-medium">Total Consolidado Auditado:</span>
                        <span className="font-mono">R$ {fin.totalAuditedPrize.toFixed(2)} (Saldo: {fin.netBalance >= 0 ? "+" : ""}R$ {fin.netBalance.toFixed(2)})</span>
                      </div>
                    </div>
                  )}

                  {fin.manualInformedPrize > 0 && (
                    <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl space-y-1 text-xs">
                      <div className="flex justify-between items-center text-slate-300">
                        <span className="font-semibold text-slate-400">Valor Informado Pendente (Não Confirmado):</span>
                        <span className="font-mono text-slate-400 font-bold">R$ {fin.manualInformedPrize.toFixed(2)}</span>
                      </div>
                      <p className="text-[10px] text-slate-500">
                        Valor preliminar informado no registro, sem homologação documental da Caixa ou auditoria de operador. Mantido estritamente para trilha de auditoria, sem incorporação a prêmios, saldo ou ROI confirmados.
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Aviso de Rateio Pendente */}
            {isContestPendingVariableRateio(selectedRecord) && (
              <div className="bg-amber-950/20 border border-amber-500/30 rounded-xl p-3 flex items-start gap-2.5 text-xs text-amber-300">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="font-bold block">Rateio Oficial da Caixa Pendente</span>
                  <p className="text-[11px] text-amber-200/80">
                    Este concurso possui apostas premiadas em faixas variáveis (14 ou 15 acertos) cujo rateio oficial ainda não foi homologado.
                    O saldo e o total de prêmios refletem estritamente os valores comprovados até o momento.
                  </p>
                </div>
              </div>
            )}

            {/* Resultado Oficial se houver */}
            {selectedRecord.officialResult && (
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-medium">Resultado Oficial Sorteado:</span>
                  <span className="text-[10px] font-mono text-slate-400">
                    Fonte: {selectedRecord.resultSource === "API_TERCEIROS"
                      ? "API Terceiros (Intermediária)"
                      : selectedRecord.resultSource === "API_LOTERIAS"
                      ? "API Terceiros (Loterias)"
                      : selectedRecord.resultSource === "API_CAIXA"
                      ? "API Caixa Oficial"
                      : "Conferência Manual"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedRecord.officialResult.map(n => (
                    <Ball key={n} number={n} isOfficial size="sm" />
                  ))}
                </div>
              </div>
            )}

            {/* Jogos Registrados */}
            <div className="space-y-3">
              <span className="text-xs text-slate-400 font-medium">Os 5 Jogos Oficiais C5:</span>
              {selectedRecord.games.map((game, idx) => {
                const hits = selectedRecord.gameHits ? selectedRecord.gameHits[idx] : undefined;
                return (
                  <div
                    key={idx}
                    className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded bg-slate-800 text-slate-300 font-mono text-[10px] flex items-center justify-center font-bold">
                        J{idx + 1}
                      </span>
                      {hits !== undefined && (
                        <span
                          className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded ${
                            hits >= 11
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                              : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {hits} acertos
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 justify-end">
                      {game.map(num => {
                        const isHit = selectedRecord.officialResult?.includes(num);
                        return <Ball key={num} number={num} isHit={isHit} size="sm" />;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Auditoria Criptográfica */}
            {selectedRecord.frozenPayload && (
              <div className="space-y-2 text-xs bg-slate-950/90 p-4 rounded-xl border border-slate-800/80">
                <div className="flex items-center gap-2 text-emerald-400 font-bold mb-1">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Auditoria Criptográfica de Congelamento</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400 font-mono">
                  <div>
                    <span>Revisão Histórica:</span>{" "}
                    <strong className="text-slate-200">#{selectedRecord.frozenPayload.historyRevision}</strong>
                  </div>
                  <div>
                    <span>Índice no Pool:</span>{" "}
                    <strong className="text-slate-200">{selectedRecord.frozenPayload.poolIndex}</strong>
                  </div>
                </div>
                <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] font-mono text-slate-400">
                  <span className="truncate max-w-xs">
                    SHA: {selectedRecord.frozenPayload.sha256}
                  </span>
                  <button
                    onClick={() => handleCopy(selectedRecord.frozenPayload!.sha256)}
                    className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 ml-2 cursor-pointer"
                  >
                    {copiedHash ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedHash ? "Copiado" : "Copiar"}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
