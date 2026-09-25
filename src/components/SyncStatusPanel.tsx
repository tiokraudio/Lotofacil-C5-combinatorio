import React from "react";
import {
  RefreshCw,
  Radio,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Inbox,
  ArrowRight,
  WifiOff,
  Eye,
} from "lucide-react";
import type { ContestSyncState, SyncRecommendedAction } from "../sync/types.ts";

interface SyncStatusPanelProps {
  syncState: ContestSyncState | null;
  isLoading: boolean;
  onRefresh: () => void;
  onPrepareContest: (contestNumber: number) => void;
  onOpenDraft: (contestNumber: number) => void;
  onCheckResult: (contestNumber: number) => void;
}

export const SyncStatusPanel: React.FC<SyncStatusPanelProps> = ({
  syncState,
  isLoading,
  onRefresh,
  onPrepareContest,
  onOpenDraft,
  onCheckResult,
}) => {
  const formatTime = (isoString?: string) => {
    if (!isoString) return "--:--:--";
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return "--:--:--";
    }
  };

  const handleAction = (action: SyncRecommendedAction) => {
    switch (action.type) {
      case "PREPARE_CONTEST":
        onPrepareContest(action.contestNumber);
        break;
      case "OPEN_DRAFT":
        onOpenDraft(action.contestNumber);
        break;
      case "CHECK_RESULT":
        onCheckResult(action.contestNumber);
        break;
      case "VIEW_CONTEST":
        onOpenDraft(action.contestNumber);
        break;
    }
  };

  const hasPendingResults = (syncState?.availableResultContests.length ?? 0) > 0;
  const hasStaleDrafts = (syncState?.staleDrafts.length ?? 0) > 0;
  const isAhead = (syncState?.aheadContests.length ?? 0) > 0;

  return (
    <section
      id="sync-status-panel"
      className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm overflow-hidden"
    >
      {/* Barra superior de identificação */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-zinc-800/80 bg-zinc-900/90">
        <div className="flex items-center gap-2.5">
          <span className="flex h-2.5 w-2.5 relative">
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                syncState?.status === "ONLINE"
                  ? "bg-emerald-400"
                  : syncState?.status === "OFFLINE"
                  ? "bg-amber-400"
                  : "bg-rose-400"
              }`}
            />
            <span
              className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                syncState?.status === "ONLINE"
                  ? "bg-emerald-500"
                  : syncState?.status === "OFFLINE"
                  ? "bg-amber-500"
                  : "bg-rose-500"
              }`}
            />
          </span>
          <h3 className="text-xs font-semibold tracking-wider uppercase text-zinc-300">
            SITUAÇÃO ATUAL DA LOTOFÁCIL
          </h3>
          <span className="text-[11px] text-zinc-500 font-mono">
            • {syncState?.providerName ?? "CAIXA"}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[11px] text-zinc-400 font-mono">
            Atualizado em:{" "}
            <span className="text-zinc-200">
              {formatTime(syncState?.fetchedAt)}
            </span>
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-zinc-700 bg-zinc-800/90 text-zinc-300 hover:text-white hover:bg-zinc-700 transition disabled:opacity-50"
            title="Sincronizar situação com a CAIXA"
          >
            <RefreshCw
              className={`h-3 w-3 ${isLoading ? "animate-spin text-emerald-400" : ""}`}
            />
            <span>{isLoading ? "Atualizando..." : "ATUALIZAR SITUAÇÃO"}</span>
          </button>
        </div>
      </div>

      {/* Conteúdo principal do painel */}
      <div className="p-5">
        {/* Alerta de erro ou modo offline externo */}
        {syncState?.status === "OFFLINE" && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-950/20 p-3 text-xs text-amber-300">
            <WifiOff className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
            <div>
              <p className="font-semibold">Modo Offline Detectado</p>
              <p className="text-amber-400/90 text-[11px]">
                Não foi possível conectar à CAIXA. O histórico local no IndexedDB e
                todas as funcionalidades de geração e conferência manual continuam
                100% disponíveis.
              </p>
            </div>
          </div>
        )}

        {syncState?.status === "ERROR" && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-rose-500/20 bg-rose-950/20 p-3 text-xs text-rose-300">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-rose-400" />
            <div>
              <p className="font-semibold">Consulta Externa Indisponível</p>
              <p className="text-rose-400/90 text-[11px]">
                {syncState.errorMessage ??
                  "Não foi possível obter dados da CAIXA. Os registros locais continuam plenamente seguros e operacionais."}
              </p>
            </div>
          </div>
        )}

        {/* Métricas de status */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mb-4">
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 p-3">
            <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">
              Último Concurso Apurado
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-lg font-bold font-mono text-zinc-100">
                {syncState?.latestOfficialContest ?? "---"}
              </span>
              {syncState?.latestDrawDate && (
                <span className="text-xs text-zinc-400">
                  ({syncState.latestDrawDate})
                </span>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 p-3">
            <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">
              Próximo Concurso Sugerido
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-lg font-bold font-mono text-emerald-400">
                {syncState?.nextSuggestedContest ?? "---"}
              </span>
              <span className="text-[11px] text-zinc-500">Estimado/Oficial</span>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 p-3">
            <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">
              Resultados Disponíveis
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span
                className={`text-lg font-bold font-mono ${
                  hasPendingResults ? "text-amber-400" : "text-zinc-400"
                }`}
              >
                {syncState?.availableResultContests.length ?? 0}
              </span>
              <span className="text-xs text-zinc-400">
                {syncState?.availableResultContests.length === 1
                  ? "concurso pendente"
                  : "concursos pendentes"}
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 p-3">
            <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">
              Aguardando Sorteio
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-lg font-bold font-mono text-zinc-300">
                {syncState?.waitingResultContests.length ?? 0}
              </span>
              <span className="text-xs text-zinc-400">
                {syncState?.waitingResultContests.length === 1
                  ? "concurso congelado"
                  : "concursos congelados"}
              </span>
            </div>
          </div>
        </div>

        {/* Avisos Operacionais Específicos */}
        {hasPendingResults && (
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs text-amber-200">
              <CheckCircle2 className="h-4 w-4 text-amber-400 shrink-0" />
              <span>
                <strong>
                  {syncState?.availableResultContests.length}{" "}
                  {syncState?.availableResultContests.length === 1
                    ? "concurso congelado possui"
                    : "concursos congelados possuem"}
                </strong>{" "}
                resultado oficial apurado na CAIXA:{" "}
                <span className="font-mono font-semibold text-amber-300">
                  {syncState?.availableResultContests.join(", ")}
                </span>
                .
              </span>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              {syncState?.availableResultContests.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onCheckResult(c)}
                  className="px-2.5 py-1 text-xs font-semibold rounded bg-amber-500 text-zinc-950 hover:bg-amber-400 transition"
                >
                  CONFERIR {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {hasStaleDrafts && (
          <div className="mb-3 rounded-lg border border-zinc-700 bg-zinc-800/40 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-zinc-300">
            <div className="flex items-center gap-2.5">
              <Clock className="h-4 w-4 text-zinc-400 shrink-0" />
              <span>
                Rascunho antigo detectado: concurso(s){" "}
                <strong className="text-zinc-100 font-mono">
                  {syncState?.staleDrafts.join(", ")}
                </strong>{" "}
                (anterior ao concurso oficial{" "}
                {syncState?.latestOfficialContest}).
              </span>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              {syncState?.staleDrafts.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => onOpenDraft(d)}
                  className="px-2 py-0.5 text-xs rounded border border-zinc-600 bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition"
                >
                  ABRIR {d}
                </button>
              ))}
            </div>
          </div>
        )}

        {isAhead && (
          <div className="mb-3 rounded-lg border border-indigo-500/20 bg-indigo-950/20 p-3 text-xs text-indigo-300 flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Concurso Local à Frente</p>
              <p className="text-indigo-300/90 text-[11px]">
                O concurso local {syncState?.aheadContests.join(", ")} está à
                frente da numeração atualmente divulgada pela CAIXA (próximo:{" "}
                {syncState?.nextSuggestedContest}). O registro permanece intacto e
                será conferido quando a numeração for alcançada.
              </p>
            </div>
          </div>
        )}

        {/* Ações Operacionais Recomendadas (Orientação sem geração automática) */}
        {syncState?.recommendedActions &&
          syncState.recommendedActions.length > 0 && (
            <div className="mt-3 pt-3 border-t border-zinc-800/70 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">
                Ações sugeridas:
              </span>
              {syncState.recommendedActions.map((act) => {
                let badgeClass =
                  "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700";
                if (act.type === "CHECK_RESULT") {
                  badgeClass =
                    "border-amber-500/40 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30";
                } else if (act.type === "PREPARE_CONTEST") {
                  badgeClass =
                    "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20";
                }

                return (
                  <button
                    key={act.id}
                    type="button"
                    onClick={() => handleAction(act)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition ${badgeClass}`}
                    title={act.description}
                  >
                    <span>{act.label}</span>
                    <ArrowRight className="h-3 w-3 opacity-60" />
                  </button>
                );
              })}
            </div>
          )}
      </div>
    </section>
  );
};
