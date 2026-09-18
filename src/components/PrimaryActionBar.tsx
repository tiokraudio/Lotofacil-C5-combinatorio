import React from "react";
import {
  ArrowRight,
  AlertCircle,
  Clock,
  CheckCircle2,
  Lock,
  Sparkles,
  Inbox,
  Layers,
} from "lucide-react";
import type { PrimaryAction } from "../sync/primaryAction.ts";

interface PrimaryActionBarProps {
  primaryAction: PrimaryAction;
  onExecuteAction: (action: PrimaryAction) => void;
  activeContestStatus?: "DRAFT" | "FROZEN" | "SCORED" | null;
}

export const PrimaryActionBar: React.FC<PrimaryActionBarProps> = ({
  primaryAction,
  onExecuteAction,
  activeContestStatus,
}) => {
  // Determina o estágio para o indicador discreto de progresso
  const getStageState = (stageName: "GERADO" | "CONGELADO" | "RESULTADO" | "CONFERIDO") => {
    // Se há concurso ativo visualizado, reflete o concurso ativo; caso contrário, reflete a ação recomendada
    const currentStatus = activeContestStatus ?? (
      primaryAction.progressStage === "SCORED"
        ? "SCORED"
        : primaryAction.progressStage === "WAITING_RESULT"
        ? "FROZEN"
        : primaryAction.progressStage === "FROZEN"
        ? "FROZEN"
        : primaryAction.progressStage === "GENERATED"
        ? "DRAFT"
        : null
    );

    if (!currentStatus) return "todo";

    switch (stageName) {
      case "GERADO":
        return currentStatus === "DRAFT" || currentStatus === "FROZEN" || currentStatus === "SCORED"
          ? "done"
          : "todo";
      case "CONGELADO":
        return currentStatus === "FROZEN" || currentStatus === "SCORED"
          ? "done"
          : "todo";
      case "RESULTADO":
        return currentStatus === "SCORED"
          ? "done"
          : primaryAction.category === "RESULT_AVAILABLE"
          ? "active"
          : "todo";
      case "CONFERIDO":
        return currentStatus === "SCORED" ? "done" : "todo";
    }
  };

  const isUrgent = primaryAction.category === "RESULT_AVAILABLE";
  const isDraft = primaryAction.category === "DRAFT_PENDING" || primaryAction.category === "STALE_DRAFT";

  return (
    <section
      id="primary-action-section"
      aria-label="Próxima Ação Recomendada"
      className={`mb-6 rounded-2xl border transition-all p-5 shadow-lg ${
        isUrgent
          ? "border-amber-500/50 bg-amber-950/20 shadow-amber-950/20"
          : isDraft
          ? "border-blue-500/40 bg-blue-950/20 shadow-blue-950/20"
          : "border-zinc-800 bg-zinc-900/80 shadow-black/40"
      }`}
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        {/* Lado Esquerdo: Identificação da Próxima Ação */}
        <div className="space-y-1.5 max-w-2xl">
          <div className="flex items-center gap-2.5">
            <span className="text-[11px] font-mono font-bold tracking-widest text-emerald-400 uppercase">
              PRÓXIMA AÇÃO
            </span>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider ${
                isUrgent
                  ? "bg-amber-500/20 border border-amber-500/50 text-amber-300"
                  : isDraft
                  ? "bg-blue-500/20 border border-blue-500/50 text-blue-300"
                  : "bg-zinc-800 border border-zinc-700 text-zinc-300"
              }`}
            >
              {primaryAction.badge}
            </span>
          </div>

          <h3 className="text-xl font-bold text-zinc-100 font-mono flex items-center gap-2">
            {primaryAction.title}
          </h3>

          <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
            {primaryAction.subtitle}
          </p>

          {/* Se houver múltiplos pendentes de conferência */}
          {primaryAction.pendingCount && primaryAction.pendingCount > 1 && primaryAction.allPendingContests && (
            <div className="mt-2 text-xs text-amber-300/90 font-mono">
              Aguardando: {primaryAction.allPendingContests.join(", ")}
            </div>
          )}
        </div>

        {/* Lado Direito: Botão da Ação Principal */}
        <div className="flex flex-col sm:flex-row lg:flex-col items-start sm:items-center lg:items-end gap-3 shrink-0">
          <button
            type="button"
            id="btn-primary-action"
            onClick={() => onExecuteAction(primaryAction)}
            className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm tracking-wide transition-all shadow-md active:scale-95 cursor-pointer ${
              isUrgent
                ? "bg-amber-500 hover:bg-amber-400 text-zinc-950 font-extrabold focus:ring-2 focus:ring-amber-400"
                : isDraft
                ? "bg-blue-600 hover:bg-blue-500 text-white focus:ring-2 focus:ring-blue-400"
                : "bg-emerald-600 hover:bg-emerald-500 text-white focus:ring-2 focus:ring-emerald-400"
            }`}
          >
            <span>{primaryAction.actionLabel}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Indicador Discreto de Progresso do Fluxo do Concurso (Prompt 09 Seção 10) */}
      <div className="mt-4 pt-3.5 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono">
        <span className="text-zinc-500 uppercase tracking-wider font-sans text-[10px]">
          Fluxo do Concurso:
        </span>
        <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
          {(
            [
              { label: "Gerado", stage: "GERADO" },
              { label: "Congelado", stage: "CONGELADO" },
              { label: "Resultado", stage: "RESULTADO" },
              { label: "Conferido", stage: "CONFERIDO" },
            ] as const
          ).map((step, idx) => {
            const state = getStageState(step.stage);
            return (
              <React.Fragment key={step.stage}>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      state === "done"
                        ? "bg-emerald-400"
                        : state === "active"
                        ? "bg-amber-400 animate-pulse"
                        : "bg-zinc-700"
                    }`}
                  />
                  <span
                    className={`${
                      state === "done"
                        ? "text-zinc-200 font-semibold"
                        : state === "active"
                        ? "text-amber-300 font-semibold"
                        : "text-zinc-500"
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
                {idx < 3 && <span className="text-zinc-700 select-none">→</span>}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </section>
  );
};
