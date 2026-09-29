// Browser regression tests for the three UI bugs found during play-testing.
// See BUGS.md. Run against a served copy of the game:
//   node tests/regressions.mjs [url] [cdpEndpoint]
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:8080/index.html';
const cdp = process.argv[3] || 'http://localhost:29229';

const browser = await chromium.connectOverCDP(cdp);
const ctx = browser.contexts()[0] || (await browser.newContext());

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures++;
};

async function fresh({ skipBoot = true } = {}) {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  if (skipBoot) await page.keyboard.press('Enter');
  await page.waitForSelector('#view-title.is-active', { timeout: 25000 });
  return page;
}

async function intoBattle(page) {
  await page.click('#startBtn');
  await page.waitForSelector('#view-deploy.is-active');
  await page.click('#randomBtn');
  await page.click('#battleBtn');
  await page.waitForSelector('#view-battle.is-active');
}

// BUG 1 — the boot "press any key to skip" handler stayed armed for the whole
// session, so the first keypress in a later screen jumped back to the title.
{
  const page = await fresh({ skipBoot: false });
  await intoBattle(page);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  const view = await page.evaluate(() => window.__BS.S.view);
  check('bug1: a keypress mid-battle does not bounce to the title', view === 'battle', `view=${view}`);
  await page.close();
}

// BUG 2 — moving an already-placed ship onto an illegal square deleted it.
{
  const page = await fresh();
  await page.click('#startBtn');
  await page.waitForSelector('#view-deploy.is-active');
  await page.click('#randomBtn');
  const before = await page.evaluate(() => window.__BS.S.player.ships.length);
  await page.evaluate(() => { window.__BS.S.selected = 'carrier'; });
  await page.locator('#deployBoard .cell[data-r="0"][data-c="9"]').click(); // 5-long ship, no room
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => window.__BS.S.player.ships.length);
  const cells = await page.locator('#deployBoard .cell.is-ship').count();
  check('bug2: a rejected move keeps the ship on the board', before === 5 && after === 5, `${before} -> ${after}`);
  check('bug2: board still shows all 17 ship cells', cells === 17, `cells=${cells}`);
  await page.close();
}

// BUG 3 — aborting mid-turn left the previous game's timers running, so the
// dead game kept firing, logging and could even force a GAME OVER screen.
{
  const page = await fresh();
  await intoBattle(page);
  await page.locator('#enemyBoard .cell[data-r="0"][data-c="0"]').click();
  await page.waitForTimeout(1750); // land inside the Admiral's return volley
  await page.click('#quitBtn');
  const logsAtQuit = await page.evaluate(() => document.getElementById('log').children.length);
  await page.waitForTimeout(2000);
  const state = await page.evaluate(() => {
    let shots = 0;
    for (const row of window.__BS.S.player.grid) for (const v of row) if (v) shots++;
    return { view: window.__BS.S.view, shots, logs: document.getElementById('log').children.length };
  });
  check('bug3: abandoned game stops shooting', state.shots === 0, `shots=${state.shots}`);
  check('bug3: abandoned game stops logging', state.logs === logsAtQuit, `${logsAtQuit} -> ${state.logs}`);
  check('bug3: stays on the title screen', state.view === 'title', `view=${state.view}`);
  await page.close();
}

await browser.close();
console.log(failures ? `REGRESSIONS FAILED (${failures})` : 'ALL REGRESSION CHECKS PASSED');
process.exitCode = failures ? 1 : 0;
