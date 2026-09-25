import React, { useState, useEffect, useCallback, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { Header, NavTab } from "./components/Header.tsx";
import { GeneratorView } from "./components/GeneratorView.tsx";
import { ConferenceView } from "./components/ConferenceView.tsx";
import { HistoryView } from "./components/HistoryView.tsx";
import { AuditView } from "./components/AuditView.tsx";
import { repository } from "./storage/service.ts";
import {
  type AppBootState,
  type AppBootResult,
  performAppBootstrap,
} from "./system/bootstrap.ts";
import { refreshCoordinator } from "./system/refreshCoordinator.ts";
import { localSyncCoordinator } from "./system/localSyncCoordinator.ts";

export default function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>("generator");
  const [historyCount, setHistoryCount] = useState<number>(0);
  const [updateKey, setUpdateKey] = useState<number>(1);
  const [bootState, setBootState] = useState<AppBootState>("BOOTING");
  const [bootResult, setBootResult] = useState<AppBootResult | null>(null);

  const isMountedRef = useRef<boolean>(true);
  const activeRunIdRef = useRef<number>(0);

  const refreshHistoryBadge = useCallback(async () => {
    try {
      const all = await repository.getAllContestRecords();
      if (isMountedRef.current) {
        setHistoryCount(all.length);
      }
    } catch {
      // Falha de leitura de storage é tratada pelas views correspondentes
    }
  }, []);

  const runBootstrap = useCallback(async () => {
    const runId = ++activeRunIdRef.current;
    setBootState("BOOTING");
    const result = await performAppBootstrap();

    if (!isMountedRef.current || runId !== activeRunIdRef.current || result.stale) {
      return; // Ignora resultado obsoleto ou se o componente foi desmontado
    }

    setBootResult(result);
    setBootState(result.state);
    if (result.state === "READY" || result.state === "DEGRADED") {
      await refreshHistoryBadge();
    }
  }, [refreshHistoryBadge]);

  useEffect(() => {
    isMountedRef.current = true;
    runBootstrap();
    return () => {
      isMountedRef.current = false;
    };
  }, [runBootstrap]);

  // Inscrição no coordenador global de atualizações persistentes (Prompt 14 #17-#24)
  useEffect(() => {
    const unsub = refreshCoordinator.subscribe((rev) => {
      setUpdateKey(rev);
      refreshHistoryBadge();
    });
    return unsub;
  }, [refreshHistoryBadge]);

  const handleDataInvalidated = async () => {
    await refreshHistoryBadge();
  };

  // 1. Estado BOOTING: infraestrutura essencial sendo checada
  if (bootState === "BOOTING") {
    return (
      <div
        className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-4 font-sans select-none"
        aria-live="polite"
      >
        <div className="w-12 h-12 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mb-4" />
        <h2 className="text-base font-bold text-zinc-200 font-mono tracking-wide">
          INICIALIZANDO SISTEMA
        </h2>
        <p className="text-xs text-zinc-400 mt-1.5 text-center max-w-sm">
          Verificando primitivas criptográficas, manifesto de integridade e armazenamento local...
        </p>
      </div>
    );
  }

  // 2. Estado FATAL: infraestrutura essencial indisponível (geração, congelamento, etc. bloqueados)
  if (bootState === "FATAL") {
    return (
      <div
        className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-4 font-sans"
        role="alert"
      >
        <div className="max-w-md w-full p-6 rounded-2xl bg-zinc-900 border border-rose-500/50 shadow-2xl space-y-4 text-center">
          <div className="w-12 h-12 rounded-full bg-rose-950/60 border border-rose-500/40 text-rose-400 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold font-mono text-zinc-100">
            FALHA OPERACIONAL ESSENCIAL
          </h2>
          <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
            {bootResult?.error?.userMessage || "Não foi possível acessar a infraestrutura local necessária para operar o sistema com segurança."}
          </p>
          <p className="text-[11px] text-zinc-500 leading-normal">
            As operações de geração, congelamento, pontuação e importação estão bloqueadas para proteger a integridade dos seus dados.
          </p>
          <div className="pt-2">
            <button
              type="button"
              id="btn-retry-bootstrap"
              onClick={runBootstrap}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold font-mono text-xs tracking-wide transition-all shadow-md cursor-pointer focus:ring-2 focus:ring-emerald-400"
            >
              TENTAR NOVAMENTE
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3. Estados READY ou DEGRADED: aplicação operacional liberada
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
        {/* Banner de Aviso para Modo DEGRADADO (Prompt 14 #9 e #50) */}
        {bootState === "DEGRADED" && (
          <div
            id="banner-degraded-state"
            role="alert"
            className="mb-6 p-4 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md"
          >
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
              <span>
                <strong>MODO DEGRADADO:</strong> {bootResult?.quarantineCount} concurso(s) com violação em quarentena. Operações em registros válidos continuam operacionais.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setCurrentTab("audit")}
              className="px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-mono text-[11px] border border-amber-500/30 whitespace-nowrap self-start sm:self-auto cursor-pointer"
            >
              VER AUDITORIA
            </button>
          </div>
        )}

        {currentTab === "generator" && (
          <GeneratorView onRecordUpdated={handleDataInvalidated} />
        )}
        {currentTab === "conference" && (
          <ConferenceView onRecordUpdated={handleDataInvalidated} />
        )}
        {currentTab === "history" && <HistoryView updateTrigger={updateKey} />}
        {currentTab === "audit" && <AuditView onImportSuccess={handleDataInvalidated} />}
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
