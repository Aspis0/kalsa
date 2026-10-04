// The lab's scorer (one responsibility: compare one extracted JSON against
// the ground truth, by pre-declared rules). It never sees the validators.
//
// Rules, declared before any model ran:
//  * amounts            the same coercion everywhere (A may deliver strings,
//                       B's grammar delivers numbers): strip currency symbols
//                       and spaces, Italian decimal comma → dot; then exact
//                       within ±0.01 against the PRINTED value (on trap
//                       documents the printed value is the truth of the
//                       paper; flagging it is condition C's job, scored
//                       separately).
//  * data / scadenza    the validators' own parser, then ISO string equality.
//  * esercente          case-insensitive trim equality.
//  * iban / piva / pod / pdr   normalized (spaces out) exact equality.
//  * righe              F1: a predicted item is a TP when some unmatched
//                       ground-truth item has importo within ±0.01 AND a
//                       name that shares a 4-character window (greedy).
//  * ABSENT vs WRONG    an absent field is an omission, never a wrong value.
//  * SILENT ERROR       a confidently DELIVERED field that is wrong —
//                       outcome "answer" and the field present-and-wrong.
//  * fully correct      every scored field delivered-and-right, righe
//                       complete (TP == all GT, no FP), no omissions.

import { parseDate } from "./validators.mjs";

const coerceAmount = (v) => {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;
  const s = v.replace(/[€\s]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const close = (a, b) => Math.abs(a - b) <= 0.011;
const norm = (s) => String(s ?? "").replace(/\s+/g, "").toUpperCase();

function itemsF1(predItems, gtItems) {
  const preds = (predItems ?? [])
    .map((i) => i && { descrizione: i.descrizione, importo: coerceAmount(i.importo) })
    .filter((i) => i && i.importo !== null);
  const gts = (gtItems ?? []).map((g) => ({ ...g }));
  let tp = 0;
  const taken = new Set();
  for (const p of preds) {
    let best = -1;
    for (let i = 0; i < gts.length; i += 1) {
      if (taken.has(i)) continue;
      if (!close(p.importo, gts[i].importo)) continue;
      const name = norm(p.descrizione);
      const gtName = norm(gts[i].descrizione);
      if (gtName.includes(name.slice(0, 4)) || name.includes(gtName.slice(0, 4)) ||
          gtName.split(/\s+/).some((w) => w.length >= 4 && name.includes(w))) { best = i; break; }
    }
    if (best !== -1) { taken.add(best); tp += 1; }
  }
  const fp = preds.length - tp;
  const fn = gts.length - tp;
  return { tp, fp, fn, f1: 2 * tp / (2 * tp + fp + fn) };
}

/** One field's verdict: delivered-right / delivered-wrong / omitted. */
function verdict(parsedValue, predicate) {
  if (parsedValue === undefined || parsedValue === null || parsedValue === "") return "omitted";
  return predicate() ? "right" : "wrong";
}

export function scoreDocument(parsed, gt) {
  const outcome = parsed?.__outcome ?? (parsed === null ? "malformed" : "answer");
  const fields = {};
  const amount = (key, target) => {
    const raw = parsed?.[key];
    const v = verdict(raw, () => close(coerceAmount(raw), target));
    fields[key] = v;
  };
  if (gt.totale !== undefined) amount("totale", gt.totale_stampata ?? gt.totale);
  const dateField = (key) => {
    const raw = parsed?.[key];
    fields[key] = verdict(raw, () => (parseDate(raw) ?? null) === gt[key]);
  };
  if (gt.data !== undefined) dateField("data");
  if (gt.kind.startsWith("bolletta") && gt.scadenza !== undefined) dateField("scadenza");
  const stringField = (key, target) => {
    const raw = parsed?.[key];
    fields[key] = verdict(raw, () => norm(raw) === norm(target));
  };
  if (gt.esercente !== undefined) stringField("esercente", gt.esercente);
  if (gt.piva !== undefined) stringField("piva", gt.piva);
  if (gt.iban !== undefined) stringField("iban", gt.iban_stampato ?? gt.iban);
  if (gt.pod !== undefined) stringField("pod", gt.pod);
  if (gt.pdr !== undefined) stringField("pdr", gt.pdr);
  let items = null;
  if (Array.isArray(gt.righe) || Array.isArray(gt.items)) {
    const gtItems = gt.righe ?? gt.items;
    items = itemsF1(Array.isArray(parsed?.righe) ? parsed.righe : [], gtItems);
    fields.righe = items.tp === gtItems.length && items.fp === 0 ? "right" : (parsed?.righe ? "wrong" : "omitted");
  }
  const wrong = Object.entries(fields).filter(([, v]) => v === "wrong").map(([k]) => k);
  const omitted = Object.entries(fields).filter(([, v]) => v === "omitted").map(([k]) => k);
  const confident = outcome === "answer";
  return {
    outcome,
    fields,
    wrongFields: wrong,
    omittedFields: omitted,
    silentErrors: confident ? wrong : [],
    items,
    fullyCorrect: confident && wrong.length === 0 && omitted.length === 0,
  };
}
