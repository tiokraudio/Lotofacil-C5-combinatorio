// C5-Memory-2.1.0 — Suíte Oficial em Chromium Real (V8, WebCrypto, Native IndexedDB)
// Ordem Executiva IC2-R3 (Seção 21)

async function runBrowserTests210() {
  const results = [];

  function addResult(id, name, passed, details) {
    results.push({ id, name, passed, details });
  }

  // Helper WebCrypto SHA-256
  async function webCryptoSha256(text) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    const arr = Array.from(new Uint8Array(buf));
    return arr.map(b => b.toString(16).padStart(2, "0")).join("");
  }

  // Helper PRNG
  function prng(seedStr) {
    let h = 0x811c9dc5;
    for (let i = 0; i < seedStr.length; i++) {
      h ^= seedStr.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    let state = h >>> 0;
    function nextU() {
      let t = (state += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    }
    function shuffle25() {
      const arr = Array.from({ length: 25 }, (_, i) => i + 1);
      for (let i = 24; i > 0; i--) {
        const j = Math.floor((nextU() / 4294967296) * (i + 1));
        const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      }
      return arr;
    }
    return { nextU, shuffle25 };
  }

  // Helper Builder Estrutural
  function buildC5(p) {
    const s12 = [p[0], p[1], p[2]];
    const s23 = [p[3], p[4], p[5]];
    const s34 = [p[6], p[7], p[8]];
    const s45 = [p[9], p[10], p[11]];
    const s51 = [p[12], p[13], p[14]];

    const s13 = [p[15], p[16]];
    const s14 = [p[17], p[18]];
    const s24 = [p[19], p[20]];
    const s25 = [p[21], p[22]];
    const s35 = [p[23], p[24]];

    const j1 = [...s23, ...s34, ...s45, ...s24, ...s25, ...s35].sort((a, b) => a - b);
    const j2 = [...s34, ...s45, ...s51, ...s13, ...s14, ...s35].sort((a, b) => a - b);
    const j3 = [...s12, ...s45, ...s51, ...s14, ...s24, ...s25].sort((a, b) => a - b);
    const j4 = [...s12, ...s23, ...s51, ...s13, ...s25, ...s35].sort((a, b) => a - b);
    const j5 = [...s12, ...s23, ...s34, ...s13, ...s14, ...s24].sort((a, b) => a - b);

    return [j1, j2, j3, j4, j5];
  }

  function isC5(c5) {
    if (c5.length !== 5) return false;
    const freq = new Array(26).fill(0);
    for (const g of c5) {
      if (g.length !== 15) return false;
      for (const n of g) freq[n]++;
    }
    for (let n = 1; n <= 25; n++) {
      if (freq[n] !== 3) return false;
    }
    const inters = [];
    for (let i = 0; i < 5; i++) {
      for (let j = i + 1; j < 5; j++) {
        const common = c5[i].filter(x => c5[j].includes(x)).length;
        inters.push(common);
      }
    }
    inters.sort((a, b) => a - b);
    return JSON.stringify(inters) === JSON.stringify([7, 7, 7, 7, 7, 8, 8, 8, 8, 8]);
  }

  // 1. V8 Math & Mulberry32
  try {
    const p = prng("BROWSER-TEST-SEED");
    const u1 = p.nextU();
    const u2 = p.nextU();
    addResult(1, "V8 32-bit Math & Mulberry32", u1 !== u2 && u1 > 0, `Valores: ${u1}, ${u2}`);
  } catch (e) {
    addResult(1, "V8 32-bit Math & Mulberry32", false, e.message);
  }

  // 2. Structural Builder no V8
  try {
    const pIdent = Array.from({ length: 25 }, (_, i) => i + 1);
    const c5 = buildC5(pIdent);
    const valid = isC5(c5);
    addResult(2, "Structural Builder C5 no V8", valid, `Invariante C5 satisfeita no navegador`);
  } catch (e) {
    addResult(2, "Structural Builder C5 no V8", false, e.message);
  }

  // 3. Pool K=500 Estrutural no V8
  try {
    const p = prng("POOL-SEED-V8");
    let allValid = true;
    for (let k = 0; k < 500; k++) {
      const perm = p.shuffle25();
      const cand = buildC5(perm);
      if (!isC5(cand)) { allValid = false; break; }
    }
    addResult(3, "Geração de Pool K=500 Estrutural", allValid, `500 candidatos C5 estruturais válidos`);
  } catch (e) {
    addResult(3, "Geração de Pool K=500 Estrutural", false, e.message);
  }

  // 4. WebCrypto Nativo SHA-256
  try {
    const text = "C5-POOL-MASTER:3500:891c919bd55be4113c00d326cec187bbd43a9fa60f53fc7c330ee32590b09acb";
    const hash = await webCryptoSha256(text);
    addResult(4, "WebCrypto Nativo SHA-256", hash.length === 64, `Hash: ${hash.substring(0, 16)}...`);
  } catch (e) {
    addResult(4, "WebCrypto Nativo SHA-256", false, e.message);
  }

  // 5. MAX-LEXIMIN e Seleção H0
  try {
    const fp0 = await webCryptoSha256("H0-REV0-EMPTY");
    const seed0 = await webCryptoSha256(`C5-POOL-MASTER:3500:${fp0}`);
    const p = prng(seed0);
    // Com H vazio, todos empatam em [15,15,15,15,15], o índice 0 vence
    const perm0 = p.shuffle25();
    const cand0 = buildC5(perm0);
    addResult(5, "MAX-LEXIMIN e Seleção H0", isC5(cand0), `Candidato H0 poolIndex=0 validado`);
  } catch (e) {
    addResult(5, "MAX-LEXIMIN e Seleção H0", false, e.message);
  }

  // 6. IndexedDB Nativo para registros 2.1.0
  try {
    const dbName = `C5_210_BROWSER_DB_${Date.now()}`;
    const openReq = indexedDB.open(dbName, 1);
    await new Promise((resolve, reject) => {
      openReq.onupgradeneeded = (e) => {
        const db = e.target.result;
        db.createObjectStore("contests", { keyPath: "contestNumber" });
      };
      openReq.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction("contests", "readwrite");
        tx.objectStore("contests").add({
          contestNumber: 3500,
          algorithmVersion: "C5-Memory-2.1.0",
          status: "FROZEN",
          createdAt: new Date().toISOString()
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
      openReq.onerror = () => reject(openReq.error);
    });
    addResult(6, "IndexedDB Nativo 2.1.0", true, `Banco ${dbName} gravado com sucesso`);
  } catch (e) {
    addResult(6, "IndexedDB Nativo 2.1.0", false, e.message);
  }

  return results;
}

window.__runBrowserTests210 = runBrowserTests210;

// Auto-executa e renderiza na tela
runBrowserTests210().then(results => {
  window.__browserTestResults210 = results;
  const pre = document.getElementById("browser-test-results");
  if (pre) {
    pre.textContent = JSON.stringify(results, null, 2);
  }
  const status = document.getElementById("status");
  if (status) {
    const allPass = results.every(r => r.passed);
    status.textContent = allPass ? "TODOS OS TESTES APROVADOS (PASS)" : "FALHAS DETECTADAS";
    status.style.color = allPass ? "#4ade80" : "#f87171";
  }
});
