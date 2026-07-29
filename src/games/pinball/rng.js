// Deterministic RNG — mulberry32. Everything random in the game routes through here
// so `window.__GAME__.seed(n)` makes screenshots reproducible.

let _state = 0x9e3779b9;

export function seed(n) {
  _state = (n >>> 0) || 1;
}

export function random() {
  _state |= 0;
  _state = (_state + 0x6d2b79f5) | 0;
  let t = Math.imul(_state ^ (_state >>> 15), 1 | _state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function range(a, b) {
  return a + (b - a) * random();
}

export function irange(a, b) {
  return Math.floor(a + (b - a + 1) * random()) | 0;
}

export function pick(arr) {
  return arr[Math.floor(random() * arr.length) % arr.length];
}

/** Independent stream, useful for texture generation that must not perturb gameplay. */
export function makeRng(s) {
  let st = (s >>> 0) || 1;
  return function () {
    st |= 0;
    st = (st + 0x6d2b79f5) | 0;
    let t = Math.imul(st ^ (st >>> 15), 1 | st);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

seed(1337);
