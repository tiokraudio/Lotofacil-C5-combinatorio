/**
 * Máquina de Estados Pura e Determinística para Prévia de Resultado Oficial (v1.4.0)
 * 
 * Gerencia o ciclo de vida da prévia de resultado oficial obtido da CAIXA:
 * - acceptedPreview: Resultado aceito e pronto para pontuação (snapshot imutável)
 * - pendingPreview: Novo resultado divergente detectado em consulta subsequente
 * - error: Mensagens de falha na consulta sem perda do preview anterior
 * 
 * Transições Canônicas:
 * - FETCH_SUCCESS_FIRST: Primeiro resultado válido aceito.
 * - FETCH_SUCCESS_SAME: Consulta subsequente com resultado idêntico (atualiza metadados, sem divergência).
 * - FETCH_SUCCESS_DIFFERENT: Consulta subsequente com resultado diferente (mantém acceptedPreview, coloca novo em pendingPreview, bloqueia score).
 * - FETCH_FAILURE: Erro na consulta (preserva acceptedPreview, limpa pendingPreview, expõe erro).
 * - KEEP_PREVIOUS: Usuário decide explicitamente manter o resultado anterior.
 * - ACCEPT_NEW: Usuário decide explicitamente aceitar o novo resultado.
 * - CLEAR: Limpa todos os previews (ex: ao trocar de concurso ou cancelar).
 */

import type { OfficialResultPreview } from "./operationalState.ts";

export interface OfficialResultPreviewState {
  acceptedPreview: OfficialResultPreview | null;
  pendingPreview: OfficialResultPreview | null;
  error: string | null;
}

export const INITIAL_OFFICIAL_PREVIEW_STATE: OfficialResultPreviewState = {
  acceptedPreview: null,
  pendingPreview: null,
  error: null,
};

export type OfficialResultPreviewAction =
  | { type: "FETCH_SUCCESS_FIRST"; preview: OfficialResultPreview }
  | { type: "FETCH_SUCCESS_SAME"; preview: OfficialResultPreview }
  | { type: "FETCH_SUCCESS_DIFFERENT"; preview: OfficialResultPreview }
  | { type: "FETCH_FAILURE"; error: string }
  | { type: "KEEP_PREVIOUS" }
  | { type: "ACCEPT_NEW" }
  | { type: "CLEAR" };

/**
 * Compara se duas listas de dezenas são estritamente iguais.
 */
export function areResultNumbersEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Reducer puro para transição de estados de prévia.
 */
export function officialResultPreviewReducer(
  state: OfficialResultPreviewState,
  action: OfficialResultPreviewAction
): OfficialResultPreviewState {
  switch (action.type) {
    case "FETCH_SUCCESS_FIRST":
      return {
        acceptedPreview: action.preview,
        pendingPreview: null,
        error: null,
      };

    case "FETCH_SUCCESS_SAME":
      return {
        // Atualiza com os metadados mais recentes da consulta mantendo o mesmo resultado
        acceptedPreview: action.preview,
        pendingPreview: null,
        error: null,
      };

    case "FETCH_SUCCESS_DIFFERENT":
      return {
        // Preserva o resultado anterior em acceptedPreview e coloca o novo em pendingPreview
        acceptedPreview: state.acceptedPreview,
        pendingPreview: action.preview,
        error: null,
      };

    case "FETCH_FAILURE":
      return {
        // Regra 23: Preserva acceptedPreview anterior; não apaga
        acceptedPreview: state.acceptedPreview,
        pendingPreview: null,
        error: action.error,
      };

    case "KEEP_PREVIOUS":
      return {
        acceptedPreview: state.acceptedPreview,
        pendingPreview: null,
        error: null,
      };

    case "ACCEPT_NEW":
      return {
        acceptedPreview: state.pendingPreview ?? state.acceptedPreview,
        pendingPreview: null,
        error: null,
      };

    case "CLEAR":
      return INITIAL_OFFICIAL_PREVIEW_STATE;

    default:
      return state;
  }
}

/**
 * Avalia um resultado recebido em relação ao estado atual e retorna a ação correta.
 */
export function evaluateIncomingPreviewAction(
  currentState: OfficialResultPreviewState,
  incoming: OfficialResultPreview
): OfficialResultPreviewAction {
  if (!currentState.acceptedPreview) {
    return { type: "FETCH_SUCCESS_FIRST", preview: incoming };
  }

  const isSame = areResultNumbersEqual(
    currentState.acceptedPreview.numbers,
    incoming.numbers
  );

  if (isSame) {
    return { type: "FETCH_SUCCESS_SAME", preview: incoming };
  }

  return { type: "FETCH_SUCCESS_DIFFERENT", preview: incoming };
}

/**
 * Determina se a pontuação pode ser realizada.
 * Bloqueada se não houver acceptedPreview ou se houver divergência pendente (pendingPreview !== null).
 */
export function canScoreOfficialPreview(state: OfficialResultPreviewState): boolean {
  return state.acceptedPreview !== null && state.pendingPreview === null;
}

/**
 * Obtém o snapshot exato de dezenas para pontuação.
 * Retorna null se a pontuação estiver bloqueada ou indisponível.
 */
export function getScoreSnapshotNumbers(state: OfficialResultPreviewState): number[] | null {
  if (!canScoreOfficialPreview(state)) {
    return null;
  }
  return state.acceptedPreview ? [...state.acceptedPreview.numbers] : null;
}

/**
 * Controlador de Prévia Oficial.
 * Encapsula a máquina de estados em uma interface amigável para componentes e testes.
 */
export class OfficialResultPreviewController {
  private state: OfficialResultPreviewState;

  constructor(initialState: OfficialResultPreviewState = INITIAL_OFFICIAL_PREVIEW_STATE) {
    this.state = initialState;
  }

  getState(): Readonly<OfficialResultPreviewState> {
    return this.state;
  }

  dispatch(action: OfficialResultPreviewAction): OfficialResultPreviewState {
    this.state = officialResultPreviewReducer(this.state, action);
    return this.state;
  }

  handleIncomingPreview(incoming: OfficialResultPreview): OfficialResultPreviewState {
    const action = evaluateIncomingPreviewAction(this.state, incoming);
    return this.dispatch(action);
  }

  handleFetchFailure(error: string): OfficialResultPreviewState {
    return this.dispatch({ type: "FETCH_FAILURE", error });
  }

  keepPrevious(): OfficialResultPreviewState {
    return this.dispatch({ type: "KEEP_PREVIOUS" });
  }

  acceptNew(): OfficialResultPreviewState {
    return this.dispatch({ type: "ACCEPT_NEW" });
  }

  clear(): OfficialResultPreviewState {
    return this.dispatch({ type: "CLEAR" });
  }

  canScore(): boolean {
    return canScoreOfficialPreview(this.state);
  }

  getScoreSnapshot(): number[] | null {
    return getScoreSnapshotNumbers(this.state);
  }
}
