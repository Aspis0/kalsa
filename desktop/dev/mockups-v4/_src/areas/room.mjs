// 16 · The Room: the household's group chat with Kalsa as a guest.
import { icon } from '../kit.mjs';
import { rail } from '../hearth.mjs';
import { modal, btn } from './ui.mjs';

export const css = `
.rh{min-height:76px;padding-top:12px;padding-bottom:12px;flex:none;display:flex;align-items:center;gap:14px;padding:0 28px;border-bottom:1px solid var(--line)}
.rh h3{font-size:20px;font-weight:650;margin-right:6px}
.who{display:flex;gap:6px;flex-wrap:wrap}
.who span{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:16px;background:var(--card);border:1px solid var(--line);font-size:14px;font-weight:600}
.who span i{width:9px;height:9px;border-radius:50%}
.who span em{font-style:normal;font-weight:500;color:var(--tx3)}
.rh .me-chip{margin-left:auto;display:inline-flex;align-items:center;gap:8px;height:44px;padding:0 16px;border-radius:22px;border:1.5px solid var(--line);font-weight:600;background:var(--card)}
.rh .clr{display:inline-flex;align-items:center;gap:8px;height:44px;padding:0 16px;border-radius:22px;color:var(--tx2);font-weight:600}
.namef{margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.namef .in{display:flex;align-items:center;gap:8px;height:44px;width:260px;padding:0 16px;border-radius:22px;border:1.5px solid var(--ac);box-shadow:0 0 0 4px var(--ac-soft);background:var(--bg);font-weight:600}
.namef .err{font-size:14px}
.rmsgs{flex:1;overflow:hidden;padding:20px 0 0;display:flex;flex-direction:column;justify-content:flex-end;-webkit-mask-image:linear-gradient(transparent 0,#000 70px)}
.rmsgs .rempty{margin-bottom:auto}
.rcol{width:820px;margin:0 auto}
.day{text-align:center;margin:6px 0 16px}
.day span{display:inline-block;padding:4px 14px;border-radius:14px;background:var(--rail);font-size:14px;font-weight:600;color:var(--tx3)}
.rr{margin-bottom:14px;display:flex;flex-direction:column;align-items:flex-start}
.rr.own{align-items:flex-end}
.rr .an{font-size:14px;font-weight:700;margin:0 0 4px 14px;display:flex;align-items:center;gap:6px}
.rr.own .an{margin:0 14px 4px 0}
.rr .rb{max-width:560px;padding:11px 16px 9px;border-radius:20px;border:1.5px solid var(--c);background:var(--t);font-size:17px;line-height:26px;position:relative}
.rr .rb .tm{display:block;text-align:right;font-size:12px;color:var(--tx3);margin-top:2px}
.rr .rb .asked{font-weight:700;color:var(--tx2)}
.rr .rb .rd3{font-size:13px;color:var(--tx3)}
.rr.k .rb{background:var(--card);border-color:var(--ac)}
.rr .rb ul{margin:4px 0}
.rr .rb li{position:relative;padding-left:18px}
.rr .rb li::before{content:"";position:absolute;left:4px;top:11px;width:6px;height:6px;border-radius:50%;background:var(--ring)}
.queue{text-align:center;color:var(--tx3);font-size:15px;margin:2px 0 8px}
.rdock{padding:6px 0 18px}
.rbox{background:var(--card);border:1.5px solid var(--line);border-radius:28px;padding:14px 12px 12px 22px}
.rbox .ph{color:var(--tx3);font-size:17px;height:38px}
.rbox .r{display:flex;align-items:center;gap:10px}
.ask{display:inline-flex;align-items:center;gap:8px;height:48px;padding:0 20px;border-radius:24px;border:1.5px solid var(--ac);color:var(--ac-tx);font-weight:650;font-size:16px;background:var(--bg)}
.rbox .mist{flex:1}
.grid3{display:grid;grid-template-columns:repeat(3,150px);gap:6px;margin:4px 0 6px}
.grid3 div{height:120px;border-radius:12px;overflow:hidden}
.mchip{position:relative;width:72px;height:72px;border-radius:16px;overflow:hidden}
.mchip .ov{position:absolute;inset:0;background:rgba(20,22,16,.55);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:12px;font-weight:600;text-align:center;line-height:15px}
.mchip .bar3{position:absolute;left:8px;right:8px;bottom:8px;height:4px;border-radius:2px;background:rgba(255,255,255,.3)}
.mchip .bar3 i{display:block;height:100%;border-radius:2px;background:#fff}
.rerr{text-align:center;font-size:15px;margin:0 0 8px}
.rempty{text-align:center;padding-top:200px;color:var(--tx2)}
.rempty .lf{width:72px;height:72px;border-radius:22px;background:var(--ac-soft);color:var(--ac-tx);display:grid;place-items:center;margin:0 auto 20px}
.rempty h2{font-size:30px;font-weight:600;letter-spacing:-.02em;color:var(--tx)}
.rempty p{font-size:19px;margin-top:8px}
.rempty .go{margin-top:26px}
`;

const P = {
  giulia: ['Giulia', '#B5543F', '#F7E6E1'], marco: ['Marco', '#3B6EA8', '#E3ECF6'], nonna: ['Nonna Lia', '#8A5BA6', '#EFE6F4'],
  you: ['Living room', '#9A6A1C', '#F6EBD7'], kalsa: ['Kalsa', '#3F6B3A', ''],
};
const DARK_T = { giulia: '#3A2621', marco: '#1F2A38', nonna: '#30253A', you: '#3A3022', kalsa: '' };

function msg(who, html, time, { own = false, grouped = false, dark = false } = {}) {
  const [name, c, t] = P[who];
  const tint = dark ? DARK_T[who] : t;
  return `<div class="rr ${own ? 'own' : ''} ${who === 'kalsa' ? 'k' : ''}" style="--c:${c};--t:${tint}">${grouped ? '' : `<span class="an" style="color:${c}">${name}</span>`}<div class="rb">${html}<span class="tm">${time}</span></div></div>`;
}

const photo = (a, b) => `<svg viewBox="0 0 150 120" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><rect width="150" height="120" fill="${a}"/><circle cx="110" cy="36" r="14" fill="#F6D27A"/><path d="M0 90 L44 58 L80 86 L112 64 L150 92 V120 H0Z" fill="${b}"/></svg>`;

function header({ naming = false } = {}) {
  const who = ['giulia', 'marco', 'nonna'].map(k => `<span><i style="background:${P[k][1]}"></i>${P[k][0]}${k === 'nonna' ? '<em> · left</em>' : ''}</span>`).join('');
  const right = naming
    ? `<div class="namef"><div class="in">Giulia</div><span class="err">Someone in this room already uses that name. Pick another.</span></div>`
    : `<span class="me-chip">${icon('pencil', 15)}You are Living room</span><span class="clr">${icon('trash', 17)}Clear Room photos and videos</span>`;
  return `<div class="rh"><h3>Room</h3><div class="who">${who}</div>${right}</div>`;
}

function dock({ chips = '', above = '' } = {}) {
  return `<div class="rdock"><div class="rcol">${above}<div class="rbox">${chips}<div class="ph">Write, or type @Kalsa…</div>
    <div class="r"><span class="att">${icon('image', 18)}Attach a photo</span><span class="mist">Kalsa can make mistakes.</span><span class="ask">${icon('at', 18)}Ask Kalsa</span><span class="send">Send${icon('up', 18, 2.4)}</span></div></div></div></div>`;
}

function room({ body, top = header(), bottom = dock(), overlay = '' }) {
  return `${rail('room')}<main>${top}<div class="rmsgs"><div class="rcol">${body}</div></div>${bottom}${overlay}</main>`;
}

const thread = (dark = false) => `<div class="day"><span>Today</span></div>
  ${msg('giulia', 'Stasera pizza o pasta? 🍕', '19:02', { dark })}
  ${msg('marco', 'Pizza! Ma facciamola noi', '19:03', { dark })}
  ${msg('you', '<span class="asked">asked Kalsa ·</span> @Kalsa una ricetta per l’impasto della pizza per 4, con poco lievito', '19:05', { own: true, dark })}
  ${msg('kalsa', '<p>Ecco un impasto per 4 pizze, a lunga lievitazione:</p><ul><li><b>500 g</b> di farina 0, <b>350 ml</b> d’acqua</li><li><b>2 g</b> di lievito di birra fresco, <b>12 g</b> di sale</li><li>Riposo: 8 ore in frigo, poi 2 a temperatura ambiente.</li></ul><span class="rd3">read the last 3 messages</span>', '19:05', { dark })}
  ${msg('giulia', '<span class="asked">asked Kalsa ·</span> @Kalsa e con la farina integrale?', '19:07', { dark })}`;

export const screens = [
  ['16-room', () => room({ body: thread(), bottom: `<p class="queue">Kalsa will answer Giulia next, then Marco.</p>${dock()}` }), 'light'],
  ['16-room-dark', () => room({ body: thread(true), bottom: `<p class="queue">Kalsa will answer Giulia next, then Marco.</p>${dock()}` }), 'dark'],
  ['16-room-empty', () => room({ body: `<div class="rempty"><div class="lf">${icon('users', 34, 1.9)}</div><h2>The Room</h2><p>No messages yet. Say something, or ask Kalsa.</p></div>` }), 'light'],
  ['16-room-closed', () => room({ top: '', bottom: '', body: `<div class="rempty"><div class="lf" style="background:var(--rail);color:var(--tx3)">${icon('users', 34, 1.9)}</div><h2>The Room is closed</h2><p>Turn on Kalsa to use the room.</p><span class="go">${icon('power', 22, 2)}Turn Kalsa on</span></div>` }), 'light'],
  ['16-room-naming', () => room({ top: header({ naming: true }), body: thread() }), 'light'],
  ['16-room-media', () => room({
    body: `<div class="day"><span>Today</span></div>${msg('marco', `<div class="grid3"><div>${photo('#E9C9A6', '#8A6A44')}</div><div>${photo('#BFD9E8', '#4E7A5A')}</div><div>${photo('#D7CBB4', '#7A5C3A')}</div></div>La pizza è venuta così!`, '20:41')}
      ${msg('kalsa', '<p>Bel cornicione! La seconda è cotta meglio: bordo gonfio e macchie scure regolari.</p>', '20:42')}`,
    bottom: `<p class="rerr err">That video is too large for the room (over 100 MB).</p>${dock({ chips: `<div class="chips"><div class="mchip">${photo('#E9C9A6', '#8A6A44')}<div class="ov">Compressing… 64%<div class="bar3"><i style="width:64%"></i></div></div></div>
      <div class="mchip">${photo('#BFD9E8', '#4E7A5A')}<div class="ov">Uploading… 30%<div class="bar3"><i style="width:30%"></i></div></div></div>
      <div class="mchip">${photo('#D7CBB4', '#7A5C3A')}<span class="x" style="position:absolute;right:4px;top:4px;width:22px;height:22px;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;display:grid;place-items:center">${icon('x', 12, 2.4)}</span></div></div>` })}`,
  }), 'light'],
  ['16-room-clear', () => room({ body: thread(), overlay: modal({ ic: 'trash', tone: 'warn', title: 'Clear Room photos and videos',
    body: 'Delete all photos and videos in this Room for everyone? Messages stay.', actions: btn('Keep') + btn('Delete', 'danger', 'trash') }) }), 'light'],
];
