// 13 · First-run states: check, its failure, already-downloaded pick, too weak, confirm,
// getting ready, resumed download, tuning, tune cut short, and the walk's failures.
import { icon, lights } from '../kit.mjs';
import { card, SMART, QUICK, growScreen, startChat } from '../hearth.mjs';

export const css = `
.frerr{display:flex;flex-direction:column;align-items:center;gap:14px;margin-top:22px;max-width:560px}
.frerr p{color:#9B3B2E;font-size:17px;font-weight:600;line-height:25px}
.fr-ic{width:96px;height:96px;border-radius:50%;background:var(--rail);color:var(--tx2);display:grid;place-items:center;margin-bottom:26px}
.fr-ic.warn{background:#F3E3C8;color:#7A5418}
.fr-acts{display:flex;gap:14px;margin-top:34px;align-items:center}
.fr-acts .go{margin-top:0}
.fr-acts .btn{height:60px;padding:0 30px;border-radius:30px;font-size:19px}
.details-link{margin-top:18px;color:var(--ac-tx);font-weight:600;display:inline-flex;align-items:center;gap:6px}
.opt .ondisk{display:flex;align-items:center;gap:8px;margin-top:20px;padding-top:18px;border-top:1px solid var(--line);font-size:17px;font-weight:600;color:var(--ac-tx)}
`;

const solo = inner => `<div class="solo">${lights()}${inner}</div>`;
const tryAgain = `<span class="go" style="margin-top:0">${icon('refresh', 21, 2.2)}Try again</span>`;

function pickOnDisk() {
  const smart = card({ ...SMART, chosen: true, rec: 'Recommended', mode: 'pick' })
    .replace(/<div class="need">[\s\S]*?<\/div>/, `<div class="ondisk">${icon('check', 20, 2.4)}Already on your computer</div>`);
  return solo(`<div class="prog">Step 1 of 2</div>
    <h1 style="margin-top:0">Which one would you like?</h1><p class="sub">Both work well on this computer. You can change later.</p>
    <div class="opts" style="margin-top:38px">${smart}${card({ ...QUICK, mode: 'pick' })}</div>
    <span class="go" style="margin-top:36px;padding:0 56px">Continue</span>`);
}

export const screens = [
  ['13-first-run-check-failed', () => solo(`
    <h1 style="margin-top:0">Welcome to Kalsa</h1><p class="sub">Your own private assistant. It lives on this computer, and your chats never leave it.</p>
    <div class="pw on startb"><div class="face">Start</div></div>
    <div class="frerr"><p>Kalsa couldn’t check this computer. Wait a moment and try again.</p><span class="btn sm">${icon('refresh', 17)}Try again</span></div>`), 'light'],
  ['13-first-run-checking', () => growScreen({ p: 0.12, head: 'Checking your computer…', indeterminate: true, note: '' }), 'light'],
  ['13-first-run-pick-on-disk', () => pickOnDisk(), 'light'],
  ['13-first-run-too-weak', () => solo(`<div class="fr-ic warn">${icon('laptop', 46, 1.7)}</div>
    <h1 style="margin-top:0">Kalsa can’t run well on this computer yet</h1>
    <p class="sub">Kalsa doesn’t have an AI that runs well on this computer yet. Check for an app update.</p>
    <div class="fr-acts"><span class="go">${icon('refresh', 21, 2.2)}Check for updates</span></div>
    <p class="hint" style="margin-top:22px">Kalsa will not start on a computer where it would be too slow.</p>`), 'light'],
  ['13-first-run-confirm', () => solo(`<div class="prog">Step 2 of 2</div><div class="fr-ic">${icon('download', 44, 1.8)}</div>
    <h1 style="margin-top:0">Download 20.6 GB?</h1>
    <p class="sub">Kalsa needs these files to answer with Qwen 3.6.</p>
    <div class="fr-acts"><span class="btn">Cancel</span><span class="go">${icon('download', 21, 2.2)}Download</span></div>`), 'light'],
  ['13-first-run-getting-ready', () => growScreen({ p: 0.12, head: 'Getting ready…', indeterminate: true }), 'light'],
  ['13-first-run-resumed', () => growScreen({ p: 0.45, head: 'Downloading Kalsa’s AI…', line: 'Picking up where it stopped — 2.1 of 4.6 GB · about 3 minutes left' }), 'light'],
  ['13-first-run-tuning', () => growScreen({ p: 0.78, head: 'Finding the fastest settings for this computer…', line: 'About 4 minutes left', small: 'Test 2 of 6',
    note: 'This happens only once. You can minimize Kalsa and keep using your computer.' }), 'light'],
  ['13-first-run-tune-cut', () => growScreen({ p: 1, head: 'Kalsa is ready', line: 'Kalsa will finish testing next time it starts.', note: '',
    action: `<span class="go" style="margin-top:26px">${icon('chat', 22, 2)}Start a chat</span>` }), 'light'],
  ['13-first-run-failed-connection', () => growScreen({ p: 0.35, cls: 'failed', head: 'Kalsa couldn’t get ready.',
    line: 'Kalsa couldn’t download what it needs. Check your connection and try again.', note: '',
    action: `<div class="fr-acts" style="margin-top:26px">${tryAgain}</div><span class="details-link">Show details ${icon('down', 15, 2.2)}</span>` }), 'light'],
  ['13-first-run-failed-disk', () => growScreen({ p: 0.35, cls: 'failed', head: 'Kalsa couldn’t get ready.',
    line: 'Kalsa needs more space. Free up 6 GB and try again.', note: '',
    action: `<div class="fr-acts" style="margin-top:26px">${tryAgain}</div><span class="details-link">Show details ${icon('down', 15, 2.2)}</span>` }), 'light'],
];

export { startChat };
