// Shared overlays for every area: banners, a modal dialog, a toast, a status page.
import { icon } from '../kit.mjs';

export const screens = [];

export const css = `
.banner{display:flex;align-items:center;gap:16px;margin:18px 28px 0;padding:16px 18px 16px 20px;border-radius:20px;background:var(--card);border:1px solid var(--line);font-size:16px;line-height:24px;position:relative;z-index:3}
.banner .bi{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;flex:none;background:var(--ac-soft);color:var(--ac-tx)}
.banner.warn .bi{background:#F3E3C8;color:#7A5418}
.dark .banner.warn .bi{background:#3A3022;color:#E8C489}
.banner .bt{flex:1}
.banner .bt b{display:block;font-size:17px;font-weight:650}
.banner .bt span{color:var(--tx2)}
.banner .btn{height:44px;padding:0 18px;font-size:16px;border-radius:22px}
.float-top{position:absolute;top:0;left:0;right:0;z-index:6}
.modal-scrim{position:absolute;inset:0;background:rgba(35,38,30,.28);z-index:8}
.dark .modal-scrim{background:rgba(0,0,0,.5)}
.modal{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:560px;background:var(--card);border:1px solid var(--line);border-radius:28px;box-shadow:0 30px 80px -20px var(--sh);padding:30px 32px 26px;z-index:9}
.modal .mi{width:56px;height:56px;border-radius:50%;background:var(--ac-soft);color:var(--ac-tx);display:grid;place-items:center;margin-bottom:18px}
.modal .mi.warn{background:#F3E3C8;color:#7A5418}
.modal h3{font-size:24px;line-height:31px;font-weight:650;letter-spacing:-.01em}
.modal p{color:var(--tx2);font-size:17px;line-height:26px;margin-top:8px}
.modal .ma{display:flex;justify-content:flex-end;gap:12px;margin-top:26px}
.btn.danger{background:#9B3B2E;border-color:#9B3B2E;color:#fff}
.toast{position:absolute;left:50%;bottom:30px;transform:translateX(-50%);display:flex;align-items:center;gap:14px;background:var(--tx);color:var(--bg);border-radius:26px;padding:12px 14px 12px 22px;font-size:16px;font-weight:500;box-shadow:0 16px 40px -14px var(--sh);z-index:7;white-space:nowrap}
.toast .tl{color:var(--bg);font-weight:650;opacity:.85}
.toast .tb{height:38px;padding:0 16px;border-radius:19px;background:rgba(255,255,255,.14);display:inline-flex;align-items:center;font-weight:600}
.dark .toast .tb{background:rgba(0,0,0,.12)}
.page{width:760px;margin:0 auto;padding-top:56px}
.page h2{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI Variable Display",system-ui,sans-serif;font-size:38px;line-height:44px;font-weight:600;letter-spacing:-.025em}
.page .lead{font-size:19px;line-height:28px;color:var(--tx2);margin-top:6px}
.note{display:flex;gap:12px;align-items:flex-start;padding:14px 18px;border-radius:16px;background:var(--rail);color:var(--tx2);font-size:15px;line-height:22px}
.note .i{flex:none;margin-top:2px;color:var(--tx3)}
.err{color:#9B3B2E;font-weight:600}
.dark .err{color:#F0A08F}
`;

/** A banner across the top of the page. tone: '' | 'warn'. */
export function banner({ ic = 'info', title = '', text, actions = '', tone = '' }) {
  return `<div class="banner ${tone}"><span class="bi">${icon(ic, 20)}</span><div class="bt">${title ? `<b>${title}</b>` : ''}<span>${text}</span></div>${actions}</div>`;
}

export function modal({ ic = 'info', tone = '', title, body = '', actions, extra = '' }) {
  return `<div class="modal-scrim"></div><div class="modal"><div class="mi ${tone}">${icon(ic, 26)}</div><h3>${title}</h3>${body ? `<p>${body}</p>` : ''}${extra}<div class="ma">${actions}</div></div>`;
}

export function toast(text, action = '') {
  return `<div class="toast"><span>${text}</span>${action ? `<span class="tb">${action}</span>` : ''}</div>`;
}

export const btn = (label, cls = '', ic = '') => `<span class="btn ${cls}">${ic ? icon(ic, 18) : ''}${label}</span>`;
