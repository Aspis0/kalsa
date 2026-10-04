// The lab's code half: validators over an extracted document (one
// responsibility: decide whether a proposed JSON is internally consistent).
// Every check is mechanical; none of them knows the ground truth.

/** "IT60X0542811101000000123456" → valid iff mod-97 of the rearranged form is 1. */
export function ibanValid(value) {
  const s = String(value ?? "").replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let rest = "";
  for (const c of rearranged) rest += c >= "A" && c <= "Z" ? String(c.charCodeAt(0) - 55) : c;
  // mod 97 over the decimal string, in 9-digit windows.
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
  // A real calendar date: 31/02 must fail, not silently become March.
  return new Date(`${candidate}T00:00:00Z`).toISOString().slice(0, 10) === candidate ? candidate : null;
};

/**
 * All checks, one pass. Each failure names itself for the single re-ask.
 * Returns { failures: string[], parsed: {dataIso, scadenzaIso} }.
 */
export function validate(doc) {
  const failures = [];
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
  if (doc?.iban != null && doc.iban !== "") {
    if (!ibanValid(doc.iban)) failures.push("l'IBAN non supera il controllo mod-97");
  }
  if (doc?.piva != null && doc.piva !== "") {
    if (!pivaValid(doc.piva)) failures.push("la partita IVA non supera il suo codice di controllo");
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
