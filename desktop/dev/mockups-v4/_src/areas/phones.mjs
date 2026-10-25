// 09 · Phones: off, code loading, the square, the Allow prompt, the paired list, invites, errors.
import { icon } from '../kit.mjs';
import { rail } from '../hearth.mjs';

export const css = `
.ph-page{width:1000px;margin:0 auto;padding-top:52px}
.ph-page h2{font-size:38px;line-height:44px;font-weight:600;letter-spacing:-.025em}
.ph-page .lead{font-size:19px;line-height:28px;color:var(--tx2);margin-top:6px}
.ph-grid{display:grid;grid-template-columns:360px 1fr;gap:48px;margin-top:30px;align-items:start}
.qr{width:360px;height:360px;border-radius:28px;background:#fff;border:1px solid var(--line);display:grid;place-items:center;box-shadow:0 18px 40px -24px var(--sh)}
.qr.wait{background:var(--card);color:var(--tx3);text-align:center;padding:40px;font-size:16px;line-height:24px}
.qr.wait .spin{width:36px;height:36px;border-width:4px;margin:0 auto 18px}
.steps2 li{display:flex;gap:16px;margin-bottom:22px;font-size:18px;line-height:27px}
.steps2 .n{width:36px;height:36px;border-radius:50%;background:var(--ac-soft);color:var(--ac-tx);display:grid;place-items:center;font-weight:700;flex:none}
.ph-sub{font-size:16px;color:var(--tx3);line-height:24px;margin-top:4px}
.invite-box{margin-top:26px;padding:20px 22px;border-radius:22px;border:1px solid var(--line);background:var(--card)}
.invite-box b{display:flex;align-items:center;gap:8px;font-size:17px;font-weight:650}
.invite-box p{color:var(--tx2);font-size:15px;line-height:22px;margin:4px 0 14px}
.invite-box .btn{height:46px;padding:0 20px;font-size:16px;border-radius:23px}
.dev{display:flex;align-items:center;gap:16px;padding:16px 22px;border-top:1px solid var(--line)}
.dev:first-child{border-top:0}
.dev .di3{width:46px;height:46px;border-radius:14px;background:var(--rail);color:var(--tx2);display:grid;place-items:center;flex:none}
.dev .di3.live{background:var(--ac-soft);color:var(--ac-tx)}
.dev .dt{flex:1}
.dev .dt b{display:block;font-size:17px;font-weight:650}
.dev .dt span{color:var(--tx2);font-size:15px}
.dev .ok{display:inline-flex;align-items:center;gap:6px;color:var(--ac-tx);font-weight:600}
.dev .btn{height:46px;padding:0 20px;font-size:16px;border-radius:23px}
.dev.ask{background:var(--ac-soft);border-radius:22px;border-top:0;margin:8px}
.dev.ask .di3{background:var(--card);color:var(--ac-tx)}
.allowcard{margin-top:22px;max-width:760px;display:flex;align-items:center;gap:22px;padding:26px 28px;border-radius:28px;background:var(--card);border:2px solid var(--ac);box-shadow:0 18px 40px -24px var(--sh)}
.allowcard .ai2{width:72px;height:72px;border-radius:22px;background:var(--ac-soft);color:var(--ac-tx);display:grid;place-items:center;flex:none}
.allowcard .at{flex:1}
.allowcard .at b{display:block;font-size:24px;font-weight:650}
.allowcard .at span{display:block;color:var(--tx2);font-size:16px;margin-top:2px}
.allowcard .btn{height:56px;padding:0 26px;font-size:18px;border-radius:28px}
.claim{max-width:760px;display:flex;align-items:center;gap:12px;margin-top:22px;padding:14px 18px;border-radius:18px;background:var(--ac-soft);color:var(--ac-tx);font-weight:600;font-size:17px}
.linkf{display:flex;align-items:center;gap:10px;height:50px;padding:0 8px 0 16px;border-radius:16px;border:1.5px solid var(--ac);background:var(--bg);font:15px ui-monospace,Menlo,monospace;color:var(--tx);margin:14px 0 6px}
.linkf .btn{margin-left:auto;height:38px;padding:0 14px;font:600 15px -apple-system,sans-serif;border-radius:19px}
.inv{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--line)}
.inv>span:first-child{flex:1;color:var(--tx2)}
.inv .btn{height:40px;padding:0 16px;font-size:15px;border-radius:20px}
.ph-err{margin-top:30px;display:flex;gap:16px;align-items:flex-start;padding:22px 24px;border-radius:24px;background:#FBF1EE;border:1px solid #EBCFC8;max-width:760px}
.ph-err .ei{width:46px;height:46px;border-radius:50%;background:#F6DDD7;color:#9B3B2E;display:grid;place-items:center;flex:none}
.ph-err b{display:block;font-size:19px;font-weight:650}
.ph-err p{color:var(--tx2);margin:4px 0 14px}
.ph-err .btn{height:46px;padding:0 20px;font-size:16px;border-radius:23px}
`;

/** A deterministic QR-like square: three finder patterns and seeded modules. */
function qr(size = 300) {
  const n = 29, c = size / n;
  let seed = 7;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const finder = (x, y) => `<rect x="${x * c}" y="${y * c}" width="${7 * c}" height="${7 * c}" fill="#1F2A1B"/><rect x="${(x + 1) * c}" y="${(y + 1) * c}" width="${5 * c}" height="${5 * c}" fill="#fff"/><rect x="${(x + 2) * c}" y="${(y + 2) * c}" width="${3 * c}" height="${3 * c}" fill="#1F2A1B"/>`;
  let mods = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const inF = (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
    const inLogo = x > 11 && x < 17 && y > 11 && y < 17;
    if (!inF && !inLogo && rnd() > 0.52) mods += `<rect x="${x * c}" y="${y * c}" width="${c}" height="${c}" rx="${c * 0.25}" fill="#1F2A1B"/>`;
  }
  const mid = size / 2;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${mods}${finder(0, 0)}${finder(n - 7, 0)}${finder(0, n - 7)}
    <rect x="${mid - 28}" y="${mid - 28}" width="56" height="56" rx="16" fill="#3F6B3A"/><g transform="translate(${mid - 13} ${mid - 13}) scale(1.08)" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></g></svg>`;
}

const page = inner => `${rail('phones')}<main><div class="ph-page">${inner}</div></main>`;
const inviteBox = `<div class="invite-box"><b>Someone not at home?</b><p>To add someone who is not at home, use Invite by link. The link works once and expires.</p><span class="btn">${icon('link', 17)}Invite by link</span></div>`;
const steps = `<ol class="steps2"><li><span class="n">1</span><div>Open Kalsa on your phone.</div></li>
  <li><span class="n">2</span><div>Point your phone’s camera at the square.<p class="ph-sub">Anyone who can see this square can connect a phone — show it only to yours.</p></div></li>
  <li><span class="n">3</span><div>Press <b>Allow</b> here when your phone asks.</div></li></ol>
  <p class="ph-sub">If several phones ask at the same time, some may have to wait their turn.</p>`;

const devRow = (ic, name, line, right, cls = '') => `<div class="dev ${cls}"><span class="di3 ${cls.includes('live') ? 'live' : ''}">${icon(ic, 22)}</span><div class="dt"><b>${name}</b><span>${line}</span></div>${right}</div>`;

export const screens = [
  ['09-phones-off', () => page(`<h2>Phones</h2><p class="lead">Use Kalsa from your phone, anywhere at home.</p>
    <div class="ph-err" style="background:var(--card);border-color:var(--line)"><span class="ei" style="background:var(--rail);color:var(--tx2)">${icon('power', 22)}</span><div><b>Kalsa is off</b><p>This computer is not running yet, so there is nothing for your phone to connect to.</p><span class="btn pri">${icon('power', 17)}Turn Kalsa on</span></div></div>`), 'light'],
  ['09-phones-loading', () => page(`<h2>Connect a phone</h2><p class="lead">Use Kalsa from your phone, anywhere at home.</p>
    <div class="ph-grid"><div class="qr wait"><div><span class="spin" style="display:block"></span>The code is almost ready. It will appear here in a moment.</div></div><div>${steps}</div></div>`), 'light'],
  ['09-phones-square', () => page(`<h2>Connect a phone</h2><p class="lead">Use Kalsa from your phone, anywhere at home.</p>
    <div class="ph-grid"><div class="qr">${qr()}</div><div>${steps}${inviteBox}</div></div>`), 'light'],
  ['09-phones-allow', () => page(`<h2>Connect a phone</h2>
    <div class="claim">${icon('phone', 20)}A phone is connecting. Choose Allow or Refuse below.</div>
    <div class="allowcard"><span class="ai2">${icon('phone', 34, 1.8)}</span><div class="at"><b>Phone 2</b><span>Phone with its own AI</span><span>Waiting for your OK.</span></div>
      <span class="btn">Refuse</span><span class="btn pri">${icon('check', 20, 2.4)}Allow</span></div>
    <p class="ph-sub" style="margin-top:14px">Only press Allow if this is a phone you know.</p>
    <span class="btn" style="margin-top:20px">Cancel</span>`), 'light'],
  ['09-phones-paired', () => page(`<h2>Your phones</h2><p class="lead">Kalsa now works with Giulia’s phone.</p>
    <div class="grp" style="margin-top:24px">
      ${devRow('laptop', 'This computer', 'Kalsa runs here.', `<span class="ok">${icon('check', 16, 2.6)}Connected</span>`, 'live')}
      ${devRow('phone', 'Giulia’s phone', 'Giulia’s phone is connected.', `<span class="ok">${icon('check', 16, 2.6)}Connected</span><span class="btn">Remove</span>`, 'live')}
      ${devRow('phone', 'Phone 3', 'Waiting for your OK.', `<span class="btn">Refuse</span><span class="btn pri">${icon('check', 18, 2.4)}Allow</span>`)}</div>
    <div style="display:flex;gap:12px;margin-top:20px"><span class="btn pri">${icon('plus', 18, 2.2)}Pair another phone</span><span class="btn">${icon('link', 17)}Invite by link</span></div>`), 'light'],
  ['09-phones-invite', () => page(`<h2>Invite by link</h2><p class="lead">For someone who is not at home. The link works once and expires.</p>
    <div class="invite-box" style="max-width:760px"><b>${icon('check', 16, 2.6)} Link copied.</b><p>It works once, until tomorrow at 9:30. Send it only to the person you want to add.</p>
      <div class="linkf">kalsa://pair/7Q4K-M2PX-HV9D…<span class="btn">${icon('copy', 15)}Copy link</span></div>
      <div class="inv"><span>Expires tomorrow at 9:30</span><span class="btn">${icon('copy', 15)}Copy link</span><span class="btn">Cancel invite</span></div>
      <div class="inv"><span>Expires today at 18:10</span><span class="btn">${icon('copy', 15)}Copy link</span><span class="btn">Cancel invite</span></div></div>`), 'light'],
  ['09-phones-error', () => page(`<h2>Phones</h2><p class="lead">Use Kalsa from your phone, anywhere at home.</p>
    <div class="ph-err"><span class="ei">${icon('alert', 22)}</span><div><b>Kalsa couldn’t save this phone.</b><p>Connect it again, or send a new invite.</p><span class="btn pri">${icon('refresh', 17)}Try again</span></div></div>
    <div class="ph-err"><span class="ei">${icon('wifiOff', 22)}</span><div><b>Phones can’t connect right now.</b><p>Restart Kalsa to fix it.</p><span class="btn">Turn Kalsa on</span></div></div>`), 'light'],
];
