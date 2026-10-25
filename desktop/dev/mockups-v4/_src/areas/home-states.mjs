// 14 · Home states: starting, stopping, failures, resting, phone in use, throttled,
// notices over Home, and the Your AI page's live and off faces.
import { icon } from '../kit.mjs';
import { rail, presence, startChat, foot, aiPage, DETAILS, hero } from '../hearth.mjs';
import { banner, btn } from './ui.mjs';

export const css = `
.home-note{display:flex;gap:12px;align-items:center;max-width:560px;margin-top:22px;padding:14px 18px;border-radius:18px;background:#F3E3C8;color:#5E4214;font-size:16px;line-height:23px;text-align:left}
.dark .home-note{background:#3A3022;color:#F0D7A8}
.home-note .i{flex:none}
.retry{display:inline-flex;align-items:center;gap:10px;height:60px;padding:0 34px;border-radius:30px;background:var(--ac);color:var(--ac-ink);font-size:19px;font-weight:600;margin-top:30px}
.quietline{margin-top:18px;font-size:16px;color:var(--tx3)}
.det .small2{padding:10px 0 14px;border-top:1px solid var(--line);font-size:14px;color:var(--tx3)}
.aip .banner{margin:0 0 22px}
`;

const page = (inner, top = '') => `${rail('home')}<main>${top}<div class="center">${inner}</div>${foot}</main>`;
const retry = `<span class="retry">${icon('refresh', 21, 2.2)}Try again</span>`;

export const screens = [
  ['14-home-states-starting', () => page(presence({ ring: 'busy', head: 'Kalsa is starting…', sub: 'Getting ready. On a slower computer this can take a minute.' })), 'light'],
  ['14-home-states-stopping', () => page(presence({ ring: 'busy', head: 'Kalsa is turning off…', sub: 'Next time it starts with your choice.' })), 'light'],
  ['14-home-states-stopped', () => page(presence({ ring: 'warn', hint: 'Press to try again', head: 'Kalsa stopped', sub: 'Kalsa stopped by itself. Turn it on again.', action: retry })), 'light'],
  ['14-home-states-did-not-start', () => page(presence({ ring: 'warn', hint: 'Press to try again', head: 'Kalsa couldn’t start', sub: 'Kalsa needs more space. Free up 6 GB and try again.', action: retry })), 'light'],
  ['14-home-states-not-known', () => page(presence({ ring: '', head: 'Kalsa’s state is unknown', sub: 'Kalsa’s state couldn’t be read. Try again.', action: retry, using: false })), 'light'],
  ['14-home-states-resting', () => page(presence({ ring: 'rest', hint: 'Press to turn off', head: 'Kalsa is resting', sub: 'Kalsa is resting to free up memory. Your next message wakes it up in a few seconds.', action: startChat })), 'light'],
  ['14-home-states-phone-in-use', () => page(presence({ hint: 'Press to turn off', head: 'Kalsa is on', sub: 'Your phone is using this computer right now.', action: startChat })), 'light'],
  ['14-home-states-throttled', () => page(presence({ hint: 'Press to turn off', head: 'Kalsa is on', sub: 'Ready to chat.', action: startChat,
    extra: `<div class="home-note">${icon('alert', 20)}<span>This computer is running slower on purpose, to protect itself. Answers take longer than usual.</span></div>` })), 'light'],
  ['14-home-states-stop-failed', () => page(presence({ ring: 'warn', head: 'Kalsa didn’t turn off', sub: 'Close this window to stop it.', action: '' })), 'light'],
  ['14-home-states-checking-ai', () => page(presence({ ring: 'busy', face: icon('leaf', 50, 2), head: 'Checking the AI already on your computer…', sub: 'This happens once, after an update.', using: false })), 'light'],
  ['14-home-states-recovered', () => page(hero(true), `<div class="float-top">${banner({ ic: 'refresh', text: 'Kalsa recovered from an error.', actions: btn('Send the log') + btn('Dismiss') })}</div>`), 'light'],
  ['14-home-states-telemetry-notice', () => page(hero(true), `<div class="float-top">${banner({ ic: 'shield', title: 'Error reports are on during the alpha',
    text: 'During the alpha, Kalsa sends error reports with technical details, and the app’s log when something serious goes wrong. Never your chats or text. You can turn this off in Settings.', actions: btn('Dismiss') })}</div>`), 'light'],
  ['14-home-states-ai-details-live', () => aiPage({ details: [
    ['Speed right now', '38 tokens per second'],
    ...DETAILS,
    ['Phones connected now', '1'],
  ] }), 'light'],
  ['14-home-states-ai-off', () => aiPage({ inUse: false,
    banner: banner({ ic: 'power', text: 'Kalsa is off. Go to Home to start it.', actions: btn('Turn Kalsa on', 'pri', 'power') }) }), 'light'],
];
