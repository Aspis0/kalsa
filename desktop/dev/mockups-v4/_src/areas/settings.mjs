// 08 · Settings, and 15 · every face of Updates (in Settings and over Home).
import { icon } from '../kit.mjs';
import { rail, hero } from '../hearth.mjs';
import { AI, NOTES } from '../data.mjs';

export const css = `
.set .row{min-height:70px;padding:14px 24px}
.row .t .more{display:inline-flex;align-items:center;gap:4px;color:var(--ac-tx);font-weight:600;font-size:15px;margin-top:4px}
.rownote{padding:0 24px 18px;margin-top:-6px;color:var(--tx2);font-size:15px;line-height:23px}
.rownote p{padding:14px 16px;border-radius:14px;background:var(--rail)}
.row .t .err{display:block;margin-top:4px;font-size:15px}
.sw.off{background:#CFC8B6}.sw.off::after{right:auto;left:3px}
.lede{display:flex;align-items:center;gap:8px;justify-content:center;color:var(--tx3);font-size:15px;margin-top:20px}
.upd{margin:0 24px 20px;padding:16px 18px;border-radius:18px;background:var(--ac-soft)}
.upd b{display:block;font-size:17px;font-weight:650}
.upd .wn2{display:inline-flex;align-items:center;gap:6px;color:var(--ac-tx);font-weight:600;margin-top:4px}
.upd ul{margin:6px 0 0;color:var(--tx2)}
.upd li{line-height:27px;display:flex;gap:10px;align-items:center}
.upd li::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--ring);flex:none}
.upd .ua{display:flex;gap:10px;align-items:center;margin-top:14px}
.upd .ua .btn{height:46px;padding:0 20px;font-size:16px;border-radius:23px}
.upd.bad{background:#FBF1EE}
.upd.bad b{color:#9B3B2E}
.prog2{height:12px;border-radius:6px;background:var(--card);margin-top:10px;overflow:hidden}
.prog2 i{display:block;height:100%;border-radius:6px;background:var(--ac)}
.btn.dis{opacity:.5}
.row .t .okline{display:flex;align-items:center;gap:6px;color:var(--ac-tx);font-weight:600;font-size:15px;margin-top:3px}
.sheet .err{display:block;margin-top:8px}
`;

const sw = (on = true) => `<span class="sw ${on ? '' : 'off'}"></span>`;
const NOTE_WEB = 'When your question needs something current, the assistant can search the web and open a page. That search — the words it chose, and the address it opens — leaves this computer for a search service on the internet, and what comes back is kept in the conversation. With this off, web searches and page requests are not sent and the assistant answers from what it already knows. This switch is applied as soon as you change it.';
const NOTE_REPORTS = 'On during the alpha. Reports carry technical details and, when something serious goes wrong, the app’s log. Never your chats or text. You can turn them off here. A report already on its way may still arrive.';

const notesNote = 'Kalsa checks for updates a little after it starts. Nothing is installed without you.';

/** The Settings page. `version` replaces the version row's right side and adds a block under it. */
function settingsPage({ notes = false, reportErr = false, version = {} } = {}) {
  const v = {
    sub: notesNote,
    right: `<span class="btn sm">${icon('refresh', 17)}Check for updates</span>`,
    block: '',
    ...version,
  };
  return `${rail('settings')}<main><div class="set" style="padding-top:${notes ? 46 : 56}px"><h2>Settings</h2>
    <div class="grp">
      <div class="row"><div class="t"><b>Look</b></div><span class="seg"><span class="on">Light</span><span>Dark</span><span>Automatic</span></span></div>
      <div class="row"><div class="t"><b>Language</b></div><span class="sel">System default ${icon('down', 16)}</span></div></div>
    <div class="grp">
      <div class="row"><div class="t"><b>Let Kalsa search the web</b><span>Only the search words go online. Your chats stay here.</span>
        <span class="more">What leaves this computer? ${icon(notes ? 'down' : 'right', 14, 2.2)}</span></div>${sw()}</div>
      ${notes ? `<div class="rownote"><p>${NOTE_WEB}</p></div>` : ''}
      <div class="row"><div class="t"><b>Send error reports</b><span>Helps us fix problems. Never includes your chats.</span>
        ${reportErr ? '<span class="err">This preference could not be saved. Please try again.</span>' : ''}
        <span class="more">More about error reports ${icon(notes ? 'down' : 'right', 14, 2.2)}</span></div>${sw(!reportErr)}</div>
      ${notes ? `<div class="rownote"><p>${NOTE_REPORTS}</p></div>` : ''}</div>
    ${notes ? '' : `<div class="grp">
      <div class="row"><div class="t"><b>AI</b><span>Using ${AI.name}</span></div><span class="lk">Change or see details ${icon('right', 16)}</span></div>
      <div class="row"><div class="t"><b>Version 0.0.3</b>${v.ok ? `<span class="okline">${icon('check', 15, 2.6)}${v.ok}</span>` : `<span>${v.sub}</span>`}</div>${v.right}</div>
      ${v.block}</div>
    ${v.block ? '' : `<p class="lede">${icon('lock', 15)}Your messages and answers stay on this computer.</p>`}`}
  </div></main>`;
}

const available = (extra = '', disabled = false) => `<div class="upd"><b>Kalsa 0.0.4 is available.</b><span class="wn2">What’s new ${icon('right', 15, 2.2)}</span>
  <div class="ua"><span class="btn pri ${disabled ? 'dis' : ''}">${icon('refresh', 17)}Restart to update</span>${extra}</div></div>`;
const checkDisabled = `<span class="btn sm dis">${icon('refresh', 17)}Check for updates</span>`;

export const screens = [
  ['08-settings', () => settingsPage(), 'light'],
  ['08-settings-notes-open', () => settingsPage({ notes: true }), 'light'],
  ['08-settings-save-failed', () => settingsPage({ reportErr: true }), 'light'],
  ['15-update-states-checking', () => settingsPage({ version: { right: `<span class="btn sm dis"><span class="spin"></span>Checking for updates…</span>` } }), 'light'],
  ['15-update-states-up-to-date', () => settingsPage({ version: { ok: 'Kalsa is up to date.' } }), 'light'],
  ['15-update-states-downloading', () => settingsPage({ version: { right: checkDisabled,
    block: `<div class="upd"><b>Downloading the update… 42%</b><div class="prog2"><i style="width:42%"></i></div></div>` } }), 'light'],
  ['15-update-states-failed', () => settingsPage({ version: {
    block: `<div class="upd bad"><b>Kalsa couldn’t download the update. Try again.</b><div class="ua"><span class="btn pri">${icon('refresh', 17)}Restart to update</span></div></div>` } }), 'light'],
  ['15-update-states-busy', () => settingsPage({ version: {
    block: available('<span style="color:var(--tx2);font-size:15px">Kalsa is writing a reply. Install when it finishes.</span>', true) } }), 'light'],
  ['15-update-states-notice-failed', () => `${rail('home')}<main><div class="center compact" style="padding-bottom:300px">${hero(true)}</div>
    <div class="sheet"><span class="ic">${icon('download', 26)}</span><div><b>A new version of Kalsa is ready</b>
      <span class="err">The update could not be verified, so Kalsa did not install it.</span>
      <div class="wn">What’s new ${icon('down', 16, 2.2)}</div><ul>${NOTES.map(n => `<li>${n}</li>`).join('')}</ul></div>
      <div class="a"><span class="btn">Later</span><span class="btn pri">${icon('refresh', 19)}Restart to update</span></div></div></main>`, 'light'],
];
