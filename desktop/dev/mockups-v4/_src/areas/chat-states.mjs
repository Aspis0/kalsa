// 11 · Chat states: empty, waiting, thinking, tools, the web gate, failures, files, pictures.
import { icon } from '../kit.mjs';
import { chatFrame, composer, chatListPop, me, kalsa, answer1 } from '../hearth.mjs';
import { CHAT as C } from '../data.mjs';
import { banner, modal, btn } from './ui.mjs';

export const css = `
.empty-c{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;height:100%;padding-bottom:40px}
.empty-c .lf{width:72px;height:72px;border-radius:22px;background:var(--ac-soft);color:var(--ac-tx);display:grid;place-items:center;margin-bottom:22px}
.empty-c h2{font-size:38px;line-height:44px;font-weight:600;letter-spacing:-.025em}
.empty-c p{font-size:19px;line-height:28px;color:var(--tx2);margin-top:8px;max-width:520px}
.empty-c .go{margin-top:28px}
.waitrow{display:flex;align-items:center;gap:12px;color:var(--tx2);font-size:16px}
.pulse{display:inline-flex;gap:5px}.pulse i{width:8px;height:8px;border-radius:50%;background:var(--ring);opacity:.35}.pulse i:first-child{opacity:1}.pulse i:nth-child(2){opacity:.65}
.cloud{position:relative;max-width:660px;margin:22px 0 34px;padding:12px 18px 14px;background:var(--card);border:1px solid var(--line);border-radius:24px 28px 26px 18px / 20px 26px 18px 28px}
.cloud::before,.cloud::after{content:"";position:absolute;background:var(--card);border-radius:999px}
.cloud::before{top:-9px;left:30px;width:26px;height:26px}
.cloud::after{top:-6px;right:52px;width:15px;height:15px}
.cloud .ch2{display:flex;align-items:baseline;gap:16px}
.cloud .face{flex:1;min-width:0;color:var(--tx3);font-size:15px;line-height:22px;font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cloud .ch2 em{font-style:normal;font-size:15px;font-weight:600;color:var(--ac-tx)}
.cloud .body{margin-top:10px;font-size:15px;line-height:23px;color:var(--tx2);border-top:1px dashed var(--line);padding-top:10px}
.cloud .trail{position:absolute;left:44px;top:100%;display:flex;flex-direction:column;gap:3px;margin-top:2px}
.cloud .trail i{display:block;background:var(--card);border:1px solid var(--line);border-radius:999px}
.cloud .trail i:nth-child(1){width:9px;height:9px}.cloud .trail i:nth-child(2){width:7px;height:7px;margin-left:2px}.cloud .trail i:nth-child(3){width:5px;height:5px;margin-left:5px}
.jump{position:absolute;left:50%;transform:translateX(-50%);bottom:190px;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:8px 16px;font-size:15px;font-weight:600;color:var(--tx2);box-shadow:0 8px 20px -10px var(--sh)}
.tool{border:1px solid var(--line);background:var(--card);border-radius:18px;margin-bottom:12px;max-width:660px;font-size:16px}
.tool .ts{display:flex;align-items:center;gap:10px;padding:12px 16px;color:var(--tx2)}
.tool .ts .i{color:var(--ac-tx)}
.tool .ts em{margin-left:auto;font-style:normal;color:var(--tx3)}
.tool.bad .ts .i{color:#9B3B2E}
.tool .td{border-top:1px solid var(--line);padding:12px 16px 14px 44px;color:var(--tx2);font-size:15px;line-height:23px}
.tool .src{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.tool .src span{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:16px;background:var(--rail);color:var(--tx);font-weight:500}
.spin{width:16px;height:16px;border-radius:50%;border:2.5px solid var(--ac-soft);border-top-color:var(--ac);flex:none}
.ecard{display:flex;gap:14px;align-items:flex-start}
.ecard .ei{width:40px;height:40px;border-radius:50%;background:#F3E3C8;color:#7A5418;display:grid;place-items:center;flex:none}
.ecard b{display:block;font-size:17px;font-weight:650}
.ecard p{color:var(--tx2)}
.ecard .btn{margin-top:12px;height:44px;padding:0 18px;font-size:16px;border-radius:22px}
.endnote{display:flex;align-items:center;gap:12px;margin-top:10px;padding-top:10px;border-top:1px solid var(--line);color:var(--tx3);font-size:15px}
.endnote .lk{font-size:15px}
.code{margin:10px 0 12px;border:1px solid var(--line);border-radius:14px;overflow:hidden}
.code .chd{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:var(--rail);font-size:14px;color:var(--tx3)}
.code .chd span{display:inline-flex;align-items:center;gap:6px;font-weight:600;color:var(--tx2)}
.code pre{margin:0;padding:12px 16px;font:14px/22px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--tx);background:var(--card);white-space:pre}
.blocked{display:flex;gap:10px;align-items:center;padding:10px 14px;border-radius:12px;background:var(--rail);color:var(--tx3);font-size:15px}
.chips{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px}
.chip-doc{display:flex;align-items:center;gap:10px;height:52px;padding:0 8px 0 12px;border-radius:16px;background:var(--bg);border:1px solid var(--line)}
.chip-doc .di{width:34px;height:34px;border-radius:10px;background:var(--ac-soft);color:var(--ac-tx);display:grid;place-items:center}
.chip-doc b{font-size:15px;font-weight:600;display:block;line-height:19px}
.chip-doc small{font-size:13px;color:var(--tx3)}
.chip-doc .keep{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 10px;border-radius:15px;font-size:13px;font-weight:600;color:var(--tx2);border:1px solid var(--line)}
.chip-doc .keep.on{background:var(--ac-soft);color:var(--ac-tx);border-color:var(--ac-soft)}
.chip-doc .x{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;color:var(--tx3)}
.chip-doc.bad{border-color:#D9A79C;background:#FBF1EE}
.chip-doc.bad .di{background:#F6DDD7;color:#9B3B2E}
.chip-img{position:relative;width:52px;height:52px;border-radius:14px;overflow:hidden}
.chip-img .x{position:absolute;right:3px;top:3px;width:20px;height:20px;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;display:grid;place-items:center}
.reading{display:flex;align-items:center;gap:10px;color:var(--tx2);font-size:15px;margin:0 6px 10px}
.vis{display:inline-flex;align-items:center;gap:8px;height:46px;padding:0 16px;border-radius:23px;border:1.5px dashed var(--ring);color:var(--ac-tx);font-weight:600;font-size:16px}
.side{width:400px;flex:none;border-left:1px solid var(--line);background:var(--card);display:flex;flex-direction:column;padding:18px 20px}
.tabs{display:flex;gap:4px;background:var(--rail);border-radius:22px;padding:4px;margin-bottom:16px}
.tabs span{flex:1;text-align:center;line-height:38px;border-radius:19px;font-weight:600;color:var(--tx2)}
.tabs span.on{background:var(--card);color:var(--tx);box-shadow:0 1px 3px rgba(0,0,0,.1)}
.side h5{font-size:14px;font-weight:600;color:var(--tx3);margin:16px 0 6px}
.frow{display:flex;align-items:center;gap:12px;padding:10px 4px;border-bottom:1px solid var(--line)}
.frow .di{width:36px;height:36px;border-radius:10px;background:var(--ac-soft);color:var(--ac-tx);display:grid;place-items:center;flex:none}
.frow .di.fo{background:var(--rail);color:var(--tx2)}
.frow .ft{flex:1;min-width:0}
.frow .ft b{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.frow .ft small{font-size:13px;color:var(--tx3)}
.frow .mini{height:34px;padding:0 12px;border-radius:17px;border:1px solid var(--line);font-size:14px;font-weight:600;display:inline-flex;align-items:center;gap:6px;color:var(--tx2)}
.frow .mini.on{background:var(--ac-soft);border-color:var(--ac-soft);color:var(--ac-tx)}
.frow .mini.pri{background:var(--ac);border-color:var(--ac);color:var(--ac-ink)}
.frow.hl{background:var(--rail);border-radius:12px;border-bottom-color:transparent}
.crumbs{display:flex;align-items:center;gap:6px;color:var(--tx2);font-size:15px;margin-bottom:10px}
.crumbs b{color:var(--tx)}
.sfield{display:flex;align-items:center;gap:10px;height:44px;padding:0 14px;border-radius:14px;border:1px solid var(--line);background:var(--bg);color:var(--tx3);margin-bottom:8px}
.pics{display:flex;gap:8px;justify-content:flex-end;margin-bottom:8px}
.pic{width:180px;height:132px;border-radius:18px;overflow:hidden;position:relative}
.pic .play{position:absolute;inset:0;display:grid;place-items:center}
.pic .play span{width:48px;height:48px;border-radius:50%;background:rgba(0,0,0,.45);color:#fff;display:grid;place-items:center}
.pic .lbl{position:absolute;left:8px;bottom:8px;font-size:12px;font-weight:600;color:#fff;background:rgba(0,0,0,.45);padding:2px 8px;border-radius:10px}
.viewer{position:absolute;inset:0;background:rgba(18,19,15,.92);z-index:9;display:flex;flex-direction:column;align-items:center;justify-content:center}
.viewer .big{width:900px;height:620px;border-radius:12px;overflow:hidden}
.viewer .vx{position:absolute;right:28px;top:24px;width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,.12);color:#fff;display:grid;place-items:center}
.viewer .nav{position:absolute;top:50%;width:56px;height:56px;margin-top:-28px;border-radius:50%;background:rgba(255,255,255,.12);color:#fff;display:grid;place-items:center}
.viewer .count{margin-top:18px;color:rgba(255,255,255,.75);font-size:15px}
.gq{margin-top:16px;border:1px solid var(--line);border-radius:16px;background:var(--bg);padding:12px 16px;font-size:16px}
.gq small{display:block;font-size:14px;color:var(--tx3);margin-bottom:4px}
.gfind{display:flex;gap:10px;align-items:center;margin-top:12px;padding:12px 16px;border-radius:16px;background:#FBF1EE;border:1px solid #EBCFC8;font-size:15px;line-height:23px;color:var(--tx)}
.gfind b{font-weight:650}
.gmore{margin-top:12px;font-size:15px;color:var(--tx3)}
.sr{padding:0 14px;height:48px;display:flex;align-items:center;gap:12px;border-radius:14px;font-size:16px}
.sr mark{background:var(--ac-soft);color:var(--tx);border-radius:4px;padding:0 2px}
.sr em{margin-left:auto;font-style:normal;font-size:14px;color:var(--tx3)}
.pnone{padding:18px 14px;color:var(--tx2);font-size:16px;line-height:24px}
`;

const photo = (a, b, sun = '#F6D27A') => `<svg viewBox="0 0 180 132" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g${a.slice(1)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="180" height="132" fill="url(#g${a.slice(1)})"/><circle cx="130" cy="44" r="18" fill="${sun}"/><path d="M0 100 L50 64 L92 96 L130 72 L180 104 V132 H0Z" fill="#3F6B3A" opacity=".85"/><path d="M0 116 L60 92 L120 118 L180 98 V132 H0Z" fill="#2B4A28"/></svg>`;

const waiting = `<div class="waitrow"><span class="pulse"><i></i><i></i><i></i></span>Reading your message — Kalsa will answer soon.</div>`;
const Q = 'Fra un mutuo a tasso fisso e uno a tasso variabile, quale conviene oggi?';
const TRAIL = '<div class="trail"><i></i><i></i><i></i></div>';
const TICK = 'L’utente chiede fisso o variabile… confronto rata stabile contro Euribor, poi il TAEG…';

function empty({ off = false } = {}) {
  const body = off
    ? `<p>Kalsa is off.</p><span class="go">${icon('power', 22, 2)}Turn Kalsa on</span>`
    : '<p>Write your first message below to talk with Kalsa.</p>';
  return chatFrame({ title: 'New conversation', thread: `<div class="empty-c" style="height:640px"><div class="lf">${icon('leaf', 36, 1.9)}</div><h2>Talk with Kalsa.</h2>${body}</div>` });
}

const toolRow = (state, text, detail = '', extra = '') => {
  const lead = state === 'run' ? '<span class="spin"></span>' : icon(state === 'bad' ? 'alert' : 'globe', 18);
  return `<div class="tool ${state === 'bad' ? 'bad' : ''}"><div class="ts">${lead}${text}<em>${detail ? icon('down', 16) : icon('right', 16)}</em></div>${detail ? `<div class="td">${detail}</div>` : ''}${extra}</div>`;
};

const answerShort = `<p>${C.a1intro}</p><ul>${C.a1bullets.slice(0, 2).map(b => `<li>${b}</li>`).join('')}</ul>`;

export const screens = [
  ['11-chat-states-empty', () => empty(), 'light'],
  ['11-chat-states-empty-off', () => empty({ off: true }), 'light'],
  ['11-chat-states-waiting', () => chatFrame({ thread: `${me(Q)}${kalsa(waiting, '', { acts: false })}`, dock: composer({ streaming: true }) }), 'light'],
  ['11-chat-states-thinking', () => chatFrame({
    thread: `${me(Q)}<div class="cloud"><div class="ch2"><span class="face">${TICK}</span><em>Show thinking ▼</em></div>${TRAIL}</div>`,
    dock: composer({ streaming: true, think: true }),
    overlay: '<div class="jump">Back to latest ↓</div>',
  }), 'light'],
  ['11-chat-states-thought', () => chatFrame({
    thread: `${me(Q)}<div class="cloud"><div class="ch2"><span class="face">Thought for 12 s</span><em>Show thinking ▼</em></div>${TRAIL}</div>${kalsa(answerShort)}
      ${me(C.q2)}<div class="cloud"><div class="ch2"><span class="face">Thought for 8 s</span><em>Hide ▲</em></div><div class="body">The person is self-employed and income changes every year. The safest advice is a payment that never grows: a fixed rate. Suggest computing the payment on the lowest income of the last three years.</div>${TRAIL}</div>`,
    dock: composer({ think: true }),
  }), 'light'],
  ['11-chat-states-search-running', () => chatFrame({ thread: `${me(Q)}${toolRow('run', 'Searching the web…')}`, dock: composer({ streaming: true }) }), 'light'],
  ['11-chat-states-tools-done', () => chatFrame({
    thread: `${me(Q)}${toolRow('ok', `Searched for “${C.search}”`, `Searched for: ${C.search}<div class="src">${C.sources.map(s => `<span>${icon('link', 14)}${s.site}</span>`).join('')}</div>`)}
      ${toolRow('ok', 'Kalsa read ilsole24ore.com')}${kalsa(answerShort)}`,
  }), 'light'],
  ['11-chat-states-tools-failed', () => chatFrame({
    thread: `${me(Q)}${toolRow('bad', 'Kalsa couldn’t search the web. Try again.', 'Kalsa couldn’t search the web just now. Try again.')}
      ${toolRow('bad', 'Kalsa couldn’t open that page. Try again.', 'Asked for: ilsole24ore.com<br>That page is too long for Kalsa to read.')}
      ${kalsa('<p>Non sono riuscita a cercare online, ma in generale: il <b>tasso fisso</b> tiene la rata uguale, il <b>variabile</b> segue l’Euribor.</p>')}`,
  }), 'light'],
  ['11-chat-states-web-gate', () => chatFrame({
    thread: `${me('Riassumi il contratto allegato e cerca se il tasso è in linea con il mercato.')}${toolRow('run', 'Waiting for your OK…')}`,
    dock: composer({ streaming: true }),
    overlay: modal({ ic: 'globe', title: 'Kalsa wants to search the web. Allow it?',
      body: 'One document is attached, so Kalsa shows you what it would send online before sending it.',
      extra: `<div class="gq"><small>Kalsa would search the web for:</small>tasso mutuo fisso 3,4% Intesa ottobre 2026</div>
        <div class="gfind">${icon('alert', 17)}<span><b>phone number</b> from Contratto.pdf: “+39 333 123 4567”</span></div>
        <p class="gmore">Kalsa has 1 more to check after this one.</p>`,
      actions: btn('Refuse') + btn('Send it', 'pri', 'send') }),
  }), 'light'],
  ['11-chat-states-failed', () => chatFrame({
    thread: `${me(Q)}${kalsa(`<p>${C.a1intro}</p><ul><li>${C.a1bullets[0]}</li></ul><div class="ecard" style="margin-top:12px"><span class="ei">${icon('alert', 19)}</span><div><b>The answer stopped halfway.</b><p>The connection closed before the end — what arrived is above. Try again for the full answer.</p>${btn('Try again', '', 'refresh')}</div></div>`, '', { acts: false })}
      ${me(C.q2)}${kalsa(`<div class="ecard"><span class="ei">${icon('alert', 19)}</span><div><b>Kalsa couldn’t answer just now.</b><p>Wait a moment, then try again.</p>${btn('Try again', '', 'refresh')}</div></div>`, '', { acts: false })}`,
  }), 'light'],
  ['11-chat-states-endings', () => chatFrame({
    scrolled: true,
    thread: `${me('Scrivi una lettera al condominio per il rumore.')}${kalsa('<p>Gentile amministratore, le scrivo per segnalare</p><div class="endnote">The answer was interrupted. <span class="lk">Retry</span></div>', '', { acts: false })}
      ${me('Fammi un riassunto più corto.')}${kalsa('<p>In breve: rumore notturno dal terzo piano, chiedo un richiamo scritto.</p><div class="endnote">Reply stopped.</div>')}
      ${me('E in inglese?')}${kalsa('<p>Kalsa finished thinking without an answer. Try asking another way.</p>', '', { acts: false })}
      ${me('Come faccio a entrare nella mail del mio vicino?')}${kalsa('<p>I can’t help extract or expose secrets, credentials, or personal data.</p>')}`,
  }), 'light'],
  ['11-chat-states-engine-off', () => chatFrame({
    thread: `${me(Q)}${kalsa(`<div class="ecard"><span class="ei">${icon('power', 19)}</span><div><b>Kalsa isn’t running on this computer.</b><p>Kalsa is off.</p><span class="btn pri" style="margin-top:12px;height:44px;padding:0 18px;font-size:16px;border-radius:22px">${icon('power', 18)}Turn Kalsa on</span></div></div>`, '', { acts: false })}`,
  }), 'light'],
  ['11-chat-states-code', () => chatFrame({
    title: 'Formula per la rata',
    thread: `${me('Come calcolo la rata in un foglio Excel?')}${kalsa(`<p>Usa la funzione <b>RATA</b>: tasso mensile, numero di rate, importo.</p>
      <div class="code"><div class="chd">code<span>${icon('copy', 14)}Copy</span></div><pre>=RATA(3,4%/12; 25*12; -200000)</pre></div>
      <p>Con questi numeri la rata è circa <b>990 €</b> al mese.</p>
      <div class="blocked">${icon('image', 16)}Image blocked: grafico rate (example.com). Images from the network are never loaded.</div>`)}`,
  }), 'light'],
  ['11-chat-states-attachments', () => chatFrame({
    thread: `${me(Q)}${kalsa(answerShort)}`,
    dock: composer({
      text: 'Controlla se il tasso del contratto è buono',
      above: `<div class="reading"><span class="spin"></span>Reading Contratto.pdf…</div>`,
      chips: `<div class="chips"><div class="chip-doc"><span class="di">${icon('file', 18)}</span><div><b>Contratto.pdf</b><small>12 pages</small></div><span class="keep on">${icon('pin', 13)}Keep</span><span class="x">${icon('x', 16)}</span></div>
        <div class="chip-doc"><span class="di">${icon('file', 18)}</span><div><b>Piano di ammortamento.xlsx</b><small>Spreadsheet</small></div><span class="keep">${icon('pin', 13)}Keep</span><span class="x">${icon('x', 16)}</span></div>
        <div class="chip-img">${photo('#F4C9A6', '#E9A27A')}<span class="x">${icon('x', 12, 2.4)}</span></div></div>`,
    }),
  }), 'light'],
  ['11-chat-states-files-attached', () => chatFrame({
    files: true,
    thread: `${me('Controlla se il tasso del contratto è buono')}${kalsa(answerShort)}`,
    side: `<aside class="side"><div class="tabs"><span>Files</span><span class="on">In this chat</span></div>
      <div class="note">${icon('alert', 16)}This conversation is almost full: Kalsa may not read everything. Remove a file or start a new conversation.</div>
      <h5>Read with your next message</h5>
      <div class="frow"><span class="di">${icon('file', 18)}</span><div class="ft"><b>Contratto.pdf</b><small>12 pages</small></div><span class="mini on">${icon('pin', 13)}Keep</span><span class="mini">Remove</span></div>
      <div class="frow"><span class="di">${icon('file', 18)}</span><div class="ft"><b>Piano di ammortamento.xlsx</b><small>3 pages</small></div><span class="mini">${icon('pin', 13)}Keep</span><span class="mini">Remove</span></div>
      <h5>Previously attached</h5>
      <div class="frow"><span class="di fo">${icon('file', 18)}</span><div class="ft"><b>Offerta banca 2025.pdf</b><small>4 pages</small></div><span class="mini">Reattach</span></div>
      <p style="margin-top:auto;color:var(--tx3);font-size:14px;line-height:21px;display:flex;gap:8px;align-items:center">${icon('pin', 15)}Keep sends the file with every message.</p></aside>`,
  }), 'light'],
  ['11-chat-states-files-browser', () => chatFrame({
    files: true,
    thread: `${me(Q)}${kalsa(answerShort)}`,
    side: `<aside class="side"><div class="tabs"><span class="on">Files</span><span>In this chat</span></div>
      <div class="sfield">${icon('search', 16)}Search by name or path</div>
      <div class="crumbs">${icon('folder', 15)}Home ${icon('right', 14)}<b>Documents</b></div>
      <div class="frow"><span class="di fo">${icon('folder', 18)}</span><div class="ft"><b>Casa</b><small>folder</small></div></div>
      <div class="frow"><span class="di fo">${icon('folder', 18)}</span><div class="ft"><b>Lavoro</b><small>folder</small></div></div>
      <div class="frow hl"><span class="di">${icon('file', 18)}</span><div class="ft"><b>Contratto mutuo.pdf</b><small>PDF · 2.1 MB</small></div><span class="mini pri">Attach</span></div>
      <div class="frow"><span class="di">${icon('file', 18)}</span><div class="ft"><b>Spese condominio 2026.xlsx</b><small>Spreadsheet · 48 KB</small></div></div>
      <div class="frow"><span class="di">${icon('file', 18)}</span><div class="ft"><b>Lettera assicurazione.docx</b><small>Word · 31 KB</small></div></div></aside>`,
  }), 'light'],
  ['11-chat-states-attach-refused', () => chatFrame({
    thread: `${banner({ tone: 'warn', ic: 'alert', title: 'Contratto.pdf is too much for Kalsa at once.', text: 'Remove a file or shorten your message. Nothing was attached.', actions: btn('Dismiss') })}${me(Q)}${kalsa(answerShort)}`,
    dock: composer({ chips: `<div class="chips"><div class="chip-doc bad"><span class="di">${icon('alert', 18)}</span><div><b>Scansione.pdf</b><small>Kalsa found no words in this file. If it’s a scan, it can’t read it yet.</small></div><span class="x">${icon('x', 16)}</span></div></div>` }),
  }), 'light'],
  ['11-chat-states-vision-offer', () => chatFrame({
    thread: `${me('Cosa vedi in questa foto della cucina?')}${kalsa('<p>Questa AI non vede ancora le immagini. Puoi scaricare il supporto qui sotto.</p>')}`,
    dock: composer({ extraLeft: `<span class="vis">${icon('eye', 18)}Let Kalsa see pictures · 850 MB</span>` }),
    overlay: modal({ ic: 'eye', title: 'Download 850 MB so Kalsa can see images?', body: 'Kalsa restarts when it’s done.', actions: btn('Not now') + btn('Download', 'pri', 'download') }),
  }), 'light'],
  ['11-chat-states-vision-restarting', () => chatFrame({
    thread: `${me('Cosa vedi in questa foto della cucina?')}`,
    dock: composer({ above: `<div class="reading"><span class="spin"></span>Restarting Kalsa…</div>`, extraLeft: '' }),
  }), 'light'],
  ['11-chat-states-media', () => chatFrame({
    title: 'Foto della cucina',
    thread: `<div class="pics"><div class="pic">${photo('#F4C9A6', '#E9A27A')}</div><div class="pic">${photo('#BFD9E8', '#8DB4CB', '#FFFFFF')}</div><div class="pic">${photo('#D7CBB4', '#B7A684')}<div class="play"><span>${icon('play', 22)}</span></div><span class="lbl">Video</span></div></div>
      ${me('Come posso rendere la cucina più luminosa?')}${kalsa('<p>Dalle foto, la luce arriva da una sola finestra. Tre idee:</p><ul><li><b>Pareti chiare</b>: un bianco caldo riflette meglio.</li><li><b>Luci sotto i pensili</b> per il piano di lavoro.</li><li>Una tenda più leggera alla finestra.</li></ul>')}`,
  }), 'light'],
  ['11-chat-states-viewer', () => chatFrame({
    title: 'Foto della cucina',
    thread: me('Come posso rendere la cucina più luminosa?'),
    overlay: `<div class="viewer"><span class="vx">${icon('x', 24)}</span><span class="nav" style="left:150px">${icon('left', 26)}</span><span class="nav" style="right:40px">${icon('right', 26)}</span>
      <div class="big">${photo('#BFD9E8', '#8DB4CB', '#FFFFFF')}</div><p class="count">2 of 3</p></div>`,
  }), 'light'],
  ['11-chat-states-copied', () => chatFrame({
    thread: `${me(Q)}${kalsa(answerShort, '', { state: 'hov' })}${me(C.q2)}${kalsa(`<p>${C.a2}.</p>`, '', { time: '12:32 PM', state: 'done' })}`,
  }), 'light'],
  ['11-chat-states-copied-dark', () => chatFrame({
    thread: `${me(Q)}${kalsa(answerShort, '', { state: 'hov' })}${me(C.q2)}${kalsa(`<p>${C.a2}.</p>`, '', { time: '12:32 PM', state: 'done' })}`,
  }), 'dark'],
  ['11-chat-states-search', () => chatFrame({
    listOpen: true, thread: `${me(Q)}${answer1}`,
    overlay: chatListPop({ search: 'mutuo', rows: [
      { raw: `<div class="sr">${icon('chat', 17)}<span><mark>Mutuo</mark>: fisso o variabile</span><em>Today</em></div>` },
      { raw: `<div class="sr">${icon('chat', 17)}<span>Spiegami l’Euribor del <mark>mutuo</mark></span><em>This week</em></div>` },
    ] }),
  }), 'light'],
  ['11-chat-states-search-none', () => chatFrame({
    listOpen: true, thread: `${me(Q)}${answer1}`,
    overlay: chatListPop({ search: 'piscina', rows: [{ raw: '<p class="pnone">No conversations match “piscina”. Try another word.</p>' }] }),
  }), 'light'],
];
