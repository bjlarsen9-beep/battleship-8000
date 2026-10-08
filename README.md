# BATTLESHIP 8000

A 1980s arcade-cabinet Battleship game. You versus **THE ADMIRAL 8000**, a
naval AI with two difficulty settings and absolutely no manners.

Vanilla HTML/CSS/JavaScript. No framework, no build step, no audio files — the
chiptune soundtrack and every explosion are synthesized live with the Web Audio
API. The soundtrack is two original naval marches: a bugle-call fanfare on the
title screen and a driving minor-key gallop with sonar pings during battle.

The Admiral trash-talks in a speech box above the boards: a jab before each of
its shots, a reaction after each of yours, and a nudge if you dither too long.

**▶ Play it: https://bs-dist-furwwnbl.devinapps.com**

## How to play

1. **Pick how angry the Admiral is** — SHORE LEAVE or BATTLE STATIONS.
2. **Deploy your fleet** in the dry dock. Click a ship, click the board.
   `R` rotates, SCRAMBLE randomizes the whole fleet, CLEAR empties the dock.
3. **Fire** at ENEMY WATERS. Hit every cell of all five enemy ships before the
   Admiral sinks yours.

The fleet is the real US Navy line-up: AIRCRAFT CARRIER (USS Nimitz, 5),
BATTLESHIP (USS Missouri, 4), CRUISER (USS Ticonderoga, 3), SUBMARINE
(USS Nautilus, 3), DESTROYER (USS Arleigh Burke, 2). Sink one and the cabinet
says "You sunk my battleship!" out loud via speech synthesis.
THE ADMIRAL sails a 1980s Soviet fleet: carrier KIEV, battlecruiser KIROV,
cruiser SLAVA, submarine DMITRY DONSKOY and destroyer SOVREMENNY.

| Keys | |
| --- | --- |
| Arrows | move the targeting cursor |
| Enter / Space | fire (or place a ship) |
| `R` | rotate a ship in the dry dock |
| `M` | mute |

Scoring rewards hits, sinks and consecutive-hit streaks; accuracy determines
your end-of-game rank, which ranges from FLEET ADMIRAL down to the widely
feared SEAGULL WRANGLER. Your high score lives in the cabinet
(`localStorage`).

## The AI

Two genuinely different opponents, neither of which can see your ships — each
is handed only the public shot grid, exactly what a human opponent would see.

| Difficulty | Strategy | Avg. shots to clear a fleet |
| --- | --- | --- |
| **SHORE LEAVE** | Fires at random; only follows up on a hit a third of the time. | ~65 |
| **BATTLE STATIONS** | Probability-density targeting: for every empty cell, counts how many ways each surviving ship could still fit through it, and fires at the maximum. Then hunts wounded ships to the seabed. | ~44 |

## Debugging document

Bugs found, how they were found, and how they were fixed:
[**BUGS.md**](BUGS.md).

## Code layout

```
index.html          markup for all five screens (boot, title, deploy, battle, over)
css/style.css       CRT/arcade styling — scanlines, neon, cabinet bezel
js/engine.js        pure rules engine: board, fleet, placement, firing. No DOM.
js/ai.js            the two AI brains + the taunt writers' room
js/audio.js         Web Audio chiptune synth (no assets)
js/main.js          screens, input, animation, game loop
tests/*.test.js     25 headless rules + AI tests (node --test)
tests/smoke.mjs     full-game browser playthrough over CDP
tests/regressions.mjs  one check per bug in BUGS.md
```

The rules engine is deliberately DOM-free and RNG-seeded so the whole game can
be simulated headlessly — the AI tests play 360 complete games on every run.

## Running locally

```bash
python3 -m http.server 8080   # then open http://localhost:8080
npm test                      # headless rules + AI tests
```

The browser tests (`tests/smoke.mjs`, `tests/regressions.mjs`) attach to a
running Chrome over CDP on port 29229 and need `npm install` first.
