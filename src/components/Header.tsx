import React from "react";
import { LayoutDashboard, Sparkles, CheckCircle2, History, ShieldCheck } from "lucide-react";

export type NavTab = "dashboard" | "generator" | "conference" | "history" | "audit";

interface HeaderProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  currentContestNumber: number;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  currentContestNumber,
}) => {
  const navItems: Array<{ id: NavTab; label: string; icon: React.ReactNode }> = [
    { id: "dashboard", label: "Painel C5", icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: "generator", label: "Gerador", icon: <Sparkles className="w-4 h-4" /> },
    { id: "conference", label: "Conferência", icon: <CheckCircle2 className="w-4 h-4" /> },
    { id: "history", label: "Histórico", icon: <History className="w-4 h-4" /> },
    { id: "audit", label: "Auditoria", icon: <ShieldCheck className="w-4 h-4" /> },
  ];

  return (
    <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <span className="font-mono font-black text-white text-base tracking-tighter">C₅</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-100 tracking-tight text-lg">Lotofácil C5</span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                  Memory-2.0.0
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                Ciclo Diário Oficial & Auditoria Criptográfica
              </p>
            </div>
          </div>

          <nav className="flex items-center gap-1 sm:gap-2">
            {navItems.map(item => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  id={`nav-tab-${item.id}`}
                  onClick={() => onTabChange(item.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                    isActive
                      ? "bg-slate-800 text-emerald-400 border border-slate-700 shadow-sm"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                  }`}
                >
                  {item.icon}
                  <span className="hidden md:inline">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
};
