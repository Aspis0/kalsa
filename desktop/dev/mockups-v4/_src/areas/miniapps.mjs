// 12 · Mini apps inside an answer: calculator, quiz, checklist, sortable table, and the build row.
import { icon } from '../kit.mjs';
import { chatFrame, me, kalsa } from '../hearth.mjs';

export const css = `
.mapp{margin-top:12px;border:1.5px solid var(--line);border-radius:20px;background:var(--bg);overflow:hidden}
.mapp .mh{display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid var(--line);background:var(--rail);font-weight:650;font-size:16px}
.mapp .mh .mi2{width:30px;height:30px;border-radius:9px;background:var(--ac-soft);color:var(--ac-tx);display:grid;place-items:center}
.mapp .mb{padding:16px 18px 18px}
.fields{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.fld label{display:block;font-size:14px;font-weight:600;color:var(--tx2);margin-bottom:6px}
.fld .in{height:48px;border-radius:14px;border:1.5px solid var(--line);background:var(--card);display:flex;align-items:center;padding:0 14px;font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
.fld .in.focus{border-color:var(--ac);box-shadow:0 0 0 4px var(--ac-soft)}
.formula{margin-top:14px;font-size:15px;color:var(--tx2)}
.formula b{font-weight:600;color:var(--tx3);margin-right:6px}
.result{margin-top:14px;display:flex;align-items:baseline;justify-content:space-between;padding:14px 18px;border-radius:16px;background:var(--ac-soft)}
.result span{font-weight:600;color:var(--ac-tx)}
.result b{font-size:32px;font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.qq{font-size:18px;font-weight:600;line-height:26px;margin-bottom:12px}
.qo{display:flex;align-items:center;gap:12px;min-height:52px;padding:10px 16px;border-radius:16px;border:1.5px solid var(--line);background:var(--card);margin-bottom:8px;font-size:16px}
.qo .rd2{width:22px;height:22px;border-radius:50%;border:2px solid #B9B3A1;flex:none}
.qo.sel{border-color:var(--ac)}.qo.sel .rd2{border:7px solid var(--ac)}
.qo.ok{border-color:#5E9A4F;background:#EAF3E3}.qo.ok .rd2{border:0;background:#5E9A4F;color:#fff;display:grid;place-items:center}
.qo.no{border-color:#D9A79C;background:#FBF1EE}.qo.no .rd2{border:0;background:#B5543F;color:#fff;display:grid;place-items:center}
.qo em{margin-left:auto;font-style:normal;font-weight:650;font-size:15px}
.qo.ok em{color:#3F7A31}.qo.no em{color:#9B3B2E}
.mbtn{display:inline-flex;align-items:center;gap:8px;height:46px;padding:0 22px;border-radius:23px;background:var(--ac);color:var(--ac-ink);font-weight:600;margin-top:6px}
.mbtn.q{background:transparent;border:1.5px solid var(--line);color:var(--tx)}
.verdict{margin-top:12px;padding:12px 16px;border-radius:16px;background:var(--rail);font-size:15px;line-height:23px;color:var(--tx2)}
.verdict b{display:block;font-size:17px;color:#3F7A31;margin-bottom:2px}
.ck{display:flex;align-items:center;gap:14px;padding:12px 2px;border-bottom:1px solid var(--line);font-size:16px}
.ck:last-child{border-bottom:0}
.ck .box2{width:26px;height:26px;border-radius:8px;border:2px solid #B9B3A1;flex:none;display:grid;place-items:center}
.ck.on .box2{background:var(--ac);border-color:var(--ac);color:var(--ac-ink)}
.ck.on span{color:var(--tx3);text-decoration:line-through}
.ckcount{font-size:14px;color:var(--tx3);font-weight:600;margin-left:auto}
table.mt{width:100%;border-collapse:collapse;font-size:15px}
.mt th{text-align:left;font-size:14px;font-weight:650;color:var(--tx2);padding:10px 12px;border-bottom:1.5px solid var(--line)}
.mt th span{display:inline-flex;align-items:center;gap:4px}
.mt th.on{color:var(--ac-tx)}
.mt td{padding:12px;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums}
.mt tr:last-child td{border-bottom:0}
.mt td.n,.mt th.n{text-align:right}
.mt th.n span{justify-content:flex-end}
.mt tr.best td{background:#EAF3E3}
.capnote{margin-top:10px;font-size:14px;color:var(--tx3)}
`;

const head = (ic, title) => `<div class="mh"><span class="mi2">${icon(ic, 17)}</span>${title}</div>`;
const builtRow = `<div class="tool"><div class="ts">${icon('layoutGrid', 18)}Kalsa built an interactive view<em>${icon('right', 16)}</em></div></div>`;

const calculator = `<div class="mapp">${head('gauge', 'Calculator')}<div class="mb">
  <div class="fields"><div class="fld"><label>Importo (€)</label><div class="in">200.000</div></div>
    <div class="fld"><label>Tasso annuo (%)</label><div class="in focus">3,4</div></div>
    <div class="fld"><label>Anni</label><div class="in">25</div></div></div>
  <p class="formula"><b>Formula</b>importo × tasso mensile ÷ (1 − (1 + tasso mensile)^−mesi)</p>
  <div class="result"><span>Rata mensile</span><b>990 €</b></div></div></div>`;

const quizOpts = ['La rata sale anche lei', 'La rata resta uguale', 'Il mutuo diventa variabile'];
function quiz(checked) {
  const opts = quizOpts.map((o, i) => {
    if (!checked) return `<div class="qo ${i === 1 ? 'sel' : ''}"><span class="rd2"></span>${o}</div>`;
    if (i === 1) return `<div class="qo ok"><span class="rd2">${icon('check', 13, 3)}</span>${o}<em>Correct</em></div>`;
    return `<div class="qo"><span class="rd2"></span>${o}</div>`;
  }).join('');
  const after = checked
    ? `<div class="verdict"><b>Correct</b>Explanation: con il tasso fisso la rata è decisa alla firma e non segue l’Euribor.</div><span class="mbtn q" style="margin-top:12px">${icon('refresh', 17)}Retry</span>`
    : `<span class="mbtn">${icon('check', 17, 2.4)}Check</span>`;
  return `<div class="mapp">${head('help', 'Quiz')}<div class="mb"><p class="qq">Con un mutuo a tasso fisso, cosa succede alla rata se l’Euribor sale?</p>${opts}${after}</div></div>`;
}

const items = [['Ultime due buste paga', true], ['Dichiarazione dei redditi', true], ['Compromesso di vendita', true], ['Perizia della casa', false], ['Documento d’identità', false]];
const checklist = `<div class="mapp"><div class="mh"><span class="mi2">${icon('check', 17, 2.4)}</span>Checklist<span class="ckcount">3 of 5</span></div><div class="mb" style="padding-top:4px;padding-bottom:6px">
  ${items.map(([t, on]) => `<div class="ck ${on ? 'on' : ''}"><span class="box2">${on ? icon('check', 15, 3) : ''}</span><span>${t}</span></div>`).join('')}</div></div>`;

const rows = [['Banca Verde', '3,10%', '3,32%', '962 €'], ['Credito Sud', '3,25%', '3,41%', '975 €'], ['Banca Nord', '3,40%', '3,58%', '990 €'], ['Cassa Lago', '3,55%', '3,71%', '1.004 €']];
const table = `<div class="mapp">${head('sort', 'Comparison')}<div class="mb" style="padding:4px 8px 8px">
  <table class="mt"><tr><th><span>Banca</span></th><th class="n"><span>Tasso</span></th><th class="n on"><span>TAEG ${icon('down', 14, 2.4)}</span></th><th class="n"><span>Rata</span></th></tr>
  ${rows.map((r, i) => `<tr class="${i === 0 ? 'best' : ''}"><td>${r[0]}</td><td class="n">${r[1]}</td><td class="n">${r[2]}</td><td class="n">${r[3]}</td></tr>`).join('')}</table></div></div>`;

const frame = (title, q, body) => () => chatFrame({ title, thread: `${me(q)}${builtRow}${kalsa(body)}` });

export const screens = [
  ['12-miniapps-calculator', frame('Rata del mutuo', 'Quanto pago al mese per 200.000 € in 25 anni?', `<p>Ecco un calcolatore: cambia i numeri e la rata si aggiorna.</p>${calculator}`), 'light'],
  ['12-miniapps-quiz', frame('Ripasso mutui', 'Fammi una domanda per vedere se ho capito.', `<p>Proviamo con una domanda.</p>${quiz(false)}`), 'light'],
  ['12-miniapps-quiz-checked', frame('Ripasso mutui', 'Fammi una domanda per vedere se ho capito.', `<p>Proviamo con una domanda.</p>${quiz(true)}`), 'light'],
  ['12-miniapps-checklist', frame('Documenti per il mutuo', 'Cosa devo portare in banca?', `<p>Spunta quello che hai già: lo vedo anch’io.</p>${checklist}`), 'light'],
  ['12-miniapps-table', frame('Offerte a confronto', 'Confronta queste quattro offerte.', `<p>Ordinate per <b>TAEG</b>, il costo vero. Tocca un titolo per riordinare.</p>${table}`), 'light'],
  ['12-miniapps-building', () => chatFrame({
    title: 'Offerte a confronto',
    thread: `${me('Confronta queste quattro offerte.')}<div class="tool"><div class="ts"><span class="spin"></span>Kalsa is building an interactive view…</div></div>
      ${me('E fammi anche un grafico.')}<div class="tool bad"><div class="ts">${icon('alert', 18)}Kalsa couldn’t build that view.<em>${icon('down', 16)}</em></div><div class="td">Kalsa couldn’t build that view.</div></div>
      ${kalsa('<p>Non riesco a disegnare un grafico qui, ma la tabella sopra mostra le stesse cifre.</p>')}`,
  }), 'light'],
];
