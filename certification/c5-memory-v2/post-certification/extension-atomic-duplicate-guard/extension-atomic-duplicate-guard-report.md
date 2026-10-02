# C5-MEMORY-2.0.0 — EXTENSÃO PÓS-CERTIFICAÇÃO
# EXTENSÃO DO HARD BLOCK ATÔMICO DE REPETIÇÃO EXATA

**Identificador:** `POST_CERT_EXTENSION = C5_MEMORY_ATOMIC_EXACT_DUPLICATE_GUARD`  
**Autorização:** UI-1A.1 (Ordem Executiva)  
**Data:** 2026-10-02T13:17:38.703Z  
**Status Terminal:** `PASS`  

---

## 1. Contexto e Motivação Arquitetural

Na etapa UI-1A, a regra operacional de não repetição de jogos de 15 dezenas pertencentes a apostas confirmadas foi implementada com sucesso na Application Layer (`memoryBetOrchestrator.ts`).

A revisão executiva apontou com exatidão a lacuna residual:
- `HARD_BLOCK_AT_GENERATION = YES`
- `HARD_BLOCK_AT_ATOMIC_CONFIRMATION = NO`

Caso um chamador externo invocasse diretamente a transação de persistência (`confirmMemoryBetAtomic`), contornando a Application Layer, jogos duplicados poderiam ingressar no banco.

Por autorização expressa da UI-1A.1, a fronteira transacional de persistência (`src/storage/memoryTransaction.ts`) foi estendida de forma mínima e aditiva para incluir a validação autoritativa no commit.

---

## 2. Invariante Garantida

> Nenhum `ContestRecord` C5-Memory poderá ser confirmado se qualquer jogo de `draft.selectedC5` já existir no histórico canônico H observado pela própria transação autoritativa.

A validação foi inserida no **Passo 4.5** de `confirmMemoryBetAtomic()`, executada dentro da **mesma e única transação IndexedDB `readwrite`**:
1. Lê o estado completo do store `contestRecords`;
2. Reconstrói o histórico canônico H e valida freshness OCC (`historyRevision` e `historyFingerprint`);
3. Verifica colisão de concurso;
4. **Executa o Hard Block Atômico (Passo 4.5):** Converte cada jogo de $H$ e cada jogo de `draft.selectedC5` em máscara binária de 32 bits (`gameToBitmask`). Se houver colisão de 15 dezenas (independente da ordenação):
   - A transação é imediatamente abortada via `tx.abort()`;
   - A Promise é rejeitada com `ExactHistoryDuplicateBlockedError` (`code: EXACT_HISTORY_DUPLICATE_BLOCKED`);
   - Nenhum registro é gravado e a revisão não avança.

---

## 3. Matriz de Testes da Extensão

| Cenário | Entrada | Comportamento Esperado | Resultado |
| :--- | :--- | :--- | :---: |
| **Teste A: Bypass Direto (1 jogo duplicado)** | Draft adulterado contornando orchestrator | Rejeição atômica + abort da transação | **PASS** |
| **Teste B: Ordem Permutada** | Jogo com dezenas em ordem reversa | Detecção idêntica via bitmask | **PASS** |
| **Teste C: 5 Jogos Duplicados** | Todos os 5 jogos já existentes em H | Rejeição com contagem 5 e lista de índices | **PASS** |
| **Teste D: Aposta Fresh Legítima** | Draft legítimo sem jogos em H | Confirmação bem-sucedida + status FROZEN | **PASS** |
| **Teste E: Defesa em Profundidade** | Chamada via `confirmMemoryDraft` | Bloqueio na Application Layer e Storage | **PASS** |
| **Controle Negativo** | Simulação sem o Passo 4.5 | Jogo duplicado entra no banco comprovando necessidade do guard | **PASS** |

---

## 4. Preservação da Run 001 e Ação 001

- **Integration Run 001:** Intacta (`SEALED`, `CERTIFIED_WITH_ERRATA`, Seal SHA-256 idêntico, 175/175 checksums OK).
- **Ação Pós-Certificação 001:** Intacta (9/9 checksums OK).
- **Núcleo Matemático C5-Memory:** 7/7 módulos estritamente congelados.
- **BUILD / LINT:** 0 erros.
