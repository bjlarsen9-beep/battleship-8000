// Core Battleship rules engine. Pure logic, no DOM, no audio — so it can be
// unit-tested in Node and reused by the AI for simulation.

export const BOARD_SIZE = 10;

export const FLEET = [
  { id: 'carrier', name: 'AIRCRAFT CARRIER', hull: 'USS NIMITZ', foe: 'KIEV', size: 5, glyph: '#' },
  { id: 'battleship', name: 'BATTLESHIP', hull: 'USS MISSOURI', foe: 'KIROV', size: 4, glyph: '@' },
  { id: 'cruiser', name: 'CRUISER', hull: 'USS TICONDEROGA', foe: 'SLAVA', size: 3, glyph: '%' },
  { id: 'submarine', name: 'SUBMARINE', hull: 'USS NAUTILUS', foe: 'DMITRY DONSKOY', size: 3, glyph: '&' },
  { id: 'destroyer', name: 'DESTROYER', hull: 'USS ARLEIGH BURKE', foe: 'SOVREMENNY', size: 2, glyph: '*' }
];

export const EMPTY = 0;
export const MISS = 1;
export const HIT = 2;

export const HORIZONTAL = 'H';
export const VERTICAL = 'V';

/** Deterministic, seedable PRNG (mulberry32) so games/tests are reproducible. */
export function makeRng(seed = Date.now() >>> 0) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createBoard(size = BOARD_SIZE) {
  return {
    size,
    // grid holds EMPTY / MISS / HIT — what the *shooter* is allowed to see.
    grid: Array.from({ length: size }, () => new Array(size).fill(EMPTY)),
    // occupancy holds ship ids (or null) — hidden knowledge.
    occupancy: Array.from({ length: size }, () => new Array(size).fill(null)),
    ships: []
  };
}

export function inBounds(board, r, c) {
  return r >= 0 && c >= 0 && r < board.size && c < board.size;
}

export function shipCells(size, r, c, orientation) {
  const cells = [];
  for (let i = 0; i < size; i++) {
    cells.push(orientation === HORIZONTAL ? { r, c: c + i } : { r: r + i, c });
  }
  return cells;
}

export function canPlace(board, size, r, c, orientation) {
  const cells = shipCells(size, r, c, orientation);
  return cells.every(
    (cell) => inBounds(board, cell.r, cell.c) && board.occupancy[cell.r][cell.c] === null
  );
}

export function placeShip(board, def, r, c, orientation) {
  if (!canPlace(board, def.size, r, c, orientation)) return null;
  const cells = shipCells(def.size, r, c, orientation);
  const ship = {
    id: def.id,
    name: def.name,
    hull: def.hull,
    foe: def.foe,
    size: def.size,
    glyph: def.glyph,
    orientation,
    origin: { r, c },
    cells,
    hits: 0,
    sunk: false
  };
  for (const cell of cells) board.occupancy[cell.r][cell.c] = ship.id;
  board.ships.push(ship);
  return ship;
}

export function removeShip(board, shipId) {
  const idx = board.ships.findIndex((s) => s.id === shipId);
  if (idx === -1) return false;
  for (const cell of board.ships[idx].cells) board.occupancy[cell.r][cell.c] = null;
  board.ships.splice(idx, 1);
  return true;
}

export function getShip(board, shipId) {
  return board.ships.find((s) => s.id === shipId) || null;
}

export function randomizeFleet(board, rng = Math.random, fleet = FLEET) {
  for (const ship of [...board.ships]) removeShip(board, ship.id);
  for (const def of fleet) {
    let placed = null;
    let guard = 0;
    while (!placed && guard++ < 5000) {
      const orientation = rng() < 0.5 ? HORIZONTAL : VERTICAL;
      const r = Math.floor(rng() * board.size);
      const c = Math.floor(rng() * board.size);
      placed = placeShip(board, def, r, c, orientation);
    }
    if (!placed) throw new Error(`Could not place ${def.id}`);
  }
  return board;
}

export function alreadyShot(board, r, c) {
  return board.grid[r][c] !== EMPTY;
}

/**
 * Fire at a cell. Returns a result object; never throws on a repeat shot so
 * the UI can just ignore it.
 * @returns {{ok:boolean, reason?:string, result?:'miss'|'hit'|'sunk', ship?:object, r:number, c:number}}
 */
export function fire(board, r, c) {
  if (!inBounds(board, r, c)) return { ok: false, reason: 'out-of-bounds', r, c };
  if (alreadyShot(board, r, c)) return { ok: false, reason: 'repeat', r, c };

  const shipId = board.occupancy[r][c];
  if (shipId === null) {
    board.grid[r][c] = MISS;
    return { ok: true, result: 'miss', r, c };
  }

  board.grid[r][c] = HIT;
  const ship = getShip(board, shipId);
  ship.hits += 1;
  if (ship.hits >= ship.size) ship.sunk = true;
  return { ok: true, result: ship.sunk ? 'sunk' : 'hit', ship, r, c };
}

export function fleetSunk(board) {
  return board.ships.length > 0 && board.ships.every((s) => s.sunk);
}

export function remainingShips(board) {
  return board.ships.filter((s) => !s.sunk);
}

export function shotsFired(board) {
  let n = 0;
  for (const row of board.grid) for (const v of row) if (v !== EMPTY) n++;
  return n;
}

export function hitCount(board) {
  let n = 0;
  for (const row of board.grid) for (const v of row) if (v === HIT) n++;
  return n;
}

export function accuracy(board) {
  const shots = shotsFired(board);
  return shots === 0 ? 0 : hitCount(board) / shots;
}

export function coordLabel(r, c) {
  return `${String.fromCharCode(65 + c)}${r + 1}`;
}
