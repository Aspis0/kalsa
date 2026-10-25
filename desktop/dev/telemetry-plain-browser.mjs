import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../chat/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const browser = await chromium.launch({ headless: true });
try {
 const page = await browser.newPage();
 const errors = [];
 page.on('pageerror', error => errors.push(error.message));
 await page.goto(process.env.KALSA_TELEMETRY_UI_URL ?? 'http://127.0.0.1:5175');
 await page.getByRole('button', { name: 'Settings', exact: true }).waitFor();
 assert.equal(await page.evaluate(() => typeof window.__TAURI__), 'undefined');
 assert.ok(await page.locator('#root').getByRole('button', { name: 'Settings', exact: true }).isVisible());
 assert.deepEqual(errors, []);
 await page.getByRole('button', { name: 'Settings', exact: true }).click();
 await page.getByText('Settings', { exact: true }).last().click();
 const toggle = page.getByRole('checkbox', { name: 'Error reports' });
 await toggle.waitFor();
 assert.equal(await toggle.isDisabled(), true);
 assert.deepEqual(errors, []);
 console.log('Plain Chromium, no Tauri bridge or mock IPC: root and Settings render, no page errors: PASS');
} finally { await browser.close(); }
