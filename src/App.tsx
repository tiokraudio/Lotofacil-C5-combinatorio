import React, { useState, useEffect } from "react";
import { Header, NavTab } from "./components/Header";
import { C5DashboardView } from "./components/C5DashboardView";
import { C5MemoryView } from "./components/C5MemoryView";
import { ConferenceView } from "./components/ConferenceView";
import { HistoryView } from "./components/HistoryView";
import { AuditView } from "./components/AuditView";
import { ContestRecord } from "./c5-memory/types";
import {
  getAllContestRecordsUI,
  initializeSeedDataUI,
  loadOptInDemoDataUI,
  clearDemoDataUI,
} from "./c5-memory/application/uiService";
import { AlertTriangle, FlaskConical, Trash2, CheckCircle2 } from "lucide-react";

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>("dashboard");
  const [records, setRecords] = useState<ContestRecord[]>([]);
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);
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
      setRecords(loaded);

      // Concursos a serem considerados para o número do próximo concurso
      const activeRecords = isDemoMode ? loaded : loaded.filter(r => !r.isDemo);

      if (activeRecords.length > 0) {
        const maxContest = Math.max(...activeRecords.map(r => r.contestNumber));
        const lastRecord = activeRecords.find(r => r.contestNumber === maxContest);
        if (lastRecord && lastRecord.status === "COMPLETED") {
          setCurrentContestNumber(maxContest + 1);
        } else {
          setCurrentContestNumber(maxContest);
        }
      } else {
        setCurrentContestNumber(3501);
      }
    } catch (err: any) {
      console.error("Erro ao inicializar dados:", err);
      setLoadError(err?.message ?? "Falha ao carregar registros do banco operacional.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [isDemoMode]);

  const handleContestUpdated = () => {
    loadData();
  };

  const handleNavigateToConference = (contestNum: number) => {
    setConferenceTargetNumber(contestNum);
    setActiveTab("conference");
  };

  const handleLoadDemo = async () => {
    try {
      setIsLoading(true);
      await loadOptInDemoDataUI();
      setIsDemoMode(true);
      await loadData();
    } catch (err: any) {
      setLoadError("Falha ao carregar dados de demonstração: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearDemo = async () => {
    try {
      setIsLoading(true);
      await clearDemoDataUI();
      setIsDemoMode(false);
      await loadData();
    } catch (err: any) {
      setLoadError("Falha ao limpar dados de demonstração: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const hasDemoInDB = records.some(r => r.isDemo === true);
  // Registros visíveis de acordo com a seleção de modo de demonstração
  const visibleRecords = isDemoMode ? records : records.filter(r => !r.isDemo);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <Header
        activeTab={activeTab}
        onTabChange={tab => setActiveTab(tab)}
        currentContestNumber={currentContestNumber}
      />

      {/* Banner de Controle e Notificação do Modo de Demonstração */}
      <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-2 text-xs">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          {isDemoMode ? (
            <div className="flex items-center gap-2 text-amber-300">
              <FlaskConical className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <strong>Modo de Demonstração Ativo:</strong> Exibindo 4 concursos sintéticos de teste. O histórico oficial e a memória H estão isolados.
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-slate-400">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                <strong>Modo Oficial de Produção:</strong> Banco operacional limpo e auditável. Exibindo apenas apostas reais.
              </span>
            </div>
          )}

          <div className="flex items-center gap-2">
            {isDemoMode ? (
              <button
                onClick={handleClearDemo}
                className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg transition-all cursor-pointer font-medium"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Desativar / Limpar Demonstração</span>
              </button>
            ) : hasDemoInDB ? (
              <button
                onClick={() => setIsDemoMode(true)}
                className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg transition-all cursor-pointer font-medium"
              >
                <FlaskConical className="w-3.5 h-3.5 text-amber-400" />
                <span>Alternar para Modo Demonstração</span>
              </button>
            ) : (
              <button
                onClick={handleLoadDemo}
                className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition-all cursor-pointer font-medium"
              >
                <FlaskConical className="w-3.5 h-3.5 text-emerald-400" />
                <span>Carregar Dados Demonstrativos (Opt-in)</span>
              </button>
            )}
          </div>
        </div>
      </div>

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
                records={visibleRecords}
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

            {activeTab === "history" && <HistoryView records={visibleRecords} />}

            {activeTab === "audit" && <AuditView records={visibleRecords} />}
          </>
        )}
      </main>

      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4">
          <p>
            Lotofácil C5 Combinatório • Algoritmo Canônico C5-Memory-2.1.0 • Critério MAX-LEXIMIN (K=500)
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
