# CONTRATO OPERACIONAL DE PRNG CANÔNICO PARA O POOL C5-MEMORY
**Documento Normativo:** ic2-canonical-pool-prng-contract.json  
**Versão:** 1.0.0  
**Algoritmo Escolhido:** Mulberry32  
**Status:** CONGELADO PARA INTEGRAÇÃO  

---

## 1. Justificativa Técnica
O algoritmo **Mulberry32** foi selecionado para reconstrução determinística do pool de 500 candidatos C5-Memory com base exclusivamente em critérios objetivos de engenharia de software:
1. **Determinismo rigoroso em JavaScript:** utiliza apenas operadores inteiros de 32 bits (`>>> 0`, `Math.imul`, `^`), produzindo exatamente o mesmo fluxo em qualquer motor ECMAScript (Node.js/V8, Chromium/V8, Safari/JavaScriptCore, Firefox/SpiderMonkey).
2. **Estado compacto:** possui um único registro de 32 bits de estado, sem tabelas estáticas ou buffers compartilhados, eliminando vazamento de estado entre execuções.
3. **Alto desempenho:** gera as 12.000 palavras necessárias para 500 candidatos em frações de milissegundo (~0.2ms).
4. **Alinhamento arquitetural:** já integra o código de testes do motor C5-1.0.0 (`src/c5/random.ts`).

## 2. Especificação da Transição e Palavra de Saída
```ts
function createMulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

## 3. Contrato de Consumo de Palavras
* Cada candidato C5 requer exatamente 1 permutação de 25 dezenas via Fisher-Yates.
* O loop de Fisher-Yates executa de `i = 24` até `i = 1` (24 iterações).
* Cada candidato consome exatamente **24 palavras**.
* Para o pool de K = 500 candidatos, são consumidas exatamente **12.000 palavras** em ordem sequencial.
* O candidato no índice canônico `k` (0 <= k < 500) consome as palavras de `k * 24` até `k * 24 + 23`.
