# BATTLESHIP 8000 — Debugging Report

How the game was debugged, the bugs that turned up, and what fixed them.

## How I hunted for bugs

Three layers, because different bug classes hide in different places:

1. **Unit tests on a pure rules engine** (`tests/engine.test.js`, `tests/ai.test.js`).
   The rules and the AI have no DOM dependency, so they can be hammered
   headlessly. Everything random is driven by a seeded RNG, so a failure is
   reproducible. The AI tests play **360 complete games** (120 per difficulty)
   and assert invariants rather than exact outcomes: never fire out of bounds,
   never fire twice on the same cell, always terminate, and difficulty ordering
   holds (ADMIRAL < CAPTAIN < ENSIGN in average shots-to-win).
2. **A browser smoke test** (`tests/smoke.mjs`) that drives the real page in
   Chrome through Playwright: skip boot → pick a difficulty → deploy → play a
   full game to a win screen → replay. It fails on any console error and audits
   the boards afterwards (shot count vs. hit count vs. painted cells).
3. **Manual adversarial poking** — deliberately doing the *wrong* thing:
   mashing keys in the middle of a battle, dropping a ship on an illegal
   square, quitting a game while the AI's animated counterattack was still in
   flight. All three real bugs came out of this layer, which is the honest
   lesson: the test suite proved the rules were right, and the rules were never
   the problem.

Each bug below has a dedicated regression check in `tests/regressions.mjs` that
fails against the old code and passes against the fix.

---

## Bug 1 — Any keypress mid-game teleported you back to the title screen

**Symptom.** Halfway through a battle, pressing an arrow key (or any key at
all) abandoned the game and dumped the player on the title screen. Losing a
game in progress to a stray keystroke.

**Reproduction.**

```
view before keypress: battle
view after one arrow key: title
```

**Cause.** The boot sequence lets you skip the ROM-check crawl by pressing a
key, registered as:

```js
window.addEventListener('keydown', skip, { once: true });
```

`{ once: true }` only removes the listener *after it fires*. When the crawl was
allowed to finish on its own — which is what happens if you just watch it — the
listener was never consumed. It stayed armed on `window` for the entire
session, and the first key you pressed at any later point ran `skip()`, which
calls `toTitle()`.

**Fix.** Explicitly disarm both the keyboard and click skip handlers as soon as
the boot sequence ends, by either path:

```js
const disarm = () => {
  window.removeEventListener('keydown', skip);
  view.removeEventListener('click', skip);
};
```

`disarm()` is called both when the crawl completes naturally and inside
`skip()` itself.

**Regression check.** `bug1` — boot to completion, start a battle, press a key,
assert the view is still `battle`.

---

## Bug 2 — Moving a ship to an illegal square deleted the ship

**Symptom.** During deployment, dragging an already-placed ship onto a square
where it didn't fit (off the edge, or overlapping another hull) made it vanish
from the board entirely. The dry-dock roster still showed it as deployed, so
the ship was gone but you could not re-place it, and you could start a battle
with a four-ship fleet.

**Reproduction.**

```
ships on board before failed re-placement: 5
ships on board after:                      4
```

**Cause.** The placement handler treated "move" as remove-then-add:

```js
if (existing) removeShip(S.player, def.id);
const ship = placeShip(S.player, def, r, c, S.orientation);
if (!ship) { /* rejected — and the old ship is already gone */ }
```

Validation happened *after* the destructive step, so a rejected placement left
the board in the intermediate state. A classic non-atomic update.

**Fix.** Make the move transactional: remember the old origin and orientation,
and roll back if the new placement is rejected.

```js
const previous = existing
  ? { origin: existing.origin, orientation: existing.orientation }
  : null;
if (existing) removeShip(S.player, def.id);
const ship = placeShip(S.player, def, r, c, S.orientation);
if (!ship) {
  if (previous) placeShip(S.player, def, previous.origin.r, previous.origin.c, previous.orientation);
  audio.denied();
  paint($('deployBoard'), S.player, true);
  $('deployTip').textContent = 'NO ROOM, CADET. Ships cannot stack or swim off the map.';
  return;
}
```

**Regression check.** `bug2` — place a full fleet, attempt an illegal move,
assert the ship count is still 5 and all 17 hull cells are still painted.

---

## Bug 3 — An abandoned game kept playing itself in the background

**Symptom.** Hitting ABORT while the AI's counterattack animation was running
returned you to the title screen, but the dead game kept going: it continued
firing at your board and appending lines to the radio chatter. Start a new
game and the ghost game's shots were still landing on the new board, sinking
ships you had just placed.

**Reproduction.** Abort during the AI turn, then inspect state a second later:
the previous game's shot count kept incrementing and the log kept growing.

**Cause.** The AI turn is deliberately paced for arcade drama:

```js
async function aiTurn() {
  await wait(520);
  const shot = S.ai.nextShot(S.player.grid);
  ...
  await wait(380);
}
```

Each `await` is a suspension point. Aborting changed the view and reset state,
but the suspended continuations still resumed afterwards and happily mutated
whatever `S.player` now pointed at. Nothing told them their game no longer
existed.

**Fix.** Give every battle a generation ID and re-validate it after every
suspension point:

```js
function stale(gen) {
  return gen !== S.gameId || S.view !== 'battle';
}
```

`S.gameId` is incremented when a battle starts, when a game ends, and when the
player aborts. `aiTurn(gen)` and `playerFire()` capture the generation they
began in and bail out immediately after each `await` if `stale(gen)` is true.
The old turn unwinds harmlessly instead of writing to the live board.

**Regression check.** `bug3` — start a battle, abort mid-AI-turn, wait, then
assert the abandoned board took zero shots, the log stopped growing, and the
view stayed on `title`.

---

## Smaller things fixed along the way

- **`npm test` couldn't find the tests.** `node --test tests/` made Node try to
  resolve `tests` as a *module* (`Cannot find module '.../tests'`) instead of
  globbing it. Changed to `node --test tests/*.test.js`.
- **ENSIGN was too competent.** The "drunk" difficulty averaged ~65 shots to
  win, close enough to CAPTAIN that the difficulty ladder was meaningless.
  Dropped its follow-up-on-a-hit probability from 45% to 33% so it genuinely
  wanders.
- **The AI was accidentally able to cheat.** The AI is handed only the public
  shot grid (`board.grid`), never `board.occupancy`. This is enforced by
  construction — `nextShot(grid)` takes the grid as an argument and the AI
  holds no reference to the board — and asserted by the smoke test, which
  checks that no enemy ship position is exposed to the DOM before it is sunk.
- **Multi-line banner text rendered on one line.** `\n` in the "SHIP SUNK"
  overlay needed `white-space: pre-line`.

## Running the tests yourself

```bash
npm test                     # 26 rules + AI tests, no browser needed
python3 -m http.server 8080  # in one terminal
node tests/smoke.mjs         # full-game browser playthrough
node tests/regressions.mjs   # the three bugs above
```

The browser tests attach to a running Chrome over CDP
(`http://localhost:29229`); see `tests/smoke.mjs` for the connection details.
