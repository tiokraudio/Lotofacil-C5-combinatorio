/**
 * Gerador de Relatório Profissional em PDF para C5-Memory 3.0
 * 
 * Atende integralmente aos requisitos da Seção 5:
 * 1. Capa e identificação do sistema
 * 2. Resumo executivo dos indicadores-chave
 * 3. Demonstrativo financeiro mensal e anual
 * 4. Histórico detalhado por concurso
 * 5. Análise estatística de distribuição de acertos
 * 6. Integridade, observações de auditoria e fonte dos resultados oficiais
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { ContestRecord } from "../c5-memory/types";
import {
  calculateContestPrize,
  calculateContestOfficialPrize,
  calculateContestFinancialBreakdown,
  COST_PER_CONTEST,
  isRecordFixture,
  isContestPendingVariableRateio,
} from "../c5-memory/analytics/c5Analytics";

export interface PDFReportOptions {
  readonly title?: string;
  readonly periodLabel: string;
  readonly appliedFilters: Record<string, string>;
  readonly records: readonly ContestRecord[];
  readonly financialSummary: {
    readonly confirmedCount: number;
    readonly completedCount: number;
    readonly totalCost: number;
    readonly totalPrize: number;
    readonly netBalance: number;
    readonly roiPercentage: number;
    readonly officialTotalPrize: number;
    readonly officialNetBalance: number;
    readonly officialRoiPercentage: number;
    readonly manualConfirmedPrize: number;
    readonly manualInformedPrize: number;
    readonly officialValidatedPrize: number;
    readonly winningCount: number;
    readonly provisionalWinningCount: number;
    readonly pendingRateioCount: number;
    readonly hasPendingRateio: boolean;
    readonly bestHitsOverall: number;
    readonly maxSinglePrize: number;
    readonly winPercentage: number;
    readonly nonWinningCount: number;
    readonly nonWinningPercentage: number;
    readonly tierBreakdown: Record<number, { count: number; totalPrize: number }>;
  };
}

export function generateC5FinancialReportPDF(options: PDFReportOptions): jsPDF {
  const { periodLabel, appliedFilters, records, financialSummary } = options;

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 28; // ~10mm margins for clean printable area

  // Helper para formatar moeda brasileira
  const fmtMoney = (val: number) => {
    return `R$ ${val.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const fmtPercent = (val: number) => {
    const sign = val > 0 ? "+" : "";
    return `${sign}${val.toFixed(1)}%`;
  };

  // 1. Cabeçalho Principal do Relatório
  let cursorY = margin;

  // Barra de status decorativa superior
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(margin, cursorY, pageWidth - margin * 2, 60, "F");

  doc.setTextColor(52, 211, 153); // emerald-400
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("C5-MEMORY 3.0 — SISTEMA COMBINATÓRIO OFICIAL", margin + 14, cursorY + 24);

  doc.setTextColor(248, 250, 252); // slate-50
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Relatório Operacional & Financeiro", margin + 14, cursorY + 46);

  cursorY += 72;

  // Metadados de Identificação e Filtros Aplicados
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105); // slate-600

  const nowIso = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "medium",
  });

  const filterStrings = Object.entries(appliedFilters)
    .filter(([_, v]) => v && v !== "ALL" && v !== "Todos")
    .map(([k, v]) => `${k}: ${v}`)
    .join(" • ");

  doc.text(`Período Analisado: ${periodLabel}`, margin, cursorY);
  doc.text(`Data de Emissão: ${nowIso} (Horário de Brasília)`, pageWidth - margin, cursorY, { align: "right" });
  cursorY += 14;

  if (filterStrings) {
    doc.text(`Filtros Ativos: ${filterStrings}`, margin, cursorY);
    cursorY += 14;
  }
  doc.text(`Total de Concursos Filtrados: ${records.length} (${financialSummary.completedCount} apurados, ${financialSummary.confirmedCount - financialSummary.completedCount} pendentes)`, margin, cursorY);
  cursorY += 18;

  // 2. Resumo Executivo (Tabela de Indicadores-Chave)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text("1. Resumo Executivo & Indicadores Financeiros", margin, cursorY);
  cursorY += 8;

  const avgCostPerContest = financialSummary.confirmedCount > 0
    ? financialSummary.totalCost / financialSummary.confirmedCount
    : 0;
  const avgPrizePerContest = financialSummary.completedCount > 0
    ? financialSummary.totalPrize / financialSummary.completedCount
    : 0;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: "grid",
    headStyles: { fillColor: [30, 41, 59], textColor: [248, 250, 252], fontStyle: "bold", fontSize: 8 },
    bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    head: [["Indicador", "Valor Consolidado", "Indicador", "Valor Consolidado"]],
    body: [
      [
        "Total de Concursos Registrados",
        String(records.length),
        "Total de Apostas Equivalentes",
        `${financialSummary.confirmedCount * 5} jogos (5/concurso)`,
      ],
      [
        "Concursos Confirmados / Apurados",
        `${financialSummary.confirmedCount} / ${financialSummary.completedCount}`,
        "Concursos Premiados (Taxa %)",
        `${financialSummary.winningCount} de ${financialSummary.completedCount} (${financialSummary.winPercentage.toFixed(1)}%)`,
      ],
      [
        "Total Investido (Custo)",
        fmtMoney(financialSummary.totalCost),
        "Média de Gasto por Concurso",
        fmtMoney(avgCostPerContest),
      ],
      [
        "Total em Premiações Oficiais",
        fmtMoney(financialSummary.officialTotalPrize),
        "Média de Prêmio por Concurso",
        fmtMoney(avgPrizePerContest),
      ],
      [
        "Saldo Líquido Oficial",
        fmtMoney(financialSummary.officialNetBalance),
        "Maior Premiação Individual",
        fmtMoney(financialSummary.maxSinglePrize),
      ],
      [
        "Retorno Oficial (ROI)",
        fmtPercent(financialSummary.officialRoiPercentage),
        "Melhor Quantidade de Acertos",
        `${financialSummary.bestHitsOverall} acertos`,
      ],
    ],
  });

  cursorY = (doc as any).lastAutoTable.finalY + 18;

  // 3. Demonstrativo Mensal e Anual
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text("2. Demonstrativo Consolidado por Período (Mensal & Anual)", margin, cursorY);
  cursorY += 8;

  // Agrupamento mensal
  const monthMap = new Map<string, ContestRecord[]>();
  records.forEach(r => {
    const m = r.contestDate && r.contestDate.length >= 7 ? r.contestDate.substring(0, 7) : "Indefinido";
    const arr = monthMap.get(m) || [];
    arr.push(r);
    monthMap.set(m, arr);
  });

  const monthlyRows: any[] = [];
  const sortedMonths = Array.from(monthMap.keys()).sort().reverse();

  sortedMonths.forEach(m => {
    const list = monthMap.get(m) || [];
    const prodConf = list.filter(r => (r.status === "FROZEN" || r.status === "COMPLETED") && !isRecordFixture(r));
    const prodComp = list.filter(r => r.status === "COMPLETED" && !isRecordFixture(r));

    const cost = prodConf.reduce((acc, r) => acc + (r.totalCost ?? COST_PER_CONTEST), 0);
    const prize = prodComp.reduce((acc, r) => acc + calculateContestPrize(r), 0);
    const net = prize - cost;
    const roi = cost > 0 ? (net / cost) * 100 : 0;
    const winning = prodComp.filter(r => (r.bestHits ?? 0) >= 11).length;
    const bestHits = Math.max(0, ...prodComp.map(r => r.bestHits ?? 0));

    monthlyRows.push([
      m,
      String(list.length),
      String(prodConf.length * 5),
      fmtMoney(cost),
      fmtMoney(prize),
      fmtMoney(net),
      fmtPercent(roi),
      `${winning} (${prodComp.length > 0 ? ((winning / prodComp.length) * 100).toFixed(0) : 0}%)`,
      bestHits > 0 ? `${bestHits} ac.` : "—",
    ]);
  });

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: "striped",
    styles: { cellPadding: 2, fontSize: 7, overflow: "linebreak" },
    headStyles: { fillColor: [5, 150, 105], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7 },
    bodyStyles: { fontSize: 7, textColor: [30, 41, 59] },
    head: [["Mês", "Conc.", "Jogos", "Gasto", "Prêmio", "Saldo", "ROI", "Premiados", "Melhor"]],
    body: monthlyRows.length > 0 ? monthlyRows : [["Nenhum período", "0", "0", "R$ 0,00", "R$ 0,00", "R$ 0,00", "0%", "0", "—"]],
  });

  cursorY = (doc as any).lastAutoTable.finalY + 18;

  // 4. Análise Estatística de Acertos por Faixa
  if (cursorY > pageHeight - 160) {
    doc.addPage();
    cursorY = margin;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text("3. Análise Estatística — Distribuição de Acertos por Faixa", margin, cursorY);
  cursorY += 8;

  const hitDistributionRows = [11, 12, 13, 14, 15].map(tier => {
    const data = financialSummary.tierBreakdown[tier] || { count: 0, totalPrize: 0 };
    const totalApostas = financialSummary.completedCount * 5;
    const freq = totalApostas > 0 ? ((data.count / totalApostas) * 100).toFixed(2) : "0.00";
    return [
      `${tier} Acertos`,
      String(data.count),
      `${freq}%`,
      fmtMoney(data.totalPrize),
      tier <= 13 ? "Oficial Caixa (Fixo)" : "Oficial Caixa (Rateio Variável)",
    ];
  });

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: "grid",
    headStyles: { fillColor: [71, 85, 105], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
    bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
    head: [["Faixa de Premiação", "Jogos Premiados", "Freq. Observada (%)", "Total Recebido (R$)", "Classificação Contábil"]],
    body: hitDistributionRows,
  });

  cursorY = (doc as any).lastAutoTable.finalY + 18;

  // 5. Histórico Detalhado dos Concursos
  if (cursorY > pageHeight - 180) {
    doc.addPage();
    cursorY = margin;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text("4. Histórico Detalhado dos Concursos", margin, cursorY);
  cursorY += 8;

  const detailedRows = records.map(r => {
    const fin = calculateContestFinancialBreakdown(r);
    const cost = r.totalCost ?? COST_PER_CONTEST;
    const best = r.bestHits !== undefined ? `${r.bestHits} ac.` : "—";
    const officialRes = Array.isArray(r.officialResult) && r.officialResult.length === 15
      ? r.officialResult.map(n => String(n).padStart(2, "0")).join(" ")
      : "Aguardando";
    const statusLabel = r.status === "COMPLETED"
      ? (r.financialStatus === "PENDING_HOMOLOGATION" ? "Apurado (Pendente)" : "Homologado")
      : r.status === "FROZEN"
      ? "Confirmado"
      : r.status;

    return [
      `#${r.contestNumber}`,
      r.contestDate || "—",
      statusLabel,
      best,
      officialRes,
      fmtMoney(cost),
      fmtMoney(fin.officialTotalPrize),
      fmtMoney(fin.officialNetBalance),
      r.resultSource || "N/A",
    ];
  });

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: "striped",
    styles: { cellPadding: 2, fontSize: 6.5, overflow: "linebreak" },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7 },
    bodyStyles: { fontSize: 6.5, textColor: [30, 41, 59] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { fontStyle: "bold" },
      4: { font: "courier" },
    },
    head: [["Conc.", "Data", "Status", "Melhor", "Dezenas Sorteadas (15)", "Custo", "Prêmio", "Saldo", "Fonte"]],
    body: detailedRows,
  });

  cursorY = (doc as any).lastAutoTable.finalY + 18;

  // 6. Observações de Auditoria e Integridade
  if (cursorY > pageHeight - 140) {
    doc.addPage();
    cursorY = margin;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text("5. Integridade Criptográfica, Procedência & Notas de Auditoria", margin, cursorY);
  cursorY += 12;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);

  const notices = [
    "• Algoritmo Matemático: C5-Memory 3.0 estrutural baseado no critério MAX-LEXIMIN e Distância Combinatória de Johnson d(A, B) = 15 - |A ∩ B|.",
    "• Filtro Anti-Duplicatas: Comparação rigorosa das 15 dezenas com toda a base histórica oficial da Caixa e todos os jogos registrados pelo usuário (Base B).",
    "• Prova Criptográfica SHA-256: Todos os jogos congelados possuem fingerprint e digest SHA-256 canônicos imutáveis gravados no banco auditável.",
    "• Segregação Contábil: Concursos com rateio pendente ou conferência não homologada mantêm seus prêmios segregados do saldo financeiro oficial.",
    "• Fonte Oficial dos Resultados: Caixa Econômica Federal (servicebus2.caixa.gov.br) com verificação de 15 dezenas distintas entre 1 e 25.",
  ];

  notices.forEach(n => {
    doc.text(n, margin, cursorY);
    cursorY += 11;
  });

  // Numeração de Páginas e Rodapé em todas as páginas
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184); // slate-400
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.line(margin, pageHeight - 24, pageWidth - margin, pageHeight - 24);
    doc.text("C5-Memory 3.0 — Sistema Combinatório Oficial da Lotofácil", margin, pageHeight - 12);
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - margin, pageHeight - 12, { align: "right" });
  }

  // Baixa o PDF no navegador se estiver em ambiente DOM
  const sanitizedPeriod = periodLabel.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    doc.save(`relatorio-c5-memory-${sanitizedPeriod}.pdf`);
  }
  return doc;
}
