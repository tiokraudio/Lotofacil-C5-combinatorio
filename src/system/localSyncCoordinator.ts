/**
 * Coordenador de Coerência Multiaba e Sincronização Local (v1.6.0)
 *
 * Responsável por:
 * - Prover canal versionado e isolado de comunicação entre abas/janelas locais via BroadcastChannel
 * - Garantir que o evento multiaba seja estritamente um sinal de invalidação (sem dados de negócio)
 * - Garantir que o IndexedDB permaneça como Única Fonte da Verdade (Source of Truth)
 * - Proteger contra loops infinitos de replicação (eventos remotos recebidos nunca republicam)
 * - Ignorar eventos gerados pela própria instância (originId) e eventos duplicados (eventId / dedup)
 * - Rejeitar em tempo de execução eventos malformados ou forjados sem causar falhas ou mutações
 * - Operar normalmente com fallback No-Op quando o BroadcastChannel estiver indisponível
 */

import {
  type RefreshCoordinator,
  type DataMutationReason,
  refreshCoordinator as canonicalRefreshCoordinator,
} from "./refreshCoordinator.ts";

export const LOCAL_SYNC_CHANNEL_NAME = "lotofacil-c5-local-sync-v1";
export const LOCAL_SYNC_PROTOCOL_VERSION = 1;

export type LocalSyncReason =
  | "SAVE"
  | "FREEZE"
  | "SCORE"
  | "DELETE"
  | "IMPORT";

export interface LocalSyncEvent {
  protocolVersion: 1;
  eventId: string;
  originId: string;
  reason: LocalSyncReason;
  contestNumber?: number;
  emittedAt: string;
}

export interface LocalSyncMetrics {
  published: number;
  received: number;
  ignoredDuplicate: number;
  ignoredOwnOrigin: number;
  ignoredMalformed: number;
}

export interface LocalSyncTransport {
  publish(event: LocalSyncEvent): void;
  subscribe(listener: (event: LocalSyncEvent) => void): () => void;
  close(): void;
}

/**
 * Gera identificador UUID único usando primitivas criptográficas do WebCrypto.
 * Proibido expressamente o uso de geradores pseudoaleatórios inseguros.
 */
export function generateCryptoUUID(): string {
  const cryptoObj =
    typeof crypto !== "undefined"
      ? crypto
      : typeof globalThis !== "undefined" && (globalThis as any).crypto
      ? (globalThis as any).crypto
      : null;

  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }

  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10xx
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  throw new Error("Ambiente sem suporte a primitivas seguras de WebCrypto.");
}

/**
 * Validação rigorosa em tempo de execução para contratos de eventos de sincronização multiaba.
 */
export function isValidLocalSyncEvent(event: unknown): event is LocalSyncEvent {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return false;
  }

  const candidate = event as Partial<LocalSyncEvent>;

  if (candidate.protocolVersion !== LOCAL_SYNC_PROTOCOL_VERSION) {
    return false;
  }

  if (typeof candidate.eventId !== "string" || candidate.eventId.trim().length === 0) {
    return false;
  }

  if (typeof candidate.originId !== "string" || candidate.originId.trim().length === 0) {
    return false;
  }

  const validReasons: LocalSyncReason[] = ["SAVE", "FREEZE", "SCORE", "DELETE", "IMPORT"];
  if (!candidate.reason || !validReasons.includes(candidate.reason as LocalSyncReason)) {
    return false;
  }

  if (candidate.contestNumber !== undefined) {
    if (
      typeof candidate.contestNumber !== "number" ||
      !Number.isInteger(candidate.contestNumber) ||
      candidate.contestNumber < 1
    ) {
      return false;
    }
  }

  if (
    typeof candidate.emittedAt !== "string" ||
    candidate.emittedAt.trim().length === 0 ||
    Number.isNaN(Date.parse(candidate.emittedAt))
  ) {
    return false;
  }

  return true;
}

/**
 * Transporte nativo baseado em BroadcastChannel para comunicação de abas no mesmo navegador.
 */
export class BroadcastChannelTransport implements LocalSyncTransport {
  private channel: BroadcastChannel | null = null;

  constructor(channelName: string = LOCAL_SYNC_CHANNEL_NAME) {
    if (typeof BroadcastChannel !== "undefined") {
      try {
        this.channel = new BroadcastChannel(channelName);
      } catch (err) {
        console.warn(
          "[LocalSync] Falha ao criar BroadcastChannel nativo. Operando em modo isolado:",
          err
        );
        this.channel = null;
      }
    } else {
      this.channel = null;
    }
  }

  publish(event: LocalSyncEvent): void {
    if (!this.channel) return;
    try {
      this.channel.postMessage(event);
    } catch (err) {
      // Prompt 15 #75: Se o commit já ocorreu e postMessage falhar, NÃO desfazer commit nem repetir mutação.
      console.error("[LocalSync] Erro técnico ao publicar mensagem no BroadcastChannel:", err);
    }
  }

  subscribe(listener: (event: LocalSyncEvent) => void): () => void {
    if (!this.channel) return () => {};

    const handler = (msg: MessageEvent) => {
      try {
        listener(msg.data);
      } catch (err) {
        console.error("[LocalSync] Erro ao processar mensagem recebida no BroadcastChannel:", err);
      }
    };

    this.channel.addEventListener("message", handler);
    return () => {
      this.channel?.removeEventListener("message", handler);
    };
  }

  close(): void {
    if (this.channel) {
      try {
        this.channel.close();
      } catch {
        // ignore
      }
      this.channel = null;
    }
  }
}

/**
 * Barramento de teste em memória que simula múltiplas abas concorrentes de forma determinística.
 */
export class InMemoryLocalSyncBus {
  private transports: Set<InMemoryLocalSyncTransport> = new Set();

  register(transport: InMemoryLocalSyncTransport): void {
    this.transports.add(transport);
  }

  unregister(transport: InMemoryLocalSyncTransport): void {
    this.transports.delete(transport);
  }

  dispatch(sender: InMemoryLocalSyncTransport, event: LocalSyncEvent): void {
    for (const transport of Array.from(this.transports)) {
      if (transport !== sender) {
        transport.deliver(event);
      }
    }
  }

  clear(): void {
    this.transports.clear();
  }
}

/**
 * Transporte em memória conectado a um InMemoryLocalSyncBus (para suítes de teste multiaba).
 */
export class InMemoryLocalSyncTransport implements LocalSyncTransport {
  private bus: InMemoryLocalSyncBus;
  private listeners: Set<(event: LocalSyncEvent) => void> = new Set();
  private isClosed: boolean = false;

  constructor(bus: InMemoryLocalSyncBus) {
    this.bus = bus;
    bus.register(this);
  }

  publish(event: LocalSyncEvent): void {
    if (this.isClosed) return;
    this.bus.dispatch(this, event);
  }

  deliver(event: LocalSyncEvent): void {
    if (this.isClosed) return;
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(event);
      } catch (err) {
        console.error("[LocalSync Test] Erro ao entregar evento:", err);
      }
    }
  }

  subscribe(listener: (event: LocalSyncEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  close(): void {
    this.isClosed = true;
    this.listeners.clear();
    this.bus.unregister(this);
  }
}

/**
 * Transporte No-Op utilizado como fallback quando o BroadcastChannel estiver indisponível.
 */
export class NoOpLocalSyncTransport implements LocalSyncTransport {
  publish(_event: LocalSyncEvent): void {}
  subscribe(_listener: (event: LocalSyncEvent) => void): () => void {
    return () => {};
  }
  close(): void {}
}

export interface LocalSyncCoordinatorOptions {
  originId?: string;
  transport?: LocalSyncTransport;
  refreshCoordinator?: RefreshCoordinator;
  maxDedupEntries?: number;
}

/**
 * Coordenador Central de Sincronização Local Multiaba.
 */
export class LocalSyncCoordinator {
  private readonly originId: string;
  private readonly transport: LocalSyncTransport;
  private readonly refreshCoordinator: RefreshCoordinator;
  private readonly maxDedupEntries: number;

  private seenEventIds: Set<string> = new Set();
  private dedupQueue: string[] = [];

  private unsubCommit?: () => void;
  private unsubTransport?: () => void;

  private metrics: LocalSyncMetrics = {
    published: 0,
    received: 0,
    ignoredDuplicate: 0,
    ignoredOwnOrigin: 0,
    ignoredMalformed: 0,
  };

  constructor(options?: LocalSyncCoordinatorOptions) {
    this.originId = options?.originId ?? generateCryptoUUID();
    this.maxDedupEntries = options?.maxDedupEntries ?? 500;
    this.refreshCoordinator = options?.refreshCoordinator ?? canonicalRefreshCoordinator;

    // Transporte: utiliza o injetado, ou BroadcastChannel nativo com fallback automático
    this.transport = options?.transport ?? new BroadcastChannelTransport();

    // 1. Escuta mutações locais PÓS-COMMIT da própria aba para publicar externamente
    this.unsubCommit = this.refreshCoordinator.onCommit((reason, contestNumber) => {
      this.broadcast(reason, contestNumber);
    });

    // 2. Escuta eventos do transporte de rede local vindos de outras abas
    this.unsubTransport = this.transport.subscribe((rawEvent) => {
      this.handleIncomingEvent(rawEvent);
    });
  }

  getOriginId(): string {
    return this.originId;
  }

  getMetrics(): Readonly<LocalSyncMetrics> {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      published: 0,
      received: 0,
      ignoredDuplicate: 0,
      ignoredOwnOrigin: 0,
      ignoredMalformed: 0,
    };
  }

  /**
   * Registra um eventId na fila de deduplicação limitada (evita vazamento de memória).
   */
  private recordSeenEventId(eventId: string): void {
    this.seenEventIds.add(eventId);
    this.dedupQueue.push(eventId);
    while (this.dedupQueue.length > this.maxDedupEntries) {
      const oldest = this.dedupQueue.shift();
      if (oldest) {
        this.seenEventIds.delete(oldest);
      }
    }
  }

  /**
   * Publica uma notificação de mutação local após confirmação definitiva (commit) do IndexedDB.
   */
  broadcast(reason: DataMutationReason, contestNumber?: number): void {
    if (reason === "INITIAL_LOAD") return;

    const event: LocalSyncEvent = {
      protocolVersion: LOCAL_SYNC_PROTOCOL_VERSION,
      eventId: generateCryptoUUID(),
      originId: this.originId,
      reason: reason as LocalSyncReason,
      contestNumber,
      emittedAt: new Date().toISOString(),
    };

    this.recordSeenEventId(event.eventId);
    this.metrics.published++;

    try {
      this.transport.publish(event);
    } catch (err) {
      console.error("[LocalSync] Erro técnico ao transmitir sinal multiaba:", err);
    }
  }

  /**
   * Processa com segurança um evento vindo de outra aba através do transporte.
   */
  handleIncomingEvent(rawEvent: unknown): void {
    // 1. Validação estrita de contrato e tipo (Prompt 15 #20)
    if (!isValidLocalSyncEvent(rawEvent)) {
      this.metrics.ignoredMalformed++;
      return;
    }

    // 2. Ignora eventos de si própria (Prompt 15 #18)
    if (rawEvent.originId === this.originId) {
      this.metrics.ignoredOwnOrigin++;
      return;
    }

    // 3. Deduplicação com memória limitada (Prompt 15 #19 e #66)
    if (this.seenEventIds.has(rawEvent.eventId)) {
      this.metrics.ignoredDuplicate++;
      return;
    }

    this.recordSeenEventId(rawEvent.eventId);
    this.metrics.received++;

    // 4. Invalida estado local para induzir releitura limpa do IndexedDB (Prompt 15 #4, #16, #17)
    // CRÍTICO: notifyExternalSyncReceived NUNCA retransmite o evento, evitando loops.
    // CRÍTICO: NÃO escreve no IndexedDB, NÃO chama a CAIXA.
    this.refreshCoordinator.notifyExternalSyncReceived(rawEvent.reason, rawEvent.contestNumber);
  }

  /**
   * Desconecta o coordenador e libera os listeners e canais de transporte.
   */
  close(): void {
    if (this.unsubCommit) {
      this.unsubCommit();
      this.unsubCommit = undefined;
    }
    if (this.unsubTransport) {
      this.unsubTransport();
      this.unsubTransport = undefined;
    }
    this.transport.close();
    this.seenEventIds.clear();
    this.dedupQueue = [];
  }
}

// Instância canônica global da aba atual
export const localSyncCoordinator = new LocalSyncCoordinator();
