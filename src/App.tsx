import React, { useState, useEffect } from "react";
import { Header, NavTab } from "./components/Header";
import { C5DashboardView } from "./components/C5DashboardView";
import { C5MemoryView } from "./components/C5MemoryView";
import { ConferenceView } from "./components/ConferenceView";
import { HistoryView } from "./components/HistoryView";
import { AuditView } from "./components/AuditView";
import { ContestRecord } from "./c5-memory/types";
import { getAllContestRecordsUI, initializeSeedDataUI } from "./c5-memory/application/uiService";

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>("dashboard");
  const [records, setRecords] = useState<ContestRecord[]>([]);
  const [currentContestNumber, setCurrentContestNumber] = useState<number>(3505);
  const [conferenceTargetNumber, setConferenceTargetNumber] = useState<number | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const loadData = async () => {
    try {
      await initializeSeedDataUI();
      const loaded = await getAllContestRecordsUI();
      setRecords(loaded);

      if (loaded.length > 0) {
        const maxContest = Math.max(...loaded.map(r => r.contestNumber));
        // Se o último já está COMPLETED, o atual para gerar é max + 1
        const lastRecord = loaded.find(r => r.contestNumber === maxContest);
        if (lastRecord && lastRecord.status === "COMPLETED") {
          setCurrentContestNumber(maxContest + 1);
        } else {
          setCurrentContestNumber(maxContest);
        }
      }
    } catch (err) {
      console.error("Erro ao inicializar dados:", err);
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

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        {isLoading ? (
          <div className="py-24 text-center text-slate-400">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm">Inicializando C5-Memory-2.1.0...</p>
          </div>
        ) : (
          <>
            {activeTab === "dashboard" && (
              <C5DashboardView
                records={records}
                currentContestNumber={currentContestNumber}
                onNavigateToGenerator={() => setActiveTab("generator")}
                onNavigateToConference={() => setActiveTab("conference")}
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
              />
            )}

            {activeTab === "history" && <HistoryView records={records} />}

            {activeTab === "audit" && <AuditView records={records} />}
          </>
        )}
      </main>

      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4">
          <p>
            Lotofácil C5 Combinatório • Algoritmo Canônico C5-Memory-2.0.0 • Critério MAX-LEXIMIN (K=500)
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
