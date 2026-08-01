// AAA-style HUD: canvas speedo, boost bar, minimap, animated score, kinetic
// takedown callouts, crash-mode meter.
import { clamp } from './rng.js';

const CSS = `
#co-hud { position:fixed; inset:0; pointer-events:none; font-family: "Inter", "Helvetica Neue", Arial, system-ui, sans-serif;
  color:#fff; -webkit-font-smoothing:antialiased; overflow:hidden; z-index:10; }
#co-hud .fx { position:absolute; }
#co-hud canvas { display:block; }

#co-speedo { right:26px; bottom:18px; }
#co-mini { left:26px; bottom:22px; opacity:.92; }

#co-top { position:absolute; top:0; left:0; right:0; padding:18px 30px; display:flex; justify-content:space-between; align-items:flex-start; }
.co-stat { display:flex; flex-direction:column; }
.co-label { font-size:11px; letter-spacing:.28em; font-weight:800; color:#8fa3bd; text-transform:uppercase; margin-bottom:2px;
  text-shadow:0 2px 8px rgba(0,0,0,.9); }
.co-value { font-size:48px; font-weight:900; font-style:italic; letter-spacing:-.035em; line-height:.92;
  -webkit-text-stroke:1.5px rgba(2,4,9,.85); paint-order:stroke fill;
  text-shadow:0 3px 16px rgba(0,0,0,.95), 0 0 26px rgba(80,190,255,.45); }
.co-value small { font-size:19px; font-weight:800; opacity:.75; margin-left:3px; }
#co-score { align-items:flex-end; }
#co-score .co-value { color:#ffdf4a; transform-origin:100% 50%;
  text-shadow:0 3px 16px rgba(0,0,0,.95), 0 0 30px rgba(255,190,40,.85), 0 0 70px rgba(255,140,0,.5); }
#co-td .co-value, #co-tdwrap .co-value { color:#ff5c3a; }

#co-pops { position:absolute; right:34px; top:120px; width:340px; text-align:right; }
#co-pops div { font-size:40px; font-weight:900; font-style:italic; letter-spacing:-.03em; color:#ffe066;
  -webkit-text-stroke:2px rgba(2,4,9,.9); paint-order:stroke fill;
  text-shadow:0 0 26px rgba(255,170,30,.9), 0 4px 16px #000; will-change:transform,opacity; }

#co-boostwrap { position:absolute; left:50%; bottom:26px; transform:translateX(-50%); width:430px; }
#co-boostbar { position:relative; height:16px; border-radius:3px; overflow:hidden;
  background:linear-gradient(180deg, rgba(6,10,18,.86), rgba(3,5,10,.9));
  box-shadow: inset 0 0 0 1.5px rgba(150,190,240,.28), 0 6px 26px rgba(0,0,0,.7);
  transform: skewX(-16deg); }
#co-boostfill { position:absolute; inset:1.5px; width:0%; border-radius:2px;
  background:linear-gradient(90deg,#1e63ff,#25c5ff 45%,#8ef0ff); box-shadow:0 0 22px rgba(60,190,255,.75); }
#co-boostwrap.ready #co-boostfill { background:linear-gradient(90deg,#ff8a00,#ffd23f 45%,#fff5c0); box-shadow:0 0 34px rgba(255,190,60,.95); }
#co-boostwrap.burn #co-boostfill { background:linear-gradient(90deg,#ff2d00,#ff9d00 50%,#fff0b8); box-shadow:0 0 44px rgba(255,120,20,1); }
#co-boostticks { position:absolute; inset:0; display:flex; transform: skewX(-16deg); }
#co-boostticks i { flex:1; border-right:1.5px solid rgba(4,8,14,.85); }
#co-boostticks i:last-child { border-right:0; }
#co-boostlabel { margin-top:7px; text-align:center; font-size:11px; letter-spacing:.34em; font-weight:800; color:#9fc6ef;
  text-transform:uppercase; text-shadow:0 2px 10px #000; }

#co-callout { position:absolute; left:50%; top:19%; transform:translate(-50%,-50%); text-align:center; width:100%; }
#co-callout .scrim { position:absolute; left:-10%; top:-6%; width:120%; height:132%; opacity:0;
  background:linear-gradient(180deg, rgba(3,5,9,0) 0%, rgba(3,5,9,.86) 22%, rgba(3,5,9,.90) 72%, rgba(3,5,9,0) 100%);
  transform:skewY(-2.2deg); }
#co-callout .big { position:relative; font-size:clamp(72px, 11.2vw, 168px); font-weight:900; font-style:italic;
  letter-spacing:-.05em; line-height:.84; white-space:nowrap;
  text-transform:uppercase; opacity:0; will-change:transform,opacity;
  -webkit-text-stroke:5px rgba(2,3,6,.94); paint-order:stroke fill; }
#co-callout .sub { position:relative; font-size:29px; font-weight:800; letter-spacing:.26em; text-transform:uppercase; opacity:0; margin-top:10px;
  color:#eef4ff; text-shadow:0 0 18px rgba(0,0,0,.95), 0 2px 10px #000; }

#co-chain { position:absolute; left:50%; top:34%; transform:translateX(-50%); font-size:40px; font-weight:900; font-style:italic;
  letter-spacing:.05em; opacity:0; color:#ffd76a; text-shadow:0 0 26px rgba(255,170,40,.9), 0 3px 14px #000; }

#co-crash { position:absolute; left:50%; bottom:96px; transform:translateX(-50%); width:520px; opacity:0; transition:opacity .18s; }
#co-crash .bar { height:9px; background:rgba(6,10,18,.8); border-radius:2px; overflow:hidden; transform:skewX(-16deg);
  box-shadow: inset 0 0 0 1.5px rgba(255,190,90,.35); }
#co-crash .fill { height:100%; width:0%; background:linear-gradient(90deg,#ff5a00,#ffcf3a,#fff6cf); box-shadow:0 0 26px rgba(255,150,30,.9); }
#co-crash .txt { text-align:center; font-size:13px; letter-spacing:.3em; font-weight:800; color:#ffd489; margin-top:7px; text-shadow:0 2px 10px #000; }

#co-flash { position:absolute; inset:0; background:#fff; opacity:0; mix-blend-mode:screen; }
#co-vig { position:absolute; inset:0; box-shadow: inset 0 0 240px 40px rgba(0,0,0,.55); }
#co-dmg { position:absolute; inset:0; opacity:0;
  background: radial-gradient(ellipse at center, rgba(255,0,0,0) 40%, rgba(190,10,0,.55) 100%); }

#co-title { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center;
  background:radial-gradient(ellipse at 50% 60%, rgba(4,8,16,.45), rgba(2,3,7,.88)); transition:opacity .45s; }
#co-title h1 { font-size:120px; font-weight:900; font-style:italic; letter-spacing:-.05em; margin:0;
  background:linear-gradient(180deg,#fff,#ffca4a 55%,#ff6a00);
  -webkit-background-clip:text; background-clip:text; color:transparent;
  filter: drop-shadow(0 8px 30px rgba(255,140,0,.5)); text-transform:uppercase; }
#co-title p { margin:12px 0 0; font-size:14px; letter-spacing:.42em; font-weight:800; color:#a9c6e8; text-transform:uppercase; }
#co-title .keys { margin-top:26px; font-size:12px; letter-spacing:.2em; color:#7d94b3; font-weight:700; }
`;

export class HUD {
  constructor(root) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'co-hud';
    el.innerHTML = `
      <div id="co-vig"></div>
      <div id="co-dmg"></div>
      <div id="co-top">
        <div style="display:flex; gap:34px">
          <div class="co-stat"><div class="co-label">Position</div><div class="co-value" id="co-pos">1<small>/6</small></div></div>
          <div class="co-stat"><div class="co-label">Lap</div><div class="co-value" id="co-lap">1<small>/3</small></div></div>
          <div class="co-stat"><div class="co-label">Time</div><div class="co-value" id="co-time">0:00</div></div>
        </div>
        <div style="display:flex; gap:34px; text-align:right">
          <div class="co-stat" id="co-tdwrap"><div class="co-label">Takedowns</div><div class="co-value" id="co-td">0</div></div>
          <div class="co-stat" id="co-score"><div class="co-label">Score</div><div class="co-value" id="co-scorev">0</div></div>
        </div>
      </div>
      <canvas id="co-speedo" class="fx" width="300" height="300"></canvas>
      <canvas id="co-mini" class="fx" width="220" height="220"></canvas>
      <div id="co-boostwrap">
        <div id="co-boostbar"><div id="co-boostfill"></div><div id="co-boostticks"><i></i><i></i><i></i><i></i></div></div>
        <div id="co-boostlabel">Boost — Shift</div>
      </div>
      <div id="co-chain"></div>
      <div id="co-pops"></div>
      <div id="co-callout"><div class="scrim"></div><div class="big"></div><div class="sub"></div></div>
      <div id="co-crash"><div class="bar"><div class="fill"></div></div><div class="txt">Crashbreaker — steer into traffic</div></div>
      <div id="co-flash"></div>
      <div id="co-title">
        <h1>CRASHOUT</h1>
        <p>Takedown Racing</p>
        <div class="keys">↑ / W accelerate &nbsp;·&nbsp; ↓ / S brake &nbsp;·&nbsp; ← → steer &nbsp;·&nbsp; SHIFT boost &nbsp;·&nbsp; SPACE handbrake &nbsp;·&nbsp; C camera</div>
      </div>
    `;
    (root || document.body).appendChild(el);
    this.el = el;
    this.speedo = el.querySelector('#co-speedo');
    this.sctx = this.speedo.getContext('2d');
    this.mini = el.querySelector('#co-mini');
    this.mctx = this.mini.getContext('2d');
    this.boostFill = el.querySelector('#co-boostfill');
    this.boostWrap = el.querySelector('#co-boostwrap');
    this.calloutBig = el.querySelector('#co-callout .big');
    this.calloutSub = el.querySelector('#co-callout .sub');
    this.calloutScrim = el.querySelector('#co-callout .scrim');
    this.chain = el.querySelector('#co-chain');
    this.pops = el.querySelector('#co-pops');
    this.popList = [];
    this.crash = el.querySelector('#co-crash');
    this.crashFill = el.querySelector('#co-crash .fill');
    this.flash = el.querySelector('#co-flash');
    this.dmg = el.querySelector('#co-dmg');
    this.title = el.querySelector('#co-title');
    this.posEl = el.querySelector('#co-pos');
    this.lapEl = el.querySelector('#co-lap');
    this.timeEl = el.querySelector('#co-time');
    this.tdEl = el.querySelector('#co-td');
    this.scoreEl = el.querySelector('#co-scorev');

    this.shownScore = 0;
    this.calloutT = 0;
    this.chainT = 0;
    this.flashT = 0;
    this.trackPts = null;
  }

  setTrack(track) {
    // pre-project the loop for the minimap
    const pts = [];
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < track.N; i += 6) {
      const x = track.pos[i * 3], z = track.pos[i * 3 + 2];
      pts.push([x, z]);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    this.trackPts = pts;
    this.trackBounds = { minX, maxX, minZ, maxZ };
  }

  hideTitle() {
    if (this.title && this.title.style.opacity !== '0') {
      this.title.style.opacity = '0';
      setTimeout(() => { if (this.title) this.title.style.display = 'none'; }, 500);
    }
  }

  callout(big, sub, color = '#ffffff') {
    this.calloutBig.textContent = big;
    this.calloutSub.textContent = sub || '';
    this.calloutBig.style.color = color;
    this.calloutBig.style.textShadow =
      `0 0 8px rgba(0,0,0,.95), 0 0 30px ${color}aa, 0 0 74px ${color}66, 0 8px 26px rgba(0,0,0,.95)`;
    // Held captures park the sim on one beat; a callout that keeps counting
    // down in wall time would be half-faded by the time the shutter fires.
    this.calloutT = 1.9;
  }

  // Floating score popup. A 10-year-old needs to SEE the points land, not
  // notice a counter tick. Nodes are recycled through a small list so a
  // 6-takedown chain does not churn the DOM.
  scorePop(text, color = '#ffe066', big = false) {
    if (!this.pops) return;
    let node = this.popList.find(n => n.t <= 0);
    if (!node) {
      if (this.popList.length >= 8) return;
      node = { el: document.createElement('div'), t: 0 };
      this.pops.appendChild(node.el);
      this.popList.push(node);
    }
    node.el.textContent = text;
    node.el.style.color = color;
    node.el.style.fontSize = big ? '64px' : '40px';
    node.t = 1.25;
    node.life = 1.25;
  }

  updatePops(dt) {
    for (const n of this.popList) {
      if (n.t <= 0) { if (n.el.style.opacity !== '0') n.el.style.opacity = '0'; continue; }
      n.t -= dt;
      const k = 1 - Math.max(0, n.t) / n.life;
      const pop = k < 0.10 ? k / 0.10 : 1;
      const sc = 0.5 + pop * 0.62 - Math.max(0, k - 0.55) * 0.18;
      n.el.style.opacity = k > 0.62 ? clamp((1 - k) / 0.38, 0, 1) : 1;
      n.el.style.transform = `translateY(${-k * 96}px) scale(${sc}) skewX(-9deg)`;
    }
  }

  showChain(text) {
    this.chain.textContent = text;
    this.chainT = 1.5;
  }

  impactFlash(a) { this.flashT = Math.max(this.flashT, a); }

  update(dt, s) {
    // ---- numbers
    this.shownScore += (s.score - this.shownScore) * clamp(dt * 7, 0, 1);
    if (Math.abs(s.score - this.shownScore) < 1) this.shownScore = s.score;
    this.scoreEl.textContent = Math.round(this.shownScore).toLocaleString();
    // Score counter kicks while it is still catching up, so points landing is
    // a physical event rather than a silent digit change.
    this.scoreKick = Math.max(0, (this.scoreKick || 0) - dt * 3.4);
    if (s.score - this.shownScore > 40) this.scoreKick = 1;
    if (this.scoreKick > 0.001 || this._kicked) {
      this.scoreEl.style.transform = `scale(${1 + this.scoreKick * 0.30}) skewX(${-this.scoreKick * 5}deg)`;
      this._kicked = this.scoreKick > 0.001;
    }
    this.updatePops(dt);
    this.tdEl.textContent = s.takedowns;
    this.posEl.innerHTML = `${s.position}<small>/${s.racers}</small>`;
    this.lapEl.innerHTML = `${s.lap}<small>/${s.laps}</small>`;
    const m = Math.floor(s.time / 60), sec = Math.floor(s.time % 60);
    this.timeEl.textContent = `${m}:${sec.toString().padStart(2, '0')}`;

    // ---- boost
    this.boostFill.style.width = `${clamp(s.boost, 0, 1) * 100}%`;
    this.boostWrap.classList.toggle('ready', s.boost >= 0.999 && !s.boosting);
    this.boostWrap.classList.toggle('burn', s.boosting);

    // ---- callouts
    if (this.calloutT > 0) {
      // Held captures park the sim on one beat, so the callout is parked on its
      // fully-struck pose instead of counting down in wall time and being
      // half-faded by the time a 1fps harness fires the shutter.
      if (!this.holdCallouts) this.calloutT -= dt;
      const t = this.holdCallouts ? 0.45 : 1 - this.calloutT / 1.9;
      // Hard slam: overshoot past 1 then settle, with a decaying rattle for the
      // first third of a second so the word physically shakes the screen.
      const pop = t < 0.09 ? t / 0.09 : 1;
      const settle = clamp((t - 0.09) / 0.16, 0, 1);
      const scale = (0.42 + pop * 0.72) * (1 + (1 - settle) * 0.14 * Math.cos(t * 74))
                    - Math.max(0, t - 0.7) * 0.18;
      const skew = -9 + (1 - pop) * 34;
      const rattle = Math.max(0, 1 - t / 0.30);
      const sx = Math.sin(t * 190) * 22 * rattle;
      const sy = Math.cos(t * 151) * 13 * rattle;
      const rot = Math.sin(t * 133) * 2.4 * rattle;
      const op = t < 0.06 ? t / 0.06 : t > 0.72 ? clamp((1 - t) / 0.28, 0, 1) : 1;
      this.calloutBig.style.opacity = op;
      this.calloutBig.style.transform =
        `translate(${sx}px,${sy}px) rotate(${rot}deg) scale(${scale}) skewX(${skew}deg)`;
      this.calloutSub.style.opacity = op * 0.9;
      this.calloutSub.style.transform = `translateX(${(1 - pop) * -40}px)`;
      if (this.calloutScrim) this.calloutScrim.style.opacity = op * 0.92;
    } else {
      this.calloutBig.style.opacity = 0;
      this.calloutSub.style.opacity = 0;
      if (this.calloutScrim) this.calloutScrim.style.opacity = 0;
    }
    if (this.chainT > 0) {
      if (!this.holdCallouts) this.chainT -= dt;
      const t = this.holdCallouts ? 0.4 : 1 - this.chainT / 1.5;
      this.chain.style.opacity = t < 0.1 ? t / 0.1 : clamp((1 - t) / 0.4, 0, 1);
      this.chain.style.transform = `translateX(-50%) scale(${1 + (1 - Math.min(1, t * 6)) * 0.5})`;
    } else this.chain.style.opacity = 0;

    // ---- crash meter
    this.crash.style.opacity = s.crashMode ? 1 : 0;
    this.crashFill.style.width = `${clamp(s.crashMeter, 0, 1) * 100}%`;

    // ---- flash / damage vignette
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt * 3.4);
    this.flash.style.opacity = this.flashT * 0.55;
    this.dmg.style.opacity = clamp((1 - s.health) * 0.9, 0, 1) * (0.55 + 0.45 * Math.sin(s.time * 6));

    this.drawSpeedo(s);
    this.drawMini(s);
  }

  drawSpeedo(s) {
    const c = this.sctx;
    const W = 300, H = 300;
    c.clearRect(0, 0, W, H);
    const cx = W * 0.62, cy = H * 0.66, R = 104;
    const a0 = Math.PI * 0.78, a1 = Math.PI * 2.30;
    const kmh = s.speed * 3.6;
    const frac = clamp(kmh / 340, 0, 1);

    // outer plate
    c.save();
    c.beginPath();
    c.arc(cx, cy, R + 22, a0 - 0.16, a1 + 0.16);
    c.strokeStyle = 'rgba(8,12,20,0.72)';
    c.lineWidth = 44;
    c.lineCap = 'butt';
    c.stroke();
    c.restore();

    // track
    c.beginPath();
    c.arc(cx, cy, R, a0, a1);
    c.strokeStyle = 'rgba(140,175,215,0.20)';
    c.lineWidth = 12;
    c.lineCap = 'round';
    c.stroke();

    // fill
    const grad = c.createLinearGradient(cx - R, cy, cx + R, cy);
    if (s.boosting) { grad.addColorStop(0, '#ff7a00'); grad.addColorStop(0.6, '#ffd23f'); grad.addColorStop(1, '#fff6d0'); }
    else { grad.addColorStop(0, '#2a7bff'); grad.addColorStop(0.55, '#39d0ff'); grad.addColorStop(1, '#b7f4ff'); }
    c.beginPath();
    c.arc(cx, cy, R, a0, a0 + (a1 - a0) * frac);
    c.strokeStyle = grad;
    c.lineWidth = 12;
    c.lineCap = 'round';
    c.shadowColor = s.boosting ? 'rgba(255,170,40,0.95)' : 'rgba(60,190,255,0.85)';
    c.shadowBlur = 24;
    c.stroke();
    c.shadowBlur = 0;

    // ticks
    for (let i = 0; i <= 17; i++) {
      const t = i / 17;
      const a = a0 + (a1 - a0) * t;
      const maj = i % 3 === 0;
      const r0 = R - 16, r1 = R - (maj ? 30 : 24);
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      c.strokeStyle = t <= frac ? 'rgba(220,240,255,0.85)' : 'rgba(130,160,195,0.35)';
      c.lineWidth = maj ? 3 : 1.6;
      c.stroke();
    }

    // redline arc
    c.beginPath();
    c.arc(cx, cy, R + 13, a0 + (a1 - a0) * 0.82, a1);
    c.strokeStyle = 'rgba(255,60,40,0.75)';
    c.lineWidth = 4;
    c.stroke();

    // number
    c.textAlign = 'center';
    c.fillStyle = '#fff';
    c.font = '900 italic 62px "Helvetica Neue", Arial, sans-serif';
    c.shadowColor = 'rgba(0,0,0,0.95)';
    c.shadowBlur = 18;
    c.fillText(Math.round(kmh), cx, cy + 14);
    c.shadowBlur = 0;
    c.font = '800 13px "Helvetica Neue", Arial, sans-serif';
    c.fillStyle = 'rgba(160,190,225,0.9)';
    c.letterSpacing = '3px';
    c.fillText('KM/H', cx, cy + 36);

    // gear
    c.font = '900 italic 30px "Helvetica Neue", Arial, sans-serif';
    c.fillStyle = s.boosting ? '#ffd76a' : '#7fd6ff';
    c.shadowColor = s.boosting ? 'rgba(255,170,40,.9)' : 'rgba(60,190,255,.8)';
    c.shadowBlur = 16;
    c.fillText(String(s.gear), cx, cy - 34);
    c.shadowBlur = 0;

    // rpm bar under the dial
    const rw = 150, rh = 6;
    const rx = cx - rw / 2, ry = cy + 52;
    c.fillStyle = 'rgba(10,14,22,0.8)';
    c.fillRect(rx, ry, rw, rh);
    const rf = clamp(s.rpm / 7600, 0, 1);
    c.fillStyle = rf > 0.88 ? '#ff4b2b' : '#8ff0ff';
    c.fillRect(rx, ry, rw * rf, rh);
  }

  drawMini(s) {
    if (!this.trackPts) return;
    const c = this.mctx;
    const W = 220, H = 220;
    c.clearRect(0, 0, W, H);
    const b = this.trackBounds;
    const spanX = b.maxX - b.minX, spanZ = b.maxZ - b.minZ;
    const span = Math.max(spanX, spanZ) * 1.06;
    const px = (x) => ((x - (b.minX + spanX / 2)) / span) * (W - 30) + W / 2;
    const pz = (z) => ((z - (b.minZ + spanZ / 2)) / span) * (H - 30) + H / 2;

    c.fillStyle = 'rgba(6,10,18,0.55)';
    c.beginPath();
    c.arc(W / 2, H / 2, 100, 0, 6.3);
    c.fill();
    c.strokeStyle = 'rgba(150,190,240,0.22)';
    c.lineWidth = 2;
    c.stroke();

    c.beginPath();
    const pts = this.trackPts;
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i];
      if (i === 0) c.moveTo(px(x), pz(z)); else c.lineTo(px(x), pz(z));
    }
    c.closePath();
    c.strokeStyle = 'rgba(160,200,245,0.55)';
    c.lineWidth = 4;
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.14)';
    c.lineWidth = 8;
    c.stroke();

    for (const r of s.blips || []) {
      c.beginPath();
      c.arc(px(r.x), pz(r.z), r.me ? 5 : 3.4, 0, 6.3);
      c.fillStyle = r.me ? '#ffd23f' : (r.rival ? '#ff4b52' : 'rgba(150,190,240,0.7)');
      c.shadowColor = r.me ? 'rgba(255,190,60,0.9)' : 'transparent';
      c.shadowBlur = r.me ? 12 : 0;
      c.fill();
      c.shadowBlur = 0;
    }
  }
}
