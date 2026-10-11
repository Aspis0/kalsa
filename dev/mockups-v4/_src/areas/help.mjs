// 10 · Help: a contents list on the left, one section on the right. Report a problem lives here.
import { icon } from '../kit.mjs';
import { rail } from '../hearth.mjs';

export const css = `
.help{display:grid;grid-template-columns:300px 1fr;gap:48px;width:1180px;margin:0 auto;padding-top:52px}
.help h2{font-size:38px;line-height:44px;font-weight:600;letter-spacing:-.025em;margin-bottom:18px}
.toc a{display:flex;align-items:center;gap:10px;height:46px;padding:0 16px;border-radius:23px;font-size:16px;color:var(--tx2);text-decoration:none}
.toc a.on{background:var(--ac-soft);color:var(--tx);font-weight:650}
.hsec{padding-top:70px;max-width:780px}
.hsec h3{font-size:30px;line-height:36px;font-weight:650;letter-spacing:-.02em;margin-bottom:14px}
.hsec p{font-size:18px;line-height:29px;color:var(--tx);margin-bottom:12px}
.hsec ul{margin:4px 0 0}
.hsec li{position:relative;padding-left:26px;font-size:18px;line-height:29px;margin-bottom:12px}
.hsec li::before{content:"";position:absolute;left:6px;top:12px;width:8px;height:8px;border-radius:50%;background:var(--ring)}
.hsec b{font-weight:650}
.report{margin-top:22px;background:var(--card);border:1px solid var(--line);border-radius:24px;padding:24px 26px}
.report h4{font-size:21px;font-weight:650;margin-bottom:10px}
.report .big{font-size:19px;line-height:28px;font-weight:600;color:var(--ac-tx);display:flex;gap:12px}
.report .big .i{flex:none;margin-top:4px}
.report .facts{margin-top:10px;color:var(--tx2);font-size:16px;line-height:24px}
.report .ra{display:flex;align-items:center;gap:12px;margin-top:20px}
.report .ra .btn{height:50px}
.report .done{display:flex;align-items:center;gap:8px;color:var(--ac-tx);font-weight:650;font-size:17px}
`;

const SECTIONS = ['What Kalsa is', 'The Room', 'Getting started', 'Home', 'Chatting', 'Files and pictures', 'Web search', 'Interactive answers', 'Connecting a phone', 'When something goes wrong', 'Why Kalsa'];

const BODY = {
  'What Kalsa is': `<p>Kalsa is an AI assistant that runs on your own computer. Your questions are answered here, on this computer, not on a company’s servers. Kalsa also lives on your phone. The two work together:</p>
    <ul><li>The phone has its own small AI, so it works even when the computer is off.</li>
    <li>When the computer is on, the phone can use it as its “brain”: the computer runs a bigger AI and sends the answers to the phone.</li></ul>`,
  'Chatting': `<ul><li>Write in the box and press Enter. Shift+Enter starts a new line.</li>
    <li><b>New chat</b> starts a fresh conversation. <b>Chats</b>, at the top of the chat, lists your past chats: you can search, rename or delete them.</li>
    <li><b>Think</b>: Kalsa reasons before answering. Answers are slower but more careful. Not every AI has it.</li>
    <li><b>Try again</b> appears when an answer fails.</li>
    <li>Kalsa can make mistakes. Check important information.</li></ul>`,
  'When something goes wrong': `<p>During the alpha, Kalsa sends error reports with technical details, and the app’s log when something serious goes wrong. Never your chats or text. You can turn this off in Settings.</p>
    <p>Here, under <b>Report a problem</b>, press <b>Send the log</b>.</p>`,
};

function report(state) {
  const actions = {
    idle: `<span class="btn pri">${icon('send', 18)}Send the log</span><span class="btn">${icon('folder', 18)}Open the log folder</span>`,
    sent: `<span class="done">${icon('check', 19, 2.6)}Sent. Thank you.</span><span class="btn">${icon('folder', 18)}Open the log folder</span>`,
    failed: `<span class="btn pri">${icon('send', 18)}Send the log</span><span class="err">Your network (e.g. a company network) blocks the upload.</span>`,
  }[state];
  return `<div class="report"><h4>Report a problem</h4>
    <p class="big">${icon('lock', 20)}The log never contains your messages, Kalsa’s answers, your files, or any code or key.</p>
    <p class="facts">It holds what Kalsa did and what this computer has: versions, processor, graphics card, memory, errors.</p>
    <div class="ra">${actions}</div></div>`;
}

function help(section, extra = '') {
  return `${rail('help')}<main><div class="help"><div><h2>Help</h2><nav class="toc">${SECTIONS.map(s => `<a class="${s === section ? 'on' : ''}">${s}</a>`).join('')}</nav></div>
    <div class="hsec"><h3>${section}</h3>${BODY[section]}${extra}</div></div></main>`;
}

export const screens = [
  ['10-help', () => help('What Kalsa is'), 'light'],
  ['10-help-open', () => help('Chatting'), 'light'],
  ['10-help-report', () => help('When something goes wrong', report('idle')), 'light'],
  ['10-help-report-sent', () => help('When something goes wrong', report('sent')), 'light'],
  ['10-help-report-failed', () => help('When something goes wrong', report('failed')), 'light'],
];
