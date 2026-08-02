# floppy-run — status and next steps

Three browser games (Three.js, no extra deps, all assets procedural). See `PRD.md`
for the product brief and the legal constraint on assets.

- `play/road-rash/` — **Asphalt Fury**, motorcycle combat racer
- `play/burnout/` — **Crashout**, arcade crash racer
- `play/pinball/` — **Space Cadet: Nova**, Windows XP-style table

## Goal (revised)

Not photoreal AAA. **Nice-looking games that work, feel good, and impress a
10-year-old.** Feel and playability beat graphics every time.

## How to verify

```sh
npx vite --port 5173      # dev server (needed by smoke.mjs)
node tools/playtest.mjs   # THE gate — must be all-pass before any commit
node tools/smoke.mjs      # page health, 0 console errors
npx vite build
```

`tools/playtest.mjs` is the objective gate. It drives a real GPU context, presses
keys, and asserts boot time, shader-program count, input latency, that steering
**ramps rather than snaps**, screen-space steer direction, top speed, steady fps,
and draw calls. Screenshot critique was removed — it was structurally blind to
lag, latency and controls, which is exactly what the player complained about.

`tools/shot.mjs` needs `--gpu` for anything motion- or timing-dependent; the
headless SwiftShader default renders at 1–3 fps. Args: `--url --out --wait
--frames --interval --keys --size --noclick --gpu`. It is `--url`, not `--game`.

### Last green run (M2 Pro)

| game | fps | boot | input | draw calls | programs |
|---|---|---|---|---|---|
| road-rash | 120.5 | 2.6s | 35ms | 111 | 39 |
| burnout | 119.0 | 2.4s | 19ms | 195 | **40/40** |
| pinball | 120.4 | 1.8s | n/a | 206 | 35 |

## Open work, highest value first

1. **Crashout's opening 5 seconds.** Holding accelerate without steering puts you
   into traffic almost immediately. It's a crash racer, but the first run should
   not be a wall. Widen the early traffic gap or ease the first corner.
2. **Crashout attract mode.** The autopilot reportedly still crashes visibly.
   It is the first thing a player sees.
3. **Crashout has zero shader-program headroom** (40/40 against the gate budget).
   Any new material variant fails the gate. Budget for a merge/dedupe pass before
   adding art. See the pinball `mergeReport` for the techniques that worked.
4. Road-rash HUD read 189 km/h where an earlier gate run measured lower — possible
   display scaling, never chased down.

## Hard-won gotchas (do not rediscover these)

- **`renderer.compile()` must run with the postfx render target bound.**
  `outputColorSpace` and `toneMapping` are shader cache-key inputs read from the
  *currently bound* target. Compiling unbound discards every precompiled program.
- **`PCFSoftShadowMap` silently downgrades** on the first shadow pass in three
  r185, invalidating precompiled programs again.
- **Never clamp frame delta and then feed it to the FPS counter.** That makes the
  counter unable to report low fps *and* runs the sim in slow motion. This shipped
  once as a fabricated FPS readout.
- **Do not apply ACES tone mapping twice** (renderer *and* OutputPass). That was
  the washed-out look.
- `transparent` + `DoubleSide` costs 3 shader programs each — use `forceSinglePass`.
  Padding unused map slots with one shared 1×1 white `DataTexture` collapses
  permutations; each map slot is an independent binary cache-key axis.
- **Off-axis cameras read as "rolled"** on symmetric objects. A pinball camera
  10.5cm off centre made the whole cabinet look tilted.
- **`FrontSide` + a 180° rotation = invisible geometry.** Symptom: an unexplained
  solid black rectangle (you are seeing the backing frame).
- **Speed-keyed screen effects must threshold near the *top* of the range**, or
  they become a permanent overlay instead of an accent.
- Playwright 1.62 runs `waitForFunction` in an isolated world, so page globals are
  invisible to it. Poll via `page.evaluate`.
- `page.screenshot({animations:'disabled'})` freezes CSS-animated HUD at
  `opacity: 0`. Use CDP `Page.captureScreenshot`.

## Process notes

- **Do not fan out parallel sub-agents.** It exhausted the machine's RAM twice and
  the agents overwrite each other's session `todos` table. Sequential work found
  more real bugs per hour anyway.
- A gate assertion shapes the product. `responseMs <= 120` literally rewarded
  step-function steering and is why the controls felt "designed for a computer".
  Assert a *human window*, not a minimum.
