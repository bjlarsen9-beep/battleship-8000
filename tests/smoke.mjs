// End-to-end smoke test: drives the real page in Chrome over CDP and plays a
// whole game to completion, failing on any console error or stuck turn.
// Usage: node tests/smoke.mjs [url] [cdpEndpoint]
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:8080/index.html';
const cdp = process.argv[3] || 'http://localhost:29229';

const browser = await chromium.connectOverCDP(cdp);
const ctx = browser.contexts()[0] || (await browser.newContext());
const page = await ctx.newPage();

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

const fail = (msg) => {
  console.error('FAIL:', msg);
  process.exitCode = 1;
};

await page.goto(url, { waitUntil: 'load' });
await page.evaluate(() => window.__BS && window.__BS.S && (window.__BS.S.busy = true));

// Skip the boot crawl.
await page.keyboard.press('Enter');
await page.waitForSelector('#view-title.is-active', { timeout: 8000 });
console.log('ok  title screen reached');

// Exactly two difficulties, and ADMIRAL is the enemy, not an option.
const diffCount = await page.locator('button[data-diff]').count();
if (diffCount !== 2) fail(`expected 2 difficulty buttons, found ${diffCount}`);
if (await page.locator('button[data-diff="ADMIRAL"]').count()) fail('ADMIRAL is still selectable');
console.log('ok  two difficulty options offered');

// Difficulty selection sticks.
await page.click('button[data-diff="BATTLE_STATIONS"]');
if (!(await page.locator('button[data-diff="BATTLE_STATIONS"]').getAttribute('class')).includes('is-sel')) {
  fail('difficulty button did not highlight');
}

await page.click('#startBtn');
await page.waitForSelector('#view-deploy.is-active');
console.log('ok  deploy screen reached');

if (await page.locator('#battleBtn').isEnabled()) fail('ENGAGE should be disabled with an empty dock');

// Manual placement of the first ship, then scramble the rest.
await page.locator('#deployBoard .cell[data-r="0"][data-c="0"]').click();
if ((await page.locator('#deployBoard .cell.is-ship').count()) < 5) fail('manual placement did not draw a ship');

await page.click('#clearBtn');
if ((await page.locator('#deployBoard .cell.is-ship').count()) !== 0) fail('clear did not empty the board');

await page.click('#randomBtn');
const shipCells = await page.locator('#deployBoard .cell.is-ship').count();
if (shipCells !== 17) fail(`expected 17 ship cells after scramble, got ${shipCells}`);
if (!(await page.locator('#battleBtn').isEnabled())) fail('ENGAGE should enable once the fleet is placed');

await page.click('#battleBtn');
await page.waitForSelector('#view-battle.is-active');
console.log('ok  battle started');

// Enemy ships must not be visible before they are hit.
if ((await page.locator('#enemyBoard .cell.is-ship').count()) !== 0) fail('enemy fleet is leaking through the fog of war');

// Play until someone wins by firing at the first unshot cell each turn.
const deadline = Date.now() + 360000;
let turns = 0;
while (!(await page.locator('#view-over.is-active').count())) {
  if (Date.now() > deadline) {
    fail('game never ended');
    break;
  }
  const ready = await page.evaluate(() => window.__BS.S.busy === false && window.__BS.S.turn === 'player');
  if (!ready) {
    await page.waitForTimeout(120);
    continue;
  }
  const target = await page.evaluate(() => {
    const g = window.__BS.S.enemy.grid;
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) if (g[r][c] === 0) return { r, c };
    return null;
  });
  if (!target) {
    fail('no cells left but the game is still running');
    break;
  }
  await page.locator(`#enemyBoard .cell[data-r="${target.r}"][data-c="${target.c}"]`).click();
  turns++;
  // Double-click the same cell: must be rejected, not double-counted.
  if (turns === 3) {
    await page.locator(`#enemyBoard .cell[data-r="${target.r}"][data-c="${target.c}"]`).click();
  }
}
console.log(`ok  game finished after ${turns} player shots`);

const headline = await page.locator('#overHeadline').textContent();
if (!/VICTORY|GAME OVER/.test(headline || '')) fail(`unexpected end headline: ${headline}`);

// Shot accounting must match the board state exactly.
const audit = await page.evaluate(() => {
  const count = (b) => {
    let shots = 0;
    for (const row of b.grid) for (const v of row) if (v !== 0) shots++;
    let hits = 0;
    for (const s of b.ships) hits += s.hits;
    let hitCells = 0;
    for (const row of b.grid) for (const v of row) if (v === 2) hitCells++;
    return { shots, hits, hitCells, sunk: b.ships.filter((s) => s.sunk).length };
  };
  return { enemy: count(window.__BS.S.enemy), player: count(window.__BS.S.player) };
});
for (const [who, a] of Object.entries(audit)) {
  if (a.hits !== a.hitCells) fail(`${who}: ship damage ${a.hits} != hit cells ${a.hitCells}`);
}
if (audit.enemy.sunk !== 5 && audit.player.sunk !== 5) fail('game ended without a destroyed fleet');
console.log('ok  board audit clean', JSON.stringify(audit));

// Replay from the game over screen.
await page.click('#againBtn');
await page.waitForSelector('#view-deploy.is-active');
const leftovers = await page.locator('#deployBoard .cell.is-ship').count();
if (leftovers !== 0) fail(`replay kept ${leftovers} stale ship cells`);
console.log('ok  replay resets the board');

if (errors.length) fail(`console errors: ${JSON.stringify(errors.slice(0, 5))}`);
else console.log('ok  no console errors');

await page.close();
await browser.close();
console.log(process.exitCode ? 'SMOKE TEST FAILED' : 'SMOKE TEST PASSED');
