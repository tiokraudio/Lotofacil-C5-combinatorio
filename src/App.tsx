import React, { useState, useEffect } from "react";
import { Header, NavTab } from "./components/Header";
import { C5DashboardView } from "./components/C5DashboardView";
import { C5MemoryView } from "./components/C5MemoryView";
import { ConferenceView } from "./components/ConferenceView";
import { HistoryView } from "./components/HistoryView";
import { ContestRecord } from "./c5-memory/types";
import {
  getAllContestRecordsUI,
  initializeSeedDataUI,
} from "./c5-memory/application/uiService";
import { CheckCircle2, Shield } from "lucide-react";

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>("dashboard");
  const [records, setRecords] = useState<ContestRecord[]>([]);
  const [currentContestNumber, setCurrentContestNumber] = useState<number>(3501);
  const [conferenceTargetNumber, setConferenceTargetNumber] = useState<number | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      await initializeSeedDataUI();
      const loaded = await getAllContestRecordsUI();
      // Somente registros operacionais reais (exclusão estrita de demo ou fixtures)
      const realRecords = loaded.filter(r => !r.isDemo && !r.isFixture);
      setRecords(realRecords);

      if (realRecords.length > 0) {
        const maxContest = Math.max(...realRecords.map(r => r.contestNumber));
        const lastRecord = realRecords.find(r => r.contestNumber === maxContest);
        if (lastRecord && lastRecord.status === "COMPLETED") {
          setCurrentContestNumber(maxContest + 1);
        } else {
          setCurrentContestNumber(maxContest);
        }
      } else {
        setCurrentContestNumber(3501);
      }
    } catch (err: any) {
      console.error("Erro ao inicializar dados operacionais:", err);
      setLoadError(err?.message ?? "Falha ao carregar registros do banco operacional.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleContestUpdated = () => {
    loadData();
  };

  const handleNavigateToConference = (contestNum: number) => {
    setConferenceTargetNumber(contestNum);
    setActiveTab("conference");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <Header
        activeTab={activeTab}
        onTabChange={tab => setActiveTab(tab)}
        currentContestNumber={currentContestNumber}
      />

      {/* Faixa de Integridade Operacional C5-Memory 3.0 */}
      <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-2 text-xs">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-slate-300">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              <strong>Ambiente Operacional Oficial:</strong> C5-Memory 3.0 • Isolamento absoluto de dados reais contra fixtures.
            </span>
          </div>

          <div className="flex items-center gap-3 text-slate-400 font-mono text-[11px]">
            <span className="flex items-center gap-1 text-emerald-400">
              <Shield className="w-3.5 h-3.5" />
              Critério: MAX-LEXIMIN (Johnson)
            </span>
            <span>•</span>
            <span>5 Jogos/Op</span>
            <span>•</span>
            <span>Anti-Duplicação Oficial & Histórico</span>
          </div>
        </div>
      </div>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        {isLoading ? (
          <div className="py-24 text-center text-slate-400">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm">Inicializando C5-Memory 3.0...</p>
          </div>
        ) : (
          <>
            {activeTab === "dashboard" && (
              <C5DashboardView
                records={records}
                currentContestNumber={currentContestNumber}
                onNavigateToGenerator={() => setActiveTab("generator")}
                onNavigateToConference={() => setActiveTab("conference")}
                isLoading={isLoading}
                error={loadError}
                onRetry={loadData}
              />
            )}

            {activeTab === "generator" && (
              <C5MemoryView
                currentContestNumber={currentContestNumber}
                onContestUpdated={handleContestUpdated}
                onNavigateToConference={handleNavigateToConference}
              />
            )}

            {activeTab === "conference" && (
              <ConferenceView
                initialContestNumber={conferenceTargetNumber}
                onContestUpdated={handleContestUpdated}
                onNavigateToDashboard={() => setActiveTab("dashboard")}
                onNavigateToGenerator={() => setActiveTab("generator")}
              />
            )}

            {activeTab === "history" && <HistoryView records={records} />}
          </>
        )}
      </main>

      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4">
          <p>
            Lotofácil C5 Combinatório • Algoritmo Canônico C5-Memory 3.0 • Critério MAX-LEXIMIN (K=500)
          </p>
          <p className="mt-1 text-slate-600">
            Registro prospectivo com congelamento SHA-256 e auditoria criptográfica independente.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default App;
