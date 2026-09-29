import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_SIZE, FLEET, EMPTY, MISS, HIT, HORIZONTAL, VERTICAL,
  createBoard, canPlace, placeShip, removeShip, getShip, randomizeFleet,
  fire, fleetSunk, shotsFired, hitCount, accuracy, coordLabel, makeRng, shipCells
} from '../js/engine.js';

const carrier = FLEET[0];
const destroyer = FLEET[4];

test('board starts empty', () => {
  const b = createBoard();
  assert.equal(b.size, BOARD_SIZE);
  assert.equal(shotsFired(b), 0);
  assert.equal(b.ships.length, 0);
  assert.ok(b.grid.every((row) => row.every((v) => v === EMPTY)));
});

test('placement respects bounds', () => {
  const b = createBoard();
  assert.equal(canPlace(b, 5, 0, 6, HORIZONTAL), false, 'runs off the right edge');
  assert.equal(canPlace(b, 5, 6, 0, VERTICAL), false, 'runs off the bottom edge');
  assert.equal(canPlace(b, 5, 0, 5, HORIZONTAL), true, 'exactly fits');
  assert.equal(canPlace(b, 5, 5, 0, VERTICAL), true, 'exactly fits');
});

test('placement rejects overlap and leaves board unchanged', () => {
  const b = createBoard();
  placeShip(b, carrier, 3, 2, HORIZONTAL);
  const before = JSON.stringify(b.occupancy);
  assert.equal(placeShip(b, destroyer, 3, 5, VERTICAL), null);
  assert.equal(b.ships.length, 1);
  assert.equal(JSON.stringify(b.occupancy), before);
});

test('removeShip frees its cells', () => {
  const b = createBoard();
  placeShip(b, carrier, 0, 0, HORIZONTAL);
  assert.equal(canPlace(b, 2, 0, 0, HORIZONTAL), false);
  assert.equal(removeShip(b, carrier.id), true);
  assert.equal(canPlace(b, 2, 0, 0, HORIZONTAL), true);
  assert.equal(removeShip(b, carrier.id), false);
});

test('shipCells matches orientation', () => {
  assert.deepEqual(shipCells(3, 2, 4, HORIZONTAL), [
    { r: 2, c: 4 }, { r: 2, c: 5 }, { r: 2, c: 6 }
  ]);
  assert.deepEqual(shipCells(3, 2, 4, VERTICAL), [
    { r: 2, c: 4 }, { r: 3, c: 4 }, { r: 4, c: 4 }
  ]);
});

test('firing marks hits, misses and sinks exactly once', () => {
  const b = createBoard();
  placeShip(b, destroyer, 4, 4, HORIZONTAL);

  const miss = fire(b, 0, 0);
  assert.equal(miss.result, 'miss');
  assert.equal(b.grid[0][0], MISS);

  const hit = fire(b, 4, 4);
  assert.equal(hit.result, 'hit');
  assert.equal(b.grid[4][4], HIT);

  const repeat = fire(b, 4, 4);
  assert.equal(repeat.ok, false);
  assert.equal(repeat.reason, 'repeat');
  assert.equal(getShip(b, destroyer.id).hits, 1, 'repeat shot must not re-damage the ship');

  const sunk = fire(b, 4, 5);
  assert.equal(sunk.result, 'sunk');
  assert.equal(sunk.ship.sunk, true);
  assert.equal(fleetSunk(b), true);
});

test('out of bounds fire is rejected', () => {
  const b = createBoard();
  for (const [r, c] of [[-1, 0], [0, -1], [10, 0], [0, 10]]) {
    const res = fire(b, r, c);
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'out-of-bounds');
  }
  assert.equal(shotsFired(b), 0);
});

test('fleetSunk is false on an empty board', () => {
  assert.equal(fleetSunk(createBoard()), false);
});

test('stats track shots and accuracy', () => {
  const b = createBoard();
  placeShip(b, destroyer, 0, 0, HORIZONTAL);
  fire(b, 0, 0);
  fire(b, 9, 9);
  assert.equal(shotsFired(b), 2);
  assert.equal(hitCount(b), 1);
  assert.equal(accuracy(b), 0.5);
  assert.equal(accuracy(createBoard()), 0);
});

test('coordLabel is A1-style', () => {
  assert.equal(coordLabel(0, 0), 'A1');
  assert.equal(coordLabel(9, 9), 'J10');
});

test('randomizeFleet always places a legal, non-overlapping fleet', () => {
  for (let seed = 0; seed < 400; seed++) {
    const b = createBoard();
    randomizeFleet(b, makeRng(seed));
    assert.equal(b.ships.length, FLEET.length, `seed ${seed}`);
    const seen = new Set();
    let occupied = 0;
    for (const ship of b.ships) {
      assert.equal(ship.cells.length, ship.size);
      for (const cell of ship.cells) {
        const k = `${cell.r},${cell.c}`;
        assert.ok(!seen.has(k), `overlap at ${k} on seed ${seed}`);
        seen.add(k);
        assert.ok(cell.r >= 0 && cell.r < BOARD_SIZE && cell.c >= 0 && cell.c < BOARD_SIZE);
        assert.equal(b.occupancy[cell.r][cell.c], ship.id);
      }
    }
    for (const row of b.occupancy) for (const v of row) if (v !== null) occupied++;
    assert.equal(occupied, FLEET.reduce((n, f) => n + f.size, 0), `seed ${seed}`);
  }
});

test('re-randomizing does not accumulate ships', () => {
  const b = createBoard();
  const r = makeRng(7);
  randomizeFleet(b, r);
  randomizeFleet(b, r);
  randomizeFleet(b, r);
  assert.equal(b.ships.length, FLEET.length);
  let occupied = 0;
  for (const row of b.occupancy) for (const v of row) if (v !== null) occupied++;
  assert.equal(occupied, FLEET.reduce((n, f) => n + f.size, 0));
});

test('seeded rng is deterministic', () => {
  const a = makeRng(42);
  const b = makeRng(42);
  for (let i = 0; i < 50; i++) assert.equal(a(), b());
});
