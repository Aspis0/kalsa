// Hearth, final: cream paper and sage, an icon rail, a smaller round power button on
// Home, a chat with one navigation column (the chat list opens on demand), labelled
// composer buttons, and side-by-side cards wherever an AI is chosen.
import { icon, lights, FONT_DISPLAY } from './kit.mjs';
import { AI, ALT, CHATS, CHAT as C, NOTES } from './data.mjs';
import { hearth as tree } from './tree-hearth.mjs';
import { FRAMES } from './tree.mjs';

export const meta = { id: 'hearth', label: 'Hearth' };

export const css = `
.light{--bg:#F4F1E9;--rail:#ECE8DD;--card:#FBFAF5;--line:#DDD7C8;--tx:#23261E;--tx2:#53584A;--tx3:#646A5B;
  --ac:#3F6B3A;--ac-ink:#FFFFFF;--ac-soft:#E2E8D4;--ac-tx:#3A6334;--ring:#74B266;--ring-glow:rgba(116,178,102,.45);
  --face1:#FFFFFF;--face2:#EFEBE0;--bezel:#E6E1D3;--sh:rgba(80,70,40,.28);--track:#E2DCCC}
.dark{--bg:#191A16;--rail:#131410;--card:#22241E;--line:#33362D;--tx:#EEECE3;--tx2:#BEBFB0;--tx3:#A2A494;
  --ac:#A9CF8E;--ac-ink:#16220F;--ac-soft:#2A3423;--ac-tx:#B8DA9F;--ring:#8FD07A;--ring-glow:rgba(143,208,122,.35);
  --face1:#34372F;--face2:#25281F;--bezel:#121310;--sh:rgba(0,0,0,.6);--track:#2C2F27}
body{background:var(--bg);color:var(--tx);font-size:16px;line-height:25px;display:grid;grid-template-columns:112px 1fr}
.rail{background:var(--rail);height:900px;display:flex;flex-direction:column;align-items:center;padding:60px 0 24px;position:relative;border-right:1px solid var(--line)}
.mark{width:44px;height:44px;border-radius:14px;background:var(--ac);color:var(--ac-ink);display:grid;place-items:center;margin-bottom:26px}
.ri{display:flex;flex-direction:column;align-items:center;gap:5px;width:96px;margin-bottom:10px;font-size:15px;font-weight:500;color:var(--tx2)}
.ri .ico{width:60px;height:42px;border-radius:21px;display:grid;place-items:center}
.ri.on{color:var(--tx);font-weight:650}
.ri.on .ico{background:var(--ac-soft);color:var(--ac-tx)}
.rail-low{margin-top:auto;display:flex;flex-direction:column;align-items:center}
.rail-low .ri:last-child{margin-bottom:0}
main{height:900px;position:relative;min-width:0;display:flex;flex-direction:column}
.center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding-bottom:30px}
/* the power button, about 65% of the first round */
.pw{position:relative;width:172px;height:172px;border-radius:50%;background:var(--bezel);box-shadow:inset 0 3px 8px var(--sh),0 1px 0 rgba(255,255,255,.7);display:grid;place-items:center}
.dark .pw{box-shadow:inset 0 3px 10px rgba(0,0,0,.8),0 1px 0 rgba(255,255,255,.05)}
.pw .face{width:142px;height:142px;border-radius:50%;background:radial-gradient(circle at 50% 30%,var(--face1),var(--face2) 75%);box-shadow:0 16px 30px -12px var(--sh),0 3px 6px -2px var(--sh),inset 0 2px 0 rgba(255,255,255,.9),inset 0 -3px 8px rgba(0,0,0,.06);display:grid;place-items:center;color:var(--tx3)}
.dark .pw .face{box-shadow:0 16px 30px -12px rgba(0,0,0,.8),inset 0 1px 0 rgba(255,255,255,.08)}
.pw.on::before{content:"";position:absolute;inset:-10px;border-radius:50%;border:4px solid var(--ring);box-shadow:0 0 26px var(--ring-glow),inset 0 0 14px var(--ring-glow)}
.pw.on .face{color:var(--ac)}
.pw.busy::before{content:"";position:absolute;inset:-10px;border-radius:50%;border:4px solid var(--track);border-top-color:var(--ring);border-right-color:var(--ring)}
.pw.busy .face{color:var(--ring)}
.pw.rest::before{content:"";position:absolute;inset:-10px;border-radius:50%;border:4px solid var(--ring);opacity:.45}
.pw.rest .face{color:var(--ac);opacity:.7}
.pw.warn::before{content:"";position:absolute;inset:-10px;border-radius:50%;border:4px solid #D9A443}
.pw.warn .face{color:#9A6A1C}
.grow.failed .tree{filter:saturate(.25);opacity:.75}
.grow.failed .bar i{background:#C79A4A}
.hint{margin-top:22px;font-size:15px;color:var(--tx3)}
h1{font-family:${FONT_DISPLAY};font-size:44px;line-height:50px;font-weight:600;letter-spacing:-.025em;margin-top:18px}
.sub{font-size:21px;line-height:30px;color:var(--tx2);margin-top:6px}
.go{display:inline-flex;align-items:center;gap:12px;height:60px;padding:0 34px;border-radius:30px;background:var(--ac);color:var(--ac-ink);font-size:19px;font-weight:600;margin-top:32px}
.using{margin-top:20px;font-size:16px;color:var(--tx3)}
.using a{color:var(--ac-tx);font-weight:600;margin-left:6px}
.foot{position:absolute;bottom:26px;left:0;right:0;display:flex;justify-content:center;align-items:center;gap:8px;color:var(--tx3);font-size:15px}
.btn{display:inline-flex;align-items:center;gap:8px;height:52px;padding:0 24px;border-radius:26px;font-size:17px;font-weight:600;border:1.5px solid var(--line);color:var(--tx);background:transparent;white-space:nowrap}
.btn.pri{background:var(--ac);border-color:var(--ac);color:var(--ac-ink)}
.btn.sm{height:44px;padding:0 18px;font-size:16px;border-radius:22px}
/* update sheet */
.sheet{position:absolute;left:40px;right:40px;bottom:0;background:var(--card);border:1px solid var(--line);border-bottom:0;border-radius:26px 26px 0 0;box-shadow:0 -18px 50px -20px var(--sh);padding:26px 34px 30px;display:grid;grid-template-columns:56px 1fr auto;gap:0 18px;z-index:5}
.sheet .ic{width:56px;height:56px;border-radius:50%;background:var(--ac-soft);color:var(--ac-tx);display:grid;place-items:center}
.sheet b{font-size:21px;font-weight:650;display:block;line-height:30px}
.sheet .wn{display:flex;align-items:center;gap:6px;color:var(--ac-tx);font-weight:600;margin-top:6px}
.sheet ul{margin-top:8px;color:var(--tx2)}
.sheet li{line-height:30px;display:flex;gap:10px;align-items:center}
.sheet li::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--ring);flex:none}
.sheet .a{display:flex;gap:12px;align-self:start}
/* chat: one navigation column, the list on demand */
.ch{height:76px;flex:none;display:flex;align-items:center;gap:12px;padding:0 28px;border-bottom:1px solid var(--line)}
.ch .btn{height:44px;padding:0 18px;font-size:16px;border-radius:22px;background:var(--card)}
.ch .btn.open{background:var(--ac-soft);border-color:var(--ac-soft);color:var(--ac-tx)}
.body-row{flex:1;display:flex;min-height:0}
.convo{flex:1;display:flex;flex-direction:column;min-width:0}
.msgs{flex:1;overflow:hidden;padding-top:26px}
.msgs.end{display:flex;flex-direction:column;justify-content:flex-end;padding-bottom:8px;-webkit-mask-image:linear-gradient(transparent 0,#000 70px)}
.ch .t{flex:1;text-align:center;font-size:17px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.psearch{display:flex;align-items:center;gap:10px;height:46px;padding:0 14px;margin:0 0 6px;border-radius:14px;background:var(--bg);border:1px solid var(--line);color:var(--tx);font-size:16px}
.psearch .phd{color:var(--tx3)}
.psearch kbd{margin-left:auto;font:inherit;font-size:13px;color:var(--tx3)}
.cbox .ph.typed{color:var(--tx)}
.think{display:inline-flex;align-items:center;gap:8px;height:46px;padding:0 16px;border-radius:23px;border:1.5px solid var(--line);color:var(--tx2);font-weight:600;font-size:16px}
.think.on{background:var(--ac-soft);border-color:var(--ac-soft);color:var(--ac-tx)}
.send.stop{background:var(--tx);color:var(--bg)}
.col{width:780px;margin:0 auto}
.me{display:flex;justify-content:flex-end;margin-bottom:18px}
.me div{max-width:540px;background:var(--ac);color:var(--ac-ink);border-radius:24px 24px 6px 24px;padding:13px 19px;font-size:17px;line-height:26px}
.it{display:flex;margin-bottom:18px}
.itc{display:flex;flex-direction:column;align-items:flex-start;max-width:660px}
.acts{display:flex;align-items:center;gap:6px;margin:6px 0 0 8px;color:var(--tx3);font-size:13px;line-height:18px}
.acts .cp{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;color:var(--tx3)}
.acts .cp.hov{background:var(--rail);color:var(--tx2)}
.dark .acts .cp.hov{background:#2C2F27}
.acts .cp.done{color:var(--ac-tx)}
.acts time{font-variant-numeric:tabular-nums}
.it .bub{max-width:660px;background:var(--card);border:1px solid var(--line);border-radius:24px 24px 24px 6px;padding:16px 22px;font-size:17px;line-height:28px}
.web{display:inline-flex;align-items:center;gap:8px;font-size:15px;color:var(--tx3);margin-bottom:8px}
.bub p{margin-bottom:10px}.bub p:last-child{margin-bottom:0}
.bub ul{margin-bottom:10px}
.bub li{position:relative;padding-left:22px;margin-bottom:6px}
.bub li::before{content:"";position:absolute;left:5px;top:11px;width:7px;height:7px;border-radius:50%;background:var(--ring)}
.bub b{font-weight:650}
.dots{display:inline-flex;gap:5px;margin-left:8px;vertical-align:middle}
.dots i{width:7px;height:7px;border-radius:50%;background:var(--tx3);opacity:.4}.dots i:first-child{opacity:.9}
.dock{padding:8px 0 18px;flex:none}
.mist{flex:1;min-width:0;text-align:center;font-size:14px;line-height:18px;color:var(--tx3);padding:0 8px}
.cbox{background:var(--card);border:1.5px solid var(--line);border-radius:28px;padding:16px 12px 12px 22px}
.cbox .ph{color:var(--tx3);font-size:17px;height:40px}
.cbox .r{display:flex;align-items:center;gap:10px}
.att{display:inline-flex;align-items:center;gap:8px;height:46px;padding:0 18px 0 14px;border-radius:23px;background:var(--ac-soft);color:var(--ac-tx);font-weight:600;font-size:16px}
.send{display:inline-flex;align-items:center;gap:8px;height:48px;padding:0 22px;border-radius:24px;background:var(--ac);color:var(--ac-ink);font-weight:600;font-size:17px}
.small{text-align:center;font-size:14px;color:var(--tx3);margin-top:10px}
.pop{position:absolute;left:28px;top:70px;width:440px;background:var(--card);border:1px solid var(--line);border-radius:22px;box-shadow:0 24px 60px -18px var(--sh),0 2px 6px rgba(0,0,0,.06);padding:12px;z-index:6}
.pop .new{display:flex;align-items:center;gap:10px;height:50px;padding:0 16px;border-radius:16px;background:var(--ac);color:var(--ac-ink);font-weight:600;font-size:16px;margin-bottom:8px}
.pop h4{font-size:14px;font-weight:600;color:var(--tx3);padding:10px 14px 4px}
.pop .li{display:flex;align-items:center;gap:12px;padding:0 14px;height:48px;border-radius:14px;font-size:16px}
.pop .li span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pop .li em{font-style:normal;font-size:14px;color:var(--tx3)}
.pop .li.on{background:var(--ac-soft);font-weight:600}
.pop .li .i{color:var(--tx3)}
.scrim{position:absolute;inset:76px 0 0 0;background:rgba(35,38,30,.08);z-index:4}
/* settings */
.set{width:720px;margin:0 auto;padding-top:62px}
.set h2,.aip h2{font-family:${FONT_DISPLAY};font-size:38px;line-height:44px;font-weight:600;letter-spacing:-.025em;margin-bottom:26px}
.grp{background:var(--card);border:1px solid var(--line);border-radius:22px;margin-bottom:16px}
.row{display:flex;align-items:center;gap:20px;padding:18px 24px;border-top:1px solid var(--line);min-height:78px}
.row:first-child{border-top:0}
.row .t{flex:1}
.row .t b{display:block;font-size:17px;font-weight:600}
.row .t span{display:block;color:var(--tx2);font-size:15px;line-height:22px;margin-top:2px}
.sw{width:58px;height:34px;border-radius:17px;background:var(--ac);position:relative;flex:none}
.sw::after{content:"";position:absolute;right:3px;top:3px;width:28px;height:28px;border-radius:50%;background:#fff;box-shadow:0 2px 4px rgba(0,0,0,.2)}
.seg{display:inline-flex;background:var(--rail);border-radius:22px;padding:4px}
.seg span{padding:0 16px;line-height:38px;border-radius:19px;font-size:15px;font-weight:600;color:var(--tx2)}
.seg span.on{background:var(--card);color:var(--tx);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.sel{display:inline-flex;align-items:center;gap:10px;height:44px;padding:0 16px;border-radius:22px;border:1.5px solid var(--line);font-weight:600}
.lk{color:var(--ac-tx);font-weight:600;display:inline-flex;align-items:center;gap:4px}
/* choosing the AI: two side-by-side cards */
.opts{display:flex;gap:22px}
.opt{width:380px;background:var(--card);border:1.5px solid var(--line);border-radius:26px;padding:28px;text-align:left;position:relative}
.opt.chosen{border:2.5px solid var(--ac);padding:27px;box-shadow:0 16px 36px -20px var(--sh)}
.opt .oi{width:54px;height:54px;border-radius:50%;background:var(--rail);color:var(--tx2);display:grid;place-items:center;margin-bottom:18px}
.opt.chosen .oi{background:var(--ac-soft);color:var(--ac-tx)}
.opt .rd{position:absolute;right:24px;top:28px;width:30px;height:30px;border-radius:50%;border:2px solid #B9B3A1}
.opt.chosen .rd{border:0;background:var(--ac);color:var(--ac-ink);display:grid;place-items:center}
.opt h3{font-size:26px;line-height:32px;font-weight:650;letter-spacing:-.01em;display:flex;align-items:center;gap:10px}
.opt h3 em{font-style:normal;font-size:13px;font-weight:700;color:var(--ac-tx);background:var(--ac-soft);border-radius:13px;padding:0 10px;line-height:26px;letter-spacing:0}
.opt p{color:var(--tx2);font-size:17px;margin-top:6px}
.opt .need{display:flex;align-items:center;gap:8px;margin-top:20px;padding-top:18px;border-top:1px solid var(--line);font-size:17px;font-weight:600}
.opt .need .i{color:var(--ac-tx)}
.opt small{display:block;color:var(--tx3);font-size:14px;margin-top:6px}
.opt .act{margin-top:20px}
.aip .opt{flex:1;width:auto;padding:22px 24px}
.aip .opt.chosen{padding:21px 23px}
.aip .opt .oi{width:46px;height:46px;margin-bottom:12px}
.aip .opt .need{margin-top:14px;padding-top:12px}
.aip .opt .act,.aip .using-now{margin-top:14px}
.det .kvs{display:grid;grid-template-columns:1fr 1fr;column-gap:40px}
.using-now{display:flex;align-items:center;gap:10px;height:44px;margin-top:20px;color:var(--ac-tx);font-weight:600}
.using-now i{width:10px;height:10px;border-radius:50%;background:var(--ring);box-shadow:0 0 0 4px var(--ring-glow)}
/* first run */
.solo{grid-column:1/-1;height:900px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;position:relative}
.solo .sub{max-width:620px}
.startb{margin-top:46px}
.startb.pw{width:206px;height:206px}
.startb .face{width:172px;height:172px;font-size:25px;font-weight:650;color:var(--ac)}
.prog{position:absolute;top:58px;font-size:15px;font-weight:600;color:var(--tx3)}
/* AI page */
.aip{width:840px;margin:0 auto;padding-top:40px}
.back{display:inline-flex;align-items:center;gap:4px;color:var(--ac-tx);font-weight:600;margin-bottom:14px}
.aip h2{margin-bottom:6px}
.aip .lead{font-size:19px;color:var(--tx2);margin-bottom:22px}
.det{margin-top:26px;background:var(--card);border:1px solid var(--line);border-radius:22px;padding:6px 24px}
.det h4{display:flex;align-items:center;gap:6px;font-size:16px;font-weight:600;color:var(--ac-tx);padding:14px 0 8px}
.det .kv{display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid var(--line);color:var(--tx2);font-size:16px}
.det .kv b{color:var(--tx);font-weight:600}
.xp{display:flex;align-items:center;gap:12px;margin-top:16px;padding:16px 24px;border:1.5px dashed var(--line);border-radius:22px;color:var(--tx2);font-weight:600}
.xp span{display:flex;align-items:center;gap:10px}
.xp em{margin-left:auto;font-style:normal;color:var(--ac-tx)}
/* growing */
.tree{width:440px;height:440px;margin-top:-30px}
.grow h1{font-size:34px;line-height:40px;margin-top:4px}
.bar{width:560px;height:14px;border-radius:7px;background:var(--track);margin-top:24px;overflow:hidden}
.bar i{display:block;height:100%;border-radius:7px;background:var(--ac)}
.grow .sub{font-size:20px;margin-top:16px}
.once{margin-top:10px;font-size:16px;color:var(--tx3)}
.tiny{margin-top:4px;font-size:15px;color:var(--tx3)}
.bar.ind i{width:30%;margin-left:35%;opacity:.55}
`;

/** The icon rail: four destinations on top, Help and Phones at the bottom. */
export function rail(active) {
  const it = (k, l, ic, extra = '') => `<div class="ri ${k === active ? 'on' : ''}${extra}"><span class="ico">${icon(ic, 24)}</span>${l}</div>`;
  const phones = it('phones', 'Phones', 'phone');
  return `<nav class="rail">${lights(20, 20)}<div class="mark">${icon('leaf', 22, 2.1)}</div>
    ${it('home', 'Home', 'power')}${it('chat', 'Chat', 'chat')}${it('room', 'Room', 'users')}${it('settings', 'Settings', 'settings')}
    <div class="rail-low">${it('help', 'Help', 'help')}${phones}</div></nav>`;
}

/** The Home presence: the round button, its hint, the sentence, one action. */
export function presence({ ring = 'on', face = icon('power', 52, 2.3), hint, head, sub, action = '', using = true, extra = '' }) {
  return `<div class="pw ${ring}"><div class="face">${face}</div></div>
    ${hint ? `<p class="hint">${hint}</p>` : ''}
    <h1>${head}</h1><p class="sub">${sub}</p>${extra}
    ${action}
    ${using ? `<p class="using">Using ${AI.name}<a>Details ›</a></p>` : ''}`;
}

export const startChat = `<span class="go">${icon('chat', 22, 2)}Start a chat</span>`;

export function hero(on) {
  return on
    ? presence({ hint: 'Press to turn off', head: 'Kalsa is on', sub: 'Ready to chat.', action: startChat })
    : presence({ ring: '', hint: 'Press to turn on', head: 'Kalsa is off', sub: 'Press the button to wake it up.' });
}

export const foot = `<div class="foot">${icon('lock', 16)}Your messages and answers stay on this computer.</div>`;

export const home = () => `${rail('home')}<main><div class="center">${hero(true)}</div>${foot}</main>`;
export const homeOff = () => `${rail('home')}<main><div class="center">${hero(false)}</div>${foot}</main>`;

export function update() {
  return `${rail('home')}<main><div class="center" style="padding-bottom:300px">${hero(true)}</div>
    <div class="sheet"><span class="ic">${icon('download', 26)}</span><div><b>A new version of Kalsa is ready</b>
      <div class="wn">What’s new ${icon('down', 16, 2.2)}</div><ul>${NOTES.map(n => `<li>${n}</li>`).join('')}</ul></div>
      <div class="a"><span class="btn">Later</span><span class="btn pri">${icon('refresh', 19)}Restart to update</span></div></div></main>`;
}

const WHEN = ['Today', 'Today', 'Yesterday', 'This week', 'This week'];

/** The chat list popover, under the Chats button. */
export function chatListPop({ rows = CHATS.map((c, i) => ({ t: c, when: WHEN[i], on: i === 0 })), search = '', extra = '' } = {}) {
  return `<div class="scrim"></div><div class="pop"><div class="new">${icon('plus', 19, 2.2)}New chat</div>
    <div class="psearch">${icon('search', 16)}<span class="${search ? '' : 'phd'}">${search || 'Search'}</span><kbd>⌘K</kbd></div>
    ${extra}${rows.map(r => r.raw ?? `<div class="li ${r.on ? 'on' : ''}">${icon('chat', 17)}<span>${r.t}</span><em>${r.when}</em></div>`).join('')}</div>`;
}

/** The composer: a text line, Attach a file, Send (or Stop while Kalsa writes). */
export function composer({ text = '', chips = '', above = '', streaming = false, think = null, extraLeft = '' } = {}) {
  const thinkBtn = think === null ? '' : `<span class="think ${think ? 'on' : ''}">${icon('thought', 18)}Think</span>`;
  const right = streaming
    ? `<span class="send stop">${icon('square', 15, 2.6)}Stop</span>`
    : `<span class="send">Send${icon('up', 18, 2.4)}</span>`;
  return `<div class="dock"><div class="col">${above}<div class="cbox">${chips}<div class="ph ${text ? 'typed' : ''}">${text || 'Write a message…'}</div>
    <div class="r"><span class="att">${icon('clip', 19)}Attach a file</span>${thinkBtn}${extraLeft}<span class="mist">Kalsa can make mistakes. Check important information.</span>${right}</div></div></div></div>`;
}

/** The chat page: header, the thread column, the composer, and any overlay. */
export function chatFrame({ thread, dock = composer(), overlay = '', title = C.title, listOpen = false, files = false, side = '', scrolled = false } = {}) {
  return `${rail('chat')}<main class="${side ? 'with-side' : ''}">
  <div class="ch"><span class="btn ${listOpen ? 'open' : ''}">${icon('sidebar', 18)}Chats ${icon('down', 15, 2.2)}</span><span class="t">${title}</span>
    <span class="btn ${files ? 'open' : ''}">${icon('file', 18)}Files</span><span class="btn">${icon('plus', 18, 2.2)}New chat</span></div>
  <div class="body-row"><div class="convo"><div class="msgs ${scrolled ? 'end' : ''}"><div class="col">${thread}</div></div>${dock}</div>${side}</div>
  ${overlay}</main>`;
}

export const me = text => `<div class="me"><div>${text}</div></div>`;
/** The quiet row under every finished answer: a copy icon (hover tint, a check once copied) and the time. */
export const msgActs = (time = '12:30 PM', state = '') =>
  `<div class="acts"><span class="cp ${state}" title="Copy">${icon(state === 'done' ? 'check' : 'copy', 14, state === 'done' ? 2.4 : 1.8)}</span><time>${time}</time></div>`;

/** One assistant message. `acts: false` for a reply still being written or a failure card. */
export const kalsa = (inner, cls = '', { acts = true, time = '12:30 PM', state = '' } = {}) =>
  `<div class="it"><div class="itc"><div class="bub ${cls}">${inner}</div>${acts ? msgActs(time, state) : ''}</div></div>`;
export const answer1 = kalsa(`<div class="web">${icon('globe', 16)}Searched the web ${icon('right', 15)}</div>
      <p>${C.a1intro}</p><ul>${C.a1bullets.map(b => `<li>${b}</li>`).join('')}</ul><p>${C.a1outro}</p>`);

function chatScreen(listOpen) {
  return chatFrame({
    thread: `${me(C.q1)}${answer1}${me(C.q2)}${kalsa(`<p>${C.a2}<span class="dots"><i></i><i></i><i></i></span></p>`, '', { acts: false })}`,
    dock: composer({ streaming: false }),
    overlay: listOpen ? chatListPop() : '',
    listOpen,
  });
}

export const chat = () => chatScreen(false);
export const chatList = () => chatScreen(true);

export function settings() {
  return `${rail('settings')}<main><div class="set"><h2>Settings</h2>
    <div class="grp">
      <div class="row"><div class="t"><b>Look</b></div><span class="seg"><span class="on">Light</span><span>Dark</span><span>Automatic</span></span></div>
      <div class="row"><div class="t"><b>Language</b></div><span class="sel">English ${icon('down', 16)}</span></div></div>
    <div class="grp">
      <div class="row"><div class="t"><b>Let Kalsa search the web</b><span>Only the search words go online. Your chats stay here.</span></div><span class="sw"></span></div>
      <div class="row"><div class="t"><b>Send error reports</b><span>Helps us fix problems. Never includes your chats.</span></div><span class="sw"></span></div></div>
    <div class="grp">
      <div class="row"><div class="t"><b>AI</b><span>Using ${AI.name}</span></div><span class="lk">Change or see details ${icon('right', 16)}</span></div>
      <div class="row"><div class="t"><b>Version 0.0.3</b></div><span class="btn sm">Check for updates</span></div></div>
  </div></main>`;
}

/** One AI card. `mode` is 'pick' (radio) or 'page' (in use / switch). */
export function card({ chosen, iconName, title, rec, text, space, model, mode, action }) {
  const mark = mode === 'pick'
    ? `<span class="rd">${chosen ? icon('check', 16, 3) : ''}</span>`
    : '';
  return `<div class="opt ${chosen ? 'chosen' : ''}">${mark}<div class="oi">${icon(iconName, 26)}</div>
    <h3>${title}${rec ? `<em>${rec}</em>` : ''}</h3><p>${text}</p>
    <div class="need">${icon('download', 20)}Needs ${space} GB of space</div><small>${model}</small>
    ${action ?? ''}</div>`;
}

export const SMART = { iconName: 'bookOpen', title: 'Smartest', text: 'The most careful, complete answers.', space: AI.space, model: `${AI.name} by ${AI.by}` };
export const QUICK = { iconName: 'zap', title: 'Quickest', text: 'Fast replies. Lighter on your computer.', space: ALT.space, model: `${ALT.name} by ${ALT.by}` };

export function firstStart() {
  return `<div class="solo">${lights()}
    <h1 style="margin-top:0">Welcome to Kalsa</h1><p class="sub">Your own private assistant. It lives on this computer, and your chats never leave it.</p>
    <div class="pw on startb"><div class="face">Start</div></div>
    <p class="hint" style="margin-top:30px">Takes about 10 minutes.</p></div>`;
}

export function firstPick() {
  return `<div class="solo">${lights()}<div class="prog">Step 1 of 2</div>
    <h1 style="margin-top:0">Which one would you like?</h1><p class="sub">Both work well on this computer. You can change later.</p>
    <div class="opts" style="margin-top:38px">${card({ ...SMART, chosen: true, rec: 'Recommended', mode: 'pick' })}${card({ ...QUICK, mode: 'pick' })}</div>
    <span class="go" style="margin-top:36px;padding:0 56px">Continue</span></div>`;
}

export const DETAILS = [
  ['Speed on this computer', '31–46 tokens per second'],
  ['Space on disk', '20.6 GB'],
];

export function aiPage({ banner = '', details = DETAILS, inUse = true, overlay = '' } = {}) {
  const smartAction = inUse ? '<div class="using-now"><i></i>Kalsa is using this one</div>' : '';
  return `${rail('home')}<main><div class="aip"><span class="back">${icon('left', 16, 2.2)}Home</span>
    <h2>Your AI</h2><p class="lead">Kalsa is using the Smartest one. You can switch at any time.</p>${banner}
    <div class="opts">${card({ ...SMART, chosen: true, rec: inUse ? 'In use' : 'Chosen', mode: 'page', action: smartAction })}
      ${card({ ...QUICK, mode: 'page', action: `<span class="btn sm act">${icon('swap', 17)}Switch to Quickest</span>` })}</div>
    <div class="det"><h4>Details ${icon('down', 15, 2.2)}</h4>
      <div class="kvs">${details.map(([k, v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`).join('')}</div></div>
    <div class="xp"><span>${icon('settings', 17)}For experts</span><em>Server settings and sampling ›</em></div>
  </div>${overlay}</main>`;
}

/** The growing-tree page: tree, headline, one bar, one line, a quiet note. */
export function growScreen({ p, head, line = '', note = 'This happens only once.', bar = true, action = '', small = '', indeterminate = false, cls = '' }) {
  const barHtml = !bar ? '' : indeterminate
    ? '<div class="bar ind"><i></i></div>'
    : `<div class="bar"><i style="width:${p * 100}%"></i></div>`;
  return `<div class="solo grow ${cls}">${lights()}
    <div class="tree">${tree(p)}</div>
    <h1>${head}</h1>${barHtml}${line ? `<p class="sub">${line}</p>` : ''}${small ? `<p class="tiny">${small}</p>` : ''}
    ${action || (note ? `<p class="once">${note}</p>` : '')}</div>`;
}

export function growing(i) {
  const f = FRAMES[i];
  return growScreen({ p: f.p, head: f.head, line: f.line, action: f.p >= 1 ? `<span class="go" style="margin-top:26px">${icon('chat', 22, 2)}Start a chat</span>` : '' });
}
