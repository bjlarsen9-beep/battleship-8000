// The enemy commander: THE ADMIRAL 8000.
// Two brains, both of them talk trash. The AI only ever reads the public
// shot grid (EMPTY/MISS/HIT) plus results it is told about — it cannot peek
// at the player's ship positions.

import { EMPTY, MISS, HIT, FLEET, makeRng } from './engine.js?v=20261008';

export const DIFFICULTIES = {
  SHORE_LEAVE: {
    id: 'SHORE_LEAVE',
    label: 'SHORE LEAVE',
    blurb: 'The Admiral fires wildly and blames the tide. Your best shot.'
  },
  BATTLE_STATIONS: {
    id: 'BATTLE_STATIONS',
    label: 'BATTLE STATIONS',
    blurb: 'Probability density maps, relentless pursuit, zero manners.'
  }
};

export class BattleshipAI {
  constructor({ difficulty = 'BATTLE_STATIONS', size = 10, rng = makeRng(), fleet = FLEET } = {}) {
    this.difficulty = difficulty;
    this.size = size;
    this.rng = rng;
    this.remainingSizes = fleet.map((f) => f.size);
    this.activeHits = [];
    this.sunkCells = new Set();
    this.lastShot = null;
  }

  key(r, c) {
    return `${r},${c}`;
  }

  untried(grid) {
    const cells = [];
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) if (grid[r][c] === EMPTY) cells.push({ r, c });
    }
    return cells;
  }

  pick(list) {
    return list[Math.floor(this.rng() * list.length)];
  }

  /** Cells adjacent to a single known hit. */
  neighbours(grid, { r, c }) {
    return [
      { r: r - 1, c },
      { r: r + 1, c },
      { r, c: c - 1 },
      { r, c: c + 1 }
    ].filter((p) => p.r >= 0 && p.c >= 0 && p.r < this.size && p.c < this.size && grid[p.r][p.c] === EMPTY);
  }

  /** Given 2+ aligned hits on the same ship, shoot the ends of the line. */
  lineExtensions(grid) {
    const hits = this.activeHits;
    if (hits.length < 2) return [];
    const sameRow = hits.every((h) => h.r === hits[0].r);
    const sameCol = hits.every((h) => h.c === hits[0].c);
    const out = [];
    if (sameRow) {
      const r = hits[0].r;
      const cs = hits.map((h) => h.c).sort((a, b) => a - b);
      for (const c of [cs[0] - 1, cs[cs.length - 1] + 1]) {
        if (c >= 0 && c < this.size && grid[r][c] === EMPTY) out.push({ r, c });
      }
    } else if (sameCol) {
      const c = hits[0].c;
      const rs = hits.map((h) => h.r).sort((a, b) => a - b);
      for (const r of [rs[0] - 1, rs[rs.length - 1] + 1]) {
        if (r >= 0 && r < this.size && grid[r][c] === EMPTY) out.push({ r, c });
      }
    }
    return out;
  }

  targetCandidates(grid) {
    if (this.activeHits.length === 0) return [];
    const line = this.lineExtensions(grid);
    if (line.length) return line;
    const out = [];
    const seen = new Set();
    for (const hit of this.activeHits) {
      for (const n of this.neighbours(grid, hit)) {
        const k = this.key(n.r, n.c);
        if (!seen.has(k)) {
          seen.add(k);
          out.push(n);
        }
      }
    }
    return out;
  }

  /**
   * Probability density: for every remaining ship size, count how many legal
   * placements cover each untried cell. Placements that cover a known live hit
   * are weighted heavily so the AI converges on wounded ships.
   */
  densityMap(grid) {
    const map = Array.from({ length: this.size }, () => new Array(this.size).fill(0));
    const activeKeys = new Set(this.activeHits.map((h) => this.key(h.r, h.c)));

    const blocked = (r, c) => grid[r][c] === MISS || this.sunkCells.has(this.key(r, c));

    for (const size of this.remainingSizes) {
      for (let r = 0; r < this.size; r++) {
        for (let c = 0; c < this.size; c++) {
          for (const horiz of [true, false]) {
            const cells = [];
            let fits = true;
            for (let i = 0; i < size; i++) {
              const rr = horiz ? r : r + i;
              const cc = horiz ? c + i : c;
              if (rr >= this.size || cc >= this.size || blocked(rr, cc)) {
                fits = false;
                break;
              }
              cells.push({ r: rr, c: cc });
            }
            if (!fits) continue;
            const covered = cells.filter((x) => activeKeys.has(this.key(x.r, x.c))).length;
            const weight = covered > 0 ? 50 * covered : 1;
            for (const cell of cells) {
              if (grid[cell.r][cell.c] === EMPTY) map[cell.r][cell.c] += weight;
            }
          }
        }
      }
    }
    return map;
  }

  bestFromDensity(grid) {
    const map = this.densityMap(grid);
    let best = -1;
    let picks = [];
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (grid[r][c] !== EMPTY) continue;
        if (map[r][c] > best) {
          best = map[r][c];
          picks = [{ r, c }];
        } else if (map[r][c] === best) {
          picks.push({ r, c });
        }
      }
    }
    return picks.length ? this.pick(picks) : null;
  }

  /**
   * Choose a shot.
   * @param {number[][]} grid the public shot grid of the board being attacked
   */
  nextShot(grid) {
    const open = this.untried(grid);
    if (open.length === 0) return null;

    const targets = this.targetCandidates(grid);

    if (this.difficulty === 'SHORE_LEAVE') {
      // Sloppy: only follows up on a hit a third of the time.
      if (targets.length && this.rng() < 0.33) return this.pick(targets);
      return this.pick(open);
    }

    if (targets.length) return this.pick(targets);
    return this.bestFromDensity(grid) || this.pick(open);
  }

  /**
   * Feed the outcome back in.
   * @param {{result:'miss'|'hit'|'sunk', r:number, c:number, shipSize?:number}} outcome
   */
  notify(outcome) {
    this.lastShot = outcome;
    if (outcome.result === 'hit') {
      this.activeHits.push({ r: outcome.r, c: outcome.c });
      return;
    }
    if (outcome.result !== 'sunk') return;

    const size = outcome.shipSize || 1;
    const idx = this.remainingSizes.indexOf(size);
    if (idx !== -1) this.remainingSizes.splice(idx, 1);

    const sunkShipCells = this.inferSunkCells({ r: outcome.r, c: outcome.c }, size);
    for (const cell of sunkShipCells) this.sunkCells.add(this.key(cell.r, cell.c));
    const sunkKeys = new Set(sunkShipCells.map((cell) => this.key(cell.r, cell.c)));
    this.activeHits = this.activeHits.filter((h) => !sunkKeys.has(this.key(h.r, h.c)));
  }

  /**
   * Work out which cells the freshly sunk ship occupied, using only the hits
   * the AI has scored. Falls back to "forget everything" if ambiguous, which
   * keeps the AI honest instead of magically knowing the layout.
   */
  inferSunkCells(last, size) {
    const hitKeys = new Set(this.activeHits.map((h) => this.key(h.r, h.c)));
    hitKeys.add(this.key(last.r, last.c));

    const runAlong = (dr, dc) => {
      const cells = [last];
      for (const sign of [-1, 1]) {
        let r = last.r + dr * sign;
        let c = last.c + dc * sign;
        while (hitKeys.has(this.key(r, c))) {
          cells.push({ r, c });
          r += dr * sign;
          c += dc * sign;
        }
      }
      return cells;
    };

    for (const [dr, dc] of [
      [0, 1],
      [1, 0]
    ]) {
      const run = runAlong(dr, dc);
      if (run.length >= size) return run.slice(0, size);
    }
    // Ambiguous (ships touching). Drop every tracked hit so the AI restarts
    // its search rather than looping on cells that belong to the dead ship.
    const all = [...this.activeHits, last];
    this.activeHits = [];
    return all;
  }
}

export const TAUNTS = {
  yourTurn: [
    'Your move, Captain. Try to hit something this time.',
    'Take your time. I am a computer. I have all day.',
    'Go on, pick a square. I promise not to laugh. Out loud.',
    'Feeling lucky? The ocean is very big.',
    'Fire when ready. Or when brave. Whichever comes first.',
    'Tick tock, sailor. My coffee is getting cold.',
    'Somewhere out there is my fleet. Good luck with that.'
  ],
  aiAim: [
    'My turn. Hold still, this will only sting a little.',
    'Calculating... oh, this is going to be fun.',
    'Eeny, meeny, miny... KABOOM.',
    'Warming up tube three. It is my favorite tube.',
    'Locking on. Say something nice about me first.',
    'Let me just consult my crystal radar.'
  ],
  aiMiss: [
    'SPLASH! The ocean files a complaint.',
    'Missed. I blame solar flares.',
    'My torpedo went sightseeing.',
    'Nothing but water and regret.',
    'Recalibrating... rudely.',
    'That one is coming back as a boomerang.'
  ],
  aiHit: [
    'DIRECT HIT! Your crew is now swimming.',
    'BOOM. I felt that from here.',
    'Your hull has a new window.',
    'Hit! Do you even radar, bro?',
    'Scratch one paint job. And the ship under it.'
  ],
  aiSunk: [
    'SUNK! Send flowers. Underwater ones.',
    'Another one bites the seabed.',
    'Your fleet is now a coral reef.',
    'SPLOOSH. That is the sound of your strategy.',
    'I have logged that as "scrap metal".'
  ],
  playerMiss: [
    'You missed. The fish thank you.',
    'Wide! My paint job is untouched.',
    'That was a warning shot, right? RIGHT?',
    'Zero contacts. Zero dignity.',
    'Your aim has been reported to the coast guard.'
  ],
  playerHit: [
    'Ouch. Lucky pixel.',
    'Fine. ONE hit. Do not frame it.',
    'You hit me. I am mildly inconvenienced.',
    'My hull insurance premium just went up.'
  ],
  playerSunk: [
    'You sank it. Beginners luck, statistically.',
    'That ship was almost out of warranty anyway.',
    'Enjoy it. I have more boats than feelings.',
    'Noted. Escalating aggression by 12%.'
  ],
  victory: [
    'YOU WIN. I am filing an appeal with the ocean.',
    'VICTORY! My circuits are salty.',
    'You beat me. Do not let it define you.'
  ],
  defeat: [
    'YOUR FLEET IS FISH FOOD.',
    'DEFEAT. Would you like a rowboat for next time?',
    'I WIN. As predicted in subroutine SMUG.'
  ]
};

export function taunt(kind, rng = Math.random) {
  const list = TAUNTS[kind] || [''];
  return list[Math.floor(rng() * list.length)];
}
