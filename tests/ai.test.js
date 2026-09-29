import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FLEET, EMPTY, createBoard, randomizeFleet, fire, fleetSunk, shotsFired, makeRng
} from '../js/engine.js';
import { BattleshipAI, DIFFICULTIES, TAUNTS, taunt } from '../js/ai.js';

const TOTAL_CELLS = 100;
const FLEET_CELLS = FLEET.reduce((n, f) => n + f.size, 0);

/** Play one full AI-vs-board game; returns the number of shots needed. */
function playOut(difficulty, seed) {
  const board = createBoard();
  const rng = makeRng(seed);
  randomizeFleet(board, rng);
  const ai = new BattleshipAI({ difficulty, rng });

  let turns = 0;
  while (!fleetSunk(board)) {
    if (++turns > 500) throw new Error(`${difficulty} seed ${seed}: never finished`);
    const shot = ai.nextShot(board.grid);
    assert.ok(shot, `${difficulty} seed ${seed}: ran out of shots before winning`);
    assert.equal(board.grid[shot.r][shot.c], EMPTY, `${difficulty} seed ${seed}: repeat shot`);
    const res = fire(board, shot.r, shot.c);
    assert.equal(res.ok, true);
    ai.notify({ result: res.result, r: shot.r, c: shot.c, shipSize: res.ship?.size });
  }
  return shotsFired(board);
}

for (const difficulty of Object.keys(DIFFICULTIES)) {
  test(`${difficulty} finishes every game without repeating a shot`, () => {
    for (let seed = 1; seed <= 120; seed++) playOut(difficulty, seed);
  });
}

test('difficulty ordering: ADMIRAL < CAPTAIN < ENSIGN in shots needed', () => {
  const avg = (d) => {
    let total = 0;
    const runs = 200;
    for (let s = 1; s <= runs; s++) total += playOut(d, s);
    return total / runs;
  };
  const ensign = avg('ENSIGN');
  const captain = avg('CAPTAIN');
  const admiral = avg('ADMIRAL');
  assert.ok(admiral < captain, `admiral ${admiral} should beat captain ${captain}`);
  assert.ok(captain < ensign, `captain ${captain} should beat ensign ${ensign}`);
  assert.ok(admiral < 60, `admiral should average under 60 shots, got ${admiral}`);
  assert.ok(ensign > 62, `ensign should be sloppy, got ${ensign}`);
});

test('AI never shoots outside the board', () => {
  const board = createBoard();
  randomizeFleet(board, makeRng(3));
  const ai = new BattleshipAI({ difficulty: 'ADMIRAL', rng: makeRng(3) });
  while (!fleetSunk(board)) {
    const shot = ai.nextShot(board.grid);
    assert.ok(shot.r >= 0 && shot.r < 10 && shot.c >= 0 && shot.c < 10);
    const res = fire(board, shot.r, shot.c);
    ai.notify({ result: res.result, r: shot.r, c: shot.c, shipSize: res.ship?.size });
  }
});

test('AI returns null once every cell is taken', () => {
  const board = createBoard();
  const ai = new BattleshipAI({ rng: makeRng(1) });
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) fire(board, r, c);
  assert.equal(shotsFired(board), TOTAL_CELLS);
  assert.equal(ai.nextShot(board.grid), null);
});

test('AI chases a wounded ship instead of wandering off', () => {
  const board = createBoard();
  // Lone cruiser across D5-F5 (row 4, cols 3..5).
  board.occupancy[4][3] = 'cruiser';
  board.occupancy[4][4] = 'cruiser';
  board.occupancy[4][5] = 'cruiser';
  board.ships.push({
    id: 'cruiser', name: 'C', size: 3, glyph: '%', cells: [
      { r: 4, c: 3 }, { r: 4, c: 4 }, { r: 4, c: 5 }
    ], hits: 0, sunk: false
  });
  const ai = new BattleshipAI({ difficulty: 'CAPTAIN', rng: makeRng(9) });
  fire(board, 4, 4);
  ai.notify({ result: 'hit', r: 4, c: 4 });
  const next = ai.nextShot(board.grid);
  const adjacent = [[3, 4], [5, 4], [4, 3], [4, 5]];
  assert.ok(adjacent.some(([r, c]) => r === next.r && c === next.c), `expected adjacency, got ${JSON.stringify(next)}`);
});

test('AI extends along the axis once two hits line up', () => {
  const ai = new BattleshipAI({ difficulty: 'CAPTAIN', rng: makeRng(4) });
  const grid = Array.from({ length: 10 }, () => new Array(10).fill(EMPTY));
  grid[4][4] = 2; grid[4][5] = 2;
  ai.notify({ result: 'hit', r: 4, c: 4 });
  ai.notify({ result: 'hit', r: 4, c: 5 });
  for (let i = 0; i < 20; i++) {
    const shot = ai.nextShot(grid);
    assert.equal(shot.r, 4, 'must stay on the ship row');
    assert.ok(shot.c === 3 || shot.c === 6, `expected an end of the line, got ${shot.c}`);
  }
});

test('sinking clears the chase so the AI resumes hunting', () => {
  const ai = new BattleshipAI({ difficulty: 'CAPTAIN', rng: makeRng(5) });
  ai.notify({ result: 'hit', r: 0, c: 0 });
  ai.notify({ result: 'sunk', r: 0, c: 1, shipSize: 2 });
  assert.equal(ai.activeHits.length, 0);
  assert.deepEqual([...ai.sunkCells].sort(), ['0,0', '0,1']);
  assert.equal(ai.remainingSizes.includes(2), false);
});

test('a sink inside a cluster of touching ships does not strand the AI', () => {
  // Two ships side by side: the AI cannot tell which hits belonged to which,
  // so it must drop its tracked hits rather than loop forever.
  const ai = new BattleshipAI({ difficulty: 'CAPTAIN', rng: makeRng(6) });
  ai.notify({ result: 'hit', r: 5, c: 5 });
  ai.notify({ result: 'hit', r: 6, c: 5 });
  ai.notify({ result: 'sunk', r: 5, c: 6, shipSize: 2 });
  assert.ok(ai.activeHits.length <= 1);
});

test('density map never scores a cell that was already shot', () => {
  const ai = new BattleshipAI({ difficulty: 'ADMIRAL', rng: makeRng(2) });
  const grid = Array.from({ length: 10 }, () => new Array(10).fill(EMPTY));
  grid[0][0] = 1;
  grid[5][5] = 2;
  const map = ai.densityMap(grid);
  assert.equal(map[0][0], 0);
  assert.equal(map[5][5], 0);
});

test('taunt always returns a non-empty string for every category', () => {
  for (const kind of Object.keys(TAUNTS)) {
    for (let i = 0; i < 40; i++) {
      const line = taunt(kind, makeRng(i));
      assert.equal(typeof line, 'string');
      assert.ok(line.length > 0, `${kind} produced an empty taunt`);
    }
  }
  assert.equal(typeof taunt('nope-not-a-kind', makeRng(1)), 'string');
});

test('AI wins in fewer shots than the 100-cell worst case', () => {
  for (let seed = 500; seed < 520; seed++) {
    const shots = playOut('ADMIRAL', seed);
    assert.ok(shots >= FLEET_CELLS && shots <= TOTAL_CELLS, `got ${shots}`);
  }
});
