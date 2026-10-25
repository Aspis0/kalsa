// Generates the lab's SYNTHETIC Italian documents: renders 40 varied documents
// (supermarket scontrini, bollette luce/gas, bonifico/bollettino slips) to
// clean PNGs and writes each one's ground truth beside it, BEFORE any
// degradation. Traps are seeded and recorded in the ground truth: ~15% of
// documents print a total their line items do not sum to, ~10% print an IBAN
// whose mod-97 checksum fails, and every date format is drawn from the three
// the owner named. Run from anywhere: node gen-docs.mjs <out-dir> [count].
// Playwright resolves from chat/node_modules the way dev/smoke-react.mjs
// resolves esbuild — the repo has no root node_modules.
import { chromium } from "../../chat/node_modules/@playwright/test/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ── seeded RNG so the dataset is reproducible from the seed alone ──────────
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
}
const r = rng(20261004);
const pick = (a) => a[Math.floor(r() * a.length)];
const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const money = (lo, hi) => Math.round((lo + r() * (hi - lo)) * 100) / 100;

// ── Italian check digits ────────────────────────────────────────────────────
/** Partita IVA: Luhn-like over the first 10 digits, check digit 11th. */
function pivaOk(digits11) {
  let total = 0;
  for (let i = 0; i < 10; i += 1) {
    const d = Number(digits11[i]);
    if (i % 2 === 0) total += d;
    else {
      const doubled = d * 2;
      total += doubled > 9 ? doubled - 9 : doubled;
    }
  }
  return (10 - (total % 10)) % 10 === Number(digits11[10]);
}
function makePiva() {
  for (;;) {
    let base = "";
    for (let i = 0; i < 10; i += 1) base += int(0, 9);
    let total = 0;
    for (let i = 0; i < 10; i += 1) {
      const d = Number(base[i]);
      if (i % 2 === 0) total += d;
      else {
        const doubled = d * 2;
        total += doubled > 9 ? doubled - 9 : doubled;
      }
    }
    const check = (10 - (total % 10)) % 10;
    if (pivaOk(base + check)) return base + check;
  }
}
/** An IBAN whose mod-97 is valid, built around a plausible Italian body. */
function makeIban() {
  const bban =
    String(int(10000, 99999)) + // ABI
    String(int(10000, 99999)) + // CAB
    String(int(10 ** 11, 10 ** 12 - 1)); // conto
  const rearranged = bban + "IT00";
  const asNumber = BigInt(
    rearranged.split("").map((c) => (c >= "A" && c <= "Z" ? String(c.charCodeAt(0) - 55) : c)).join(""),
  );
  const check = Number(98n - (asNumber % 97n));
  return `IT${String(check).padStart(2, "0")}${bban}`;
}
const ibanValid = (iban) => {
  const s = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^IT\d{2}[A-Z]\d{10}\d{12}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  const asNumber = BigInt(
    rearranged.split("").map((c) => (c >= "A" && c <= "Z" ? String(c.charCodeAt(0) - 55) : c)).join(""),
  );
  return asNumber % 97n === 1n;
};

// ── vocabularies (all fictional) ───────────────────────────────────────────
const STORES = ["SUPERMERCATO AURORA", "ALIMENTARI DA LUIGI", "MEGAPOINT SPA", "DAL 1962 ALIMENTARI", "SUPERMERCATO IL PUNTO", "FAMIGLIA COOPERATIVA", "CENTRO COMMERCIALE LE VETTE", "SPAZIO CASA ALIMENTARI"];
const UTILITIES = ["ELETTROSERVIZIO NORD SPA", "GASMERIDIANA ENERGIA", "LUMEN RETI ENERGIA SRL", "AXIAPOWER ITALIA", "VERDEGAS UTENZE"];
const CITIES = ["MILANO", "TORINO", "BOLOGNA", "FIRENZE", "PADOVA", "VERONA", "GENOVA", "TRENTO", "PARMA", "ANCONA"];
const PRODUCTS = [["Pasta gr.500", 0.8, 1.6], ["Pane casereccio", 1.2, 2.8], ["Latte parz. scremato 1L", 1.0, 1.5], ["Uova 6 pz.", 1.8, 2.9], ["Pomodori pelati 400g", 0.9, 1.7], ["Olio EVO 750ml", 4.5, 8.9], ["Caffe' macinato 250g", 2.2, 4.1], ["Biscotti frollini", 1.1, 2.4], ["Detersivo piatti 750ml", 1.4, 2.9], ["Carta igienica 10 rot.", 2.8, 5.2], ["Prosciutto crudo 100g", 2.5, 4.9], ["Mozzarella 125g", 0.9, 1.8], ["Riso carnaroli 1kg", 1.9, 3.4], ["Vino Chianti 750ml", 4.0, 9.5], ["Cioccolato fondente 100g", 1.3, 2.7], ["Acqua minerale 6x1.5L", 2.0, 3.8]];
const FONTS = ["'Helvetica Neue', Arial, sans-serif", "Georgia, 'Times New Roman', serif", "'Courier New', monospace", "Verdana, sans-serif", "'Times New Roman', serif"];

// ── ground-truth date in one of three printed shapes ───────────────────────
const MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
function drawDate() {
  const day = int(1, 28);
  const month = int(1, 12);
  const year = 2026;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const shape = pick(["dmy2", "dmon", "iso"]);
  const printed =
    shape === "dmy2"
      ? `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${String(year).slice(2)}`
      : shape === "dmon"
        ? `${day} ${MONTHS[month - 1]} ${year}`
        : iso;
  return { iso, printed };
}
const euro = (n) => n.toFixed(2).replace(".", ",");

// ── document builders: return { html, gt } ─────────────────────────────────
function scontrino() {
  const store = pick(STORES);
  const city = pick(CITIES);
  const piva = makePiva();
  const n = int(3, 8);
  const lines = [];
  for (let i = 0; i < n; i += 1) {
    const [name, lo, hi] = pick(PRODUCTS);
    lines.push({ name, qty: int(1, 3), price: money(lo, hi) });
  }
  const sum = Math.round(lines.reduce((a, l) => a + l.price * l.qty, 0) * 100) / 100;
  const date = drawDate();
  const time = `${String(int(8, 20)).padStart(2, "0")}:${String(int(0, 59)).padStart(2, "0")}`;
  return {
    html: `<div class="doc thermal"><h1>${store}</h1><p>${city} — SRL<br>P.IVA ${piva}<br>Scontrino n. ${int(100, 999)}/${int(1, 9)}</p><hr>${lines.map((l) => `<div class="row"><span>${l.name}${l.qty > 1 ? ` x${l.qty}` : ""}</span><span>${euro(l.price * l.qty)}</span></div>`).join("")}<hr><div class="row total"><span>TOTALE</span><span>€ ${euro(sum)}</span></div><p>IVA ${euro(Math.round(sum * 0.04 * 100) / 100)} (4%) — ${date.printed} ${time}<br>LOTTERIA: ${int(100000, 999999)} — GRAZIE E ARRIVEDERCI</p></div>`,
    gt: { kind: "scontrino", esercente: store, citta: city, piva, data: date.iso, data_stampata: date.printed, ora: time, righe: lines.map((l) => ({ descrizione: l.name, qta: l.qty, importo: Math.round(l.price * l.qty * 100) / 100 })), totale: sum, iva_aliquota: 4, valuta: "EUR" },
  };
}

function bolletta(type) {
  const fornitore = pick(UTILITIES);
  const piva = makePiva();
  const importo = money(38, 240);
  const date = drawDate();
  const due = drawDate();
  const iban = makeIban();
  const pod = type === "luce" ? `IT${int(100, 999)}E${String(int(10 ** 10, 10 ** 11 - 1))}` : `${int(10 ** 13, 10 ** 14 - 1)}`;
  const label = type === "luce" ? "POD" : "PDR";
  const kwh = type === "luce" ? int(150, 2200) : int(200, 3000);
  const unit = type === "luce" ? "kWh" : "Smc";
  return {
    html: `<div class="doc a4"><header><h1>${fornitore}</h1><p>P.IVA ${piva} — ${pick(CITIES)}</p></header><h2>Bolletta ${type === "luce" ? "di energia elettrica" : "del gas naturale"} n. ${int(4000000, 4999999)}</h2><table><tr><td>Cliente</td><td>MARIO ROSSI</td></tr><tr><td>${label}</td><td>${pod}</td></tr><tr><td>Periodo</td><td>${date.printed} — ${due.printed}</td></tr><tr><td>Consumo</td><td>${kwh} ${unit}</td></tr></table><div class="amount">TOTALE DA PAGARE: € ${euro(importo)}</div><p>Scadenza: ${due.printed}</p><p>Pagamento mediante addebito diretto SEPA<br>IBAN: ${iban.slice(0, 9)} ${iban.slice(9, 19)} ${iban.slice(19)}<br> ${importo > 100 ? "" : ""}Riferimenti: ${label} ${pod}</p><footer>Legenda: IMPOSTA — ACCISA — ONERI DI SISTEMA. Servizio clienti 800 ${int(100000, 999999)}.</footer></div>`,
    gt: { kind: `bolletta_${type}`, esercente: fornitore, piva, data: date.iso, data_stampata: date.printed, scadenza: due.iso, scadenza_stampata: due.printed, importo, iban, [label.toLowerCase()]: pod, consumo: kwh, valuta: "EUR" },
  };
}

function bonifico(kind) {
  const iban = makeIban();
  const importo = money(120, 3800);
  const date = drawDate();
  const beneficiary = pick(["AMMINISTRAZIONE CONDOMINIO LE MIMOSE", "SCUOLA MATERNA IL GIRASOLE", "ASSICURAZIONE VELOX SPA", "CONDOMINIO VIA VERDI 12", "CIRCOLO TENNIS LA COLLINA"]);
  const causale = pick(["Affitto ottobre", "Rata polizza RC auto", "Quota condominiale 2026", "Retta scolastica", "Saldo fattura " + int(100, 999)]);
  const slip =
    kind === "bonifico"
      ? `<div class="doc slip"><h1>BONIFICO SEPA</h1><table><tr><td>Ordinante</td><td>MARIO ROSSI</td></tr><tr><td>Beneficiario</td><td>${beneficiary}</td></tr><tr><td>IBAN beneficiario</td><td>${iban}</td></tr><tr><td>Importo</td><td>€ ${euro(importo)}</td></tr><tr><td>Data esecuzione</td><td>${date.printed}</td></tr><tr><td>Causale</td><td>${causale}</td></tr></table></div>`
      : `<div class="doc slip"><h1>BOLLETTINO POSTALE</h1><p>Conto corrente n. ${int(1000000, 9999999)}</p><p>Importo € ${euro(importo)} — Scadenza ${date.printed}</p><p>Intestato a ${beneficiary}<br>su IBAN ${iban}</p><p>Causale: ${causale}</p></div>`;
  return { html: slip, gt: { kind, esercente: beneficiary, data: date.iso, data_stampata: date.printed, importo, iban, causale, valuta: "EUR" } };
}

// ── the 40 documents with traps ─────────────────────────────────────────────
function buildAll() {
  const docs = [];
  for (let i = 0; i < 16; i += 1) docs.push(scontrino());
  for (let i = 0; i < 10; i += 1) docs.push(bolletta(i % 2 === 0 ? "luce" : "gas"));
  for (let i = 0; i < 4; i += 1) docs.push(bonifico("bonifico"));
  for (let i = 0; i < 2; i += 1) docs.push(bonifico("bollettino"));
  // 40 → pad with 8 more scontrini/bollette to reach exactly 40 if the mix above
  // fell short (it is 32; the owner said ~40).
  for (let i = docs.length; i < 40; i += 1) docs.push(i % 3 === 0 ? bolletta(i % 2 ? "luce" : "gas") : scontrino());

  // Traps, seeded and disjoint: 6 sum-traps on docs with righe, 4 IBAN-traps.
  const withLines = docs.map((d, i) => [d, i]).filter(([d]) => d.gt.righe);
  for (let t = 0; t < 6 && t < withLines.length; t += 1) {
    const [doc, idx] = withLines[Math.floor(r() * withLines.length)];
    if (doc.gt.trap) { t -= 1; continue; }
    const drift = pick([0.03, 0.10, 0.37, 0.50, 1.00, 1.37]);
    doc.gt.totale_stampata = Math.round((doc.gt.totale + drift) * 100) / 100;
    doc.gt.trap = "sum";
  }
  const withIban = docs.map((d, i) => [d, i]).filter(([d]) => d.gt.iban);
  for (let t = 0; t < 4; ) {
    const [doc] = withIban[Math.floor(r() * withIban.length)];
    if (doc.gt.trap) continue;
    // Corrupt one digit of the account: mod-97 must fail (asserted below).
    const pos = 12 + int(0, 11);
    const digit = (Number(doc.gt.iban[pos]) + int(1, 8)) % 10;
    doc.gt.iban_stampato = doc.gt.iban.slice(0, pos) + digit + doc.gt.iban.slice(pos + 1);
    if (ibanValid(doc.gt.iban_stampato)) continue;
    doc.gt.trap = "iban";
    t += 1;
  }
  // Apply the printed (trapped) values into the rendered HTML last.
  for (const doc of docs) {
    if (doc.gt.trap === "sum") {
      doc.html = doc.html.replace(/TOTALE<\/span><span>€ [\d.,]+/,
        `TOTALE</span><span>€ ${euro(doc.gt.totale_stampata)}`);
    }
    if (doc.gt.trap === "iban") {
      const broken = doc.gt.iban_stampato;
      doc.html = doc.html.replace(doc.gt.iban, broken);
      doc.html = doc.html.replace(doc.gt.iban, broken);
    }
  }
  return docs;
}

const CSS = `
  body { margin: 0; background: #fff; }
  .doc { display: inline-block; padding: 18px; color: #111; }
  .thermal { width: 320px; font-family: 'Courier New', monospace; font-size: 13px; }
  .thermal h1 { font-size: 15px; text-align: center; margin: 0 0 4px; }
  .thermal p { margin: 4px 0; text-align: center; }
  .a4 { width: 560px; font-family: Georgia, serif; font-size: 13px; }
  .a4 header h1 { font-size: 19px; margin: 0; }
  .a4 h2 { font-size: 15px; margin: 10px 0; }
  .a4 table { border-collapse: collapse; margin: 8px 0; }
  .a4 td { border: 1px solid #999; padding: 3px 8px; }
  .a4 .amount { font-size: 17px; font-weight: bold; margin: 10px 0; }
  .a4 footer { margin-top: 12px; font-size: 10px; color: #444; }
  .slip { width: 460px; font-family: Verdana, sans-serif; font-size: 12px; border: 2px solid #333; }
  .slip h1 { font-size: 15px; background: #eee; margin: 0; padding: 6px; }
  .slip table { width: 100%; border-collapse: collapse; }
  .slip td { padding: 4px 8px; border-bottom: 1px dashed #aaa; }
  .slip p { margin: 6px 8px; }
  .row { display: flex; justify-content: space-between; margin: 1px 0; }
  .row.total { font-weight: bold; font-size: 15px; margin-top: 4px; }
  hr { border: none; border-top: 1px dashed #333; }
`;

async function main() {
  const out = process.argv[2] ?? "/tmp/lab-receipts/clean";
  const count = Number(process.argv[3] ?? 40);
  mkdirSync(out, { recursive: true });
  const docs = buildAll().slice(0, count);
  // Vary the body font per document (the class fonts stay; a per-doc nudge
  // gives the mix the owner asked for without new templates).
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 700, height: 980 }, deviceScaleFactor: 2 });
  for (let i = 0; i < docs.length; i += 1) {
    const font = FONTS[i % FONTS.length];
    const gt = { id: `syn-${String(i).padStart(3, "0")}`, ...docs[i].gt };
    if (gt.totale !== undefined && gt.totale_stampata === undefined) gt.totale_stampata = gt.totale;
    if (gt.iban !== undefined && gt.iban_stampato === undefined) gt.iban_stampato = gt.iban;
    await page.setContent(`<html><body style="font-family:${font}"><style>${CSS}</style>${docs[i].html}</body></html>`, { waitUntil: "domcontentloaded" });
    const el = await page.$(".doc");
    await el.screenshot({ path: join(out, `${gt.id}.png`) });
    writeFileSync(join(out, `${gt.id}.json`), JSON.stringify(gt, null, 1));
  }
  await browser.close();
  const traps = docs.filter((d) => d.gt.trap).map((d) => d.gt.trap);
  console.log(`rendered ${docs.length} docs to ${out}; traps: sum=${traps.filter((t) => t === "sum").length} iban=${traps.filter((t) => t === "iban").length}`);
}

main();
