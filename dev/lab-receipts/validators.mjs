// The lab's code half: validators over an extracted document (one
// responsibility: decide whether a proposed JSON is internally consistent AND
// complete for its document type). Every check is mechanical; none of them
// knows the ground truth.
//
// REQUIRED-by-type: a null or missing value where the document's tipo demands
// one is a FAILURE ("righe mancanti", "iban mancante", …) that triggers the
// re-ask — never a pass. An empty/null righe on a scontrino is exactly that.

/** "IT60X0542811101000000123456" → valid iff mod-97 of the rearranged form is 1. */
export function ibanValid(value) {
  const s = String(value ?? "").replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let rest = "";
  for (const c of rearranged) rest += c >= "A" && c <= "Z" ? String(c.charCodeAt(0) - 55) : c;
  let mod = 0;
  for (const chunk of rest.match(/.{1,9}/g) ?? []) mod = Number(String(mod) + chunk) % 97;
  return mod === 1;
}

/** Italian Partita IVA: Luhn-like check digit over the first ten digits. */
export function pivaValid(value) {
  const s = String(value ?? "").replace(/\s+/g, "");
  if (!/^\d{11}$/.test(s)) return false;
  let total = 0;
  for (let i = 0; i < 10; i += 1) {
    const d = Number(s[i]);
    if (i % 2 === 0) total += d;
    else {
      const doubled = d * 2;
      total += doubled > 9 ? doubled - 9 : doubled;
    }
  }
  return (10 - (total % 10)) % 10 === Number(s[10]);
}

/** Italian or ISO-ish printed dates → ISO, or null. "04/10/26" is dd/mm/yy. */
export function parseDate(value) {
  const s = String(value ?? "").trim().toLowerCase();
  const MONTHS = { gen: 1, feb: 2, mar: 3, apr: 4, mag: 5, giu: 6, lug: 7, ago: 8, set: 9, ott: 10, nov: 11, dic: 12 };
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return iso(year, +m[2], +m[1]);
  }
  m = s.match(/^(\d{1,2})\s+([a-z]{3})\.?\s+(\d{4})$/);
  if (m && MONTHS[m[2]]) return iso(+m[3], MONTHS[m[2]], +m[1]);
  return null;
}
const iso = (y, mo, d) => {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const candidate = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return new Date(`${candidate}T00:00:00Z`).toISOString().slice(0, 10) === candidate ? candidate : null;
};

/** The six tipo values the schema's enum admits. */
export const TIPI = ["scontrino", "bolletta_luce", "bolletta_gas", "bonifico", "bollettino", "ricevuta"];

/** Obvious printed variants → the enum value, or the raw string when it is
    already one of the six. Everything else returns null: unrecognized. */
export function recognizeTipo(value) {
  const s = String(value ?? "").trim().toLowerCase();
  if (TIPI.includes(s)) return s;
  if (s.includes("gas")) return "bolletta_gas";
  if (s.includes("energia elettrica") || s.includes("luce")) return "bolletta_luce";
  if (s.includes("bollett")) {
    // "bollettino" before "bolletta": both contain "bollett".
    return s.includes("ino") ? "bollettino" : s.includes("gas") ? "bolletta_gas" : "bolletta_luce";
  }
  if (s.includes("bonific")) return "bonifico";
  if (s.includes("scontrin")) return "scontrino";
  if (s.includes("ricevut") || s.includes("receipt") || s.includes("ticket")) return "ricevuta";
  return null;
}

/** What the document's own tipo owes: every listed field must be non-null.
    The map carries the DOC's values (not key names), so isMissing sees data. */
function requiredByType(doc) {
  const tipo = recognizeTipo(doc?.tipo);
  if (tipo === "bolletta_luce" || tipo === "bolletta_gas") {
    return { totale: doc.totale, scadenza: doc.scadenza, iban: doc.iban, pod_o_pdr: [doc.pod, doc.pdr] };
  }
  if (tipo === "bonifico" || tipo === "bollettino") {
    return { totale: doc.totale, iban: doc.iban };
  }
  // scontrino, ricevuta, anything else with printed line rows — and the
  // untyped case too: rows and total are what the sum check needs.
  return { totale: doc.totale, righe: doc.righe };
}

/**
 * All checks, one pass. Each failure names itself for the single re-ask.
 * Returns { failures: string[], parsed: {dataIso, scadenzaIso} }.
 */
export function validate(doc) {
  const failures = [];
  const isMissing = (v) => v === undefined || v === null || v === "" ||
    (Array.isArray(v) && v.length === 0);

  // REQUIRED by the document's own tipo — checked first: a field the check
  // needs but the proposal omits is a failure, not a pass. And the tipo
  // itself must be one of the six (variants mapped first), or nothing can be
  // required of the document — an invented tipo is the omission escape
  // reopened, so it fails on its own.
  const tipo = recognizeTipo(doc?.tipo);
  if (tipo === null) failures.push(`tipo non riconosciuto: "${doc?.tipo ?? ""}"`);
  const required = requiredByType(doc);
  for (const [name, value] of Object.entries(required)) {
    if (name === "pod_o_pdr") {
      if (isMissing(value[0]) && isMissing(value[1])) failures.push("per una bolletta serve il POD o il PDR");
      continue;
    }
    if (isMissing(value)) failures.push(`${name} mancante: questo documento deve averlo`);
  }

  const amounts = [
    doc?.totale,
    ...(Array.isArray(doc?.righe) ? doc.righe.map((r) => r?.importo) : []),
  ].filter((v) => typeof v === "number");
  if (amounts.some((v) => v < 0)) failures.push("un importo è negativo");

  if (typeof doc?.totale === "number" && Array.isArray(doc?.righe) && doc.righe.length >= 2) {
    const sum = Math.round(doc.righe.reduce((a, r) => a + (Number(r?.importo) ?? 0), 0) * 100) / 100;
    if (Math.abs(sum - doc.totale) > 0.01) {
      failures.push(`la somma delle righe (${sum.toFixed(2)}) non è il totale (${doc.totale.toFixed(2)})`);
    }
  }

  if (doc?.iban != null && doc.iban !== "" && !ibanValid(doc.iban)) {
    failures.push("l'IBAN non supera il controllo mod-97");
  }
  if (doc?.piva != null && doc.piva !== "" && !pivaValid(doc.piva)) {
    failures.push("la partita IVA non supera il suo codice di controllo");
  }

  const FAR_FUTURE = new Date(new Date().getFullYear() + 1, 11, 31);
  const parsed = {};
  for (const [key, isoKey] of [["data", "dataIso"], ["scadenza", "scadenzaIso"]]) {
    const value = doc?.[key];
    if (value == null || value === "") continue;
    const parsedIso = parseDate(value);
    if (parsedIso === null) {
      failures.push(`la ${key} "${value}" non è una data leggibile`);
      continue;
    }
    parsed[isoKey] = parsedIso;
    if (new Date(parsedIso) > FAR_FUTURE) failures.push(`la ${key} ${parsedIso} è troppo nel futuro`);
  }
  return { failures, parsed };
}
