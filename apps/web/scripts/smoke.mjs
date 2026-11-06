// Headless smoke test: find what's broken. Tries Edge/Chrome already on the machine.
import { chromium } from 'playwright';
import fs from 'node:fs';

const errors = [];
const logs = [];

const launchOptions = [
  { channel: 'msedge' },
  { channel: 'chrome' },
  {},
];
let browser = null, used = '';
for (const opt of launchOptions) {
  try { browser = await chromium.launch(opt); used = opt.channel ?? 'bundled-chromium'; break; }
  catch (e) { console.log('launch failed for', JSON.stringify(opt), e.message?.slice(0, 120)); }
}
if (!browser) { console.log('NO-BROWSER'); process.exit(2); }
console.log('browser:', used);

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 300)); });

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'load' });
await page.waitForTimeout(3000); // intro (2.2s) + settle
await page.screenshot({ path: 'shots/01-load.png' });
const appLen = await page.evaluate(() => document.querySelector('#app')?.innerHTML.length ?? -1);
console.log('app innerHTML length:', appLen);

// Hero visuals
await page.screenshot({ path: 'shots/02-hero.png' });

// Open recovery dialog
await page.click('button[data-open="recover"]');
await page.waitForTimeout(800);
await page.screenshot({ path: 'shots/03-dialog.png' });

// Submit empty (error state)
await page.click('#ens-form button[type=submit]');
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/04-error.png' });

// Submit valid name -> result view
await page.fill('#ens-input', 'test.eth');
await page.click('#ens-form button[type=submit]');
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/05-result.png' });

// Inline FAQ details
const faq = page.locator('.faq-inline summary');
if (await faq.count()) { await faq.click(); await page.waitForTimeout(500); }
await page.screenshot({ path: 'shots/06-inline-faq.png' });

// Scroll whole page
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'load' });
await page.waitForTimeout(2600);
for (const [name, y] of [['07-explorer', 900], ['08-faq', 2900], ['09-footer', 5200]]) {
  await page.evaluate(v => window.scrollTo(0, v), y);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'shots/' + name + '.png' });
}

// Mobile
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
mobile.on('pageerror', e => errors.push('MOBILE PAGEERROR: ' + e.message));
await mobile.goto('http://127.0.0.1:4173/', { waitUntil: 'load' });
await mobile.waitForTimeout(2600);
await mobile.screenshot({ path: 'shots/10-mobile.png' });
await mobile.evaluate(() => window.scrollTo(0, 2000));
await mobile.waitForTimeout(500);
await mobile.screenshot({ path: 'shots/11-mobile-mid.png' });

console.log('--- pageerrors ---'); errors.forEach(e => console.log(e));
console.log('--- console errs/warns ---'); logs.slice(0, 12).forEach(e => console.log(e));
await browser.close();
