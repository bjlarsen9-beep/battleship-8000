// BATTLESHIP 8000 — UI / game loop.
import {
  BOARD_SIZE, FLEET, EMPTY, MISS, HIT, HORIZONTAL, VERTICAL,
  createBoard, canPlace, placeShip, removeShip, getShip, randomizeFleet,
  fire, fleetSunk, shotsFired, accuracy, coordLabel, makeRng, shipCells
} from './engine.js?v=20261008';
import { BattleshipAI, DIFFICULTIES, taunt } from './ai.js?v=20261008';
import { Chiptune } from './audio.js?v=20261008';

const $ = (id) => document.getElementById(id);
const audio = new Chiptune();
const rng = makeRng();

const S = {
  view: 'boot',
  difficulty: 'BATTLE_STATIONS',
  player: createBoard(),
  enemy: createBoard(),
  ai: null,
  orientation: HORIZONTAL,
  selected: FLEET[0].id,
  turn: 'player',
  busy: true,
  score: 0,
  streak: 0,
  bestStreak: 0,
  cursor: { r: 0, c: 0 },
  // Bumped whenever a battle starts or ends, so animation timers left over
  // from an abandoned game can notice they are stale and bail out.
  gameId: 0
};

/* ======================= marquee ticker ======================= */
const TICKER_LINES = [
  'TIP: SHIPS FLOAT. THAT IS THE WHOLE TRICK.',
  'THE ADMIRAL 8000 HAS NEVER LOST. IT HAS ALSO NEVER BEEN AUDITED.',
  'TIP: PRESS R IN DRY DOCK TO ROTATE A HULL.',
  'SEAGULL WRANGLER IS A REAL RANK. IT IS NOT A GOOD ONE.',
  'TIP: CHECKERBOARD YOUR SHOTS. NO SHIP IS SMALLER THAN TWO CELLS.',
  'WARNING: TORPEDOES ARE NON-REFUNDABLE.',
  'THE OCEAN IS 71% WATER AND 100% YOUR PROBLEM.',
  'HIGH SCORES ARE STORED IN THIS CABINET AND NOWHERE ELSE.'
];

function startTicker() {
  const line = TICKER_LINES.join('   \u25c6   ');
  $('ticker').textContent = `${line}   \u25c6   `;
}

/* ======================= high score ======================= */
const HI_KEY = 'battleship8000.hiscore';

function readHiScore() {
  try {
    return Number(localStorage.getItem(HI_KEY)) || 0;
  } catch {
    return 0; // private browsing, file:// sandboxes, etc.
  }
}

function writeHiScore(value) {
  try {
    localStorage.setItem(HI_KEY, String(value));
  } catch {
    /* a cabinet with no memory is still a playable cabinet */
  }
}

function paintHiScore() {
  const text = String(readHiScore()).padStart(6, '0');
  $('hiScoreVal').textContent = text;
  $('hiScoreTitle').textContent = text;
}

/* ======================= dramatic banner ======================= */
let bannerTimer = null;
function banner(text) {
  const el = $('banner');
  const txt = $('bannerText');
  txt.textContent = text;
  el.classList.remove('is-on');
  void el.offsetWidth;
  el.classList.add('is-on');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove('is-on'), 1250);
}

/* ======================= view switching ======================= */
const VIEWS = ['boot', 'title', 'deploy', 'battle', 'over'];
function show(name) {
  S.view = name;
  for (const v of VIEWS) $(`view-${v}`).classList.toggle('is-active', v === name);
}

/* ======================= boot sequence ======================= */
const BOOT_LINES = [
  'COGNITION NAVAL WORKS (C) 1984',
  '',
  'ROM CHECK ............ OK',
  'SPRITE RAM ........... OK',
  'SALT WATER ........... WET',
  'TORPEDO TUBES ........ 4 LOADED, 1 SULKING',
  'AI CORE "ADMIRAL 8000" ... AWAKE AND SMUG',
  'SEAGULL SUBSYSTEM .... SCREAMING (NORMAL)',
  '',
  'ALL SYSTEMS NOMINAL. INSERT COIN.'
];

function runBoot() {
  const el = $('bootText');
  const view = $('view-boot');
  const full = BOOT_LINES.join('\n');
  let i = 0;

  const disarm = () => {
    window.removeEventListener('keydown', skip);
    view.removeEventListener('click', skip);
  };

  const timer = setInterval(() => {
    i += 2;
    el.textContent = full.slice(0, i) + (i % 4 < 2 ? '\u2588' : '');
    if (i >= full.length) {
      clearInterval(timer);
      el.textContent = full;
      disarm();
      setTimeout(toTitle, 650);
    }
  }, 16);

  // Skip the intro on any input. Disarmed as soon as the crawl finishes so a
  // later keypress cannot teleport a running game back to the title screen.
  function skip() {
    clearInterval(timer);
    disarm();
    el.textContent = full;
    toTitle();
  }
  window.addEventListener('keydown', skip);
  view.addEventListener('click', skip);
}

/* ======================= title / attract ======================= */
let attractTimer = null;
function startAttract() {
  const el = $('attract');
  el.innerHTML =
    '<div class="attract__boat" id="atBoat">&lt;=|=&gt;</div>' +
    '<div class="attract__wave" id="atWave"></div>';
  const boat = $('atBoat');
  const wave = $('atWave');
  let x = -60;
  let t = 0;
  clearInterval(attractTimer);
  attractTimer = setInterval(() => {
    x += 6;
    if (x > 780) x = -80;
    boat.style.left = `${x}px`;
    boat.style.transform = `translateY(${Math.sin(t / 5) * 4}px)`;
    wave.textContent = '~'.repeat(120).split('').map((ch, i) => (Math.sin((i + t) / 3) > 0 ? '~' : '-')).join('');
    if (t % 22 === 0) dropShell(el, x + 20);
    t++;
  }, 60);
}

function dropShell(parent, x) {
  const shell = document.createElement('div');
  shell.className = 'attract__shell';
  shell.textContent = '\u25cf';
  shell.style.left = `${Math.max(10, Math.min(x, 700))}px`;
  shell.style.top = '0px';
  parent.appendChild(shell);
  let y = 0;
  const t = setInterval(() => {
    y += 7;
    shell.style.top = `${y}px`;
    if (y > 66) {
      clearInterval(t);
      shell.textContent = '\u2733';
      setTimeout(() => shell.remove(), 220);
    }
  }, 40);
}

function toTitle() {
  if (S.view === 'title') return;
  show('title');
  startAttract();
  audio.startMusic('menu');
}

function buildDiffPicker() {
  const row = $('diffRow');
  row.innerHTML = '';
  for (const d of Object.values(DIFFICULTIES)) {
    const b = document.createElement('button');
    b.className = 'btn btn--diff' + (d.id === S.difficulty ? ' is-sel' : '');
    b.textContent = d.label;
    b.dataset.diff = d.id;
    b.addEventListener('click', () => {
      S.difficulty = d.id;
      audio.uiSelect();
      buildDiffPicker();
    });
    b.addEventListener('mouseenter', () => { $('diffBlurb').textContent = d.blurb; });
    row.appendChild(b);
  }
  $('diffBlurb').textContent = DIFFICULTIES[S.difficulty].blurb;
  $('diffChip').textContent = DIFFICULTIES[S.difficulty].label;
}

/* ======================= grid building ======================= */
function buildGrid(el, { onCell, onHover } = {}) {
  el.innerHTML = '';
  el.appendChild(labelCell(''));
  for (let c = 0; c < BOARD_SIZE; c++) el.appendChild(labelCell(String.fromCharCode(65 + c)));
  for (let r = 0; r < BOARD_SIZE; r++) {
    el.appendChild(labelCell(String(r + 1)));
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.dataset.r = r;
      cell.dataset.c = c;
      cell.setAttribute('aria-label', coordLabel(r, c));
      if (onCell) cell.addEventListener('click', (e) => onCell(r, c, e));
      if (onHover) {
        cell.addEventListener('mouseenter', () => onHover(r, c));
        cell.addEventListener('focus', () => onHover(r, c));
      }
      el.appendChild(cell);
    }
  }
}

function labelCell(text) {
  const d = document.createElement('div');
  d.className = 'lbl';
  d.textContent = text;
  return d;
}

function cellAt(el, r, c) {
  return el.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
}

/** Repaint a board. `reveal` shows un-hit ships (own fleet / post-mortem). */
function paint(el, board, reveal) {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = cellAt(el, r, c);
      if (!cell) continue;
      const v = board.grid[r][c];
      const shipId = board.occupancy[r][c];
      const ship = shipId ? getShip(board, shipId) : null;
      cell.className = 'cell';
      cell.textContent = '';
      if (reveal && ship && v === EMPTY) {
        cell.classList.add('is-ship');
        cell.textContent = ship.glyph;
      }
      if (v === MISS) cell.classList.add('is-miss');
      if (v === HIT) cell.classList.add(ship && ship.sunk ? 'is-sunk' : 'is-hit');
      if (v !== EMPTY) cell.classList.add('is-shot');
    }
  }
}

/* ======================= deploy screen ======================= */
function toDeploy() {
  show('deploy');
  audio.startMusic('menu');
  clearInterval(attractTimer);
  S.player = createBoard();
  S.enemy = createBoard();
  S.orientation = HORIZONTAL;
  S.selected = FLEET[0].id;
  S.cursor = { r: 0, c: 0 };
  buildGrid($('deployBoard'), { onCell: placeAt, onHover: previewAt });
  $('deployBoard').addEventListener('contextmenu', onDeployContext);
  $('deployBoard').addEventListener('mouseleave', () => paint($('deployBoard'), S.player, true));
  renderDock();
  paint($('deployBoard'), S.player, true);
}

function onDeployContext(e) {
  e.preventDefault();
  rotate();
}

function nextUnplaced() {
  const def = FLEET.find((f) => !getShip(S.player, f.id));
  return def ? def.id : null;
}

function renderDock() {
  const list = $('dockList');
  list.innerHTML = '';
  for (const def of FLEET) {
    const placed = !!getShip(S.player, def.id);
    const li = document.createElement('li');
    li.className = 'dock__item' + (placed ? ' is-placed' : '') + (def.id === S.selected ? ' is-sel' : '');
    li.innerHTML = `<span>${def.name}</span><span class="dock__pips">${def.glyph.repeat(def.size)}</span>`;
    li.addEventListener('click', () => {
      if (placed) {
        removeShip(S.player, def.id);
        audio.denied();
      } else {
        audio.uiMove();
      }
      S.selected = def.id;
      renderDock();
      paint($('deployBoard'), S.player, true);
      refreshEngage();
    });
    list.appendChild(li);
  }
  refreshEngage();
}

function refreshEngage() {
  const ready = S.player.ships.length === FLEET.length;
  $('battleBtn').disabled = !ready;
  $('dockFlavor').textContent = ready
    ? 'Fleet ready. The Admiral has finished polishing its torpedoes.'
    : `${FLEET.length - S.player.ships.length} ship(s) still on land. Ships work poorly on land.`;
}

function selectedDef() {
  return FLEET.find((f) => f.id === S.selected) || null;
}

function previewAt(r, c) {
  S.cursor = { r, c };
  paint($('deployBoard'), S.player, true);
  const def = selectedDef();
  if (!def || getShip(S.player, def.id)) return;
  const ok = canPlace(S.player, def.size, r, c, S.orientation);
  for (const cell of shipCells(def.size, r, c, S.orientation)) {
    const el = cellAt($('deployBoard'), cell.r, cell.c);
    if (el) el.classList.add('is-ship', 'is-preview', ...(ok ? [] : ['is-bad']));
  }
}

function placeAt(r, c) {
  const def = selectedDef();
  if (!def) return;
  // Re-placing an already-deployed ship must be all-or-nothing: lift it out of
  // the water first, and put it straight back if the new spot turns out bad.
  const existing = getShip(S.player, def.id);
  const previous = existing ? { origin: existing.origin, orientation: existing.orientation } : null;
  if (existing) removeShip(S.player, def.id);
  const ship = placeShip(S.player, def, r, c, S.orientation);
  if (!ship) {
    if (previous) placeShip(S.player, def, previous.origin.r, previous.origin.c, previous.orientation);
    audio.denied();
    paint($('deployBoard'), S.player, true);
    $('deployTip').textContent = 'NO ROOM, CADET. Ships cannot stack or swim off the map.';
    return;
  }
  audio.uiSelect();
  $('deployTip').textContent = `${def.name} DEPLOYED AT ${coordLabel(r, c)}.`;
  const next = nextUnplaced();
  if (next) S.selected = next;
  renderDock();
  previewAt(r, c);
}

function rotate() {
  S.orientation = S.orientation === HORIZONTAL ? VERTICAL : HORIZONTAL;
  audio.uiMove();
  previewAt(S.cursor.r, S.cursor.c);
}

/* ======================= battle ======================= */
function toBattle() {
  show('battle');
  S.gameId += 1;
  randomizeFleet(S.enemy, rng);
  S.ai = new BattleshipAI({ difficulty: S.difficulty, size: BOARD_SIZE, rng });
  S.turn = 'player';
  S.busy = false;
  S.score = 0;
  S.streak = 0;
  S.bestStreak = 0;
  S.cursor = { r: 0, c: 0 };
  $('log').innerHTML = '';
  buildGrid($('enemyBoard'), { onCell: playerFire, onHover: (r, c) => { S.cursor = { r, c }; } });
  buildGrid($('homeBoard'));
  paint($('enemyBoard'), S.enemy, false);
  paint($('homeBoard'), S.player, true);
  renderRosters();
  updateHud();
  audio.startMusic('battle');
  log('sys', 'BATTLE STATIONS! Enemy fleet detected in sector 7-G.');
  log('ai', `THE ADMIRAL 8000 — ${DIFFICULTIES[S.difficulty].label}: "${DIFFICULTIES[S.difficulty].blurb}"`);
  admiral('yourTurn', { quiet: true });
}

function log(kind, text) {
  const li = document.createElement('li');
  li.className = kind === 'you' ? 'is-you' : kind === 'ai' ? 'is-ai' : 'is-sys';
  const prefix = kind === 'you' ? '>> YOU: ' : kind === 'ai' ? '>> ADM: ' : '>> SYS: ';
  li.textContent = prefix + text;
  const list = $('log');
  list.prepend(li);
  while (list.children.length > 60) list.lastChild.remove();
}

function renderRosters() {
  const fill = (el, board, hideIntact) => {
    el.innerHTML = '';
    for (const ship of board.ships) {
      const li = document.createElement('li');
      if (ship.sunk) li.classList.add('is-sunk');
      const hp = hideIntact && !ship.sunk
        ? '?'.repeat(ship.size)
        : '\u25a0'.repeat(ship.size - ship.hits) + '\u25a1'.repeat(ship.hits);
      const label = hideIntact ? ship.name : `${ship.name} <i>${ship.hull}</i>`;
      li.innerHTML = `<span>${label}</span><span class="hp">${hp}</span>`;
      el.appendChild(li);
    }
  };
  fill($('enemyRoster'), S.enemy, true);
  fill($('homeRoster'), S.player, false);
}

function updateHud() {
  $('scoreVal').textContent = String(S.score).padStart(6, '0');
  $('statShots').textContent = shotsFired(S.enemy);
  $('statAcc').textContent = `${Math.round(accuracy(S.enemy) * 100)}%`;
  $('statStreak').textContent = S.streak;
  $('turnTitle').textContent = S.busy
    ? (S.turn === 'player' ? 'INCOMING...' : 'ENEMY IS THINKING...')
    : 'YOUR TURN — FIRE!';
}

function flash() {
  const f = $('flash');
  f.classList.remove('is-on');
  void f.offsetWidth;
  f.classList.add('is-on');
}

function shake() {
  const s = $('screen');
  s.classList.remove('shake');
  void s.offsetWidth;
  s.classList.add('shake');
}

function markSunk(el, board, ship) {
  for (const cell of ship.cells) {
    const node = cellAt(el, cell.r, cell.c);
    if (node) {
      node.classList.remove('is-hit');
      node.classList.add('is-sunk');
    }
  }
}

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

/** True once the battle that began as `gen` is no longer the live one. */
function stale(gen) {
  return gen !== S.gameId || S.view !== 'battle';
}

/* ======================= the Admiral's mouth ======================= */
let quipTimer = null;
let quipTyper = null;
function quip(text) {
  const el = $('quipText');
  clearInterval(quipTyper);
  let i = 0;
  el.textContent = '';
  quipTyper = setInterval(() => {
    i += 1;
    el.textContent = text.slice(0, i);
    if (i >= text.length) clearInterval(quipTyper);
  }, 18);
  const box = $('quip');
  box.classList.remove('is-new');
  void box.offsetWidth;
  box.classList.add('is-new');
}

/** Pick a line, put it in the speech box and (unless quiet) the radio log. */
function admiral(kind, { prefix = '', quiet = false } = {}) {
  const line = taunt(kind, rng);
  quip(line);
  if (!quiet) log('ai', prefix + line);
}

/** Egg the player on if they are still dithering a moment from now. */
function nudgeLater(gen, ms = 1500) {
  clearTimeout(quipTimer);
  const shots = shotsFired(S.enemy);
  quipTimer = setTimeout(() => {
    if (stale(gen) || S.turn !== 'player' || S.busy || shotsFired(S.enemy) !== shots) return;
    admiral('yourTurn', { quiet: true });
  }, ms);
}

async function playerFire(r, c) {
  if (S.busy || S.turn !== 'player' || S.view !== 'battle') return;
  const gen = S.gameId;
  clearTimeout(quipTimer);
  if (S.enemy.grid[r][c] !== EMPTY) {
    audio.denied();
    log('sys', `${coordLabel(r, c)} is already a crater. Pick another.`);
    return;
  }
  S.busy = true;
  updateHud();
  audio.launch();
  const target = cellAt($('enemyBoard'), r, c);
  if (target) target.classList.add('is-incoming');
  await wait(380);
  if (stale(gen)) return;
  if (target) target.classList.remove('is-incoming');

  const res = fire(S.enemy, r, c);
  paint($('enemyBoard'), S.enemy, false);
  const node = cellAt($('enemyBoard'), r, c);

  if (res.result === 'miss') {
    S.streak = 0;
    node && node.classList.add('is-splash');
    audio.splash();
    log('you', `FIRE at ${coordLabel(r, c)} ... splash.`);
    admiral('playerMiss');
  } else {
    S.streak += 1;
    S.bestStreak = Math.max(S.bestStreak, S.streak);
    S.score += 100 + (S.streak - 1) * 25;
    node && node.classList.add('is-boom');
    audio.explode();
    flash();
    if (res.result === 'sunk') {
      S.score += 500;
      audio.sink();
      shake();
      markSunk($('enemyBoard'), S.enemy, res.ship);
      banner(`${res.ship.name}\nSUNK!`);
      audio.speak('You sunk my battleship!', { pitch: 0.4 });
      log('you', `${coordLabel(r, c)} — ENEMY ${res.ship.name} (${res.ship.hull}) DESTROYED!`);
      admiral('playerSunk');
    } else {
      log('you', `FIRE at ${coordLabel(r, c)} ... DIRECT HIT!`);
      admiral('playerHit');
    }
  }

  renderRosters();
  updateHud();
  await wait(520);
  if (stale(gen)) return;

  if (fleetSunk(S.enemy)) return endGame(true);

  S.turn = 'ai';
  S.busy = true;
  updateHud();
  await wait(700);
  if (stale(gen)) return;
  admiral('aiAim', { quiet: true });
  await wait(650);
  if (stale(gen)) return;
  await aiTurn(gen);
}

async function aiTurn(gen) {
  if (stale(gen)) return;
  const shot = S.ai.nextShot(S.player.grid);
  if (!shot) return endGame(true);

  const node = cellAt($('homeBoard'), shot.r, shot.c);
  audio.launch();
  if (node) node.classList.add('is-incoming');
  await wait(420);
  if (stale(gen)) return;
  if (node) node.classList.remove('is-incoming');

  const res = fire(S.player, shot.r, shot.c);
  if (!res.ok) {
    // Should never happen; the AI filters shot cells. Bail out safely.
    log('sys', `Admiral misfired at ${coordLabel(shot.r, shot.c)} (${res.reason}). Turn skipped.`);
    S.turn = 'player';
    S.busy = false;
    updateHud();
    return;
  }

  S.ai.notify({
    result: res.result,
    r: shot.r,
    c: shot.c,
    shipSize: res.ship ? res.ship.size : undefined
  });

  paint($('homeBoard'), S.player, true);
  const after = cellAt($('homeBoard'), shot.r, shot.c);

  if (res.result === 'miss') {
    after && after.classList.add('is-splash');
    audio.splash();
    admiral('aiMiss', { prefix: `Targeting ${coordLabel(shot.r, shot.c)} ... ` });
  } else {
    after && after.classList.add('is-boom');
    audio.explode();
    flash();
    shake();
    if (res.result === 'sunk') {
      audio.sink();
      markSunk($('homeBoard'), S.player, res.ship);
      banner(`YOUR ${res.ship.name}\nIS GONE`);
      audio.speak('You sunk my battleship!', { pitch: 1.1 });
      admiral('aiSunk', { prefix: `${coordLabel(shot.r, shot.c)} — your ${res.ship.name} is gone. ` });
    } else {
      admiral('aiHit', { prefix: `${coordLabel(shot.r, shot.c)} — ` });
    }
  }

  renderRosters();
  await wait(520);
  if (stale(gen)) return;

  if (fleetSunk(S.player)) return endGame(false);

  S.turn = 'player';
  S.busy = false;
  updateHud();
  nudgeLater(gen, 2200);
}

/* ======================= game over ======================= */
const RANKS = [
  { min: 0.55, name: 'FLEET ADMIRAL' },
  { min: 0.42, name: 'COMMODORE' },
  { min: 0.30, name: 'CAPTAIN' },
  { min: 0.20, name: 'DECKHAND' },
  { min: 0, name: 'SEAGULL WRANGLER' }
];

function endGame(won) {
  S.busy = true;
  S.gameId += 1;
  audio.stopMusic();
  show('over');
  const acc = accuracy(S.enemy);
  if (won) {
    audio.fanfare();
    S.score += 2000 + Math.round(acc * 3000);
  } else {
    audio.lament();
  }
  $('overHeadline').textContent = won ? 'VICTORY!' : 'GAME OVER';
  $('overHeadline').classList.toggle('is-loss', !won);
  $('overSub').textContent = won ? taunt('victory', rng) : taunt('defeat', rng);
  const survivors = S.player.ships.filter((s) => !s.sunk).length;
  $('overStats').innerHTML = [
    `SCORE ................ ${String(S.score).padStart(6, '0')}`,
    `SHOTS FIRED .......... ${shotsFired(S.enemy)}`,
    `ACCURACY ............. ${Math.round(acc * 100)}%`,
    `BEST STREAK .......... ${S.bestStreak}`,
    `SHIPS STILL AFLOAT ... ${survivors} / ${FLEET.length}`,
    `ENGAGEMENT ........... ${DIFFICULTIES[S.difficulty].label}`
  ].map((line) => `<span>${line}</span>`).join('');
  const rank = RANKS.find((r) => acc >= r.min) || RANKS[RANKS.length - 1];
  $('overRank').textContent = `RANK: ${won ? rank.name : 'SHIPWRECKED ' + rank.name}`;

  if (S.score > readHiScore()) {
    writeHiScore(S.score);
    $('overRank').textContent += '  \u2605 NEW HI-SCORE \u2605';
  }
  paintHiScore();
  renderMinimap();
}

/** Post-mortem: show where the enemy fleet actually was. */
function renderMinimap() {
  const map = $('minimap');
  map.innerHTML = '';
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const d = document.createElement('div');
      const v = S.enemy.grid[r][c];
      if (v === HIT) d.className = 'm-hit';
      else if (v === MISS) d.className = 'm-miss';
      else if (S.enemy.occupancy[r][c]) d.className = 'm-ship';
      map.appendChild(d);
    }
  }
}

/* ======================= keyboard ======================= */
function moveCursor(dr, dc) {
  const r = Math.max(0, Math.min(BOARD_SIZE - 1, S.cursor.r + dr));
  const c = Math.max(0, Math.min(BOARD_SIZE - 1, S.cursor.c + dc));
  S.cursor = { r, c };
  audio.uiMove();
  if (S.view === 'deploy') {
    previewAt(r, c);
  } else if (S.view === 'battle') {
    paint($('enemyBoard'), S.enemy, false);
    const node = cellAt($('enemyBoard'), r, c);
    if (node) {
      node.classList.add('is-cursor');
      node.focus({ preventScroll: true });
    }
  }
}

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'm') {
    toggleSound();
    return;
  }
  if (S.view === 'title') {
    if (k === 'enter' || k === ' ') {
      e.preventDefault();
      toDeploy();
    }
    return;
  }
  if (S.view === 'over') {
    if (k === 'enter' || k === ' ') {
      e.preventDefault();
      toDeploy();
    }
    return;
  }
  if (S.view !== 'deploy' && S.view !== 'battle') return;

  const moves = { arrowup: [-1, 0], arrowdown: [1, 0], arrowleft: [0, -1], arrowright: [0, 1] };
  if (moves[k]) {
    e.preventDefault();
    moveCursor(moves[k][0], moves[k][1]);
    return;
  }
  if (k === 'r' && S.view === 'deploy') {
    rotate();
    return;
  }
  if (k === 'enter' || k === ' ') {
    e.preventDefault();
    if (S.view === 'deploy') placeAt(S.cursor.r, S.cursor.c);
    else playerFire(S.cursor.r, S.cursor.c);
  }
});

/* ======================= sound toggle ======================= */
function toggleSound() {
  const on = !audio.enabled;
  audio.setEnabled(on);
  for (const id of ['muteBtn', 'muteBtn2']) {
    const btn = $(id);
    if (btn) btn.textContent = `SOUND: ${on ? 'ON' : 'OFF'}`;
  }
  if (on) audio.startMusic(S.view === 'battle' ? 'battle' : 'menu');
}

/* ======================= wiring ======================= */
$('startBtn').addEventListener('click', () => {
  audio.ensure();
  audio.uiSelect();
  toDeploy();
});
$('rotateBtn').addEventListener('click', rotate);
$('randomBtn').addEventListener('click', () => {
  randomizeFleet(S.player, rng);
  audio.uiSelect();
  S.selected = FLEET[0].id;
  renderDock();
  paint($('deployBoard'), S.player, true);
  $('deployTip').textContent = 'FLEET SCRAMBLED. Chaos is a valid strategy.';
});
$('clearBtn').addEventListener('click', () => {
  for (const ship of [...S.player.ships]) removeShip(S.player, ship.id);
  audio.denied();
  S.selected = FLEET[0].id;
  renderDock();
  paint($('deployBoard'), S.player, true);
  $('deployTip').textContent = 'DOCK CLEARED. Start again, sailor.';
});
$('battleBtn').addEventListener('click', () => {
  if (S.player.ships.length !== FLEET.length) return;
  audio.uiSelect();
  toBattle();
});
$('quitBtn').addEventListener('click', () => {
  S.gameId += 1;
  S.busy = true;
  audio.stopMusic();
  toTitle();
});
$('againBtn').addEventListener('click', () => {
  audio.uiSelect();
  toDeploy();
});
$('titleBtn').addEventListener('click', toTitle);
$('muteBtn').addEventListener('click', toggleSound);
$('muteBtn2').addEventListener('click', toggleSound);

buildDiffPicker();
startTicker();
paintHiScore();
runBoot();

// Expose a tiny hook so the automated smoke test can drive the game.
window.__BS = { S, toDeploy, toBattle, playerFire, endGame };
