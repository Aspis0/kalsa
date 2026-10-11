// Writes one self-contained HTML file per screen, renders each to PNG at 1440×900 @2x,
// then one contact sheet per area and a master index. Usage: node build.mjs [prefix ...]
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { page } from './kit.mjs';
import * as m from './hearth.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'hearth');
const out = '/tmp/kalsa-mockups-v4';
const require = createRequire(join(here, '../../../chat/package.json'));
const { chromium } = require('playwright');

const CORE = [
  ['01-home', () => m.home(), 'light'],
  ['01-home-off', () => m.homeOff(), 'light'],
  ['01-home-dark', () => m.home(), 'dark'],
  ['02-chat', () => m.chat(), 'light'],
  ['02-chat-dark', () => m.chat(), 'dark'],
  ['02-chat-list-open', () => m.chatList(), 'light'],
  ['03-settings', () => m.settings(), 'light'],
  ['04-first-run-start', () => m.firstStart(), 'light'],
  ['04-first-run-pick', () => m.firstPick(), 'light'],
  ['05-update-notice', () => m.update(), 'light'],
  ['06-growing-seed', () => m.growing(0), 'light'],
  ['06-growing-sprout', () => m.growing(1), 'light'],
  ['06-growing-young', () => m.growing(2), 'light'],
  ['06-growing-full', () => m.growing(3), 'light'],
  ['07-ai-page', () => m.aiPage(), 'light'],
];

const AREAS = ['ui', 'settings', 'phones', 'help', 'chat-states', 'miniapps', 'first-run', 'home-states', 'updates', 'room', 'advanced', 'dialogs'];
const areaMods = [];
for (const a of AREAS) {
  try { areaMods.push(await import(`./areas/${a}.mjs`)); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
}
const css = [m.css, ...areaMods.map(a => a.css ?? '')].join('\n');
const SCREENS = [...CORE, ...areaMods.flatMap(a => a.screens)];

const only = process.argv.slice(2);
const todo = only.length ? SCREENS.filter(([n]) => only.some(p => n.startsWith(p))) : SCREENS;

mkdirSync(dir, { recursive: true });
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const tab = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();

for (const [name, body, theme] of todo) {
  const path = join(dir, `${name}.html`);
  writeFileSync(path, page({ title: `Kalsa · Hearth · ${name}`, css, body: body(), theme }));
  await tab.goto(`file://${path}`);
  await tab.screenshot({ path: join(out, `${name}.png`) });
}

const sheetTab = await (await browser.newContext({ viewport: { width: 2280, height: 600 }, deviceScaleFactor: 2 })).newPage();
async function sheet(file, title, names, cols, w) {
  const h = w * 0.625;
  const cells = names.map(n => `<figure><figcaption>${n}</figcaption><img src="file://${out}/${n}.png"></figure>`).join('');
  const html = join(out, `${file}.html`);
  writeFileSync(html, `<style>body{margin:0;background:#1c1f1d;font:600 20px -apple-system,sans-serif;color:#fff;padding:24px;width:${cols * (w + 24)}px}
    h1{font-size:28px;margin:0 0 16px}div{display:grid;grid-template-columns:repeat(${cols},${w}px);gap:20px 24px}figure{margin:0}
    figcaption{margin-bottom:6px;color:#c8d0cb;font-weight:500;font-size:${w < 400 ? 15 : 20}px}img{width:${w}px;height:${h}px;display:block;border-radius:6px;box-shadow:0 0 0 1px rgba(255,255,255,.15)}</style>
    <h1>${title}</h1><div>${cells}</div>`);
  await sheetTab.goto(`file://${html}`);
  await sheetTab.screenshot({ path: join(out, `${file}.png`), fullPage: true });
}

const all = SCREENS.map(([n]) => n).sort();
const groups = new Map();
for (const n of all) {
  const key = n.slice(0, 2);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(n);
}
const touched = new Set(todo.map(([n]) => n.slice(0, 2)));
for (const [key, names] of groups) {
  if (!touched.has(key)) continue;
  await sheet(`contact-${key}`, `Kalsa · Hearth · ${key}`, names, 4, 540);
}
await sheet('contact-sheet', 'Kalsa · Hearth (final) · every screen', all, 8, 260);

await browser.close();
console.log('ok', todo.length, 'of', SCREENS.length);
