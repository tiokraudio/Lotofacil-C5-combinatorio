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
  FileText,
  TrendingUp,
  Sparkles,
  AlertTriangle,
  RotateCcw,
  Search,
  ChevronDown,
  BarChart3,
  Award,
  Layers,
  Percent,
} from "lucide-react";
import { ContestRecord, ContestStatus, C5Game } from "../c5-memory/types";
import {
  calculateContestPrize,
  calculateContestOfficialPrize,
  calculateContestFinancialBreakdown,
  COST_PER_CONTEST,
  isContestPendingVariableRateio,
  isContestPendingProvisionalRateio,
  isRecordFixture,
  FIXED_PRIZES,
  getContestLifecycleStage,
  getLatestHomologatedContest,
} from "../c5-memory/analytics/c5Analytics";
import { calculateHits } from "../c5-memory/math";
import { Ball } from "./Ball";
import { generateC5FinancialReportPDF } from "../utils/pdfExport";

interface HistoryViewProps {
  records: readonly ContestRecord[];
}

export const HistoryView: React.FC<HistoryViewProps> = ({ records }) => {
  // Filtros combináveis
  const [filterStartDate, setFilterStartDate] = useState<string>("");
  const [filterEndDate, setFilterEndDate] = useState<string>("");
  const [filterYear, setFilterYear] = useState<string>("ALL");
  const [filterMonth, setFilterMonth] = useState<string>("ALL");
  const [filterContestSearch, setFilterContestSearch] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [filterConference, setFilterConference] = useState<string>("ALL");
  const [filterWinning, setFilterWinning] = useState<string>("ALL");
  const [filterHits, setFilterHits] = useState<string>("ALL");
  const [filterPrizeTier, setFilterPrizeTier] = useState<string>("ALL");
  const [filterAlgorithm, setFilterAlgorithm] = useState<string>("ALL");

  // Visualizações e Modal
  const [activeTab, setActiveTab] = useState<"LIST" | "MONTHLY" | "ANNUAL">("LIST");
  const [selectedRecord, setSelectedRecord] = useState<ContestRecord | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);
  const [copiedReport, setCopiedReport] = useState(false);
  const [isExportingPDF, setIsExportingPDF] = useState(false);

  // Anos e Meses únicos presentes nos dados
  const availableYears = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => {
      if (r.contestDate && r.contestDate.length >= 4) {
        set.add(r.contestDate.substring(0, 4));
      }
    });
    return Array.from(set).sort().reverse();
  }, [records]);

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => {
      if (r.contestDate && r.contestDate.length >= 7) {
        set.add(r.contestDate.substring(0, 7));
      }
    });
    return Array.from(set).sort().reverse();
  }, [records]);

  // Função para limpar todos os filtros
  const handleClearFilters = () => {
    setFilterStartDate("");
    setFilterEndDate("");
    setFilterYear("ALL");
    setFilterMonth("ALL");
    setFilterContestSearch("");
    setFilterStatus("ALL");
    setFilterConference("ALL");
    setFilterWinning("ALL");
    setFilterHits("ALL");
    setFilterPrizeTier("ALL");
    setFilterAlgorithm("ALL");
  };

  const hasActiveFilters = useMemo(() => {
    return (
      filterStartDate !== "" ||
      filterEndDate !== "" ||
      filterYear !== "ALL" ||
      filterMonth !== "ALL" ||
      filterContestSearch.trim() !== "" ||
      filterStatus !== "ALL" ||
      filterConference !== "ALL" ||
      filterWinning !== "ALL" ||
      filterHits !== "ALL" ||
      filterPrizeTier !== "ALL" ||
      filterAlgorithm !== "ALL"
    );
  }, [
    filterStartDate,
    filterEndDate,
    filterYear,
    filterMonth,
    filterContestSearch,
    filterStatus,
    filterConference,
    filterWinning,
    filterHits,
    filterPrizeTier,
    filterAlgorithm,
  ]);

  // Aplicação simultânea e rigorosa de todos os filtros combináveis
  const filteredRecords = useMemo(() => {
    return records
      .filter(r => {
        if (filterStartDate && r.contestDate && r.contestDate < filterStartDate) {
          return false;
        }
        if (filterEndDate && r.contestDate && r.contestDate > filterEndDate) {
          return false;
        }
        if (filterYear !== "ALL" && r.contestDate && !r.contestDate.startsWith(filterYear)) {
          return false;
        }
        if (filterMonth !== "ALL" && r.contestDate && !r.contestDate.startsWith(filterMonth)) {
          return false;
        }
        if (filterContestSearch.trim() !== "") {
          const search = filterContestSearch.trim();
          if (search.includes("-")) {
            const [minStr, maxStr] = search.split("-");
            const min = parseInt(minStr, 10);
            const max = parseInt(maxStr, 10);
            if (!isNaN(min) && !isNaN(max)) {
              if (r.contestNumber < min || r.contestNumber > max) return false;
            }
          } else {
            const exact = parseInt(search, 10);
            if (!isNaN(exact)) {
              if (r.contestNumber !== exact) return false;
            } else if (!String(r.contestNumber).includes(search)) {
              return false;
            }
          }
        }
        if (filterStatus !== "ALL" && r.status !== filterStatus) {
          return false;
        }
        if (filterConference === "CHECKED" && getContestLifecycleStage(r) !== "HOMOLOGATED") {
          return false;
        }
        if (filterConference === "PENDING" && getContestLifecycleStage(r) === "HOMOLOGATED") {
          return false;
        }
        const prize = calculateContestPrize(r);
        const hasWinningHit = (r.bestHits ?? 0) >= 11;
        if (filterWinning === "WINNING" && (!hasWinningHit || prize <= 0)) {
          return false;
        }
        if (filterWinning === "NON_WINNING" && (hasWinningHit || prize > 0)) {
          return false;
        }
        if (filterHits !== "ALL") {
          const targetHits = parseInt(filterHits, 10);
          if (r.bestHits !== targetHits) {
            const hitsList = r.gameHits || [];
            if (!hitsList.includes(targetHits)) {
              return false;
            }
          }
        }
        if (filterPrizeTier === ">0" && prize <= 0) return false;
        if (filterPrizeTier === ">100" && prize <= 100) return false;
        if (filterPrizeTier === ">1000" && prize <= 1000) return false;
        if (filterPrizeTier === ">10000" && prize <= 10000) return false;

        if (filterAlgorithm === "C5-Memory 3.0" && r.algorithmVersion !== "C5-Memory-3.0") {
          return false;
        }
        if (filterAlgorithm === "ANTERIOR" && r.algorithmVersion === "C5-Memory-3.0") {
          return false;
        }

        return true;
      })
      .sort((a, b) => b.contestNumber - a.contestNumber);
  }, [
    records,
    filterStartDate,
    filterEndDate,
    filterYear,
    filterMonth,
    filterContestSearch,
    filterStatus,
    filterConference,
    filterWinning,
    filterHits,
    filterPrizeTier,
    filterAlgorithm,
  ]);

  // Cálculo rigoroso dos 16 Indicadores Financeiros e Operacionais (Classificação Canônica P1)
  const financialSummary = useMemo(() => {
    const totalRegistered = filteredRecords.length;
    const confirmed = filteredRecords.filter(r => r.status === "FROZEN" || r.status === "COMPLETED");
    const completed = filteredRecords.filter(
      r => !isRecordFixture(r) && getContestLifecycleStage(r) === "HOMOLOGATED"
    );
    const pendingContests = filteredRecords.filter(r => getContestLifecycleStage(r) !== "HOMOLOGATED");

    const productionConfirmed = confirmed.filter(r => !isRecordFixture(r));
    const productionCompleted = completed;

    const confirmedCount = confirmed.length;
    const completedCount = completed.length;

    const totalGames = filteredRecords.reduce((acc, r) => acc + (r.games?.length || 5), 0);
    const totalSimpleBets = totalGames;

    const totalCost = productionConfirmed.reduce((acc, r) => acc + (r.totalCost ?? COST_PER_CONTEST), 0);
    const totalPrize = productionCompleted.reduce((acc, r) => acc + calculateContestPrize(r), 0);
    const officialTotalPrize = productionCompleted.reduce((acc, r) => acc + calculateContestOfficialPrize(r), 0);

    const netBalance = totalPrize - totalCost;
    const officialNetBalance = officialTotalPrize - totalCost;

    const roiPercentage = totalCost > 0 ? (netBalance / totalCost) * 100 : 0;
    const officialRoiPercentage = totalCost > 0 ? (officialNetBalance / totalCost) * 100 : 0;

    const avgCostPerContest = confirmedCount > 0 ? totalCost / confirmedCount : 0;
    const avgPrizePerCompleted = completedCount > 0 ? totalPrize / completedCount : 0;

    let maxSinglePrize = 0;
    for (const r of productionCompleted) {
      const p = calculateContestPrize(r);
      if (p > maxSinglePrize) maxSinglePrize = p;
    }

    let maxHitsReached = 0;
    for (const r of productionCompleted) {
      if ((r.bestHits ?? 0) > maxHitsReached) {
        maxHitsReached = r.bestHits ?? 0;
      }
    }

    const winningContests = productionCompleted.filter(r => (r.bestHits ?? 0) >= 11);
    const winningContestsCount = winningContests.length;
    const winningContestsPct = completedCount > 0 ? (winningContestsCount / completedCount) * 100 : 0;

    const nonWinningContestsCount = completedCount - winningContestsCount;
    const nonWinningContestsPct = completedCount > 0 ? (nonWinningContestsCount / completedCount) * 100 : 0;

    const tierDistribution: Record<number, { count: number; totalValue: number }> = {
      15: { count: 0, totalValue: 0 },
      14: { count: 0, totalValue: 0 },
      13: { count: 0, totalValue: 0 },
      12: { count: 0, totalValue: 0 },
      11: { count: 0, totalValue: 0 },
    };

    let manualConfirmedPrize = 0;
    let manualInformedPrize = 0;
    let officialValidatedPrize = 0;

    for (const r of productionCompleted) {
      const fin = calculateContestFinancialBreakdown(r);
      manualConfirmedPrize += fin.manualConfirmedPrize;
      manualInformedPrize += fin.manualInformedPrize;
      officialValidatedPrize += fin.officialValidatedPrize;

      if (r.officialResult && Array.isArray(r.games)) {
        r.games.forEach((g, gIdx) => {
          const hits = r.gameHits ? r.gameHits[gIdx] : calculateHits(g, r.officialResult!);
          if (hits >= 11 && hits <= 15) {
            tierDistribution[hits].count++;
            let gamePrize = 0;
            if (r.prizeBreakdown && r.prizeBreakdown[String(hits)]) {
              gamePrize = r.prizeBreakdown[String(hits)]?.unitValue ?? 0;
            } else if (FIXED_PRIZES[hits as keyof typeof FIXED_PRIZES]) {
              gamePrize = FIXED_PRIZES[hits as keyof typeof FIXED_PRIZES] ?? 0;
            }
            tierDistribution[hits].totalValue += gamePrize;
          }
        });
      }
    }

    const pendingCost = pendingContests.reduce((acc, r) => acc + (r.totalCost ?? COST_PER_CONTEST), 0);
    const pendingRateioCount = productionCompleted.filter(isContestPendingVariableRateio).length;
    const provisionalPendingRateioCount = filteredRecords.filter(
      r => !isRecordFixture(r) && isContestPendingProvisionalRateio(r)
    ).length;

    return {
      totalRegistered,
      confirmedCount,
      completedCount,
      totalGames,
      totalSimpleBets,
      totalCost,
      totalPrize,
      netBalance,
      roiPercentage,
      officialTotalPrize,
      officialNetBalance,
      officialRoiPercentage,
      avgCostPerContest,
      avgPrizePerCompleted,
      maxSinglePrize,
      maxHitsReached,
      winningContestsCount,
      winningContestsPct,
      nonWinningContestsCount,
      nonWinningContestsPct,
      tierDistribution,
      manualConfirmedPrize,
      manualInformedPrize,
      officialValidatedPrize,
      pendingCost,
      pendingContestsCount: pendingContests.length,
      pendingRateioCount,
      hasPendingRateio: pendingRateioCount > 0,
      provisionalPendingRateioCount,
      hasProvisionalPendingRateio: provisionalPendingRateioCount > 0,
    };
  }, [filteredRecords]);

  // Agrupamento Mensal Consolidado
  const monthlySummary = useMemo(() => {
    const map = new Map<
      string,
      {
        yearMonth: string;
        contestsCount: number;
        gamesCount: number;
        cost: number;
        prize: number;
        completedCount: number;
      }
    >();

    for (const r of filteredRecords) {
      if (isRecordFixture(r)) continue;
      const ym = r.contestDate && r.contestDate.length >= 7 ? r.contestDate.substring(0, 7) : "Indefinido";
      const entry = map.get(ym) || {
        yearMonth: ym,
        contestsCount: 0,
        gamesCount: 0,
        cost: 0,
        prize: 0,
        completedCount: 0,
      };

      entry.contestsCount++;
      entry.gamesCount += r.games?.length || 5;
      if (r.status === "FROZEN" || r.status === "COMPLETED") {
        entry.cost += r.totalCost ?? COST_PER_CONTEST;
      }
      if (getContestLifecycleStage(r) === "HOMOLOGATED") {
        entry.prize += calculateContestPrize(r);
        entry.completedCount++;
      }
      map.set(ym, entry);
    }

    return Array.from(map.values())
      .map(item => {
        const net = item.prize - item.cost;
        const roi = item.cost > 0 ? (net / item.cost) * 100 : 0;
        return {
          ...item,
          net,
          roi,
        };
      })
      .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
  }, [filteredRecords]);

  // Agrupamento Anual Consolidado
  const annualSummary = useMemo(() => {
    const map = new Map<
      string,
      {
        year: string;
        contestsCount: number;
        gamesCount: number;
        cost: number;
        prize: number;
        completedCount: number;
      }
    >();

    for (const r of filteredRecords) {
      if (isRecordFixture(r)) continue;
      const yr = r.contestDate && r.contestDate.length >= 4 ? r.contestDate.substring(0, 4) : "Indefinido";
      const entry = map.get(yr) || {
        year: yr,
        contestsCount: 0,
        gamesCount: 0,
        cost: 0,
        prize: 0,
        completedCount: 0,
      };

      entry.contestsCount++;
      entry.gamesCount += r.games?.length || 5;
      if (r.status === "FROZEN" || r.status === "COMPLETED") {
        entry.cost += r.totalCost ?? COST_PER_CONTEST;
      }
      if (getContestLifecycleStage(r) === "HOMOLOGATED") {
        entry.prize += calculateContestPrize(r);
        entry.completedCount++;
      }
      map.set(yr, entry);
    }

    return Array.from(map.values())
      .map(item => {
        const net = item.prize - item.cost;
        const roi = item.cost > 0 ? (net / item.cost) * 100 : 0;
        return {
          ...item,
          net,
          roi,
        };
      })
      .sort((a, b) => b.year.localeCompare(a.year));
  }, [filteredRecords]);

  // Ações de exportação
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  const handleExportPDF = () => {
    setIsExportingPDF(true);
    try {
      const activeFiltersRecord: Record<string, string> = {};
      if (filterStartDate) activeFiltersRecord["Data Inicial"] = filterStartDate;
      if (filterEndDate) activeFiltersRecord["Data Final"] = filterEndDate;
      if (filterYear !== "ALL") activeFiltersRecord["Ano"] = filterYear;
      if (filterMonth !== "ALL") activeFiltersRecord["Mês"] = filterMonth;
      if (filterContestSearch) activeFiltersRecord["Concurso"] = filterContestSearch;
      if (filterStatus !== "ALL") activeFiltersRecord["Status"] = filterStatus;
      if (filterConference !== "ALL") activeFiltersRecord["Conferência"] = filterConference;
      if (filterWinning !== "ALL") activeFiltersRecord["Premiação"] = filterWinning;
      if (filterHits !== "ALL") activeFiltersRecord["Faixa de Acertos"] = `${filterHits} acertos`;
      if (filterPrizeTier !== "ALL") activeFiltersRecord["Faixa de Valor"] = filterPrizeTier;
      if (filterAlgorithm !== "ALL") activeFiltersRecord["Algoritmo"] = filterAlgorithm;

      const periodLabel = filterMonth !== "ALL"
        ? filterMonth
        : filterYear !== "ALL"
        ? filterYear
        : filterStartDate || filterEndDate
        ? `${filterStartDate || "Início"} a ${filterEndDate || "Fim"}`
        : "Geral (Todos os Períodos)";

      const pdfFinancialSummary = {
        confirmedCount: financialSummary.confirmedCount,
        completedCount: financialSummary.completedCount,
        totalCost: financialSummary.totalCost,
        totalPrize: financialSummary.totalPrize,
        netBalance: financialSummary.netBalance,
        roiPercentage: financialSummary.roiPercentage,
        officialTotalPrize: financialSummary.officialTotalPrize,
        officialNetBalance: financialSummary.officialNetBalance,
        officialRoiPercentage: financialSummary.officialRoiPercentage,
        manualConfirmedPrize: financialSummary.manualConfirmedPrize,
        manualInformedPrize: financialSummary.manualInformedPrize,
        officialValidatedPrize: financialSummary.officialValidatedPrize,
        winningCount: financialSummary.winningContestsCount,
        provisionalWinningCount: 0,
        pendingRateioCount: financialSummary.pendingRateioCount,
        hasPendingRateio: financialSummary.hasPendingRateio,
        bestHitsOverall: financialSummary.maxHitsReached,
        maxSinglePrize: financialSummary.maxSinglePrize,
        winPercentage: financialSummary.winningContestsPct,
        nonWinningCount: financialSummary.nonWinningContestsCount,
        nonWinningPercentage: financialSummary.nonWinningContestsPct,
        tierBreakdown: {
          15: { count: financialSummary.tierDistribution[15].count, totalPrize: financialSummary.tierDistribution[15].totalValue },
          14: { count: financialSummary.tierDistribution[14].count, totalPrize: financialSummary.tierDistribution[14].totalValue },
          13: { count: financialSummary.tierDistribution[13].count, totalPrize: financialSummary.tierDistribution[13].totalValue },
          12: { count: financialSummary.tierDistribution[12].count, totalPrize: financialSummary.tierDistribution[12].totalValue },
          11: { count: financialSummary.tierDistribution[11].count, totalPrize: financialSummary.tierDistribution[11].totalValue },
        },
      };

      generateC5FinancialReportPDF({
        periodLabel,
        appliedFilters: activeFiltersRecord,
        records: filteredRecords,
        financialSummary: pdfFinancialSummary,
      });
    } catch (err) {
      console.error("Erro ao gerar PDF:", err);
      alert("Erro ao exportar PDF. Verifique o console.");
    } finally {
      setIsExportingPDF(false);
    }
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
    let reportText = `=== RELATÓRIO OPERACIONAL E FINANCEIRO C5-MEMORY 3.0 ===\n`;
    reportText += `Período: ${filterMonth === "ALL" ? (filterYear === "ALL" ? "Geral" : filterYear) : filterMonth}\n`;
    reportText += `Concursos Cadastrados: ${financialSummary.totalRegistered}\n`;
    reportText += `Concursos Confirmados: ${financialSummary.confirmedCount}\n`;
    reportText += `Concursos Apurados: ${financialSummary.completedCount}\n`;
    reportText += `Total de Jogos Gerados: ${financialSummary.totalGames}\n`;
    reportText += `Total Investido: R$ ${financialSummary.totalCost.toFixed(2)}\n`;
    reportText += `Prêmios Oficiais Caixa: R$ ${financialSummary.officialTotalPrize.toFixed(2)}\n`;
    reportText += `Saldo Oficial Caixa: ${financialSummary.officialNetBalance >= 0 ? "+" : ""}R$ ${financialSummary.officialNetBalance.toFixed(2)}\n`;
    reportText += `Retorno Oficial (ROI): ${financialSummary.officialRoiPercentage >= 0 ? "+" : ""}${financialSummary.officialRoiPercentage.toFixed(1)}%\n`;
    reportText += `Custo Médio / Concurso: R$ ${financialSummary.avgCostPerContest.toFixed(2)}\n`;
    reportText += `Prêmio Médio / Conferido: R$ ${financialSummary.avgPrizePerCompleted.toFixed(2)}\n`;
    reportText += `Maior Faixa Alcançada: ${financialSummary.maxHitsReached} acertos\n`;
    reportText += `Concursos Premiados (>=11): ${financialSummary.winningContestsCount} (${financialSummary.winningContestsPct.toFixed(1)}%)\n`;
    reportText += `Concursos Não Premiados: ${financialSummary.nonWinningContestsCount} (${financialSummary.nonWinningContestsPct.toFixed(1)}%)\n`;
    reportText += `\nDistribuição de Premiação:\n`;
    for (const h of [15, 14, 13, 12, 11]) {
      const t = financialSummary.tierDistribution[h];
      reportText += `  ${h} Acertos: ${t.count} jogos • Total: R$ ${t.totalValue.toFixed(2)}\n`;
    }

    navigator.clipboard.writeText(reportText);
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2000);
  };

  const latestHomologatedContest = useMemo(() => {
    return getLatestHomologatedContest(records);
  }, [records]);

  const getRecordStatusBadge = (rec: ContestRecord) => {
    const stage = getContestLifecycleStage(rec);
    switch (stage) {
      case "HOMOLOGATED":
        return { label: "Homologado", classes: "bg-purple-500/10 text-purple-300 border-purple-500/20" };
      case "RESULT_VALIDATED":
        return { label: "Apurado (Pendente)", classes: "bg-amber-500/10 text-amber-300 border-amber-500/20" };
      case "RESULT_RECEIVED":
        return { label: "Resultado Recebido", classes: "bg-blue-500/10 text-blue-300 border-blue-500/20" };
      case "RECORDED":
      default:
        if (rec.status === "FROZEN") {
          return { label: "Confirmado", classes: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" };
        }
        if (rec.status === "PREVIEW") {
          return { label: "Preview", classes: "bg-amber-500/10 text-amber-300 border-amber-500/20" };
        }
        return { label: "Disponível", classes: "bg-blue-500/10 text-blue-300 border-blue-500/20" };
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-16">
      {/* Topo do Histórico & Ações de Exportação */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs uppercase font-mono tracking-wider text-emerald-400 font-semibold">
                Registro Histórico & Financeiro
              </span>
              <span className="text-slate-600">•</span>
              <span className="text-xs text-slate-400">C5-Memory 3.0 • Atividade Auditada</span>
              {latestHomologatedContest && (
                <>
                  <span className="text-slate-600">•</span>
                  <span className="text-xs text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded-full border border-purple-500/20 font-mono font-semibold">
                    Último Homologado: #{latestHomologatedContest.contestNumber}
                  </span>
                </>
              )}
            </div>
            <h1 className="text-2xl font-bold text-slate-100">
              Histórico & Painel Financeiro
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Filtros multicritério e conciliação canônica unificada.
            </p>
          </div>

          {/* Botões de Exportação */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleExportPDF}
              disabled={isExportingPDF}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white text-xs font-bold shadow-md shadow-red-600/20 transition-all cursor-pointer disabled:opacity-50"
              title="Exportar Relatório Profissional em PDF"
            >
              <FileText className="w-4 h-4" />
              <span>{isExportingPDF ? "Gerando..." : "Exportar Relatório PDF"}</span>
            </button>

            <button
              onClick={handleExportCSV}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
              title="Exportar planilha CSV dos concursos filtrados"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportar CSV</span>
            </button>

            <button
              onClick={handleCopyFormattedReport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-all cursor-pointer"
              title="Copiar relatório formatado para a área de transferência"
            >
              {copiedReport ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedReport ? "Copiado!" : "Copiar"}</span>
            </button>
          </div>
        </div>

        {/* Filtros Combináveis */}
        <div className="mt-6 pt-5 border-t border-slate-800 space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-emerald-400" />
              <span>Filtros Combináveis ({filteredRecords.length} de {records.length} registros)</span>
            </div>
            {hasActiveFilters && (
              <button
                onClick={handleClearFilters}
                className="flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 cursor-pointer font-medium"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Limpar Filtros</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
            {/* 1. Data Inicial */}
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Data Inicial</label>
              <input
                type="date"
                value={filterStartDate}
                onChange={e => setFilterStartDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 outline-none font-mono"
              />
            </div>

            {/* 2. Data Final */}
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Data Final</label>
              <input
                type="date"
                value={filterEndDate}
                onChange={e => setFilterEndDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 outline-none font-mono"
              />
            </div>

            {/* 3. Ano */}
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Ano</label>
              <select
                value={filterYear}
                onChange={e => setFilterYear(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 outline-none cursor-pointer font-mono"
              >
                <option value="ALL">Todos os Anos</option>
                {availableYears.map(yr => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </select>
            </div>

            {/* 4. Mês */}
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Mês (YYYY-MM)</label>
              <select
                value={filterMonth}
                onChange={e => setFilterMonth(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 outline-none cursor-pointer font-mono"
              >
                <option value="ALL">Todos os Meses</option>
                {availableMonths.map(m => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            {/* 5. Concurso Busca/Intervalo */}
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Concurso (Nº ou X-Y)</label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Ex: 3820 ou 3800-3820"
                  value={filterContestSearch}
                  onChange={e => setFilterContestSearch(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg pl-2 py-1.5 outline-none font-mono"
                />
              </div>
            </div>

            {/* 6. Status do Concurso */}
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Status</label>
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 outline-none cursor-pointer"
              >
                <option value="ALL">Todos os Status</option>
                <option value="PREVIEW">PREVIEW</option>
                <option value="FROZEN">FROZEN (Confirmado)</option>
                <option value="COMPLETED">COMPLETED (Apurado)</option>
              </select>
            </div>

            {/* 7. Conferência */}
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Conferência</label>
              <select
                value={filterConference}
                onChange={e => setFilterConference(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 outline-none cursor-pointer"
              >
                <option value="ALL">Todos</option>
                <option value="CHECKED">Conferidos</option>
                <option value="PENDING">Pendentes</option>
              </select>
            </div>

            {/* 8. Premiação */}
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Premiação</label>
              <select
                value={filterWinning}
                onChange={e => setFilterWinning(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 outline-none cursor-pointer"
              >
                <option value="ALL">Todos</option>
                <option value="WINNING">Premiados (&gt;=11)</option>
                <option value="NON_WINNING">Não Premiados (&lt;11)</option>
              </select>
            </div>

            {/* 9. Faixa de Acertos */}
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Faixa de Acertos</label>
              <select
                value={filterHits}
                onChange={e => setFilterHits(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 outline-none cursor-pointer font-mono"
              >
                <option value="ALL">Todas as Faixas</option>
                <option value="15">15 Acertos</option>
                <option value="14">14 Acertos</option>
                <option value="13">13 Acertos</option>
                <option value="12">12 Acertos</option>
                <option value="11">11 Acertos</option>
              </select>
            </div>

            {/* 10. Faixa de Valor */}
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Valor de Prêmio</label>
              <select
                value={filterPrizeTier}
                onChange={e => setFilterPrizeTier(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 outline-none cursor-pointer"
              >
                <option value="ALL">Todos os Valores</option>
                <option value=">0">&gt; R$ 0,00</option>
                <option value=">100">&gt; R$ 100,00</option>
                <option value=">1000">&gt; R$ 1.000,00</option>
                <option value=">10000">&gt; R$ 10.000,00</option>
              </select>
            </div>

            {/* 11. Algoritmo */}
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Algoritmo</label>
              <select
                value={filterAlgorithm}
                onChange={e => setFilterAlgorithm(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 outline-none cursor-pointer"
              >
                <option value="ALL">Todas as Versões</option>
                <option value="C5-Memory 3.0">C5-Memory 3.0</option>
                <option value="ANTERIOR">Versões Anteriores</option>
              </select>
            </div>

            {/* Botão Reset */}
            <div className="flex items-end">
              <button
                onClick={handleClearFilters}
                className="w-full py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-colors cursor-pointer"
              >
                Resetar Filtros
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Painel com os 16 Indicadores Financeiros e Operacionais */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-slate-100">
              Painel Financeiro & Indicadores Consolidados
            </h2>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            {financialSummary.completedCount} conferidos de {financialSummary.confirmedCount} confirmados ({financialSummary.totalGames} jogos)
          </span>
        </div>

        {/* Grade de Indicadores Principais */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3.5">
          {/* 1 & 2. Concursos */}
          <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
            <span className="text-[11px] text-slate-400 block">1. Concursos Cadastrados</span>
            <span className="text-xl font-black font-mono text-slate-100 mt-1 block">
              {financialSummary.totalRegistered}
            </span>
            <span className="text-[10px] text-emerald-400 font-mono">
              2. {financialSummary.completedCount} conferidos / {financialSummary.confirmedCount} confirmados
            </span>
          </div>

          {/* 3 & 4. Jogos e Apostas */}
          <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
            <span className="text-[11px] text-slate-400 block">3. Jogos Gerados / Apostas</span>
            <span className="text-xl font-black font-mono text-slate-100 mt-1 block">
              {financialSummary.totalGames}
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              4. 5 apostas simples por concurso
            </span>
          </div>

          {/* 5. Custo Total Acumulado */}
          <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
            <span className="text-[11px] text-slate-400 block">5. Custo Total Acumulado</span>
            <span className="text-xl font-black font-mono text-slate-100 mt-1 block">
              R$ {financialSummary.totalCost.toFixed(2)}
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              9. Média: R$ {financialSummary.avgCostPerContest.toFixed(2)} / concurso
            </span>
          </div>

          {/* 6. Premiação Total Obtida */}
          <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
            <span className="text-[11px] text-slate-400 block">6. Premiação Total Caixa</span>
            <span className="text-xl font-black font-mono text-emerald-400 mt-1 block">
              R$ {financialSummary.officialTotalPrize.toFixed(2)}
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              10. Média: R$ {financialSummary.avgPrizePerCompleted.toFixed(2)} / conferido
            </span>
          </div>

          {/* 7. Saldo Líquido */}
          <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
            <span className="text-[11px] text-slate-400 block">7. Saldo Líquido</span>
            <span
              className={`text-xl font-black font-mono mt-1 block ${
                financialSummary.officialNetBalance >= 0 ? "text-emerald-400" : "text-amber-400"
              }`}
            >
              {financialSummary.officialNetBalance >= 0 ? "+" : ""}R$ {financialSummary.officialNetBalance.toFixed(2)}
            </span>
            <span className="text-[10px] text-slate-500 font-mono">Prêmios menos Custos</span>
          </div>

          {/* 8. ROI (%) */}
          <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
            <span className="text-[11px] text-slate-400 block">8. Retorno Oficial (ROI)</span>
            <span
              className={`text-xl font-black font-mono mt-1 block ${
                financialSummary.officialRoiPercentage >= 0 ? "text-emerald-400" : "text-amber-400"
              }`}
            >
              {financialSummary.officialRoiPercentage >= 0 ? "+" : ""}
              {financialSummary.officialRoiPercentage.toFixed(1)}%
            </span>
            <span className="text-[10px] text-slate-500 font-mono">(Saldo / Custo) * 100</span>
          </div>

          {/* 11 & 12. Maior Premiação e Maior Faixa */}
          <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
            <span className="text-[11px] text-slate-400 block">11. Maior Prêmio em 1 Concurso</span>
            <span className="text-xl font-black font-mono text-emerald-400 mt-1 block">
              R$ {financialSummary.maxSinglePrize.toFixed(2)}
            </span>
            <span className="text-[10px] text-purple-400 font-mono font-bold">
              12. Melhor acerto: {financialSummary.maxHitsReached > 0 ? `${financialSummary.maxHitsReached} acertos` : "Nenhum"}
            </span>
          </div>

          {/* 13 & 14. Concursos Premiados vs Não Premiados */}
          <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
            <span className="text-[11px] text-slate-400 block">13 & 14. Taxa de Premiação</span>
            <span className="text-xl font-black font-mono text-emerald-400 mt-1 block">
              {financialSummary.winningContestsPct.toFixed(1)}%
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {financialSummary.winningContestsCount} premiados • {financialSummary.nonWinningContestsCount} não premiados
            </span>
          </div>
        </div>

        {/* 15. Distribuição Detalhada por Faixa de Premiação (15 a 11) */}
        <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span>15. Distribuição de Jogos Premiados por Faixa de Acertos (11 a 15)</span>
            <span className="text-[11px] text-slate-500 font-mono">Valores homologados pela Caixa</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
            {[15, 14, 13, 12, 11].map(hits => {
              const t = financialSummary.tierDistribution[hits];
              return (
                <div key={hits} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-center">
                  <span className="text-[10px] font-mono text-slate-400 uppercase font-bold block">
                    {hits} Acertos
                  </span>
                  <span className="text-base font-black font-mono text-emerald-400 mt-0.5 block">
                    {t.count} {t.count === 1 ? "jogo" : "jogos"}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400 block">
                    R$ {t.totalValue.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 16. Segregação Clara: Realizados vs Pendentes */}
        <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl space-y-1.5 text-xs">
          <span className="font-bold text-slate-200 block text-[11px]">
            16. Segregação Contábil (Realizados vs Pendentes)
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
            <div className="p-2 rounded bg-slate-900 border border-slate-800">
              <span className="text-emerald-400 font-semibold block">Valores Realizados (Conferidos e Homologados):</span>
              <div className="text-slate-300 font-mono mt-1 space-y-0.5">
                <div>Custo Homologado: R$ {financialSummary.totalCost.toFixed(2)}</div>
                <div>Prêmios Validados: R$ {financialSummary.officialTotalPrize.toFixed(2)}</div>
                <div>Saldo Líquido Realizado: {financialSummary.officialNetBalance >= 0 ? "+" : ""}R$ {financialSummary.officialNetBalance.toFixed(2)}</div>
              </div>
            </div>
            <div className="p-2 rounded bg-slate-900 border border-slate-800">
              <span className="text-amber-400 font-semibold block">Valores Pendentes de Apuração / Rateio:</span>
              <div className="text-slate-300 font-mono mt-1 space-y-0.5">
                <div>Concursos Aguardando Sorteio: {financialSummary.pendingContestsCount} (Custo: R$ {financialSummary.pendingCost.toFixed(2)})</div>
                <div>Concursos com Rateio Pendente: {financialSummary.pendingRateioCount}</div>
                <div>Valores Informados Não Comprovados: R$ {financialSummary.manualInformedPrize.toFixed(2)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Seletor de Visão: Lista de Concursos | Consolidado Mensal | Consolidado Anual */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("LIST")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === "LIST"
                ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20"
                : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
            }`}
          >
            Lista de Concursos ({filteredRecords.length})
          </button>

          <button
            onClick={() => setActiveTab("MONTHLY")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === "MONTHLY"
                ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20"
                : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
            }`}
          >
            Consolidado Mensal ({monthlySummary.length})
          </button>

          <button
            onClick={() => setActiveTab("ANNUAL")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === "ANNUAL"
                ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20"
                : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
            }`}
          >
            Consolidado Anual ({annualSummary.length})
          </button>
        </div>
      </div>

      {/* ABA 1: Lista de Concursos */}
      {activeTab === "LIST" && (
        <div className="space-y-3">
          {filteredRecords.length === 0 ? (
            <div className="p-8 text-center bg-slate-900/60 rounded-2xl border border-slate-800 text-slate-400 text-sm">
              Nenhum registro encontrado para os filtros selecionados.
            </div>
          ) : (
            filteredRecords.map(rec => {
              const badge = getRecordStatusBadge(rec);
              const prize = calculateContestPrize(rec);
              const cost = rec.totalCost ?? COST_PER_CONTEST;
              const net = prize - cost;
              const isHomologated = getContestLifecycleStage(rec) === "HOMOLOGATED";

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
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-slate-400">{rec.contestDate}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${badge.classes}`}>
                          {badge.label}
                        </span>
                        {rec.resultSource && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                            {rec.resultSource === "API_CAIXA"
                              ? "Caixa Oficial"
                              : rec.resultSource === "API_LOTERIAS"
                              ? "API Loterias"
                              : rec.resultSource === "API_TERCEIROS"
                              ? "API Terceiros"
                              : "Manual"}
                          </span>
                        )}
                        {isContestPendingVariableRateio(rec) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30 font-mono">
                            Rateio Oficial Pendente
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-300 mt-1 font-mono">
                        5 Jogos C5 • {isHomologated ? `Homologado (${rec.bestHits ?? 0} acertos)` : rec.status === "COMPLETED" ? `Apurado (${rec.bestHits ?? 0} acertos)` : "Pendente de resultado"}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 justify-between sm:justify-end">
                    <div className="text-right font-mono">
                      <span className="text-[10px] text-slate-400 block">
                        Custo: R$ {cost.toFixed(2)} {isHomologated && `• Prêmio: R$ ${prize.toFixed(2)}`}
                      </span>
                      {isHomologated ? (
                        <span
                          className={`text-xs font-bold ${
                            net >= 0 ? "text-emerald-400" : "text-amber-400"
                          }`}
                        >
                          Saldo: {net >= 0 ? "+" : ""}R$ {net.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">Aguardando homologação</span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 text-slate-400 text-xs shrink-0">
                      <span>Ver Detalhes</span>
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ABA 2: Tabela Mensal Consolidada */}
      {activeTab === "MONTHLY" && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-emerald-400" />
              <span>Consolidado Mensal ({monthlySummary.length} meses)</span>
            </h3>
            <span className="text-xs text-slate-500 font-mono">Ano-Mês • Concursos • Custo • Prêmio • Saldo • ROI</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="p-3">Ano-Mês</th>
                  <th className="p-3 text-center">Concursos</th>
                  <th className="p-3 text-center">Jogos</th>
                  <th className="p-3 text-right">Custo Total</th>
                  <th className="p-3 text-right">Prêmios</th>
                  <th className="p-3 text-right">Saldo Líquido</th>
                  <th className="p-3 text-right">ROI (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-200">
                {monthlySummary.map(m => (
                  <tr key={m.yearMonth} className="hover:bg-slate-850/60">
                    <td className="p-3 font-bold text-emerald-400">{m.yearMonth}</td>
                    <td className="p-3 text-center">{m.contestsCount} ({m.completedCount} conf.)</td>
                    <td className="p-3 text-center">{m.gamesCount}</td>
                    <td className="p-3 text-right">R$ {m.cost.toFixed(2)}</td>
                    <td className="p-3 text-right text-emerald-400">R$ {m.prize.toFixed(2)}</td>
                    <td
                      className={`p-3 text-right font-bold ${
                        m.net >= 0 ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      {m.net >= 0 ? "+" : ""}R$ {m.net.toFixed(2)}
                    </td>
                    <td
                      className={`p-3 text-right font-bold ${
                        m.roi >= 0 ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      {m.roi >= 0 ? "+" : ""}{m.roi.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-950/90 font-bold border-t-2 border-slate-700 text-slate-100">
                <tr>
                  <td className="p-3">TOTAL DO PERÍODO</td>
                  <td className="p-3 text-center">{financialSummary.confirmedCount}</td>
                  <td className="p-3 text-center">{financialSummary.totalGames}</td>
                  <td className="p-3 text-right">R$ {financialSummary.totalCost.toFixed(2)}</td>
                  <td className="p-3 text-right text-emerald-400">R$ {financialSummary.officialTotalPrize.toFixed(2)}</td>
                  <td
                    className={`p-3 text-right ${
                      financialSummary.officialNetBalance >= 0 ? "text-emerald-400" : "text-amber-400"
                    }`}
                  >
                    {financialSummary.officialNetBalance >= 0 ? "+" : ""}R$ {financialSummary.officialNetBalance.toFixed(2)}
                  </td>
                  <td
                    className={`p-3 text-right ${
                      financialSummary.officialRoiPercentage >= 0 ? "text-emerald-400" : "text-amber-400"
                    }`}
                  >
                    {financialSummary.officialRoiPercentage >= 0 ? "+" : ""}{financialSummary.officialRoiPercentage.toFixed(1)}%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ABA 3: Tabela Anual Consolidada */}
      {activeTab === "ANNUAL" && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-emerald-400" />
              <span>Consolidado Anual ({annualSummary.length} anos)</span>
            </h3>
            <span className="text-xs text-slate-500 font-mono">Ano • Concursos • Custo • Prêmio • Saldo • ROI</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="p-3">Ano</th>
                  <th className="p-3 text-center">Concursos</th>
                  <th className="p-3 text-center">Jogos</th>
                  <th className="p-3 text-right">Custo Total</th>
                  <th className="p-3 text-right">Prêmios</th>
                  <th className="p-3 text-right">Saldo Líquido</th>
                  <th className="p-3 text-right">ROI (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-200">
                {annualSummary.map(a => (
                  <tr key={a.year} className="hover:bg-slate-850/60">
                    <td className="p-3 font-bold text-emerald-400">{a.year}</td>
                    <td className="p-3 text-center">{a.contestsCount} ({a.completedCount} conf.)</td>
                    <td className="p-3 text-center">{a.gamesCount}</td>
                    <td className="p-3 text-right">R$ {a.cost.toFixed(2)}</td>
                    <td className="p-3 text-right text-emerald-400">R$ {a.prize.toFixed(2)}</td>
                    <td
                      className={`p-3 text-right font-bold ${
                        a.net >= 0 ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      {a.net >= 0 ? "+" : ""}R$ {a.net.toFixed(2)}
                    </td>
                    <td
                      className={`p-3 text-right font-bold ${
                        a.roi >= 0 ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      {a.roi >= 0 ? "+" : ""}{a.roi.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-950/90 font-bold border-t-2 border-slate-700 text-slate-100">
                <tr>
                  <td className="p-3">TOTAL ACUMULADO</td>
                  <td className="p-3 text-center">{financialSummary.confirmedCount}</td>
                  <td className="p-3 text-center">{financialSummary.totalGames}</td>
                  <td className="p-3 text-right">R$ {financialSummary.totalCost.toFixed(2)}</td>
                  <td className="p-3 text-right text-emerald-400">R$ {financialSummary.officialTotalPrize.toFixed(2)}</td>
                  <td
                    className={`p-3 text-right ${
                      financialSummary.officialNetBalance >= 0 ? "text-emerald-400" : "text-amber-400"
                    }`}
                  >
                    {financialSummary.officialNetBalance >= 0 ? "+" : ""}R$ {financialSummary.officialNetBalance.toFixed(2)}
                  </td>
                  <td
                    className={`p-3 text-right ${
                      financialSummary.officialRoiPercentage >= 0 ? "text-emerald-400" : "text-amber-400"
                    }`}
                  >
                    {financialSummary.officialRoiPercentage >= 0 ? "+" : ""}{financialSummary.officialRoiPercentage.toFixed(1)}%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Modal / Gaveta Interativa de Detalhes do Concurso */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-6 shadow-2xl">
            {/* Cabeçalho do Modal */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <span className="text-xs font-mono uppercase text-emerald-400 font-bold">
                  Concurso #{selectedRecord.contestNumber} • {selectedRecord.contestDate}
                </span>
                <h3 className="text-xl font-bold text-slate-100 mt-0.5">
                  Detalhes da Aposta & Auditoria C5
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
              const cost = selectedRecord.totalCost ?? COST_PER_CONTEST;
              const net = fin.officialNetBalance;
              return (
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 grid grid-cols-3 gap-3 text-center">
                  <div>
                    <span className="text-[10px] text-slate-400 block">Custo (5 Jogos)</span>
                    <span className="text-sm font-bold font-mono text-slate-200 mt-0.5 block">
                      R$ {cost.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">Prêmio Concurso</span>
                    <span className="text-sm font-bold font-mono text-emerald-400 mt-0.5 block">
                      R$ {fin.officialTotalPrize.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">Saldo Líquido</span>
                    <span
                      className={`text-sm font-bold font-mono mt-0.5 block ${
                        net >= 0 ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      {net >= 0 ? "+" : ""}R$ {net.toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Resultado Oficial Sorteado */}
            {selectedRecord.officialResult && (
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-medium">Resultado Oficial Sorteado:</span>
                  <span className="text-[10px] font-mono text-slate-400">
                    Fonte: {selectedRecord.resultSource === "API_CAIXA"
                      ? "Caixa Econômica Federal Oficial"
                      : selectedRecord.resultSource || "API Terceiros"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedRecord.officialResult.map(n => (
                    <Ball key={n} number={n} isOfficial size="sm" />
                  ))}
                </div>
              </div>
            )}

            {/* Os 5 Jogos com Dezenas Sorteadas Destacadas */}
            <div className="space-y-3">
              <span className="text-xs text-slate-400 font-medium">Os 5 Jogos Registrados C5-Memory:</span>
              {selectedRecord.games.map((game, idx) => {
                const hits = selectedRecord.gameHits ? selectedRecord.gameHits[idx] : undefined;
                let prizeVal = 0;
                if (hits && hits >= 11) {
                  if (selectedRecord.prizeBreakdown && selectedRecord.prizeBreakdown[String(hits)]) {
                    prizeVal = selectedRecord.prizeBreakdown[String(hits)]?.unitValue ?? 0;
                  } else if (FIXED_PRIZES[hits as keyof typeof FIXED_PRIZES]) {
                    prizeVal = FIXED_PRIZES[hits as keyof typeof FIXED_PRIZES] ?? 0;
                  }
                }

                return (
                  <div
                    key={idx}
                    className="p-3 bg-slate-950/70 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded bg-slate-800 text-slate-300 font-mono text-[10px] flex items-center justify-center font-bold">
                        J{idx + 1}
                      </span>
                      {hits !== undefined && (
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded ${
                              hits >= 11
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                : "bg-slate-800 text-slate-400"
                            }`}
                          >
                            {hits} acertos
                          </span>
                          {prizeVal > 0 && (
                            <span className="text-[10px] font-mono text-emerald-400 font-bold">
                              • R$ {prizeVal.toFixed(2)}
                            </span>
                          )}
                        </div>
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

            {/* Auditoria Criptográfica SHA-256 e Timestamps */}
            {selectedRecord.frozenPayload && (
              <div className="space-y-2 text-xs bg-slate-950/90 p-4 rounded-xl border border-slate-800">
                <div className="flex items-center justify-between text-emerald-400 font-bold mb-1">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4" />
                    <span>Auditoria Criptográfica de Congelamento</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    Revisão #{selectedRecord.frozenPayload.historyRevision}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400 font-mono">
                  <div>
                    <span>Criado em:</span> <span className="text-slate-300">{selectedRecord.createdAt || "N/A"}</span>
                  </div>
                  <div>
                    <span>Congelado em:</span> <span className="text-slate-300">{selectedRecord.frozenPayload.frozenAt || "N/A"}</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] font-mono text-slate-400">
                  <span className="truncate max-w-xs">
                    SHA-256: {selectedRecord.frozenPayload.sha256}
                  </span>
                  <button
                    onClick={() => handleCopy(selectedRecord.frozenPayload!.sha256)}
                    className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 ml-2 cursor-pointer font-sans text-xs"
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
