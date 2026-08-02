// HUD: DOM/CSS chrome + a canvas instrument cluster and minimap.
import { clamp, lerp } from './rng.js';

const CSS = `
.af-root{position:fixed;inset:0;pointer-events:none;font-family:"Inter","Helvetica Neue",system-ui,-apple-system,sans-serif;
  color:#fff;-webkit-font-smoothing:antialiased;z-index:10;user-select:none;overflow:hidden}
.af-root *{box-sizing:border-box}
.af-tl{position:absolute;left:26px;top:22px;display:flex;gap:14px;align-items:flex-start}
.af-panel{background:linear-gradient(160deg,rgba(10,13,18,.80),rgba(8,10,14,.58));
  border:1px solid rgba(255,255,255,.12);border-left:4px solid #ff5a1f;
  backdrop-filter:blur(9px) saturate(1.2);padding:10px 19px 12px 15px;
  clip-path:polygon(0 0,100% 0,100% calc(100% - 11px),calc(100% - 11px) 100%,0 100%);
  box-shadow:0 10px 34px rgba(0,0,0,.5)}
.af-label{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.48);font-weight:700;margin-bottom:1px}
.af-big{font-size:46px;font-weight:900;line-height:1;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.af-big small{font-size:19px;font-weight:800;opacity:.6;margin-left:2px}
.af-accent{color:#ff8a3d}
.af-time{font-variant-numeric:tabular-nums;font-size:36px;font-weight:900;letter-spacing:-.01em}

.af-tr{position:absolute;right:24px;top:22px;display:flex;flex-direction:column;align-items:flex-end;gap:10px}
.af-map{width:172px;height:172px;background:linear-gradient(160deg,rgba(9,12,17,.72),rgba(7,9,13,.5));
  border:1px solid rgba(255,255,255,.10);border-radius:3px;backdrop-filter:blur(9px);box-shadow:0 10px 30px rgba(0,0,0,.45)}

.af-bl{position:absolute;left:26px;bottom:26px;width:360px;display:flex;flex-direction:column;gap:9px}
.af-bar{height:15px;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.13);position:relative;overflow:hidden;
  clip-path:polygon(0 0,100% 0,100% 100%,7px 100%,0 calc(100% - 6px))}
.af-bar i{position:absolute;left:0;top:0;bottom:0;display:block;transition:width .12s linear}
.af-bar.health i{background:linear-gradient(90deg,#ff3b2f,#ff9f43)}
.af-bar.boost i{background:linear-gradient(90deg,#18d6c0,#8affea)}
.af-bar.stam i{background:linear-gradient(90deg,#4a9dff,#a9d4ff)}
.af-barrow{display:flex;align-items:center;gap:10px}
.af-barrow .af-label{margin:0;width:70px;flex:none}
.af-barwrap{flex:1}

.af-br{position:absolute;right:20px;bottom:14px}
.af-weapon{position:absolute;left:26px;bottom:150px;display:flex;align-items:center;gap:9px;opacity:0;transition:opacity .25s}
.af-weapon.on{opacity:1}
.af-weapon .chip{background:rgba(255,90,31,.16);border:1px solid rgba(255,140,60,.55);padding:6px 13px;font-weight:800;
  letter-spacing:.18em;font-size:11px;text-transform:uppercase;color:#ffb07a}

.af-callout{position:absolute;left:50%;top:31%;transform:translateX(-50%);text-align:center;opacity:0}
.af-callout .k{font-size:104px;font-weight:900;letter-spacing:-.045em;line-height:.92;-webkit-text-stroke:0;
  background:linear-gradient(180deg,#fff 10%,#ffb057 62%,#ff5a1f 100%);-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 6px 26px rgba(255,90,31,.85)) drop-shadow(0 0 8px rgba(0,0,0,.7))}
.af-callout .s{font-size:18px;font-weight:900;letter-spacing:.3em;text-transform:uppercase;color:#fff;margin-top:6px;
  text-shadow:0 2px 10px rgba(0,0,0,.9),0 0 3px rgba(0,0,0,.95)}
@keyframes afPop{0%{opacity:0;transform:translateX(-50%) scale(.72) rotate(-3deg)}
  14%{opacity:1;transform:translateX(-50%) scale(1.1) rotate(1.5deg)}
  26%{transform:translateX(-50%) scale(1) rotate(0)}
  76%{opacity:1;transform:translateX(-50%) scale(1)}
  100%{opacity:0;transform:translateX(-50%) scale(1.06) translateY(-16px)}}
.af-callout.go{animation:afPop 1.5s cubic-bezier(.2,.9,.25,1) forwards}

.af-pos{position:absolute;left:50%;transform:translateX(-50%);top:16px;display:flex;gap:6px;align-items:center}
.af-pos .rank{font-size:15px;font-weight:800;letter-spacing:.1em;padding:6px 14px;background:rgba(8,11,16,.6);
  border:1px solid rgba(255,255,255,.12);border-top:2px solid #19e0c8;backdrop-filter:blur(8px)}

/* Permanent control legend. The title card used to be the ONLY place the
   combat keys were shown and it self-dismissed after 1.6s, so punching --
   the entire point of the game -- was undiscoverable. */
.af-hint{position:absolute;left:50%;transform:translateX(-50%);bottom:14px;font-size:12px;letter-spacing:.12em;
  white-space:nowrap;text-transform:uppercase;color:rgba(255,255,255,.72);font-weight:600;transition:opacity .8s ease;
  padding:6px 14px;border-radius:6px;background:rgba(8,11,16,.45);backdrop-filter:blur(6px);
  text-shadow:0 1px 3px rgba(0,0,0,.9)}
.af-hint b{color:#ffc24d;font-weight:800}
.af-hint.hide{opacity:0}

.af-title{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:radial-gradient(ellipse at 50% 55%,rgba(4,6,10,.30) 0%,rgba(3,4,7,.86) 72%);
  transition:opacity .45s ease, backdrop-filter .45s;backdrop-filter:blur(3px)}
.af-title h1{font-size:104px;margin:0;font-weight:900;letter-spacing:-.045em;line-height:.86;
  background:linear-gradient(178deg,#fff 6%,#ffd0a0 40%,#ff5a1f 88%);-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 12px 46px rgba(255,80,20,.42))}
.af-title h2{font-size:12.5px;letter-spacing:.62em;text-transform:uppercase;font-weight:700;color:rgba(255,255,255,.62);margin:14px 0 0}
.af-title .keys{margin-top:34px;display:flex;gap:20px;font-size:11px;letter-spacing:.16em;color:rgba(255,255,255,.5);text-transform:uppercase}
.af-title .keys b{color:#ffab6d;font-weight:800}
.af-title .cta{margin-top:26px;font-size:12px;letter-spacing:.4em;text-transform:uppercase;color:#fff;opacity:.9;
  animation:afBlink 1.5s ease-in-out infinite}
@keyframes afBlink{0%,100%{opacity:.35}50%{opacity:1}}
.af-title.hide{opacity:0;backdrop-filter:blur(0);pointer-events:none}

.af-vig{position:absolute;inset:0;box-shadow:inset 0 0 220px rgba(0,0,0,.55);pointer-events:none}
.af-dmg{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(255,20,10,0) 42%,rgba(255,24,12,.55) 100%);
  opacity:0;pointer-events:none;transition:opacity .16s}
`;

export class HUD {
  constructor(container, track) {
    this.track = track;
    const root = document.createElement('div');
    root.className = 'af-root';
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);
    root.innerHTML += `
      <div class="af-tl">
        <div class="af-panel"><div class="af-label">Position</div><div class="af-big" id="af-pos">1<small>/6</small></div></div>
        <div class="af-panel"><div class="af-label">Lap</div><div class="af-big" id="af-lap">1<small>/3</small></div></div>
        <div class="af-panel"><div class="af-label">Race Time</div><div class="af-time" id="af-time">0:00.00</div></div>
      </div>
      <div class="af-tr">
        <canvas class="af-map" id="af-map" width="344" height="344"></canvas>
      </div>
      <div class="af-bl">
        <div class="af-barrow"><div class="af-label">Rider</div><div class="af-barwrap"><div class="af-bar health"><i id="af-health" style="width:100%"></i></div></div></div>
        <div class="af-barrow"><div class="af-label">Stamina</div><div class="af-barwrap"><div class="af-bar stam"><i id="af-stam" style="width:100%"></i></div></div></div>
        <div class="af-barrow"><div class="af-label">Nitro</div><div class="af-barwrap"><div class="af-bar boost"><i id="af-boost" style="width:0%"></i></div></div></div>
      </div>
      <div class="af-weapon" id="af-weapon"><div class="chip" id="af-weapon-name">Chain</div></div>
      <div class="af-br"><canvas id="af-dash" width="620" height="330"></canvas></div>
      <div class="af-callout" id="af-callout"><div class="k" id="af-callout-k">TAKEDOWN</div><div class="s" id="af-callout-s"></div></div>
      <div class="af-vig"></div>
      <div class="af-dmg" id="af-dmg"></div>
      <div class="af-title" id="af-title">
        <h1>ASPHALT<br>FURY</h1>
        <h2>Canyon Circuit &nbsp;·&nbsp; Six Riders &nbsp;·&nbsp; No Rules</h2>
        <div class="keys"><span><b>↑↓←→ / WASD</b> ride</span><span><b>Q / E</b> punch</span><span><b>F</b> kick</span><span><b>SPACE</b> nitro</span></div>
        <div class="cta">Press any key to ride</div>
      </div>
      <div class="af-hint" id="af-hint"><b>↑↓←→ / WASD</b> ride &nbsp;·&nbsp; <b>Q / E</b> punch &nbsp;·&nbsp; <b>F</b> kick &nbsp;·&nbsp; <b>SPACE</b> nitro</div>
    `;
    container.appendChild(root);
    this.root = root;
    this.el = {
      pos: root.querySelector('#af-pos'),
      lap: root.querySelector('#af-lap'),
      time: root.querySelector('#af-time'),
      health: root.querySelector('#af-health'),
      stam: root.querySelector('#af-stam'),
      boost: root.querySelector('#af-boost'),
      callout: root.querySelector('#af-callout'),
      calloutK: root.querySelector('#af-callout-k'),
      calloutS: root.querySelector('#af-callout-s'),
      title: root.querySelector('#af-title'),
      dmg: root.querySelector('#af-dmg'),
      weapon: root.querySelector('#af-weapon'),
      weaponName: root.querySelector('#af-weapon-name'),
    };
    this.dash = root.querySelector('#af-dash');
    this.dctx = this.dash.getContext('2d');
    this.map = root.querySelector('#af-map');
    this.mctx = this.map.getContext('2d');
    this.mapPath = track.minimapPath(260);
    this.needle = 0;
    this.tachNeedle = 0;
    this._calloutT = 0;
    this.scaleDash();
    window.addEventListener('resize', () => this.scaleDash());
  }

  scaleDash() {
    const w = Math.min(360, Math.max(230, window.innerWidth * 0.23));
    this.dash.style.width = `${w}px`;
    this.dash.style.height = `${(w * 330) / 620}px`;
    const mw = Math.min(190, Math.max(120, window.innerWidth * 0.115));
    this.map.style.width = `${mw}px`;
    this.map.style.height = `${mw}px`;
  }

  dismissTitle(hard = false) {
    if (hard && this.el.title.style.display !== 'none') {
      this.el.title.classList.add('hide');
      this.el.title.style.display = 'none';
      return;
    }
    if (this.el.title.classList.contains('hide')) return;
    this.el.title.classList.add('hide');
    this.el.title.style.opacity = '0';
    this.el.title.style.pointerEvents = 'none';
    setTimeout(() => {
      if (this.el.title.parentNode) this.el.title.style.display = 'none';
    }, 520);
  }

  callout(main, sub = '') {
    this.el.calloutK.textContent = main;
    this.el.calloutS.textContent = sub;
    // Driven from the render loop rather than a CSS @keyframes: screenshot
    // harnesses disable CSS animations, which froze every callout at opacity 0.
    this._calloutT = 0.0001;
  }

  _drawCallout(dt) {
    const t = this._calloutT;
    if (!t) return;
    const n = t / 2.6;
    if (n >= 1) {
      this._calloutT = 0;
      this.el.callout.style.opacity = '0';
      return;
    }
    this._calloutT = t + dt;
    let op, sc, rot, dy;
    if (n < 0.06) {
      const k = n / 0.06;
      op = k; sc = 0.45 + 0.85 * k; rot = -7 + 10 * k; dy = 0;
    } else if (n < 0.18) {
      const k = (n - 0.06) / 0.12;
      op = 1; sc = 1.30 - 0.30 * k; rot = 3 - 3 * k; dy = 0;
    } else if (n < 0.88) {
      op = 1; sc = 1; rot = 0; dy = 0;
    } else {
      const k = (n - 0.88) / 0.12;
      op = 1 - k; sc = 1 + 0.06 * k; rot = 0; dy = -16 * k;
    }
    this.el.callout.style.opacity = String(op);
    this.el.callout.style.transform =
      `translateX(-50%) translateY(${dy}px) scale(${sc}) rotate(${rot}deg)`;
  }

  setWeapon(name) {
    if (name) {
      this.el.weaponName.textContent = name;
      this.el.weapon.classList.add('on');
    } else this.el.weapon.classList.remove('on');
  }

  // ------------------------------------------------------------------ draw
  update(st, dt) {
    const e = this.el;
    this._age = (this._age || 0) + dt;
    this._drawCallout(dt);
    e.pos.innerHTML = `${st.position}<small>/${st.racers}</small>`;
    e.lap.innerHTML = `${Math.min(st.lap, st.laps)}<small>/${st.laps}</small>`;
    const t = st.time;
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    e.time.textContent = `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
    e.health.style.width = `${clamp(st.health, 0, 1) * 100}%`;
    e.stam.style.width = `${clamp(st.stamina, 0, 1) * 100}%`;
    e.boost.style.width = `${clamp(st.boost, 0, 1) * 100}%`;
    e.dmg.style.opacity = clamp(st.damageFlash, 0, 1) * 0.9;

    this.needle = lerp(this.needle, clamp(st.speedKph / 340, 0, 1.05), 1 - Math.exp(-11 * dt));
    this.tachNeedle = lerp(this.tachNeedle, clamp(st.rpm, 0, 1.03), 1 - Math.exp(-16 * dt));
    this.drawDash(st);
    this.drawMap(st);
  }

  drawDash(st) {
    const c = this.dctx;
    const W = this.dash.width;
    const H = this.dash.height;
    c.clearRect(0, 0, W, H);

    // --- big speedo ---
    const cx = W - 168;
    const cy = H - 118;
    const R = 128;
    const a0 = Math.PI * 0.78;
    const a1 = Math.PI * 2.34;

    // dial plate
    const grd = c.createRadialGradient(cx, cy - 20, 10, cx, cy, R + 26);
    grd.addColorStop(0, 'rgba(16,20,27,0.82)');
    grd.addColorStop(0.75, 'rgba(8,10,15,0.72)');
    grd.addColorStop(1, 'rgba(5,7,11,0.05)');
    c.fillStyle = grd;
    c.beginPath();
    c.arc(cx, cy, R + 24, 0, 6.283);
    c.fill();

    // outer arc
    c.lineWidth = 2;
    c.strokeStyle = 'rgba(255,255,255,0.13)';
    c.beginPath();
    c.arc(cx, cy, R + 6, a0, a1);
    c.stroke();

    // ticks
    for (let i = 0; i <= 34; i++) {
      const f = i / 34;
      const a = lerp(a0, a1, f);
      const major = i % 5 === 0;
      const r0 = R - (major ? 22 : 12);
      const hot = f > 0.79;
      c.strokeStyle = hot ? 'rgba(255,80,40,0.95)' : major ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.30)';
      c.lineWidth = major ? 3 : 1.4;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      c.lineTo(cx + Math.cos(a) * (R - 2), cy + Math.sin(a) * (R - 2));
      c.stroke();
      if (major) {
        const v = Math.round(f * 340);
        c.fillStyle = 'rgba(255,255,255,0.66)';
        c.font = '600 15px Inter, system-ui, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        const rr = R - 42;
        c.fillText(String(v), cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
    }

    // sweep fill
    const av = lerp(a0, a1, clamp(this.needle, 0, 1));
    c.strokeStyle = 'rgba(255,110,45,0.85)';
    c.lineWidth = 5;
    c.lineCap = 'round';
    c.shadowColor = 'rgba(255,110,45,0.9)';
    c.shadowBlur = 16;
    c.beginPath();
    c.arc(cx, cy, R + 6, a0, av);
    c.stroke();
    c.shadowBlur = 0;

    // needle
    c.save();
    c.translate(cx, cy);
    c.rotate(av);
    c.fillStyle = '#ff5a1f';
    c.shadowColor = 'rgba(255,90,31,0.85)';
    c.shadowBlur = 14;
    c.beginPath();
    c.moveTo(-14, -4.5);
    c.lineTo(R - 16, -1.6);
    c.lineTo(R - 16, 1.6);
    c.lineTo(-14, 4.5);
    c.closePath();
    c.fill();
    c.restore();
    c.shadowBlur = 0;
    c.fillStyle = '#0d1016';
    c.beginPath();
    c.arc(cx, cy, 17, 0, 6.283);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.25)';
    c.lineWidth = 1.5;
    c.stroke();

    // digital readout
    c.textAlign = 'center';
    c.fillStyle = '#fff';
    c.font = '800 46px Inter, system-ui, sans-serif';
    c.fillText(String(Math.round(st.speedKph)), cx, cy + 62);
    c.fillStyle = 'rgba(255,255,255,0.42)';
    c.font = '700 11px Inter, system-ui, sans-serif';
    c.fillText('KM/H', cx, cy + 82);

    // --- gear + tach bars (left of the dial) ---
    const gx = 26;
    const gy = H - 150;
    c.fillStyle = 'rgba(9,12,17,0.6)';
    c.beginPath();
    c.moveTo(gx - 8, gy - 34);
    c.lineTo(gx + 128, gy - 34);
    c.lineTo(gx + 128, gy + 108);
    c.lineTo(gx + 12, gy + 108);
    c.lineTo(gx - 8, gy + 88);
    c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.10)';
    c.lineWidth = 1.5;
    c.stroke();

    c.textAlign = 'left';
    c.fillStyle = 'rgba(255,255,255,0.42)';
    c.font = '700 10px Inter, system-ui, sans-serif';
    c.fillText('GEAR', gx + 6, gy - 16);
    c.fillStyle = this.tachNeedle > 0.9 ? '#ff5a1f' : '#fff';
    c.font = '900 74px Inter, system-ui, sans-serif';
    c.fillText(String(st.gear), gx + 4, gy + 56);

    // rpm ladder
    const bars = 18;
    for (let i = 0; i < bars; i++) {
      const f = i / (bars - 1);
      const on = this.tachNeedle > f;
      const red = f > 0.82;
      c.fillStyle = on ? (red ? 'rgba(255,60,30,0.95)' : 'rgba(120,225,255,0.9)') : 'rgba(255,255,255,0.12)';
      const bh = 8 + f * 26;
      c.fillRect(gx + 62 + i * 3.6, gy + 60 - bh, 2.6, bh);
    }
    c.fillStyle = 'rgba(255,255,255,0.42)';
    c.font = '700 10px Inter, system-ui, sans-serif';
    c.fillText('RPM', gx + 62, gy + 76);

    // nitro glyph
    if (st.boosting) {
      c.fillStyle = 'rgba(24,214,192,0.95)';
      c.font = '900 15px Inter, system-ui, sans-serif';
      c.fillText('NITRO', gx + 62, gy + 98);
    }
  }

  drawMap(st) {
    const c = this.mctx;
    const S = this.map.width;
    c.clearRect(0, 0, S, S);
    const pad = 26;
    const sc = S - pad * 2;
    const pts = this.mapPath.points;

    c.save();
    c.translate(pad, pad);
    // route glow
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(255,90,31,0.14)';
    c.lineWidth = 13;
    c.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      if (i === 0) c.moveTo(x * sc, y * sc);
      else c.lineTo(x * sc, y * sc);
    }
    c.closePath();
    c.stroke();
    c.strokeStyle = 'rgba(240,246,255,0.55)';
    c.lineWidth = 3.2;
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.lineWidth = 1.1;
    c.stroke();

    const blip = (frac, color, r, ring) => {
      const idx = clamp(Math.floor(frac * pts.length), 0, pts.length - 1);
      const [x, y] = pts[idx];
      c.fillStyle = color;
      if (ring) {
        c.shadowColor = color;
        c.shadowBlur = 12;
      }
      c.beginPath();
      c.arc(x * sc, y * sc, r, 0, 6.283);
      c.fill();
      c.shadowBlur = 0;
    };
    for (const r of st.rivalFracs || []) blip(r.f, r.cop ? '#4aa8ff' : 'rgba(255,255,255,0.75)', 4.2, r.cop);
    blip(st.playerFrac, '#ff5a1f', 6.4, true);
    // start line marker
    c.strokeStyle = 'rgba(255,255,255,0.6)';
    c.lineWidth = 2;
    const [sx, sy] = pts[0];
    c.beginPath();
    c.moveTo(sx * sc - 6, sy * sc - 6);
    c.lineTo(sx * sc + 6, sy * sc + 6);
    c.stroke();
    c.restore();

    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.font = '700 15px Inter, system-ui, sans-serif';
    c.textAlign = 'left';
    c.fillText('CANYON CIRCUIT', 14, 24);
  }

  dispose() {
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
  }
}
