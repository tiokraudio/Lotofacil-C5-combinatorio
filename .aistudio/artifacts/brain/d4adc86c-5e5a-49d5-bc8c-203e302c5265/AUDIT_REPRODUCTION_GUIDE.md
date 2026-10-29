# GUIA DE REPRODUÇÃO TÉCNICA E AUDITORIA INDEPENDENTE
## C5-Memory 2.1.0 — UI 2.0 e Camada de Aplicação

Este guia fornece instruções determinísticas para que uma equipe ou IA coordenadora independente possa extrair, instalar, auditar, testar e executar a aplicação C5-Memory 2.1.0 a partir do pacote auditável.

---

### 1. Requisitos do Sistema

- **Node.js:** Versão `>= 20.0.0` (Ambiente homologado: `v22.23.3`).
- **Gerenciador de Pacotes:** `npm` `>= 9.0.0` (Ambiente homologado: `10.9.9`) ou `bun` `>= 1.1.0`.
- **Sistema Operacional:** Linux, macOS ou Windows (com suporte a ESM/POSIX).

---

### 2. Extração do Pacote de Auditoria

O pacote compactado oficial localiza-se em:
`/app/applet/public/c5-memory-ui2-audit-package.tar.gz`

Para extrair em um diretório limpo de auditoria:

```bash
mkdir -p /tmp/c5-memory-audit
tar -xzf /app/applet/public/c5-memory-ui2-audit-package.tar.gz -C /tmp/c5-memory-audit
cd /tmp/c5-memory-audit
```

---

### 3. Instalação de Dependências

No diretório extraído, execute:

```bash
npm ci
# ou: npm install
```

---

### 4. Execução dos Testes Automatizados

O projeto utiliza `tsx` para execução de testes TypeScript sem etapa prévia de transpilação:

```bash
# 1. Suíte de Verificação das Correções Bloqueantes de Auditoria (P0: Isolamento de Fixtures, Bloqueio Transacional e Imutabilidade)
npx tsx src/c5-memory/testing/auditFixesVerification.test.ts

# 2. Suíte Integrada do Ciclo de Vida da Aplicação (UI 2.0)
npx tsx src/c5-memory/testing/integratedApplicationLifecycle.test.ts

# 3. Suíte de Hardening e Compatibilidade Semântica (2.0.0 e 2.1.0)
npx tsx src/c5-memory/testing/hardeningVerificationSuite.test.ts

# 4. Suíte de Analytics e Integridade do Painel (UI-1D)
npx tsx src/c5-memory/analytics/tests/ui1dAnalytics.test.ts

# 5. Suíte de Validação de Regras de Negócio e Entrega
npx tsx src/c5-memory/testing/applicationDeliveryValidation.test.ts

# 6. Suíte de Dupla Persistência e Controles Negativos
npx tsx src/storage/tests/crossStoreIntegrity.test.ts
```

*Todos os comandos acima foram executados com saída de código 0 (PASS).*

---

### 5. Verificação de Tipagem Estrita e Compilação

Para auditar que não há erros de tipagem TypeScript ou imports ausentes:

```bash
# Verificação estrita sem emissão
npx tsc --noEmit

# Compilação de Produção com Vite
npm run build
```

---

### 6. Execução da Aplicação Local

Para iniciar o servidor de desenvolvimento:

```bash
npm run dev
```

A aplicação estará acessível em: `http://localhost:3000`.

---

### 7. Verificação dos Principais Fluxos na Interface

1. **Painel Operacional (`/` ou aba "Painel"):**
   - Inicialização limpa: a base de produção inicia zerada (0 concursos fictícios, R$ 0,00 de custo, saldo e prêmios).
   - Dados de demonstração são puramente opt-in através do botão "Carregar Demonstração", devidamente isolados da base canônica e identificados visualmente por banner âmbar.
   - Tarifas e prêmios oficiais da Lotofácil (Caixa Econômica Federal):
     * Aposta simples (15 dezenas): R$ 3,50 (regras 2025/2026) / R$ 3,00 (regras históricas 2024)
     * Conjunto C5 (5 apostas): R$ 17,50 por concurso (regras 2025/2026) / R$ 15,00 (regras 2024)
     * Prêmios fixos: 11 acertos (R$ 7,00 / R$ 6,00), 12 acertos (R$ 14,00 / R$ 12,00), 13 acertos (R$ 35,00 / R$ 30,00) por aposta premiada
     * Prêmios variáveis: 14 e 15 acertos tratados estritamente como Rateio Pendente até confirmação documental oficial, sem inventar valores fictícios.
   - Card de Próxima Ação recomendada (ex: gerar aposta para concurso disponível).
   - Tabela de distribuição completa 0..15 (a soma fecha exatamente no total de jogos apurados).
   - Balanço financeiro consolidado e ROI explicitado.
2. **Gerador C5-Memory (Aba "Gerador C5"):**
   - Clicar em "Gerar C5 (Memory-2.1.0)".
   - Observar a transição para `PREVIEW` com avaliação de K=500 candidatos e perfil MAX-LEXIMIN.
   - Clicar em "Confirmar e Congelar Aposta (SHA-256)".
   - Observar o status `FROZEN`, o hash SHA-256 gerado e os botões "Copiar Jogos", "Baixar TXT" e "Imprimir".
3. **Conferência Oficial (Aba "Conferência"):**
   - Selecionar o concurso congelado ou apurado.
   - Selecionar 15 dezenas no grid de 25 bolas (ou clicar em "Buscar Resultado Online").
   - Campo explícito para identificação do conferente/operador (`operatorId`) e checkbox mandatório de confirmação humana.
   - Clicar em "Salvar Apuração Oficial".
   - Conferir a indicação correta da procedência (`API_TERCEIROS`, `API_LOTERIAS` ou `MANUAL_CONFERENCE`). APIs intermediárias de terceiros são estritamente categorizadas como `API_TERCEIROS`, nunca como API Caixa Oficial.
   - Rateios de 14 e 15 acertos são mantidos como `pendingRateio: true` e não compõem prêmio confirmado até homologação comprovada.
   - Tratamento financeiro de rateios mistos:
     * Concurso 3104 (vetor [14, 13, 11, 10, 9]): Preserva integralmente R$ 36,00 em prêmios fixos históricos confirmados (R$ 30,00 por 13 acertos + R$ 6,00 por 11 acertos). A aposta de 14 acertos permanece pendente de rateio (`pendingRateio: true`). Custo histórico preservado em R$ 15,00.
     * Concurso 3100 (vetor [15, 13, 12, 11, 10]): Preserva integralmente R$ 48,00 em prêmios fixos históricos confirmados (R$ 30,00 por 13 + R$ 12,00 por 12 + R$ 6,00 por 11). A aposta de 15 acertos permanece pendente de rateio (`pendingRateio: true`). Saldo líquido confirmado: +R$ 33,00 (R$ 48,00 - R$ 15,00); ROI confirmado: +220,00%. Distingue-se expressamente de concursos com apenas 15 acertos isolados sem bilhetes fixos (que confirmam R$ 0,00 até homologação).
   - Recálculo Autoritativo e Imunidade a Acertos Persistidos Inconsistentes (`getAuthoritativeHits`):
     * Valida rigorosamente que apostas e resultado contêm 15 dezenas inteiras, únicas e no intervalo [1, 25].
     * Na presença de qualquer invalidade, retorna erro estrito (`MISSING_GAMES`, `INVALID_GAME_STRUCTURE`, `MISSING_OFFICIAL_RESULT`, `INVALID_OFFICIAL_RESULT_STRUCTURE`, `UNVERIFIED_PROVENANCE`, `UNCONFIRMED_THIRD_PARTY_RESULT`, `UNCONFIRMED_MANUAL_RESULT`, `UNCONFIRMED_RESULT`), nunca recorrendo a dados persistidos adulterados.
   - Validação documental rigorosa e isolamento estrito de fixtures (`verifyOfficialCaixaProof`):
     * Fixtures históricas (`isFixture === true`): sumariamente rejeitadas por `verifyOfficialCaixaProof()` com código `HISTORICAL_FIXTURE_REJECTED`. O repositório canônico de fixtures (`CAIXA_HISTORICAL_FIXTURE_REGISTRY`) destina-se exclusivamente a testes automatizados com mocks.
     * Repositório Oficial de Produção (`CAIXA_OFFICIAL_PROOF_REGISTRY`): inicializado estritamente como objeto congelado vazio (`Object.freeze({})`). Provas oficiais autênticas nunca são criadas de forma estática no código-fonte.
     * Autenticação Documental: a ausência de infraestrutura externa independente com validação de assinatura digital ICP-Brasil classifica qualquer documento de portal como `OFFICIAL_SOURCE_RETRIEVED_UNVERIFIED`, mantendo o rateio de 14 e 15 acertos estritamente PENDENTE (`pendingRateio: true`).
     * Fixtures em `prizeBreakdown`: nunca inflam `totalPrize`, saldo ou ROI confirmados.
     * Tentativas de elevação indevida (ex: adulteração local de `isFixture: false` ou `isAutonomousOriginProven: true`) são sumariamente barradas (`UNVERIFIED_OFFICIAL_CLAIM`).
     * Entradas manuais válidas operam legitimamente sob `MANUAL_ENTRY` com operador e data de conferência, sem qualquer confusão com prova oficial da Caixa.
   - Bloqueio Transacional Pré-Persistência e Homologação Financeira (`scoreContestAtomic210` — Quinta e Sexta Rodadas):
     * Para resultados de intermediários de terceiros (`API_TERCEIROS`, `API_LOTERIAS`) e conferência manual (`MANUAL_CONFERENCE`), a transação no IndexedDB valida prévia e atomicamente antes de qualquer escrita ou homologação:
       1. `resultConfirmed === true` na operação atual (`options`), sem aceitar silenciosamente flags antigas do registro;
       2. `resultConfirmedBy` não nulo, não vazio após `trim()`;
       3. `resultConfirmedAt` string ISO 8601 com formato rigoroso e timestamp numérico válido;
       4. Cada uma das 15 dezenas do resultado oficial deve ser inteira no intervalo [1, 25] sem repetição;
       5. Cada aposta no concurso deve ser validada por `validateLotofacilBet` (exatamente 15 dezenas inteiras [1..25] sem duplicatas);
       6. **P1-1 (Sexta Rodada) — Distinção Explícita de Estado Financeiro**: Se o resultado não estiver homologado (`resultConfirmed !== true` ou metadados ausentes), o concurso é gravado com status `COMPLETED`, porém com `financialStatus: "PENDING_HOMOLOGATION"` (em oposição a `"HOMOLOGATED"`), `hasPendingVariableRateio: true`, `resultConfirmed: false`, `totalPrize = 0.00` e cada faixa premiada no breakdown com `pendingRateio: true`, `unitValue: undefined` e `totalValue: 0.00`. Nenhum prêmio (nem fixo nem variável) é somado ao balanço confirmado. Quando devidamente homologado posteriormente, transiciona para `financialStatus: "HOMOLOGATED"` preservando o custo histórico sem qualquer duplicação;
       7. **P0-1 (Sexta Rodada) — Vínculo Mandatório de Identificadores**: Para cada entrada manual de rateio (`MANUAL_ENTRY`), exige obrigatoriamente `contestNumber === contestNumber` do concurso em apuração e `tier === h` correspondendo à faixa exata. Campos ausentes, `undefined`, tipos incorretos ou divergências são categoricamente rejeitados com rollback total. O valor financeiro é estritamente recalculado a partir das apostas reais (`count * validatedUnitValue`), sem confiar em `totalValue`, `count` ou `totalPrize` legados;
       8. **P0-2 (Sexta Rodada) — Eliminação de Rota Alternativa**: A rota legada `options.prizeValues[h]` para faixas variáveis de rateio é categoricamente rejeitada (`LEGACY_PRIZE_VALUES_REJECTED`), exigindo submissão pelo canal validado com metadados completos;
       9. **P1-2 (Sexta Rodada) — Auditoria Transacional no Mesmo Store**: Toda operação bem-sucedida de `scoreContestAtomic210()` grava um evento de auditoria no store `auditEvents` na mesma transação IndexedDB (`["contests", "auditEvents"]`). Em caso de falha ou abortamento (`tx.abort()`), ambos os stores sofrem rollback atômico e nada é persistido;
       10. **P2 (Sexta Rodada) — Validação Estrita de ISO 8601**: Validação por expressão regular rigorosa (`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})# GUIA DE REPRODUÇÃO TÉCNICA E AUDITORIA INDEPENDENTE
## C5-Memory 2.1.0 — UI 2.0 e Camada de Aplicação

Este guia fornece instruções determinísticas para que uma equipe ou IA coordenadora independente possa extrair, instalar, auditar, testar e executar a aplicação C5-Memory 2.1.0 a partir do pacote auditável.

---

### 1. Requisitos do Sistema

- **Node.js:** Versão `>= 20.0.0` (Ambiente homologado: `v22.23.3`).
- **Gerenciador de Pacotes:** `npm` `>= 9.0.0` (Ambiente homologado: `10.9.9`) ou `bun` `>= 1.1.0`.
- **Sistema Operacional:** Linux, macOS ou Windows (com suporte a ESM/POSIX).

---

### 2. Extração do Pacote de Auditoria

O pacote compactado oficial localiza-se em:
`/app/applet/public/c5-memory-ui2-audit-package.tar.gz`

Para extrair em um diretório limpo de auditoria:

```bash
mkdir -p /tmp/c5-memory-audit
tar -xzf /app/applet/public/c5-memory-ui2-audit-package.tar.gz -C /tmp/c5-memory-audit
cd /tmp/c5-memory-audit
```

---

### 3. Instalação de Dependências

No diretório extraído, execute:

```bash
npm ci
# ou: npm install
```

---

### 4. Execução dos Testes Automatizados

O projeto utiliza `tsx` para execução de testes TypeScript sem etapa prévia de transpilação:

```bash
# 1. Suíte de Verificação das Correções Bloqueantes de Auditoria (P0: Isolamento de Fixtures, Bloqueio Transacional e Imutabilidade)
npx tsx src/c5-memory/testing/auditFixesVerification.test.ts

# 2. Suíte Integrada do Ciclo de Vida da Aplicação (UI 2.0)
npx tsx src/c5-memory/testing/integratedApplicationLifecycle.test.ts

# 3. Suíte de Hardening e Compatibilidade Semântica (2.0.0 e 2.1.0)
npx tsx src/c5-memory/testing/hardeningVerificationSuite.test.ts

# 4. Suíte de Analytics e Integridade do Painel (UI-1D)
npx tsx src/c5-memory/analytics/tests/ui1dAnalytics.test.ts

# 5. Suíte de Validação de Regras de Negócio e Entrega
npx tsx src/c5-memory/testing/applicationDeliveryValidation.test.ts

# 6. Suíte de Dupla Persistência e Controles Negativos
npx tsx src/storage/tests/crossStoreIntegrity.test.ts
```

*Todos os comandos acima foram executados com saída de código 0 (PASS).*

---

### 5. Verificação de Tipagem Estrita e Compilação

Para auditar que não há erros de tipagem TypeScript ou imports ausentes:

```bash
# Verificação estrita sem emissão
npx tsc --noEmit

# Compilação de Produção com Vite
npm run build
```

---

### 6. Execução da Aplicação Local

Para iniciar o servidor de desenvolvimento:

```bash
npm run dev
```

A aplicação estará acessível em: `http://localhost:3000`.

---

### 7. Verificação dos Principais Fluxos na Interface

1. **Painel Operacional (`/` ou aba "Painel"):**
   - Inicialização limpa: a base de produção inicia zerada (0 concursos fictícios, R$ 0,00 de custo, saldo e prêmios).
   - Dados de demonstração são puramente opt-in através do botão "Carregar Demonstração", devidamente isolados da base canônica e identificados visualmente por banner âmbar.
   - Tarifas e prêmios oficiais da Lotofácil (Caixa Econômica Federal):
     * Aposta simples (15 dezenas): R$ 3,50 (regras 2025/2026) / R$ 3,00 (regras históricas 2024)
     * Conjunto C5 (5 apostas): R$ 17,50 por concurso (regras 2025/2026) / R$ 15,00 (regras 2024)
     * Prêmios fixos: 11 acertos (R$ 7,00 / R$ 6,00), 12 acertos (R$ 14,00 / R$ 12,00), 13 acertos (R$ 35,00 / R$ 30,00) por aposta premiada
     * Prêmios variáveis: 14 e 15 acertos tratados estritamente como Rateio Pendente até confirmação documental oficial, sem inventar valores fictícios.
   - Card de Próxima Ação recomendada (ex: gerar aposta para concurso disponível).
   - Tabela de distribuição completa 0..15 (a soma fecha exatamente no total de jogos apurados).
   - Balanço financeiro consolidado e ROI explicitado.
2. **Gerador C5-Memory (Aba "Gerador C5"):**
   - Clicar em "Gerar C5 (Memory-2.1.0)".
   - Observar a transição para `PREVIEW` com avaliação de K=500 candidatos e perfil MAX-LEXIMIN.
   - Clicar em "Confirmar e Congelar Aposta (SHA-256)".
   - Observar o status `FROZEN`, o hash SHA-256 gerado e os botões "Copiar Jogos", "Baixar TXT" e "Imprimir".
3. **Conferência Oficial (Aba "Conferência"):**
   - Selecionar o concurso congelado ou apurado.
   - Selecionar 15 dezenas no grid de 25 bolas (ou clicar em "Buscar Resultado Online").
   - Campo explícito para identificação do conferente/operador (`operatorId`) e checkbox mandatório de confirmação humana.
   - Clicar em "Salvar Apuração Oficial".
   - Conferir a indicação correta da procedência (`API_TERCEIROS`, `API_LOTERIAS` ou `MANUAL_CONFERENCE`). APIs intermediárias de terceiros são estritamente categorizadas como `API_TERCEIROS`, nunca como API Caixa Oficial.
   - Rateios de 14 e 15 acertos são mantidos como `pendingRateio: true` e não compõem prêmio confirmado até homologação comprovada.
   - Tratamento financeiro de rateios mistos:
     * Concurso 3104 (vetor [14, 13, 11, 10, 9]): Preserva integralmente R$ 36,00 em prêmios fixos históricos confirmados (R$ 30,00 por 13 acertos + R$ 6,00 por 11 acertos). A aposta de 14 acertos permanece pendente de rateio (`pendingRateio: true`). Custo histórico preservado em R$ 15,00.
     * Concurso 3100 (vetor [15, 13, 12, 11, 10]): Preserva integralmente R$ 48,00 em prêmios fixos históricos confirmados (R$ 30,00 por 13 + R$ 12,00 por 12 + R$ 6,00 por 11). A aposta de 15 acertos permanece pendente de rateio (`pendingRateio: true`). Saldo líquido confirmado: +R$ 33,00 (R$ 48,00 - R$ 15,00); ROI confirmado: +220,00%. Distingue-se expressamente de concursos com apenas 15 acertos isolados sem bilhetes fixos (que confirmam R$ 0,00 até homologação).
   - Recálculo Autoritativo e Imunidade a Acertos Persistidos Inconsistentes (`getAuthoritativeHits`):
     * Valida rigorosamente que apostas e resultado contêm 15 dezenas inteiras, únicas e no intervalo [1, 25].
     * Na presença de qualquer invalidade, retorna erro estrito (`MISSING_GAMES`, `INVALID_GAME_STRUCTURE`, `MISSING_OFFICIAL_RESULT`, `INVALID_OFFICIAL_RESULT_STRUCTURE`, `UNVERIFIED_PROVENANCE`, `UNCONFIRMED_THIRD_PARTY_RESULT`, `UNCONFIRMED_MANUAL_RESULT`, `UNCONFIRMED_RESULT`), nunca recorrendo a dados persistidos adulterados.
   - Validação documental rigorosa e isolamento estrito de fixtures (`verifyOfficialCaixaProof`):
     * Fixtures históricas (`isFixture === true`): sumariamente rejeitadas por `verifyOfficialCaixaProof()` com código `HISTORICAL_FIXTURE_REJECTED`. O repositório canônico de fixtures (`CAIXA_HISTORICAL_FIXTURE_REGISTRY`) destina-se exclusivamente a testes automatizados com mocks.
     * Repositório Oficial de Produção (`CAIXA_OFFICIAL_PROOF_REGISTRY`): inicializado estritamente como objeto congelado vazio (`Object.freeze({})`). Provas oficiais autênticas nunca são criadas de forma estática no código-fonte.
     * Autenticação Documental: a ausência de infraestrutura externa independente com validação de assinatura digital ICP-Brasil classifica qualquer documento de portal como `OFFICIAL_SOURCE_RETRIEVED_UNVERIFIED`, mantendo o rateio de 14 e 15 acertos estritamente PENDENTE (`pendingRateio: true`).
     * Fixtures em `prizeBreakdown`: nunca inflam `totalPrize`, saldo ou ROI confirmados.
     * Tentativas de elevação indevida (ex: adulteração local de `isFixture: false` ou `isAutonomousOriginProven: true`) são sumariamente barradas (`UNVERIFIED_OFFICIAL_CLAIM`).
     * Entradas manuais válidas operam legitimamente sob `MANUAL_ENTRY` com operador e data de conferência, sem qualquer confusão com prova oficial da Caixa.
) além de verificação de timestamp numérico válido em `Date.parse()`.
     * `isHumanConferenceValid()` é exportada como função canônica única compartilhada entre persistência e analytics.
4. **Histórico de Concursos (Aba "Histórico"):**
   - Filtrar por status ("Todos", "Em andamento", "Apurados") ou por mês (YYYY-MM).
   - Toggle para visualização opcional de registros de demonstração (ocultos por padrão).
   - Clicar em "Exportar CSV" para baixar planilha com dados contábeis.
   - Clicar em "Copiar Relatório" para copiar demonstrativo em formato texto para clipboard.
5. **Auditoria Criptográfica (Aba "Auditoria"):**
   - Clicar em "Recalcular Auditoria".
   - Observar a recomputação do hash SHA-256 de todas as apostas em banco e conferência da memória cumulativa H.

---

### 8. Hashes Criptográficos Oficiais (SHA-256) — Décima Segunda Rodada de Auditoria

| Arquivo / Artefato | Tamanho (Bytes) | SHA-256 Oficial |
| :--- | :--- | :--- |
| `src/storage/storageManager210.ts` | 64.498 | `c0a9f791340d7658e4ccc6bb53680dcd690634d2b037d8ebe4076828261a5f05` |
| `src/c5-memory/types.ts` | 6.971 | `71edbbfe5792f9f8a7d5d247b4ff7428c940683cbb204d65a36d5c8aa80c7f8d` |
| `src/c5-memory/analytics/types.ts` | 5.086 | `73df427a14abb98e703ae344c72046e3c4dd6cd3a9a25b4253d72ea7a120a25b` |
| `src/c5-memory/analytics/c5Analytics.ts` | 47.190 | `0edc132eb50240092bf15a0b439935b843d8a12715688a280019a4182d5fbe46` |
| `src/components/C5DashboardView.tsx` | 48.164 | `d25df4d1ff396cd8573ef73d5a5ce6260d9dbf8b46dd371101c899bc524464f7` |
| `src/components/HistoryView.tsx` | 36.562 | `5dfd47879ec1f46b1c4aefa161e391dbd3b51f51a8a6d07ec4125f260245b6d9` |
| `src/c5-memory/testing/auditFixesVerification.test.ts` | 298.771 | `4ff8451ea95c89f00dabcef3769e909eea2c9ffef03d8a076f5fbc223e67815a` |

---

### 9. Diferenciação de Ambientes e Distinção entre Testes

- **Testes Executados no Ambiente Original:**
  1. `auditFixesVerification.test.ts` (Blocos 1 ao 8.17 completos, incluindo todos os 9 testes negativos e de isolamento da Décima Segunda Rodada: P0.1 Bloqueio de injeção de registros em produção; P0.2 Validação estrita preliminar de operandos antes da comparação; P0.3 Endurecimento documental e criptográfico de URLs, hostnames e credenciais; P0.4 Isolamento integral de saldo, ROI, exportações CSV e relatório formatado; P1 Testes negativos obrigatórios) — **EXECUTADO (PASS, 100% de sucesso, código de retorno 0)**
  2. `integratedApplicationLifecycle.test.ts` (Blocos 1 ao 5 completos) — **EXECUTADO (PASS, código 0)**
  3. `hardeningVerificationSuite.test.ts` (Testes 1 ao 4) — **EXECUTADO (PASS, código 0)**
  4. `applicationDeliveryValidation.test.ts` (Testes 1 ao 4) — **EXECUTADO (PASS, código 0)**
  5. `recert02IC0NegativeControls.test.ts` (Controles Negativos 1 ao 8) — **EXECUTADO (PASS, código 0)**
  6. `npx tsc --noEmit` (tipagem estrita TypeScript sem erros) — **EXECUTADO (PASS, 0 erros)**
  7. `npm run build` (build Vite de produção) — **EXECUTADO (PASS, compilação bem-sucedida)**

- **Testes Apenas Preparados (E2E de Navegador e Auditoria Independente Externa):**
  - Testes E2E com navegador real automatizado (Puppeteer / Playwright) continuam **apenas preparados**, pois o ambiente de sandbox não dispõe de binários de navegador (`chromium` / `google-chrome`). Toda a validação da camada web foi realizada via montagem de componentes React, testes de ciclo de vida e renderização de DTOs.
  - **AVISO FORMAL DE AUDITORIA: STATUS OBRIGATÓRIO — AUDITORIA ABERTA.** A auditoria independente **NÃO foi declarada encerrada** por este agente. As declarações deste relatório constituem evidências técnicas submetidas e a auditoria externa permanece **ABERTA** para validação e conferência autônoma pela equipe independente a partir do pacote e manifesto criptografados disponibilizados para transferência manual.

- **Limitação de Oráculo ICP-Brasil:**
  - A homologação autônoma de fontes externas oficiais Caixa depende de verificação criptográfica de cadeia de confiança ICP-Brasil que não existe localmente; por esse motivo de integridade, rateios oficiais sem prova externa verificada permanecem estritamente identificados como pendentes (`hasPendingVariableRateio: true`), confirmando R$ 0,00 no saldo e ROI oficial até comprovação documental independente ou registro manual auditado.
