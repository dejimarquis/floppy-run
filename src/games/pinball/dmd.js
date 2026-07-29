/**
 * Backbox dot-matrix display.
 *
 * A real 128x32 dot buffer with a hand-authored 5x7 pixel font, rendered to a
 * canvas as individual round dots with bloom-friendly falloff — exactly like a
 * plasma DMD. Everything the machine says goes through here.
 */

const F = {};
function glyph(ch, rows) {
  F[ch] = rows;
}
/* eslint-disable */
glyph(' ', ['00000','00000','00000','00000','00000','00000','00000']);
glyph('A', ['01110','10001','10001','11111','10001','10001','10001']);
glyph('B', ['11110','10001','10001','11110','10001','10001','11110']);
glyph('C', ['01110','10001','10000','10000','10000','10001','01110']);
glyph('D', ['11110','10001','10001','10001','10001','10001','11110']);
glyph('E', ['11111','10000','10000','11110','10000','10000','11111']);
glyph('F', ['11111','10000','10000','11110','10000','10000','10000']);
glyph('G', ['01110','10001','10000','10111','10001','10001','01111']);
glyph('H', ['10001','10001','10001','11111','10001','10001','10001']);
glyph('I', ['01110','00100','00100','00100','00100','00100','01110']);
glyph('J', ['00111','00010','00010','00010','00010','10010','01100']);
glyph('K', ['10001','10010','10100','11000','10100','10010','10001']);
glyph('L', ['10000','10000','10000','10000','10000','10000','11111']);
glyph('M', ['10001','11011','10101','10101','10001','10001','10001']);
glyph('N', ['10001','11001','10101','10011','10001','10001','10001']);
glyph('O', ['01110','10001','10001','10001','10001','10001','01110']);
glyph('P', ['11110','10001','10001','11110','10000','10000','10000']);
glyph('Q', ['01110','10001','10001','10001','10101','10010','01101']);
glyph('R', ['11110','10001','10001','11110','10100','10010','10001']);
glyph('S', ['01111','10000','10000','01110','00001','00001','11110']);
glyph('T', ['11111','00100','00100','00100','00100','00100','00100']);
glyph('U', ['10001','10001','10001','10001','10001','10001','01110']);
glyph('V', ['10001','10001','10001','10001','10001','01010','00100']);
glyph('W', ['10001','10001','10001','10101','10101','11011','10001']);
glyph('X', ['10001','10001','01010','00100','01010','10001','10001']);
glyph('Y', ['10001','10001','01010','00100','00100','00100','00100']);
glyph('Z', ['11111','00001','00010','00100','01000','10000','11111']);
glyph('0', ['01110','10001','10011','10101','11001','10001','01110']);
glyph('1', ['00100','01100','00100','00100','00100','00100','01110']);
glyph('2', ['01110','10001','00001','00010','00100','01000','11111']);
glyph('3', ['11111','00010','00100','00010','00001','10001','01110']);
glyph('4', ['00010','00110','01010','10010','11111','00010','00010']);
glyph('5', ['11111','10000','11110','00001','00001','10001','01110']);
glyph('6', ['00110','01000','10000','11110','10001','10001','01110']);
glyph('7', ['11111','00001','00010','00100','01000','01000','01000']);
glyph('8', ['01110','10001','10001','01110','10001','10001','01110']);
glyph('9', ['01110','10001','10001','01111','00001','00010','01100']);
glyph('.', ['00000','00000','00000','00000','00000','01100','01100']);
glyph(',', ['00000','00000','00000','00000','01100','01100','01000']);
glyph('-', ['00000','00000','00000','11111','00000','00000','00000']);
glyph('_', ['00000','00000','00000','00000','00000','00000','11111']);
glyph('!', ['00100','00100','00100','00100','00100','00000','00100']);
glyph('?', ['01110','10001','00001','00010','00100','00000','00100']);
glyph(':', ['00000','01100','01100','00000','01100','01100','00000']);
glyph('+', ['00000','00100','00100','11111','00100','00100','00000']);
glyph('*', ['00000','10101','01110','11111','01110','10101','00000']);
glyph('/', ['00001','00010','00010','00100','01000','01000','10000']);
glyph('(', ['00010','00100','01000','01000','01000','00100','00010']);
glyph(')', ['01000','00100','00010','00010','00010','00100','01000']);
glyph('<', ['00010','00100','01000','10000','01000','00100','00010']);
glyph('>', ['01000','00100','00010','00001','00010','00100','01000']);
glyph('=', ['00000','00000','11111','00000','11111','00000','00000']);
glyph('%', ['11001','11010','00010','00100','01000','01011','10011']);
glyph('#', ['01010','11111','01010','01010','01010','11111','01010']);
glyph('$', ['00100','01111','10100','01110','00101','11110','00100']);
glyph("'", ['00100','00100','00000','00000','00000','00000','00000']);
glyph('\u2605', ['00100','00100','11111','01110','01110','01010','10001']);
glyph('\u25b6', ['10000','11000','11100','11110','11100','11000','10000']);
glyph('\u25c0', ['00001','00011','00111','01111','00111','00011','00001']);
/* eslint-enable */

export const DMD_W = 128;
export const DMD_H = 32;

export class DMD {
  constructor(scale = 8) {
    this.w = DMD_W;
    this.h = DMD_H;
    this.buf = new Uint8Array(this.w * this.h);
    this.scale = scale;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w * scale;
    this.canvas.height = this.h * scale;
    this.g = this.canvas.getContext('2d');
    this.hue = 26; // amber plasma
    this.queue = [];
    this.current = null;
    this.t = 0;
    this.scrollX = 0;
    this.dirty = true;
    this.anim = null;
    this.animT = 0;
    this.flashT = 0;
  }

  clear() {
    this.buf.fill(0);
  }

  px(x, y, v = 3) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    if (v > this.buf[i]) this.buf[i] = v;
  }

  rect(x, y, w, h, v = 3) {
    for (let i = 0; i < w; i++) {
      this.px(x + i, y, v);
      this.px(x + i, y + h - 1, v);
    }
    for (let j = 0; j < h; j++) {
      this.px(x, y + j, v);
      this.px(x + w - 1, y + j, v);
    }
  }

  fill(x, y, w, h, v = 3) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, v);
  }

  charW(scale) {
    return 5 * scale + scale;
  }

  text(str, x, y, v = 3, scale = 1) {
    let cx = x;
    const s = String(str).toUpperCase();
    for (const ch of s) {
      const gl = F[ch] || F['?'];
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 5; c++) {
          if (gl[r][c] === '1') {
            if (scale === 1) this.px(cx + c, y + r, v);
            else this.fill(cx + c * scale, y + r * scale, scale, scale, v);
          }
        }
      }
      cx += 6 * scale;
    }
    return cx - x;
  }

  measure(str, scale = 1) {
    return String(str).length * 6 * scale - scale;
  }

  /**
   * Centred text that can never clip: shrinks the scale until it fits, then
   * marquee-scrolls if even scale 1 overflows the panel.
   */
  textC(str, y, v = 3, scale = 1, scrollT = -1) {
    let s = String(str);
    let sc = Math.max(1, scale | 0);
    while (sc > 1 && this.measure(s, sc) > this.w) sc--;
    let w = this.measure(s, sc);
    if (w > this.w) {
      if (scrollT >= 0) {
        const pad = '   ';
        const loop = s + pad;
        const cw = 6 * sc;
        const total = loop.length * cw;
        const off = Math.floor((scrollT * 26) % total);
        this.text(loop + loop, -off, y, v, sc);
        return sc;
      }
      // no scroll context: hard-fit by truncation rather than clipping both ends
      const max = Math.floor((this.w + sc) / (6 * sc));
      s = s.slice(0, max);
      w = this.measure(s, sc);
    }
    this.text(s, Math.round((this.w - w) / 2), y, v, sc);
    return sc;
  }

  /* ---------------- message queue ---------------- */

  show(msg) {
    // msg: {l1, l2, dur, scroll, anim, big, prio}
    if (msg.prio) {
      this.current = Object.assign({ dur: 1.6 }, msg);
      this.t = 0;
      this.scrollX = this.w;
      return;
    }
    if (this.queue.length > 6) this.queue.shift();
    this.queue.push(Object.assign({ dur: 1.6 }, msg));
  }

  flash(n = 3) {
    this.flashT = n * 0.12;
  }

  update(dt, ctx) {
    this.t += dt;
    this.animT += dt;
    if (this.flashT > 0) this.flashT -= dt;
    if (!this.current || this.t > this.current.dur) {
      this.current = this.queue.shift() || null;
      this.t = 0;
      this.scrollX = this.w;
    }
    this.scrollX -= dt * 34;
    this.draw(ctx);
    this.render();
  }

  /* ---------------- default screens ---------------- */

  draw(ctx) {
    this.clear();
    const m = this.current;
    const blink = Math.floor(this.t * 6) % 2 === 0;

    if (m && m.anim === 'multiball') {
      this.animMultiball();
    } else if (m && m.anim === 'tilt') {
      this.animTilt();
    } else if (m && m.anim === 'jackpot') {
      this.animJackpot(m);
    } else if (m && m.anim === 'launch') {
      this.animLaunch();
    } else if (m && m.scroll) {
      this.text(m.scroll, Math.round(this.scrollX), 12, 3, 1);
      if (this.scrollX < -this.measure(m.scroll, 1)) this.scrollX = this.w;
    } else if (m && m.big) {
      // 7-row glyphs at scale 3 occupy 21 rows: start at 2 so the sub-line at
      // row 25 keeps a clear 3-row gutter instead of butting against it.
      this.textC(m.big, 2, 3, 3);
      if (m.l2) this.textC(m.l2, 25, blink ? 3 : 2, 1);
    } else if (m) {
      if (m.l1) this.textC(m.l1, 3, 3, 2);
      if (m.l2) this.textC(m.l2, 21, 3, 1);
    } else {
      this.drawScore(ctx);
    }

    if (this.flashT > 0 && Math.floor(this.flashT * 16) % 2 === 0) {
      for (let i = 0; i < this.buf.length; i++) this.buf[i] = this.buf[i] ? 3 : 1;
    }
  }

  drawScore(ctx) {
    if (!ctx) {
      this.textC('SPACE CADET NOVA', 12, 3, 1);
      return;
    }
    const score = String(ctx.displayScore | 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const sc = score.length > 11 ? 1 : 2;
    const w = this.measure(score, sc);
    this.text(score, this.w - w - 3, sc === 2 ? 0 : 3, 3, sc);
    // ball / player strip
    this.text(`BALL ${ctx.ball}`, 3, 24, 2, 1);
    const rank = ctx.rankName || 'CADET';
    this.text(rank, this.w - this.measure(rank, 1) - 3, 24, 2, 1);
    if (ctx.multiplier > 1) this.text(`${ctx.multiplier}X`, 3, 0, 3, 1);
    // mission strip
    if (ctx.modeName) {
      const t = ctx.modeName;
      this.text(t, 3, 16, 3, 1);
    } else {
      // little animated starfield ticker
      for (let i = 0; i < 16; i++) {
        const x = ((i * 17 + Math.floor(this.animT * 26 + i * 3)) % 60) + 2;
        this.px(x, 16 + ((i * 5) % 6), i % 3 === 0 ? 3 : 1);
      }
    }
  }

  /* ---------------- animations ---------------- */

  animMultiball() {
    const t = this.animT;
    this.textC('MULTIBALL', 2, 3, 2);
    for (let i = 0; i < 6; i++) {
      const ph = t * 2.2 + i * 1.05;
      const x = 10 + ((Math.sin(ph) * 0.5 + 0.5) * (this.w - 24)) | 0;
      const y = 20 + Math.round(Math.sin(ph * 2.3 + i) * 4);
      this.disc(x, y, 3, 3);
    }
    const bar = Math.floor((Math.sin(t * 5) * 0.5 + 0.5) * this.w);
    for (let x = 0; x < bar; x++) this.px(x, 30, 1);
  }

  animJackpot(m) {
    const t = this.animT;
    const s = Math.floor(t * 10) % 2 ? 3 : 1;
    this.textC('JACKPOT', 1, s, 2);
    if (m.l2) this.textC(m.l2, 20, 3, 1);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + t * 3;
      const r = 12 + Math.sin(t * 6 + i) * 4;
      this.px(64 + Math.cos(a) * r * 2.2, 16 + Math.sin(a) * r * 0.5, 1);
    }
  }

  animTilt() {
    const t = this.animT;
    const off = Math.round(Math.sin(t * 30) * 3);
    this.textC('TILT', 6, 3, 3);
    for (let x = 0; x < this.w; x += 2) {
      this.px(x + off, 1, 2);
      this.px(x - off, 30, 2);
    }
    if (Math.floor(t * 5) % 2) this.textC('NO BONUS', 25, 2, 1);
  }

  animLaunch() {
    const t = this.animT;
    this.textC('LAUNCH', 2, 3, 2);
    const x = 6 + ((t * 60) % (this.w + 20));
    // rocket
    this.fill(x, 20, 6, 3, 3);
    this.px(x + 6, 21, 3);
    this.px(x - 1, 19, 2);
    this.px(x - 1, 23, 2);
    for (let i = 1; i < 9; i++) this.px(x - i, 21 + (i % 2 ? 0 : 1), i < 4 ? 3 : 1);
    for (let i = 0; i < 22; i++) {
      const sx = (i * 13 + Math.floor(-t * 90)) % this.w;
      this.px(sx < 0 ? sx + this.w : sx, (i * 7) % 18 + 12, 1);
    }
  }

  disc(cx, cy, r, v) {
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) this.px(cx + x, cy + y, v);
  }

  /* ---------------- raster ---------------- */

  render() {
    const g = this.g;
    const s = this.scale;
    g.fillStyle = '#050303';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const cols = [
      `hsla(${this.hue},95%,6%,1)`,
      `hsla(${this.hue},98%,32%,1)`,
      `hsla(${this.hue},100%,55%,1)`,
      `hsla(${this.hue},100%,72%,1)`,
    ];
    const glow = [null, null, `hsla(${this.hue},100%,55%,0.35)`, `hsla(${this.hue},100%,70%,0.6)`];
    const r = s * 0.36;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const v = this.buf[y * this.w + x];
        const cx = x * s + s / 2;
        const cy = y * s + s / 2;
        if (v >= 2 && glow[v]) {
          g.fillStyle = glow[v];
          g.beginPath();
          g.arc(cx, cy, r * 2.4, 0, 7);
          g.fill();
        }
        g.fillStyle = cols[v];
        g.beginPath();
        g.arc(cx, cy, r, 0, 7);
        g.fill();
      }
    }
    this.dirty = true;
  }
}
