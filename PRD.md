# Floppy.run Product Brief

## Product promise

Floppy.run brings back games as they are remembered: immediate, physical, slightly unruly, and worth
one more run. The games are original and legally clean, but the sensation must be specific enough that
the inspiration is obvious without explanatory copy.

**One-liner:** The games you remember, rebuilt for the browser.

## Current flagship

The first shippable experience is **Chain Gang**, an original motorcycle-combat road racer inspired by
the gameplay principles of *Road Rash (1994)*.

Rally follows only after Chain Gang meets its nostalgia and feel gates. Doom/Freedoom remains a
separate integration project.

## North-star memory

The user-supplied *Road Rash (1994)* frame is the visual and emotional reference:

- a bright blue sky and natural daylight;
- distant pale mountains and rolling green terrain;
- a broad two-lane road that visibly bends and rises;
- large, soft pre-rendered riders and motorcycles;
- human posture and clothing that remain readable at low resolution;
- two riders close enough to hit each other;
- a visible improvised weapon;
- traffic, guardrails, signs, and roadside objects creating danger and speed;
- low-resolution texture and softness, not block pixel art.

This is not a request to copy protected assets, characters, tracks, UI, music, or trade dress. It is a
specific production target for camera, scale, color, material, animation, and moment-to-moment play.

## Emotional promise

You are leaning through a country-road bend at unsafe speed while another rider crowds your lane and
raises a weapon.

The game must feel:

- fast because the road, scenery, engine, and traffic move, not because speed lines say so;
- physical because riders lean, reach, recoil, and lose balance;
- dangerous but readable;
- mischievous and slightly mean;
- simple enough to understand before the first bend ends.

## Vertical-slice loop

One run lasts about 45 to 70 seconds:

1. Begin already rolling with a rival in sight.
2. Accelerate into a visible bend.
3. Pull alongside the rival within the first 8 seconds.
4. Read the rival lifting a weapon.
5. Strike, evade, or force the rival toward traffic.
6. Survive several civilian vehicles and roadside hazards.
7. Reach the checkpoint first.
8. Restart in under one second.

## Controls

| Action | Keys | Required feel |
| --- | --- | --- |
| Accelerate | Up / W | Immediate engine load, then a slower climb |
| Brake | Down / S | Strong enough to reposition around traffic |
| Steer | Left/Right / A/D | Responsive with visible rider lean and curve pressure |
| Strike left | Z | Buffered, readable arm and weapon arc |
| Strike right | X | Buffered, readable arm and weapon arc |
| Kick | Space | Slower, longer reach, heavy lateral shove |
| Restart | Space / Enter | Under one second after a result |
| Tuning overlay | Backquote | Development-only live telemetry |

## Playable truths

Chain Gang is not ready unless:

- the supplied Road Rash frame and a game capture share the same basic composition;
- the road visibly curves in the first 10 seconds;
- the player and rival are large enough to read clothing, posture, bike, and weapon;
- the player reaches combat range within 8 seconds without expert play;
- a hit includes anticipation, contact, sound, displacement, reaction, and recovery;
- steering against a bend feels different from steering on a straight;
- traffic creates choices rather than random punishment;
- Edge and Safari show the same homepage and playable canvas;
- a first-time player voluntarily restarts.

## Visual and audio target

- Internal frame: 640 × 400, presented with gentle browser smoothing.
- Style: original pre-rendered-3D-like sprites and painted raster scenery.
- Palette: daylight blue, pale stone, dry soil, natural green, asphalt grey, saturated rider colors.
- Camera: low chase camera, rider fills the lower third, rival reaches comparable scale in combat.
- Animation: 12–15fps authored pose changes over a fixed simulation.
- Audio: layered engine load, wind, tyre texture, passing vehicles, weapon whoosh, body/bike impact,
  and short period-style rock rhythm. Pure oscillator beeps are not acceptable as the final sound.

### Authored rider asset gate

The road, camera, traffic, combat timing, and audio are now implemented. The remaining visual quality
gap cannot be solved with more primitive geometry. Final rider production requires original,
artist-authored pre-rendered sprites:

- rear chase-camera view at 0°, ±12°, and ±24° lean;
- ride, weapon tell, left/right swing, hit, stagger, wipeout, and recovery poses;
- player and rival each rendered with a complete motorcycle silhouette;
- 256×320 transparent source frames, authored at 2× and reduced with soft filtering;
- readable shoulders, elbows, hands, hips, knees, wheels, tank, handlebars, and weapon;
- daylight materials matching the supplied Road Rash (1994) reference;
- no copied actor likenesses, clothing, bikes, frames, or source assets.

The game must retain the current illustrated poses until replacements pass a side-by-side human review.
Procedural 3D and generic CC0 bike experiments were tested and rejected because they looked less real.

## Site presentation

The portal should be **minimal, with a restrained Windows XP memory**:

- Tahoma typography, Luna blue, pale system surfaces, and one green Play treatment;
- screenshot-led game browsing with little chrome;
- a compact title bar and simple game shelf, not a simulated desktop;
- bevelled controls and glossy highlights used only where they help recognition;
- no fake fictional-console lore, minimalist dashboard, pixel font, scanline, neon, or terminal aesthetic.

## Originality and legal boundaries

Chain Gang uses the general idea of motorcycle combat racing. It must not copy Road Rash names,
characters, logos, dialogue, exact tracks, menus, HUD layouts, rider designs, music, sounds, or source
assets.

Chain Gang's original world is an illegal courier race through rural service roads. Riders carry
contraband parcels, wear brightly patched road gear, and use improvised workshop tools.

## Browser and quality gates

- no stale service worker or cache in local development;
- no route-focus scroll jump;
- stable rendering and controls in current Edge, Safari, Chrome, and Firefox desktop;
- reliable focus, pause, audio unlock, restart, and teardown;
- deterministic tests for finish, combat, traffic collision, and seeded encounters;
- no runtime console errors;
- production build and smoke tests pass.

## Rendering architecture

- Three.js owns the primary playable road, camera, terrain, traffic, and depth.
- Camera-facing authored rider poses preserve the soft sprite language of the 1994 reference.
- The deterministic fixed-step model remains authoritative for controls, AI, combat, traffic, and results.
- Canvas 2D remains a complete fallback when WebGL is unavailable.
- The Three.js payload is lazy-loaded only after entering Chain Gang.

## Sequencing

1. Edge parity and cache/focus reliability.
2. Road Rash (1994) camera, scenery, rider scale, and combat target.
3. Handling, traffic, audio, and close-combat tuning.
4. Late-1990s/early-2000s portal rebuild.
5. Screenshot and playable nostalgia gate.
6. Rally, then separate Doom/Freedoom assessment.

## Success

The decisive test is not whether Chain Gang technically contains racing and punching. A player who
remembers *Road Rash (1994)* should recognize the memory within 10 seconds and choose another run.

*Last updated: 12 Jul 2026*
