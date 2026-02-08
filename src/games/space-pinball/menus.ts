// ── Types ───────────────────────────────────────────────────────────
export type MenuScreen = 'title' | 'playing' | 'game_over';

export interface MenuState {
  screen: MenuScreen;
  selectedOption: number;
  highScores: number[];
  showControls: boolean;
  titleAnimTimer: number;
  gameOverTimer: number;
}

const SCORES_KEY = 'floppy_pinball_scores';
const NUM_STARS = 40;
const MENU_OPTIONS = ['START GAME', 'CONTROLS'];

// Pre-generate star positions so they stay stable across frames
const stars: { x: number; y: number; phase: number }[] = [];
for (let i = 0; i < NUM_STARS; i++) {
  stars.push({
    x: Math.random(),
    y: Math.random(),
    phase: Math.random() * Math.PI * 2,
  });
}

// ── Factory ─────────────────────────────────────────────────────────
export function createMenuState(): MenuState {
  return {
    screen: 'title',
    selectedOption: 0,
    highScores: loadHighScores(),
    showControls: false,
    titleAnimTimer: 0,
    gameOverTimer: 0,
  };
}

// ── Update ──────────────────────────────────────────────────────────
export function updateMenu(state: MenuState, dt: number): void {
  state.titleAnimTimer += dt;
  if (state.screen === 'game_over') {
    state.gameOverTimer += dt;
  }
}

// ── Input ───────────────────────────────────────────────────────────
export function handleMenuInput(
  state: MenuState,
  code: string,
): 'start' | 'toggle_controls' | 'restart' | null {
  if (state.showControls) {
    state.showControls = false;
    return null;
  }

  if (state.screen === 'title') {
    if (code === 'ArrowUp') {
      state.selectedOption =
        (state.selectedOption - 1 + MENU_OPTIONS.length) % MENU_OPTIONS.length;
      return null;
    }
    if (code === 'ArrowDown') {
      state.selectedOption =
        (state.selectedOption + 1) % MENU_OPTIONS.length;
      return null;
    }
    if (code === 'Space' || code === 'Enter') {
      if (state.selectedOption === 0) return 'start';
      if (state.selectedOption === 1) return 'toggle_controls';
    }
    return null;
  }

  if (state.screen === 'game_over') {
    if (code === 'Space' && state.gameOverTimer > 1.5) {
      return 'restart';
    }
    return null;
  }

  // During play
  if (code === 'KeyH') return 'toggle_controls';
  return null;
}

// ── Render: Title Screen ────────────────────────────────────────────
export function renderTitle(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  state: MenuState,
): void {
  const w = canvas.width;
  const h = canvas.height;
  const t = state.titleAnimTimer;

  // Background
  ctx.fillStyle = '#0a0e2a';
  ctx.fillRect(0, 0, w, h);

  // Twinkling stars
  for (const star of stars) {
    const brightness = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.5 + star.phase));
    ctx.fillStyle = `rgba(255,255,255,${brightness})`;
    ctx.beginPath();
    ctx.arc(star.x * w, star.y * h, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Title text with bob
  const bobY = Math.sin(t * 2) * 6;
  const titleY = h * 0.22 + bobY;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Glow / shadow
  ctx.font = `bold ${Math.round(w * 0.09)}px monospace`;
  ctx.fillStyle = '#00ccff';
  ctx.globalAlpha = 0.4;
  ctx.fillText('SPACE PINBALL', w / 2, titleY + 3);
  ctx.globalAlpha = 1;

  // Main title
  ctx.fillStyle = '#ffffff';
  ctx.fillText('SPACE PINBALL', w / 2, titleY);

  // Animated pinball rolling back and forth
  const ballRange = w * 0.4; // 30% to 70%
  const ballX = w * 0.5 + Math.sin(t * 1.8) * (ballRange / 2);
  const ballY = h * 0.34;
  ctx.beginPath();
  ctx.arc(ballX, ballY, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#c0c0c0';
  ctx.fill();
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Menu options
  const optionStartY = h * 0.48;
  const optionSpacing = Math.round(h * 0.07);
  ctx.font = `bold ${Math.round(w * 0.045)}px monospace`;

  for (let i = 0; i < MENU_OPTIONS.length; i++) {
    const selected = i === state.selectedOption;
    const y = optionStartY + i * optionSpacing;

    if (selected) {
      ctx.fillStyle = '#00ccff';
      ctx.fillText(`▸ ${MENU_OPTIONS[i]}`, w / 2, y);
    } else {
      ctx.fillStyle = '#8899aa';
      ctx.fillText(`  ${MENU_OPTIONS[i]}`, w / 2, y);
    }
  }

  // High score at bottom
  const best = state.highScores[0] || 0;
  ctx.font = `${Math.round(w * 0.035)}px monospace`;
  ctx.fillStyle = 'rgba(218,165,32,0.7)';
  ctx.fillText(`HIGH SCORE: ${String(best).padStart(8, '0')}`, w / 2, h * 0.82);
}

// ── Render: Game Over ───────────────────────────────────────────────
export function renderGameOver(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  state: MenuState,
  finalScore: number,
): void {
  const w = canvas.width;
  const h = canvas.height;
  const t = state.gameOverTimer;

  // Fade-in overlay
  const alpha = Math.min(t / 0.5, 0.85);
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.fillRect(0, 0, w, h);

  if (alpha < 0.3) return; // don't draw text until visible

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // "GAME OVER"
  ctx.font = `bold ${Math.round(w * 0.1)}px monospace`;
  ctx.fillStyle = '#ff3333';
  ctx.fillText('GAME OVER', w / 2, h * 0.18);

  // Final score
  ctx.font = `bold ${Math.round(w * 0.045)}px monospace`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(
    `FINAL SCORE: ${String(finalScore).padStart(8, '0')}`,
    w / 2,
    h * 0.28,
  );

  // New high score check
  const isNewHigh = finalScore > 0 && finalScore >= (state.highScores[0] || 0);
  if (isNewHigh) {
    const flash = 0.5 + 0.5 * Math.sin(t * 6);
    ctx.fillStyle = `rgba(255,215,0,${flash})`;
    ctx.font = `bold ${Math.round(w * 0.04)}px monospace`;
    ctx.fillText('★ NEW HIGH SCORE! ★', w / 2, h * 0.35);
  }

  // Top scores list
  ctx.font = `bold ${Math.round(w * 0.038)}px monospace`;
  ctx.fillStyle = '#00ccff';
  ctx.fillText('TOP SCORES', w / 2, h * 0.46);

  ctx.font = `${Math.round(w * 0.034)}px monospace`;
  for (let i = 0; i < state.highScores.length; i++) {
    const score = state.highScores[i];
    const y = h * 0.53 + i * Math.round(h * 0.055);
    const isCurrent = score === finalScore && finalScore > 0;
    ctx.fillStyle = isCurrent ? '#ffd700' : '#cccccc';
    ctx.fillText(
      `${i + 1}. ${String(score).padStart(8, '0')}`,
      w / 2,
      y,
    );
  }

  // Restart prompt
  if (t > 1.5) {
    const blink = 0.5 + 0.5 * Math.sin(t * 4);
    ctx.globalAlpha = blink;
    ctx.font = `${Math.round(w * 0.032)}px monospace`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Press SPACE to play again', w / 2, h * 0.88);
    ctx.globalAlpha = 1;
  }
}

// ── Render: Controls Overlay ────────────────────────────────────────
export function renderControls(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
): void {
  const w = canvas.width;
  const h = canvas.height;

  // Semi-transparent overlay
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(0, 0, w, h);

  // Bordered box
  const boxW = w * 0.8;
  const boxH = h * 0.55;
  const boxX = (w - boxW) / 2;
  const boxY = (h - boxH) / 2;

  ctx.fillStyle = '#111833';
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.strokeStyle = '#00ccff';
  ctx.lineWidth = 2;
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Title
  ctx.font = `bold ${Math.round(w * 0.05)}px monospace`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('CONTROLS', w / 2, boxY + boxH * 0.1);

  // Control lines
  const lines = [
    'LEFT SHIFT / Z \u2014 Left Flipper',
    'RIGHT SHIFT / / \u2014 Right Flipper',
    'SPACE (hold) \u2014 Plunger',
    'ARROW KEYS \u2014 Nudge Table',
    'M \u2014 Mute Sound',
    '',
    'Press any key to close',
  ];

  ctx.font = `${Math.round(w * 0.028)}px monospace`;
  const lineH = boxH * 0.11;
  const startY = boxY + boxH * 0.25;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '') continue;
    ctx.fillStyle = i === lines.length - 1 ? '#888888' : '#cccccc';
    ctx.fillText(lines[i], w / 2, startY + i * lineH);
  }
}

// ── High Score Persistence ──────────────────────────────────────────
export function loadHighScores(): number[] {
  try {
    const raw = localStorage.getItem(SCORES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as number[];
      if (Array.isArray(parsed)) {
        const sorted = parsed
          .filter((n) => typeof n === 'number' && !isNaN(n))
          .sort((a, b) => b - a)
          .slice(0, 5);
        while (sorted.length < 5) sorted.push(0);
        return sorted;
      }
    }
  } catch {
    // localStorage unavailable or corrupt
  }
  return [0, 0, 0, 0, 0];
}

export function saveScore(score: number): void {
  try {
    const scores = loadHighScores();
    scores.push(score);
    scores.sort((a, b) => b - a);
    const top5 = scores.slice(0, 5);
    localStorage.setItem(SCORES_KEY, JSON.stringify(top5));
  } catch {
    // localStorage unavailable
  }
}
