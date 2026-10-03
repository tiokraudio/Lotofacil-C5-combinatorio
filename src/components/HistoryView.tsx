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
} from "lucide-react";
import { ContestRecord, ContestStatus } from "../c5-memory/types";
import { Ball } from "./Ball";

interface HistoryViewProps {
  records: readonly ContestRecord[];
}

export const HistoryView: React.FC<HistoryViewProps> = ({ records }) => {
  const [filterStatus, setFilterStatus] = useState<string>("ALL"); // ALL, PENDING, COMPLETED
  const [filterMonth, setFilterMonth] = useState<string>("ALL");
  const [selectedRecord, setSelectedRecord] = useState<ContestRecord | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);

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

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  const getStatusBadge = (status: ContestStatus) => {
    switch (status) {
      case "COMPLETED":
        return { label: "Encerrado", classes: "bg-purple-500/10 text-purple-300 border-purple-500/20" };
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs uppercase font-mono tracking-wider text-emerald-400 font-semibold">
                Registro Histórico
              </span>
              <span className="text-slate-600">•</span>
              <span className="text-xs text-slate-400">Todos os Concursos C5</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-100">
              Histórico de Concursos
            </h1>
          </div>

          {/* Filtros */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
              <button
                onClick={() => setFilterStatus("ALL")}
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  filterStatus === "ALL" ? "bg-slate-800 text-emerald-400 font-bold" : "text-slate-400"
                }`}
              >
                Todos
              </button>
              <button
                onClick={() => setFilterStatus("PENDING")}
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  filterStatus === "PENDING" ? "bg-slate-800 text-emerald-400 font-bold" : "text-slate-400"
                }`}
              >
                Em andamento
              </button>
              <button
                onClick={() => setFilterStatus("COMPLETED")}
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  filterStatus === "COMPLETED" ? "bg-slate-800 text-emerald-400 font-bold" : "text-slate-400"
                }`}
              >
                Encerrados
              </button>
            </div>

            {availableMonths.length > 0 && (
              <select
                value={filterMonth}
                onChange={e => setFilterMonth(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-slate-300 text-xs rounded-xl px-3 py-2 outline-none"
              >
                <option value="ALL">Todos os meses</option>
                {availableMonths.map(m => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {/* Lista de Concursos */}
      {filteredRecords.length === 0 ? (
        <div className="p-8 text-center bg-slate-900/60 rounded-2xl border border-slate-800 text-slate-400 text-sm">
          Nenhum registro encontrado para os filtros selecionados.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRecords.map(rec => {
            const badge = getStatusBadge(rec.status);
            return (
              <div
                key={rec.contestNumber}
                onClick={() => setSelectedRecord(rec)}
                className="bg-slate-900/90 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 rounded-xl p-4 transition-all cursor-pointer shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-slate-800 flex flex-col items-center justify-center font-mono">
                    <span className="text-[10px] text-slate-400">Nº</span>
                    <span className="text-sm font-bold text-slate-100">{rec.contestNumber}</span>
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">{rec.contestDate}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${badge.classes}`}>
                        {badge.label}
                      </span>
                      {rec.algorithmVersion === "C5-1.0.0" && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-500 border border-slate-700">
                          Legado 1.0
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-300 mt-1 font-mono">
                      5 Jogos C5 • {rec.status === "COMPLETED" ? "Apurado" : "Pendente de resultado"}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 justify-between sm:justify-end">
                  {rec.bestHits !== undefined && rec.bestHits > 0 && (
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 block">Melhor</span>
                      <span className="text-sm font-black font-mono text-emerald-400">
                        {rec.bestHits} acertos
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-1 text-slate-400 text-xs">
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
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Resultado Oficial se houver */}
            {selectedRecord.officialResult && (
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <span className="text-xs text-slate-400 font-medium">Resultado Oficial Sorteado:</span>
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
                    className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded bg-slate-800 text-slate-300 font-mono text-xs flex items-center justify-center font-bold">
                        J{idx + 1}
                      </span>
                      {hits !== undefined && (
                        <span className="text-xs font-mono text-emerald-400 font-bold">
                          {hits} acertos
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1.5 justify-end">
                      {game.map(num => {
                        const isHit = selectedRecord.officialResult?.includes(num);
                        return <Ball key={num} number={num} isHit={isHit} size="sm" />;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Auditoria Criptográfica do Frozen Payload */}
            {selectedRecord.frozenPayload && (
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 text-xs">
                <div className="flex items-center gap-2 text-slate-300 font-bold">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Auditoria Criptográfica C5-Memory</span>
                </div>

                <div className="space-y-1.5 font-mono text-[11px] text-slate-400">
                  <div className="flex justify-between py-1 border-b border-slate-900">
                    <span className="text-slate-500">Hash SHA-256:</span>
                    <span className="text-emerald-400 select-all break-all">
                      {selectedRecord.frozenPayload.sha256}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-900">
                    <span className="text-slate-500">Índice no Pool:</span>
                    <span className="text-slate-200">#{selectedRecord.frozenPayload.poolIndex} de K=500</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-900">
                    <span className="text-slate-500">Revisão H:</span>
                    <span className="text-slate-200">{selectedRecord.frozenPayload.historyRevision}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">Congelado em:</span>
                    <span className="text-slate-200">
                      {new Date(selectedRecord.frozenPayload.frozenAt).toLocaleString("pt-BR")}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => handleCopy(selectedRecord.frozenPayload!.sha256)}
                  className="w-full mt-2 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium flex items-center justify-center gap-2 transition-colors"
                >
                  {copiedHash ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedHash ? "Copiado!" : "Copiar Hash SHA-256"}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
