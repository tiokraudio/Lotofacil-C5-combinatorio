import React from "react";
import { Cpu, CheckCircle2, History, ShieldCheck, Layers } from "lucide-react";

export type NavTab = "generator" | "conference" | "history" | "audit";

interface HeaderProps {
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  historyCount?: number;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onTabChange,
  historyCount,
}) => {
  return (
    <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-4">
          {/* Identidade Visual */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-700 flex items-center justify-center text-emerald-400 shadow-xs shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-zinc-100 font-mono">
                  C₅ LOTOFÁCIL
                </h1>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 font-mono">
                  C5-1.0.0
                </span>
              </div>
              <p className="text-xs text-zinc-400 font-medium">
                Gerador Combinatório Auditável • 5 apostas simples (R$ 17,50)
              </p>
            </div>
          </div>

          {/* Navegação por Abas */}
          <nav className="flex items-center gap-1 bg-zinc-900/90 p-1 rounded-xl border border-zinc-800" aria-label="Navegação Principal">
            <button
              type="button"
              id="tab-generator-btn"
              onClick={() => onTabChange("generator")}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                currentTab === "generator"
                  ? "bg-zinc-800 text-zinc-100 shadow-xs border border-zinc-700"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
              }`}
            >
              <Cpu className="w-4 h-4" />
              <span>Gerador</span>
            </button>

            <button
              type="button"
              id="tab-conference-btn"
              onClick={() => onTabChange("conference")}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                currentTab === "conference"
                  ? "bg-zinc-800 text-zinc-100 shadow-xs border border-zinc-700"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Conferência</span>
            </button>

            <button
              type="button"
              id="tab-history-btn"
              onClick={() => onTabChange("history")}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all relative ${
                currentTab === "history"
                  ? "bg-zinc-800 text-zinc-100 shadow-xs border border-zinc-700"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
              }`}
            >
              <History className="w-4 h-4" />
              <span>Histórico</span>
              {typeof historyCount === "number" && historyCount > 0 && (
                <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-700 text-zinc-300 font-mono">
                  {historyCount}
                </span>
              )}
            </button>

            <button
              type="button"
              id="tab-audit-btn"
              onClick={() => onTabChange("audit")}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                currentTab === "audit"
                  ? "bg-zinc-800 text-zinc-100 shadow-xs border border-zinc-700"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Auditoria</span>
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
};
