// 18 · Dialogs and notices: rename, delete, switch AI, the crash screen, and a board of every banner.
import { icon } from '../kit.mjs';
import { rail, chatFrame, chatListPop, me, answer1, aiPage } from '../hearth.mjs';
import { CHATS, CHAT as C, AI, ALT } from '../data.mjs';
import { banner, modal, btn, toast } from './ui.mjs';

export const css = `
.li.edit{background:var(--bg);box-shadow:inset 0 0 0 1.5px var(--ac);border-radius:14px}
.li.edit span{color:var(--tx)}
.li.edit .sel2{background:var(--ac-soft);border-radius:4px;padding:1px 2px}
.li.hov{background:var(--rail)}
.li .ra2{display:flex;gap:4px;margin-left:auto;flex:none}
.li .ra2 b{display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 10px;border-radius:16px;font-size:13px;font-weight:600;color:var(--tx2);background:var(--card);border:1px solid var(--line)}
.crash{display:flex;flex-direction:column;align-items:center;text-align:center;padding-top:90px;width:760px;margin:0 auto}
.crash .ci{width:84px;height:84px;border-radius:50%;background:#F3E3C8;color:#7A5418;display:grid;place-items:center;margin-bottom:22px}
.crash h2{font-size:34px;line-height:40px;font-weight:600;letter-spacing:-.02em}
.crash p.s{font-size:19px;line-height:28px;color:var(--tx2);margin-top:8px}
.crash .report{text-align:left;width:100%}
.crash .ca{display:flex;gap:12px;margin-top:22px}
.board{width:980px;margin:0 auto;padding-top:36px}
.board h2{font-size:30px;font-weight:600;letter-spacing:-.02em;margin-bottom:4px}
.board .lead{color:var(--tx2);margin-bottom:8px}
.board .banner{margin:12px 0 0}
.board .toasts{display:flex;gap:14px;margin-top:22px}
.board .toasts .toast{position:static;transform:none}
`;

const rows = CHATS.map((c, i) => ({ t: c, when: ['Today', 'Today', 'Yesterday', 'This week', 'This week'][i], on: i === 0 }));

export const screens = [
  ['18-dialogs-rename', () => chatFrame({
    listOpen: true, thread: `${me(C.q1)}${answer1}`,
    overlay: chatListPop({ rows: [
      { raw: `<div class="li edit">${icon('pencil', 17)}<span><span class="sel2">Mutuo: fisso o variabile</span></span><em>Enter to save</em></div>` },
      { raw: `<div class="li hov">${icon('chat', 17)}<span>${CHATS[1]}</span><span class="ra2"><b>${icon('pencil', 13)}Rename</b><b>${icon('trash', 13)}Delete</b></span></div>` },
      ...rows.slice(2),
    ] }),
  }), 'light'],
  ['18-dialogs-delete', () => chatFrame({
    thread: `${me(C.q1)}${answer1}`,
    overlay: modal({ ic: 'trash', tone: 'warn', title: 'Delete this conversation?', body: '“Mutuo: fisso o variabile”', actions: btn('Cancel') + btn('Delete', 'danger', 'trash') }),
  }), 'light'],
  ['18-dialogs-switch-ai', () => aiPage({ overlay: modal({ ic: 'swap', title: 'Switch to Quickest?',
    body: `Kalsa will restart with ${ALT.name}. If it’s not on this computer yet, it downloads it first (4.6 GB), so it takes a while.`,
    actions: btn('Cancel') + btn(`Switch Kalsa to ${ALT.name}`, 'pri', 'swap') }) }), 'light'],
  ['18-dialogs-crash', () => `${rail('chat')}<main><div class="crash"><div class="ci">${icon('alert', 38, 1.8)}</div>
    <h2>Kalsa couldn’t show this conversation.</h2><p class="s">Reload the app. If it still doesn’t open, erase saved conversations. Your settings stay safe.</p>
    <div class="report"><h4>Report a problem</h4><p class="big">${icon('lock', 20)}The log never contains your messages, Kalsa’s answers, your files, or any code or key.</p>
      <p class="facts">It holds what Kalsa did and what this computer has: versions, processor, graphics card, memory, errors.</p>
      <div class="ra"><span class="btn">${icon('send', 18)}Send the log</span></div></div>
    <div class="ca"><span class="btn pri">${icon('refresh', 18)}Reload the app</span><span class="btn">Erase saved conversations and start fresh</span></div></div></main>`, 'light'],
  ['18-dialogs-notices', () => `${rail('home')}<main><div class="board"><h2>Notices</h2><p class="lead">Every banner and toast, in one place. Each appears at the top of the page it belongs to.</p>
    ${banner({ tone: 'warn', ic: 'hdd', text: 'Kalsa’s storage is full, so new messages won’t be saved. Delete old conversations to make room.', actions: btn('Dismiss') })}
    ${banner({ tone: 'warn', ic: 'alert', text: 'Kalsa couldn’t open this conversation. Try again.', actions: btn('Dismiss') })}
    ${banner({ ic: 'clock', text: 'Waiting for Kalsa…' })}
    ${banner({ tone: 'warn', ic: 'alert', text: 'This is too much for Kalsa at once. Remove a file or shorten your message.', actions: btn('Dismiss') })}
    ${banner({ ic: 'shield', text: 'During the alpha, Kalsa sends error reports with technical details, and the app’s log when something serious goes wrong. Never your chats or text. You can turn this off in Settings.', actions: btn('Dismiss') })}
    ${banner({ ic: 'refresh', text: 'Kalsa recovered from an error.', actions: btn('Send the log') + btn('Dismiss') })}
    ${banner({ ic: 'download', text: 'Kalsa is writing a reply. Install when it finishes.' })}
    <div class="toasts">${toast('Link copied. It works once, for one day.')}${toast('Saved for the next start.')}${toast('Contratto.pdf attached.')}</div>
  </div></main>`, 'light'],
];

export { AI };
