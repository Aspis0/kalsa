// 17 · For experts: one page, two sections (Server settings, Sampling), each knob with its (i).
import { icon } from '../kit.mjs';
import { rail } from '../hearth.mjs';

export const css = `
.xpage{width:1040px;margin:0 auto;padding-top:26px}
.xpage .back{margin-bottom:8px}
.xtag{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px;border-radius:14px;background:#F3E3C8;color:#6B4A14;font-size:13px;font-weight:700;letter-spacing:.02em;margin-bottom:8px}
.xpage h2{font-size:34px;line-height:40px;font-weight:600;letter-spacing:-.025em}
.xpage .lead{font-size:17px;line-height:25px;color:var(--tx2);margin-top:4px;max-width:820px}
.xtabs{display:flex;gap:4px;background:var(--rail);border-radius:22px;padding:4px;margin:18px 0 16px;width:max-content}
.xtabs span{padding:0 22px;line-height:38px;border-radius:19px;font-weight:600;color:var(--tx2)}
.xtabs span.on{background:var(--card);color:var(--tx);box-shadow:0 1px 3px rgba(0,0,0,.1)}
.xcard{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:20px 24px}
.xnote{font-size:15px;color:var(--tx2);margin-bottom:14px;display:flex;gap:8px;align-items:center}
.xgrid{display:grid;grid-template-columns:1fr 1fr;gap:16px 36px}
.kf .kl{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:650;margin-bottom:6px}
.kf .kl .info{width:22px;height:22px;border-radius:50%;border:1.5px solid var(--line);display:grid;place-items:center;color:var(--tx3);font-size:12px;font-weight:700}
.kf .kl .info.on{background:var(--ac);border-color:var(--ac);color:var(--ac-ink)}
.kf .kin{height:42px;border-radius:12px;border:1.5px solid var(--line);background:var(--bg);display:flex;align-items:center;padding:0 12px;font-size:15px;color:var(--tx3)}
.kf .kin.v{color:var(--tx);font-weight:600}
.kf .kin.bad{border-color:#C0705E;box-shadow:0 0 0 3px #F6DDD7}
.kf .kin .i{margin-left:auto}
.kf .kh{font-size:13px;line-height:19px;color:var(--tx3);margin-top:5px}
.kf.wide{grid-column:1/-1}
.presets{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.presets span{height:36px;padding:0 14px;border-radius:18px;border:1.5px solid var(--line);display:inline-flex;align-items:center;font-size:14px;font-weight:600;color:var(--tx2)}
.presets span.on{background:var(--ac-soft);border-color:var(--ac);color:var(--ac-tx)}
.ktog{display:flex;align-items:center;gap:12px}
.ktog .sw{width:50px;height:30px}.ktog .sw::after{width:24px;height:24px}
.inforce{margin-top:16px;padding:12px 14px;border-radius:14px;background:var(--rail);font:13px/20px ui-monospace,Menlo,monospace;color:var(--tx2)}
.inforce b{font-family:-apple-system,sans-serif;color:var(--tx);font-weight:650}
.xact{display:flex;align-items:center;gap:14px;margin-top:16px}
.xact .btn{height:48px}
.xact .ok{color:var(--ac-tx);font-weight:600;display:inline-flex;gap:6px;align-items:center}
.kpop{position:absolute;width:420px;background:var(--card);border:1px solid var(--line);border-radius:20px;box-shadow:0 24px 60px -18px var(--sh);padding:18px 20px;z-index:8}
.kpop h5{font-size:17px;font-weight:650;margin-bottom:10px}
.kpop dt{font-size:13px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:.04em;margin-top:10px}
.kpop dd{font-size:15px;line-height:22px;color:var(--tx);margin:2px 0 0}
.sgroup{border-top:1px solid var(--line)}
.sgroup:first-of-type{border-top:0}
.sgroup .sh{display:flex;align-items:center;justify-content:space-between;height:44px;font-size:17px;font-weight:650}
.sgroup .sh em{font-style:normal;color:var(--tx3);font-size:14px;font-weight:500;margin-left:10px}
.sgroup .sb{padding:0 0 12px}
.sgroup .xgrid{row-gap:8px}
.sgroup .kf .kin{height:38px}
.errline{display:flex;gap:8px;align-items:center;margin-top:6px;font-size:13px}
`;

const head = (tab) => `<span class="back">${icon('left', 16, 2.2)}Your AI</span>
  <div class="xtag">${icon('settings', 14)}FOR EXPERTS</div><h2>For experts</h2>
  <p class="lead">Kalsa picks good values for this computer by itself. Change these only if you know what they do.</p>
  <div class="xtabs"><span class="${tab === 'server' ? 'on' : ''}">Server settings</span><span class="${tab === 'sampling' ? 'on' : ''}">Sampling</span></div>`;

const kf = (label, input, help, { info = false, wide = false } = {}) =>
  `<div class="kf ${wide ? 'wide' : ''}"><div class="kl">${label}<span class="info ${info ? 'on' : ''}">i</span></div>${input}${help ? `<p class="kh">${help}</p>` : ''}</div>`;
const inp = (v, val = false, extra = '') => `<div class="kin ${val ? 'v' : ''} ${extra}">${v}</div>`;
const sel = v => `<div class="kin v">${v}${icon('down', 16)}</div>`;

function server({ info = false } = {}) {
  return `${head('server')}<div class="xcard">
    <p class="xnote">${icon('info', 16)}The current server stays as it is. Changes apply next time you turn on.</p>
    <div class="xgrid">
      ${kf('Context size', `<div class="presets"><span class="on">Automatic — 64k</span><span>16k</span><span>32k</span><span>64k</span><span>Maximum — 128k</span></div>`,
        'Automatic is 64k (65,536 tokens). Up to 128k on this computer. The KV cache for 64k tokens uses 2.1 GB.', { info, wide: true })}
      ${kf('Batch size', inp('Automatic'), 'Automatic is 2048.')}
      ${kf('Micro-batch size', inp('Automatic'), 'Automatic is 512.')}
      ${kf('KV cache type', sel('Automatic'), 'Automatic is q8_0.')}
      ${kf('Unload after idle', sel('5 minutes'), 'The model is released from memory after this much sitting idle.')}
      ${kf('Model name', inp('qwen3.6-35b', true), '')}
      ${kf('Internet road', `<div class="ktog"><span class="sw off"></span><span style="color:var(--tx2);font-size:15px">Off</span></div>`, 'The internet road is waiting for the server to run.')}
    </div>
    <div class="inforce"><b>In force:</b> context 65536; batch 2048; micro-batch 512; KV q8_0; flash attention on; GPU layers 99; threads 8; idle unload 300 seconds. Local door: 8080.<br>Run for Tailscale: ‹the commands Kalsa prints›. The phone chats at this computer’s tailnet name.</div>
    <div class="xact"><span class="btn pri">Save settings</span><span class="ok">${icon('check', 16, 2.6)}Saved for the next start.</span></div></div>
    ${info ? `<div class="kpop" style="left:360px;top:300px"><h5>What Context size does</h5><dl>
      <dt>What it is</dt><dd>Context size is how much of the conversation the model can hold while answering.</dd>
      <dt>What it’s for</dt><dd>A larger context can keep more earlier conversation available but uses more memory; this app calculates the safe automatic value for the chosen model and computer.</dd>
      <dt>Usual values</dt><dd>A chat-sized default is usual here — 64k where this computer funds it.</dd></dl></div>` : ''}`;
}

const RAND = [
  ['Temperature', 'Automatic is 0.8 — the server’s own value.'],
  ['Dynamic temperature range', 'Automatic is 0 — the server’s own value.'],
  ['Dynamic temperature exponent', 'Automatic is 1 — the server’s own value.'],
  ['Top K', 'Automatic is 40 — the server’s own value.'],
  ['Top P', 'Automatic is 0.95 — the server’s own value.'],
  ['Minimum probability', 'Automatic is 0.05 — the server’s own value.'],
];
const GROUPS = [['How much it trims', 5], ['Repetition', 8], ['Alternative samplers', 5], ['This answer', 2]];

function sampling({ bad = false } = {}) {
  const fields = RAND.map(([l, h], i) => {
    if (bad && i === 0) return kf(l, inp('12', true, 'bad'), `<span class="err">Temperature must be between 0 and 10; got 12.</span>`);
    return kf(l, inp('Automatic'), h);
  }).join('');
  return `${head('sampling')}<div class="xcard">
    <p class="xnote">${icon('info', 16)}Saved choices change the next message you send. Nothing restarts, and the assistant keeps running.</p>
    <div class="sgroup"><div class="sh"><span>Randomness<em>6 settings</em></span>${icon('down', 18)}</div><div class="sb"><div class="xgrid">${fields}</div></div></div>
    ${GROUPS.map(([g, n]) => `<div class="sgroup"><div class="sh"><span>${g}<em>${n} settings</em></span>${icon('right', 18)}</div></div>`).join('')}
    <div class="xact"><span class="btn pri">Save sampling</span>${bad ? '<span class="err">Could not save. Your next message still uses the previously saved values.</span>' : ''}</div></div>`;
}

const page = inner => `${rail('home')}<main><div class="xpage">${inner}</div></main>`;

export const screens = [
  ['17-advanced-entry', () => page(`${head('none').replace('<div class="xtabs">', '<div class="xtabs" style="display:none">')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:22px">
      <div class="xcard"><div class="xtag" style="background:var(--ac-soft);color:var(--ac-tx)">${icon('cpu', 14)}SERVER</div><h3 style="font-size:22px;font-weight:650">Server settings</h3><p style="color:var(--tx2);margin:6px 0 14px">Context size, batch, cache, idle unload, internet road. Changes apply next time you turn on.</p><span class="btn sm">Open ${icon('right', 15)}</span></div>
      <div class="xcard"><div class="xtag" style="background:var(--ac-soft);color:var(--ac-tx)">${icon('sliders', 14)}MESSAGES</div><h3 style="font-size:22px;font-weight:650">Sampling</h3><p style="color:var(--tx2);margin:6px 0 14px">Temperature, Top K, Top P, repetition. Saved choices change the next message you send.</p><span class="btn sm">Open ${icon('right', 15)}</span></div>
    </div>`), 'light'],
  ['17-advanced-server', () => page(server()), 'light'],
  ['17-advanced-knob-info', () => page(server({ info: true })), 'light'],
  ['17-advanced-sampling', () => page(sampling()), 'light'],
  ['17-advanced-sampling-error', () => page(sampling({ bad: true })), 'light'],
];
