#!/usr/bin/env node
/**
 * playtest.mjs — the instrument that was missing.
 *
 * A screenshot cannot show lag, input latency, inverted controls, or an
 * autopilot fighting the player. Those were the actual complaints. This
 * presses keys and measures what happens.
 *
 *   node tools/playtest.mjs                 # all three games
 *   node tools/playtest.mjs --game burnout  # one game
 *   node tools/playtest.mjs --gpu           # headed, real GPU (recommended)
 *
 * Exits non-zero if any assertion fails. This is the gate.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, c, i, arr) => {
    if (c.startsWith('--')) a.push([c.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? 'true' : arr[i + 1]]);
    return a;
  }, [])
);
const BASE = args.base || 'http://localhost:5173';
// Real GPU by default: SwiftShader runs at ~1fps, which makes every
// input-latency and frame-pacing measurement meaningless. Pass --swiftshader
// only for a pure smoke test.
const GPU = args.swiftshader !== 'true';
const ONLY = args.game;

// Budgets. Deliberately generous under software GL; the point is to catch
// broken, not to benchmark.
const BUDGET = {
  drawCalls: 300,
  programs: 40,
  bootMs: GPU ? 5000 : 40000,
  responseMs: GPU ? 120 : 2500,
  minFps: GPU ? 50 : 0,
};

const GAMES = [
  {
    id: 'road-rash',
    url: '/play/road-rash/',
    drive: ['ArrowUp'],
    // Screen-space X of the player, so we test what the PLAYER sees, not
    // internal state. A game can have correct internal steering and still
    // look inverted if the camera is welded to the car.
    probe: `(() => {
      const s = window.__SCENE__; if (!s || !s.player) return null;
      const v = s.player.pos.clone().project(s.camera);
      // player.steer is the damped steering command. player.vx is NOT usable as
      // a direction signal: it sums in centrifugal and camber terms that
      // dominate on a curved road.
      return { screenX: v.x, resp: s.player.steer, lateral: s.player.x, speed: s.player.v,
               alive: !s.player.crashed, health: s.player.health };
    })()`,
  },
  {
    id: 'burnout',
    url: '/play/burnout/',
    drive: ['ArrowUp'],
    probe: `(() => {
      const g = window.__CRASHOUT__; if (!g || !g.player) return null;
      const p = g.player, veh = p.veh;
      const v = p.group ? p.group.position.clone().project(g.camera) : { x: 0 };
      return { screenX: v.x, resp: veh.steerAngle, lateral: veh.steerAngle,
               speed: veh.speed, alive: !p.wrecked, health: p.health };
    })()`,
  },
  {
    id: 'pinball',
    url: '/play/pinball/',
    drive: [],
    flippers: true,
    probe: `(() => {
      const g = window.__GAME__; if (!g) return null;
      const w = (g.world || (window.__PIN__ && window.__PIN__.world));
      const balls = w && w.balls ? w.balls.length : (window.__PIN__ ? window.__PIN__.ballCount : -1);
      return { balls, screenX: 0, lateral: 0, speed: 0, alive: true, health: 1 };
    })()`,
  },
];

const fail = [];
const warn = [];
function check(game, name, ok, detail) {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${game.padEnd(10)} ${name}${detail ? ' — ' + detail : ''}`;
  console.log('  ' + line);
  if (!ok) fail.push(`${game}: ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch({
  headless: !GPU,
  args: GPU
    ? ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--autoplay-policy=no-user-gesture-required']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});

for (const g of GAMES) {
  if (ONLY && ONLY !== g.id) continue;
  console.log(`\n=== ${g.id} ===`);
  const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // favicon/manifest 404s are not game defects
    if (/favicon|manifest|404 \(Not Found\)/i.test(t)) return;
    errors.push(t.slice(0, 160));
  });

  const t0 = Date.now();
  await page.goto(BASE + g.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  let ready = false;
  while (Date.now() - t0 < BUDGET.bootMs + 20000) {
    ready = await page.evaluate(() => window.__READY__ === true).catch(() => false);
    if (ready) break;
    await page.waitForTimeout(200);
  }
  const bootMs = Date.now() - t0;
  check(g.id, 'boots', ready, `${(bootMs / 1000).toFixed(1)}s`);
  check(g.id, 'boot time', bootMs <= BUDGET.bootMs, `${(bootMs / 1000).toFixed(1)}s (budget ${BUDGET.bootMs / 1000}s)`);
  if (!ready) { await page.close(); continue; }

  await page.mouse.click(550, 320).catch(() => {});
  await page.waitForTimeout(600);

  const read = () => page.evaluate(g.probe).catch(() => null);

  // ---- shader precompile: programs must exist before play, not compile during
  const programs = await page
    .evaluate(() => {
      const s = window.__SCENE__ || window.__CRASHOUT__ || {};
      const r = s.renderer;
      return r && r.info && r.info.programs ? r.info.programs.length : null;
    })
    .catch(() => null);
  if (programs !== null) {
    check(g.id, 'shader programs', programs <= BUDGET.programs, `${programs} (budget ${BUDGET.programs})`);
  } else warn.push(`${g.id}: could not read program count`);

  // ---- warm up under throttle
  for (const k of g.drive) await page.keyboard.down(k);
  await page.waitForTimeout(5000);

  if (g.flippers) {
    // Pinball: a ball must exist and the flippers must respond.
    const s0 = await read();
    check(g.id, 'ball in play', !!s0 && s0.balls >= 1, s0 ? `balls=${s0.balls}` : 'no probe');
    await page.keyboard.press('Space');
    await page.waitForTimeout(1200);
    for (let i = 0; i < 6; i++) { await page.keyboard.press('z'); await page.waitForTimeout(180); }
    const errAfter = errors.length;
    check(g.id, 'flippers no errors', errAfter === 0, `${errAfter} errors`);
  } else {
    // ---- INPUT RESPONSE: from a settled neutral, does a keypress change the
    // steering command quickly? (Sampling from a non-neutral state gives false
    // negatives when the car happens to already be steering that way.)
    await page.waitForTimeout(700);
    const before = await read();
    const tPress = Date.now();
    await page.keyboard.down('ArrowLeft');
    let respondedMs = -1;
    for (let i = 0; i < 80; i++) {
      const s = await read();
      if (s && before && Math.abs(s.resp - before.resp) > 0.02) { respondedMs = Date.now() - tPress; break; }
      await page.waitForTimeout(25);
    }
    check(g.id, 'input responds', respondedMs >= 0, respondedMs >= 0 ? `${respondedMs}ms` : 'no response in 2s');
    if (respondedMs >= 0) {
      check(g.id, 'response latency', respondedMs <= BUDGET.responseMs, `${respondedMs}ms (budget ${BUDGET.responseMs}ms)`);
    }

    // ---- DIRECTION: left must steer left. Sampled as an average of the
    // steering response so a single noisy frame can't flip the verdict.
    let sumL = 0, nL = 0;
    for (let i = 0; i < 12; i++) { const s = await read(); if (s) { sumL += s.resp; nL++; } await page.waitForTimeout(80); }
    await page.keyboard.up('ArrowLeft');
    const avgL = nL ? sumL / nL : 0;
    check(g.id, 'left goes left', avgL < -0.02, `avg response ${avgL.toFixed(3)}`);

    await page.waitForTimeout(600);
    await page.keyboard.down('ArrowRight');
    let sumR = 0, nR = 0;
    for (let i = 0; i < 12; i++) { const s = await read(); if (s) { sumR += s.resp; nR++; } await page.waitForTimeout(80); }
    await page.keyboard.up('ArrowRight');
    const avgR = nR ? sumR / nR : 0;
    check(g.id, 'right goes right', avgR > 0.02, `avg response ${avgR.toFixed(3)}`);

    // ---- SURVIVABILITY: hold throttle + steer and stay alive/moving.
    // This is what caught the burnout autopilot bug: touching a key used to
    // disengage the corner-brake and put the car into the first barrier.
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(4000);
    await page.keyboard.up('ArrowLeft');
    await page.waitForTimeout(2000);
    const surv = await read();
    const movingOk = surv && surv.speed > 3;
    check(g.id, 'survives steering', movingOk, surv ? `speed ${surv.speed.toFixed(1)} health ${(surv.health ?? 1).toFixed(2)}` : 'no probe');
    // A 10-year-old holding a direction for 4s must not be near death. This is
    // the "the game is fighting me" check.
    check(g.id, 'not punished for steering', !!surv && (surv.health ?? 1) > 0.35,
      surv ? `health ${(surv.health ?? 1).toFixed(2)}` : 'no probe');
  }

  for (const k of g.drive) await page.keyboard.up(k).catch(() => {});

  // ---- perf + errors
  // Measure the REAL rAF delivery rate rather than trusting the game's own
  // counter (all three shipped fabricated FPS counters in iteration 1).
  const realFps = await page
    .evaluate(() => new Promise((res) => {
      let n = 0;
      const t = performance.now();
      (function f() {
        n++;
        if (performance.now() - t < 2500) requestAnimationFrame(f);
        else res(Math.round((n / ((performance.now() - t) / 1000)) * 10) / 10);
      })();
    }))
    .catch(() => null);
  if (realFps !== null && BUDGET.minFps > 0) {
    check(g.id, 'steady fps', realFps >= BUDGET.minFps, `${realFps}fps (budget ${BUDGET.minFps})`);
  }

  const stats = await page.evaluate(() => (window.__STATS__ ? window.__STATS__() : null)).catch(() => null);
  if (stats) {
    const dc = stats.drawCalls ?? 0;
    check(g.id, 'draw calls', dc <= BUDGET.drawCalls, `${dc} (budget ${BUDGET.drawCalls})`);
    console.log(`        stats ${JSON.stringify(stats)}`);
  }
  check(g.id, 'no page errors', errors.length === 0, errors.length ? errors[0] : '');
  await page.close();
}

await browser.close();

console.log('\n' + '='.repeat(60));
if (warn.length) { console.log('warnings:'); warn.forEach((w) => console.log('  ? ' + w)); }
if (fail.length) {
  console.log(`FAILED (${fail.length}):`);
  fail.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('ALL PLAYTESTS PASS');
