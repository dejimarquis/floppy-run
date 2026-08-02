/**
 * HUD — designed like a real machine's insert panel, not debug text.
 * Score / ball / rank / multiplier / mission status, plus the instant-play
 * onboarding card and the mode banner.
 */

const CSS = `
#pb-hud{position:fixed;inset:0;pointer-events:none;font-family:"Helvetica Neue",Inter,Arial,sans-serif;
  color:#dfe9ff;z-index:10;user-select:none;-webkit-font-smoothing:antialiased}
#pb-hud .row{position:absolute;display:flex;align-items:flex-end;gap:18px}
#pb-top{top:18px;left:24px;right:24px;justify-content:space-between}
#pb-score{font-weight:800;font-size:52px;letter-spacing:2px;line-height:0.92;
  color:#ffdca8;text-shadow:0 0 22px rgba(255,150,40,.55),0 2px 0 rgba(0,0,0,.7);
  font-variant-numeric:tabular-nums}
#pb-score small{display:block;font-size:11px;letter-spacing:5px;font-weight:700;
  color:#7fa8d8;text-shadow:none;margin-bottom:5px}
.pb-chip{background:linear-gradient(180deg,rgba(16,24,48,.82),rgba(6,10,22,.86));
  border:1px solid rgba(120,170,255,.22);border-radius:7px;padding:7px 13px;
  box-shadow:0 4px 22px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.07);
  backdrop-filter:blur(7px)}
.pb-chip b{display:block;font-size:9px;letter-spacing:3.4px;color:#6d8fc4;font-weight:700}
.pb-chip span{font-size:20px;font-weight:800;letter-spacing:1px;color:#eaf2ff;
  font-variant-numeric:tabular-nums}
.pb-chip.hot span{color:#ffd06a;text-shadow:0 0 14px rgba(255,170,50,.75)}
.pb-chip.ml span{color:#8fd89a;text-shadow:0 0 12px rgba(90,200,110,.55)}
#pb-right{top:18px;right:24px;flex-direction:row;gap:10px}
#pb-mission{position:absolute;left:26px;top:118px;transform:none;text-align:left;
  text-align:center;min-width:280px}
#pb-mission .name{font-size:15px;letter-spacing:6px;font-weight:800;color:#ffc46a;
  text-shadow:0 0 18px rgba(60,180,255,.7)}
#pb-mission .sub{font-size:11px;letter-spacing:3px;color:#8fa4c8;margin-top:4px}
#pb-mission .bar{height:3px;margin-top:8px;background:rgba(255,255,255,.12);border-radius:2px;overflow:hidden}
#pb-mission .bar i{display:block;height:100%;background:linear-gradient(90deg,#e0562c,#ffc04a);
  box-shadow:0 0 12px rgba(90,200,255,.9);transition:width .25s}
#pb-banner{position:absolute;left:50%;top:70%;transform:translate(-50%,-50%) scale(.7);
  font-size:38px;font-weight:900;letter-spacing:8px;opacity:0;white-space:nowrap;
  padding:10px 30px;border-radius:6px;
  background:linear-gradient(180deg,rgba(12,16,30,.78),rgba(6,8,16,.55));
  border:1px solid rgba(255,190,90,.45);
  color:#ffe6b0;text-shadow:0 0 18px rgba(255,180,60,.95),0 0 44px rgba(255,90,40,.55);
  transition:opacity .18s, transform .35s cubic-bezier(.2,1.6,.4,1)}
#pb-banner.show{opacity:1;transform:translate(-50%,-50%) scale(1)}
#pb-balls{position:absolute;left:24px;bottom:22px;display:flex;gap:7px;align-items:center}
#pb-balls i{width:13px;height:13px;border-radius:50%;
  background:radial-gradient(circle at 32% 28%,#fff,#9fb0c4 40%,#31384a 100%);
  box-shadow:0 0 10px rgba(180,210,255,.5), inset 0 -2px 3px rgba(0,0,0,.6);display:block}
#pb-balls i.used{background:#1b2231;box-shadow:none;opacity:.45}
#pb-balls u{font-size:9px;letter-spacing:3.4px;color:#6d8fc4;font-weight:700;
  text-decoration:none;margin-right:6px}
#pb-help{position:absolute;right:24px;bottom:22px;text-align:right;font-size:10.5px;
  letter-spacing:2.2px;color:#6d8fc4;line-height:1.85}
#pb-help kbd{background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.17);
  border-radius:4px;padding:1px 6px;font-family:inherit;font-size:10px;color:#cfe0ff;margin:0 2px}
#pb-tilt{position:absolute;inset:0;background:radial-gradient(circle,rgba(255,40,40,0) 40%,rgba(255,30,30,.35) 100%);
  opacity:0;transition:opacity .2s}
#pb-tilt.on{opacity:1}
#pb-start{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(circle at 50% 45%,rgba(10,16,40,.55),rgba(0,0,4,.9));
  z-index:20;pointer-events:auto;cursor:pointer;transition:opacity .45s;font-family:inherit}
#pb-start.hide{opacity:0;pointer-events:none}
#pb-start .card{text-align:center;color:#e6f0ff}
#pb-start h1{font-size:74px;margin:0;font-weight:900;letter-spacing:9px;
  background:linear-gradient(90deg,#ffe27a,#ff9a2f 40%,#e0532c 72%,#7fa4c4);
  -webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 0 26px rgba(255,140,50,.55))}
#pb-start h2{font-size:13px;letter-spacing:11px;margin:6px 0 26px;color:#9fc0e8;font-weight:700}
#pb-start p{font-size:12.5px;letter-spacing:3px;color:#8fa8cc;margin:6px 0}
#pb-start .go{margin-top:26px;font-size:14px;letter-spacing:6px;color:#ffd06a;
  animation:pbpulse 1.15s ease-in-out infinite}
@keyframes pbpulse{0%,100%{opacity:.45}50%{opacity:1}}
#pb-rank{position:absolute;left:26px;bottom:58px;
  font-size:9.5px;letter-spacing:4px;color:#93a9c9;
  padding:6px 12px 6px 11px;border-left:2px solid rgba(255,190,90,.75);
  background:linear-gradient(90deg,rgba(8,12,22,.72),rgba(8,12,22,0));
  text-shadow:0 1px 3px rgba(0,0,0,.9)}
#pb-rank b{color:#ffd06a;font-weight:800}
/* ---- floating score pops -------------------------------------------
   Chunky, high-contrast, hard-shadowed numbers that punch up out of the
   impact point and fade. This is the single clearest "that was worth
   something" signal in the whole game, and it costs zero draw calls. */
#pb-pops{position:absolute;inset:0;overflow:hidden}
.pb-pop{position:absolute;transform:translate(-50%,-50%);
  font-size:34px;font-weight:900;letter-spacing:1px;white-space:nowrap;
  font-variant-numeric:tabular-nums;
  text-shadow:0 0 10px currentColor, 0 0 26px currentColor,
              0 3px 0 rgba(0,0,0,.85), 0 -2px 0 rgba(0,0,0,.6),
              2px 0 0 rgba(0,0,0,.6), -2px 0 0 rgba(0,0,0,.6);
  animation:pbpop 0.95s cubic-bezier(.16,1.1,.3,1) forwards;will-change:transform,opacity}
.pb-pop.big{font-size:62px;letter-spacing:3px;animation-duration:1.35s}
@keyframes pbpop{
  0%{opacity:0;transform:translate(-50%,-50%) scale(.35) rotate(-4deg)}
  14%{opacity:1;transform:translate(-50%,-56%) scale(1.32) rotate(2deg)}
  30%{transform:translate(-50%,-62%) scale(1.02) rotate(0deg)}
  100%{opacity:0;transform:translate(-50%,-125%) scale(1.06)}}
`;

export class HUD {
  constructor(root) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'pb-hud';
    el.innerHTML = `
      <div class="row" id="pb-top">
        <div id="pb-score"><small>SCORE</small><span id="pb-scoreval">0</span></div>
        <div class="row" style="position:static">
          <div class="pb-chip"><b>BALL</b><span id="pb-ball">1</span></div>
          <div class="pb-chip hot"><b>BONUS</b><span id="pb-mult">1X</span></div>
          <div class="pb-chip ml"><b>RANK</b><span id="pb-rankv">CADET</span></div>
        </div>
      </div>
      <div id="pb-mission">
        <div class="name" id="pb-mname"></div>
        <div class="sub" id="pb-msub"></div>
        <div class="bar" style="display:none" id="pb-mbar"><i style="width:0%"></i></div>
      </div>
      <div id="pb-banner"></div>
      <div id="pb-balls"><u>BALLS</u></div>
      <div id="pb-rank">MISSION <b id="pb-mission-count">0</b> COMPLETE &nbsp;&bull;&nbsp; NEXT RANK <b id="pb-next">ENSIGN</b></div>
      <div id="pb-help">
        <div><kbd>Z</kbd><kbd>←</kbd> LEFT FLIPPER &nbsp; <kbd>/</kbd><kbd>→</kbd> RIGHT FLIPPER</div>
        <div><kbd>SPACE</kbd> PLUNGER &nbsp; <kbd>X</kbd><kbd>C</kbd><kbd>↑</kbd> NUDGE &nbsp; <kbd>1-5</kbd> CAMERA</div>
      </div>
      <div id="pb-tilt"></div>
      <div id="pb-pops"></div>`;
    root.appendChild(el);

    this.start = document.createElement('div');
    this.start.id = 'pb-start';
    this.start.innerHTML = `<div class="card">
        <h1>NOVA</h1><h2>S P A C E &nbsp; C A D E T</h2>
        <p>Z / ← &nbsp; LEFT FLIPPER &nbsp;&nbsp; / / → &nbsp; RIGHT FLIPPER</p>
        <p>SPACE &nbsp; PLUNGER &nbsp;&nbsp; X / C / ↑ &nbsp; NUDGE</p>
        <div class="go">PRESS ANY KEY TO LAUNCH</div>
      </div>`;
    root.appendChild(this.start);

    this.el = el;
    this.$score = el.querySelector('#pb-scoreval');
    this.$ball = el.querySelector('#pb-ball');
    this.$mult = el.querySelector('#pb-mult');
    this.$rank = el.querySelector('#pb-rankv');
    this.$mname = el.querySelector('#pb-mname');
    this.$msub = el.querySelector('#pb-msub');
    this.$mbar = el.querySelector('#pb-mbar');
    this.$mbarI = this.$mbar.querySelector('i');
    this.$banner = el.querySelector('#pb-banner');
    this.$balls = el.querySelector('#pb-balls');
    this.$tilt = el.querySelector('#pb-tilt');
    this.$missionCount = el.querySelector('#pb-mission-count');
    this.$next = el.querySelector('#pb-next');
    this.$pops = el.querySelector('#pb-pops');
    this.bannerT = 0;
    this.lastBalls = -1;
    this.popPool = [];
    this.popLive = [];
  }

  /**
   * Throw a score number up out of a screen position. Pooled: a busy multiball
   * fires a dozen a second and churning DOM nodes at that rate stutters.
   */
  pop(text, sx, sy, color = '#ffd85a', big = false) {
    if (sx < -80 || sy < -80 || sx > innerWidth + 80 || sy > innerHeight + 80) return;
    if (this.popLive.length > 14) {
      const old = this.popLive.shift();
      old.el.remove();
      this.popPool.push(old.el);
    }
    const el = this.popPool.pop() || document.createElement('div');
    el.className = 'pb-pop' + (big ? ' big' : '');
    el.textContent = text;
    el.style.color = color;
    el.style.left = sx + 'px';
    el.style.top = sy + 'px';
    // restart the animation on a recycled node
    el.style.animation = 'none';
    this.$pops.appendChild(el);
    void el.offsetWidth;
    el.style.animation = '';
    const rec = { el, t: big ? 1.35 : 0.95 };
    this.popLive.push(rec);
  }

  hideStart() {
    this.start.classList.add('hide');
    // The shot harness must never catch a mid-fade overlay. On a software
    // rasteriser the main thread is blocked in ~600 ms chunks, which starves
    // the CSS transition, so tear the node out on a wall-clock timer instead
    // of trusting the fade to finish.
    if (window.__SHOT__) {
      this.start.style.transition = 'none';
      this.start.style.display = 'none';
      return;
    }
    setTimeout(() => {
      this.start.style.display = 'none';
    }, 700);
  }

  banner(text, dur = 1.5) {
    this.$banner.textContent = text;
    this.$banner.classList.add('show');
    this.bannerT = dur;
  }

  update(dt, s) {
    this.$score.textContent = (s.displayScore | 0).toLocaleString('en-US');
    this.$ball.textContent = s.ball;
    this.$mult.textContent = s.multiplier + 'X';
    this.$rank.textContent = s.rankName;
    this.$missionCount.textContent = s.missionsDone;
    this.$next.textContent = s.nextRank;
    if (s.modeName) {
      this.$mname.textContent = s.modeName;
      this.$msub.textContent = s.modeSub || '';
      this.$mbar.style.display = s.modeProgress != null ? 'block' : 'none';
      if (s.modeProgress != null) this.$mbarI.style.width = Math.round(s.modeProgress * 100) + '%';
    } else {
      this.$mname.textContent = '';
      this.$msub.textContent = s.hint || '';
      this.$mbar.style.display = 'none';
    }
    if (s.ballsLeft !== this.lastBalls || s.totalBalls !== this._tb) {
      this.lastBalls = s.ballsLeft;
      this._tb = s.totalBalls;
      const dots = this.$balls.querySelectorAll('i');
      dots.forEach((d) => d.remove());
      for (let i = 0; i < s.totalBalls; i++) {
        const i2 = document.createElement('i');
        if (i >= s.ballsLeft) i2.className = 'used';
        this.$balls.appendChild(i2);
      }
    }
    this.$tilt.classList.toggle('on', !!s.tilted);
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.$banner.classList.remove('show');
    }
    for (let i = this.popLive.length - 1; i >= 0; i--) {
      const r = this.popLive[i];
      r.t -= dt;
      if (r.t <= 0) {
        r.el.remove();
        this.popPool.push(r.el);
        this.popLive.splice(i, 1);
      }
    }
  }
}
