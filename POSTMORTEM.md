# floppy.run — Postmortem

*Written for the next model/attempt. The previous implementation (3+ iterations) was reset to a
clean slate because the games were judged nonfunctional and subpar: they did not feel like the real
games or capture the nostalgia the PRD is chasing. Git history was intentionally wiped, so this
document is the memory of what happened. Read it before writing a single line of code.*

---

## 1. What we were asked for

The PRD (see `PRD.md`) wants a browser arcade of **original, legally clean games that feel like the
classics** — Road Rash (Chain Gang), Doom (Freedoom-powered), Ping Pong (Rally). The real success
bar is not "a game runs." It is:

> "It should *feel* like Road Rash. Same chaos, same satisfaction." — and the owner's words:
> **"it doesn't capture the quality and nostalgia feeling. it doesn't feel like the real game."**

That is the whole job. Everything below failed against *that* bar, not against "does it compile."

---

## 2. What was actually built

Stack: Vite + vanilla JS, static site, no framework. A shared "game shell" (fixed 120Hz loop,
keyboard input, Web Audio oscillator/noise helpers), an SPA router, a home card grid, `/play`, and
`/licenses`.

Three iterations, roughly:

- **Phase 0–1:** Rally (Pong-like, ~320 lines, spin modifiers + "juice") and Chain Gang, a
  Road-Rash-style pseudo-3D combat racer as **one ~890-line Canvas module** (segmented road
  projection, kinematic steering, 4 rivals, traffic, Z/X punch targeting, vector-drawn
  riders/cars, procedural audio, one track, countdown + finish grade).
- **Phase 2:** Doom via **authentic doomgeneric + Freedoom compiled to WASM** (~30 MB payload,
  Service-Worker cached). This one is genuinely "the real thing" and is the least of the problems.
- **Phase 3 ("Retro-arcade overhaul / nostalgia pass"):** more effects — glows, CRT
  scanline/vignette overlay, sunset gradients, speed lines, screenshake, hit-stop.

Testing was a headless **smoke test**: it drives each game for many frames with fake input and
fails only on thrown exceptions or non-finite numbers.

---

## 3. Why it failed (root causes — be honest here)

1. **Optimized for effects and code volume instead of validated feel.** Every iteration *added*
   things — juice, glow, scanlines, more lines of code — but never *validated* that the core verb
   (ride + punch; rally the ball) was fun in a blind playtest. Polish was applied to a core that
   was never proven. You cannot juice your way to "feels like Road Rash."

2. **"Nostalgia" was never operationalized.** There was no reference target, no art bible, no
   captured footage of the originals, no written "feels like X" rubric, no defined era/hardware,
   camera language, tempo, or sound palette. An undefined target cannot be hit. "Retro" got
   approximated generically (Press Start 2P + neon + a global CRT overlay), which reads as
   *generic retro / AI-template*, not the *specific* memory of a specific game.

3. **Silent deviation from the PRD's own decisions.** The PRD explicitly chose **pre-rendered
   low-poly sprite sheets**. The games instead draw everything with Canvas primitives
   (rounded-rectangle motorcycles, gradient mountains). That deviation was never surfaced or
   reconciled — so the agreed art direction was quietly abandoned and nobody decided that on
   purpose.

4. **Architecture made feel-iteration blind.** Simulation, AI, combat, track generation,
   rendering, HUD, and audio all live in one giant file per game. There is no data-driven tuning
   config, no deterministic replay, and no "feel" telemetry. Tuning the thing that matters most
   (handling, punch timing, speed sensation) meant editing tangled code by guesswork.

5. **Tests proved the wrong thing.** "Doesn't throw / no NaNs" gave false confidence. There was no
   visual baseline, no reference-comparison capture, and no playtest rubric. Green tests but a game
   that feels wrong is exactly the trap that repeated for three iterations.

6. **Scope diluted focus.** Three launch games in parallel meant none got the deep,
   feel-first iteration a single one needs. The PRD's "let the engineers think fresh" left the
   hardest, most important question — *what makes this feel right* — unowned.

---

## 4. What to do differently (guidance for the next attempt)

1. **Pick ONE game. Grey-box the feel first.** Build the ugliest possible version of the core verb
   and make *that* fun before any art or effects. If the box isn't fun, no amount of polish saves
   it. Get the owner to play it early and often.

2. **Operationalize nostalgia before coding.** For the chosen game, write it down first: reference
   footage, exact era/machine, camera height & FOV, speed sensation, tempo, control scheme, and a
   concrete **"feels like X" acceptance checklist** (e.g. Road Rash: sense of speed, weighty
   handling, the satisfying *thunk* of a punch, rival drama, wipeout recovery). Review against the
   checklist, not against "is it shiny."

3. **Separate tuning from code.** Put handling, timing, speed, and combat values in a data-driven
   config so feel can be tuned live. Add **deterministic replay** and light **feel telemetry** so
   iteration is measured, not guessed.

4. **Decide the art pipeline for real, and produce a proof asset.** Either commit to the PRD's
   pre-rendered sprite-sheet pipeline and make ONE proof sprite, or consciously change the PRD.
   Don't silently default to Canvas primitives again. Build a single "sample screen" that shows the
   intended look before scaling it to a whole game.

5. **Test what matters.** Keep the no-crash smoke test, but add a playtest rubric and a visual
   reference capture. A build is "done" only when it passes the *feel* checklist, not the linter.

6. **Reconcile the PRD.** Fix or explicitly change the assumptions that got silently violated
   (sprite sheets, procedural-only audio ceiling, three-games-at-once scope). Keep the PRD honest.

7. **What worked — keep it.** The Doom approach (real doomgeneric + Freedoom WASM, SW-cached) is
   the right pattern: when a legally-free authentic engine exists, ship it rather than rebuild it.
   Apply that instinct elsewhere where possible.

---

## 5. Pointers (history is gone, so don't blindly repeat)

- **Chain Gang** was a from-scratch pseudo-3D segmented-road racer in Canvas. The projection math
  worked; the *feel* (speed, weight, punch satisfaction) never got proven. If you revisit it,
  start from the feel rubric, not the renderer.
- **Rally** was the most complete and closest to fun — a smaller scope let it get more feel
  iteration. That is evidence for the "one game, deep" approach.
- **Doom** genuinely worked (authentic engine). Preserve that strategy; the build recipe was
  documented (doomgeneric + Freedoom via Emscripten). Reconstruct from upstream, not from memory.
- **Global CRT/scanline overlay + neon + Press Start 2P** is the generic-retro tell. Specific
  nostalgia comes from matching a specific game's look, not a catch-all filter.

*The single biggest lesson: prove the fun of one game in a grey box against a written "feels like
the real thing" rubric — before art, before effects, before a second game.*
