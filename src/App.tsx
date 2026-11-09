import React, { useState, useEffect } from "react";
import { Header, NavTab } from "./components/Header";
import { C5DashboardView } from "./components/C5DashboardView";
import { C5MemoryView } from "./components/C5MemoryView";
import { ConferenceView } from "./components/ConferenceView";
import { HistoryView } from "./components/HistoryView";
import { HistoricalReplayView } from "./components/HistoricalReplayView";
import { ContestRecord } from "./c5-memory/types";
import {
  getAllContestRecordsUI,
  initializeSeedDataUI,
} from "./c5-memory/application/uiService";
import { fetchLatestOfficialLotofacilContest, LatestOfficialContestReference } from "./c5-memory/officialDraws";
import { CheckCircle2, Shield, AlertTriangle, ArrowRight } from "lucide-react";

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>("dashboard");
  const [records, setRecords] = useState<ContestRecord[]>([]);
  const [currentContestNumber, setCurrentContestNumber] = useState<number | null>(null);
  const [isContestConfirmed, setIsContestConfirmed] = useState<boolean>(false);
  const [manualContestInput, setManualContestInput] = useState<string>("");
  const [manualContestError, setManualContestError] = useState<string | null>(null);
  const [officialReferenceInfo, setOfficialReferenceInfo] = useState<string | null>(null);
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
        // Preserva o comportamento exato para registros operacionais existentes
        const maxContest = Math.max(...realRecords.map(r => r.contestNumber));
        const lastRecord = realRecords.find(r => r.contestNumber === maxContest);
        if (lastRecord && lastRecord.status === "COMPLETED") {
          setCurrentContestNumber(maxContest + 1);
        } else {
          setCurrentContestNumber(maxContest);
        }
        setIsContestConfirmed(true);
        setOfficialReferenceInfo(null);
      } else {
        // Sem registros operacionais: tenta obter o número inicial de fonte oficial validada
        try {
          const officialRef = await fetchLatestOfficialLotofacilContest(undefined, 3500);
          if (
            officialRef &&
            Number.isInteger(officialRef.contestNumber) &&
            officialRef.contestNumber > 0
          ) {
            const nextTarget = officialRef.contestNumber + 1;
            setCurrentContestNumber(nextTarget);
            setIsContestConfirmed(true);
            setOfficialReferenceInfo(
              `Concurso inicial determinado via fonte oficial (${officialRef.source}). Último sorteio apurado: #${officialRef.contestNumber} (${officialRef.drawDate || "data confirmada"}). Próximo concurso: #${nextTarget}.`
            );
          } else {
            // Referência oficial não retornada: não inventar número de concurso
            setCurrentContestNumber(null);
            setIsContestConfirmed(false);
            setOfficialReferenceInfo(null);
          }
        } catch {
          // Ambiente offline ou indisponibilidade de rede: não inventar número de concurso
          setCurrentContestNumber(null);
          setIsContestConfirmed(false);
          setOfficialReferenceInfo(null);
        }
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
        currentContestNumber={currentContestNumber ?? 0}
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
        ) : activeTab === "reconstruction" ? (
          <HistoricalReplayView
            onNavigateToDashboard={() => setActiveTab("dashboard")}
            onNavigateToGenerator={() => setActiveTab("generator")}
            onRefreshAppState={handleContestUpdated}
          />
        ) : !isContestConfirmed || currentContestNumber === null ? (
          <div className="max-w-xl mx-auto my-12 bg-slate-900 border border-amber-500/30 rounded-2xl p-6 sm:p-8 shadow-2xl">
            <div className="flex items-center gap-3 text-amber-400 mb-4">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h2 className="text-lg font-bold text-slate-100">Definição Obrigatória do Concurso Inicial</h2>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed mb-4">
              Não foram encontrados registros operacionais anteriores e a referência oficial em tempo real da Caixa não pôde ser confirmada neste ambiente (modo offline ou sem conexão externa).
            </p>
            <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-6 font-mono">
              Invariante de Auditoria C5-Memory 3.0: É proibido inventar, estimar ou assumir arbitrariamente um número de concurso inicial quando não há comprovação oficial prévia.
            </p>
            <form
              onSubmit={e => {
                e.preventDefault();
                const parsed = parseInt(manualContestInput.trim(), 10);
                if (!Number.isInteger(parsed) || parsed <= 0) {
                  setManualContestError("Por favor, informe um número inteiro positivo válido para o concurso (ex: 3817).");
                  return;
                }
                setManualContestError(null);
                setCurrentContestNumber(parsed);
                setIsContestConfirmed(true);
              }}
              className="space-y-4"
            >
              <div>
                <label htmlFor="manual-contest-input" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Número do Concurso Alvo
                </label>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    id="manual-contest-input"
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Ex: 3817"
                    value={manualContestInput}
                    onChange={e => {
                      setManualContestInput(e.target.value);
                      setManualContestError(null);
                    }}
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-base font-mono text-emerald-400 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-medium text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 shrink-0"
                  >
                    <span>Confirmar Concurso</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
                {manualContestError && (
                  <p className="mt-2 text-xs text-rose-400">{manualContestError}</p>
                )}
              </div>

              <div className="pt-4 border-t border-slate-800 text-center">
                <button
                  type="button"
                  onClick={() => setActiveTab("reconstruction")}
                  className="text-xs text-emerald-400 hover:text-emerald-300 underline font-medium cursor-pointer"
                >
                  Ou inicialize a Reconstrução Histórica Completa C5 (Concursos 1..N)
                </button>
              </div>
            </form>
          </div>
        ) : (
          <>
            {officialReferenceInfo && (
              <div className="mb-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-2.5 text-xs text-emerald-300 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{officialReferenceInfo}</span>
                </div>
                <button
                  onClick={() => {
                    setManualContestInput(String(currentContestNumber));
                    setIsContestConfirmed(false);
                  }}
                  className="text-[11px] underline text-emerald-400 hover:text-emerald-200 shrink-0 cursor-pointer"
                >
                  Alterar Concurso
                </button>
              </div>
            )}

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
