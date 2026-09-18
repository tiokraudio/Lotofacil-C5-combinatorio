import React, { useState, useEffect } from "react";
import { Header, NavTab } from "./components/Header.tsx";
import { GeneratorView } from "./components/GeneratorView.tsx";
import { HistoryView } from "./components/HistoryView.tsx";
import { AuditView } from "./components/AuditView.tsx";
import { repository } from "./storage/service.ts";

export default function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>("generator");
  const [historyCount, setHistoryCount] = useState<number>(0);

  const refreshHistoryBadge = async () => {
    try {
      const all = await repository.getAllContestRecords();
      setHistoryCount(all.length);
    } catch {
      // IndexedDB fallback
    }
  };

  useEffect(() => {
    refreshHistoryBadge();
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans antialiased selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* Cabeçalho Principal */}
      <Header
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        historyCount={historyCount}
      />

      {/* Conteúdo Central */}
      <main className="grow max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {currentTab === "generator" && (
          <GeneratorView onRecordUpdated={refreshHistoryBadge} />
        )}
        {currentTab === "history" && <HistoryView />}
        {currentTab === "audit" && <AuditView onImportSuccess={refreshHistoryBadge} />}
      </main>

      {/* Rodapé Sóbrio e Técnico */}
      <footer className="border-t border-zinc-900 bg-zinc-950/60 py-6 text-center text-xs text-zinc-400">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p>
            C₅ LOTOFÁCIL • Gerador Combinatório Auditável • Algoritmo v1.0.0
          </p>
          <p className="font-mono text-[11px]">
            5 jogos de 15 dezenas (R$ 17,50) • Cobertura total das 25 dezenas
          </p>
        </div>
      </footer>
    </div>
  );
}
