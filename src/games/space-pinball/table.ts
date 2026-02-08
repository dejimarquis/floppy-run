import {
  PhysicsWorld,
  CircleCollider,
  LineCollider,
  createFlipper,
  createPlunger,
} from './physics';

// ── Table Element Metadata (for scoring) ────────────────────────────
export interface TableElement {
  type: 'bumper' | 'slingshot' | 'ramp' | 'drop_target' | 'rollover' | 'spinner';
  index: number;
  points: number;
  active: boolean;
}

let tableElements: TableElement[] = [];

export function getTableElements(): TableElement[] {
  return tableElements;
}

// ── Build Table ─────────────────────────────────────────────────────
export function buildTable(world: PhysicsWorld): void {
  tableElements = [];

  // Track indices as we add colliders
  let lineIdx = 0;
  let circleIdx = 0;

  function addLine(x1: number, y1: number, x2: number, y2: number, restitution = 0.3): number {
    world.lines.push({ x1, y1, x2, y2, restitution });
    return lineIdx++;
  }

  function addCircle(x: number, y: number, radius: number, restitution = 0.5): number {
    world.circles.push({ x, y, radius, restitution });
    return circleIdx++;
  }

  // ── Walls ───────────────────────────────────────────────────────
  // Left wall
  addLine(30, 30, 30, 600);
  // Right wall
  addLine(370, 30, 370, 600);

  // Top wall (approximated curve with 4 segments)
  addLine(30, 30, 100, 15);
  addLine(100, 15, 200, 10);
  addLine(200, 10, 300, 15);
  addLine(300, 15, 370, 30);

  // Bottom-left gutter
  addLine(30, 600, 160, 670);
  // Bottom-right gutter
  addLine(240, 670, 370, 600);

  // Plunger lane walls
  addLine(350, 670, 390, 670);
  addLine(390, 670, 390, 30);
  addLine(390, 30, 370, 30);
  // Left side of plunger lane (separates from main table)
  addLine(350, 600, 350, 670);

  // ── Flippers ────────────────────────────────────────────────────
  world.flippers.push(createFlipper(155, 640, 55, 'left'));
  world.flippers.push(createFlipper(245, 640, 55, 'right'));
  world.flippers.push(createFlipper(310, 280, 40, 'right'));

  // ── Pop Bumpers ─────────────────────────────────────────────────
  const bTop = addCircle(170, 180, 22, 1.5);
  tableElements.push({ type: 'bumper', index: bTop, points: 100, active: true });

  const bLeft = addCircle(140, 250, 22, 1.5);
  tableElements.push({ type: 'bumper', index: bLeft, points: 100, active: true });

  const bRight = addCircle(250, 220, 22, 1.5);
  tableElements.push({ type: 'bumper', index: bRight, points: 100, active: true });

  // ── Slingshots ──────────────────────────────────────────────────
  // Left slingshot (triangle near lower-left)
  const slL1 = addLine(60, 520, 60, 580, 1.4);
  const slL2 = addLine(60, 580, 110, 560, 1.4);
  const slL3 = addLine(110, 560, 60, 520, 1.4);
  tableElements.push({ type: 'slingshot', index: slL1, points: 10, active: true });
  tableElements.push({ type: 'slingshot', index: slL2, points: 10, active: true });
  tableElements.push({ type: 'slingshot', index: slL3, points: 10, active: true });

  // Right slingshot (mirrored)
  const slR1 = addLine(340, 520, 340, 580, 1.4);
  const slR2 = addLine(340, 580, 290, 560, 1.4);
  const slR3 = addLine(290, 560, 340, 520, 1.4);
  tableElements.push({ type: 'slingshot', index: slR1, points: 10, active: true });
  tableElements.push({ type: 'slingshot', index: slR2, points: 10, active: true });
  tableElements.push({ type: 'slingshot', index: slR3, points: 10, active: true });

  // ── Ramps ───────────────────────────────────────────────────────
  // Left ramp
  const rL = addLine(60, 400, 80, 300, 0.7);
  tableElements.push({ type: 'ramp', index: rL, points: 500, active: true });

  // Center ramp (loop)
  const rC1 = addLine(180, 350, 200, 200, 0.7);
  const rC2 = addLine(200, 200, 220, 350, 0.7);
  tableElements.push({ type: 'ramp', index: rC1, points: 750, active: true });
  tableElements.push({ type: 'ramp', index: rC2, points: 750, active: true });

  // Right ramp
  const rR = addLine(320, 400, 300, 250, 0.7);
  tableElements.push({ type: 'ramp', index: rR, points: 500, active: true });

  // ── Drop Targets ────────────────────────────────────────────────
  const dropSpacing = 70;
  for (let i = 0; i < 3; i++) {
    const cx = 130 + i * dropSpacing;
    const idx = addLine(cx - 12, 320, cx + 12, 320, 0.8);
    tableElements.push({ type: 'drop_target', index: idx, points: 250, active: true });
  }

  // ── Rollover Lanes ──────────────────────────────────────────────
  const rolloverXs = [120, 200, 280];
  for (const rx of rolloverXs) {
    const idx = addCircle(rx, 80, 6, 1.0);
    tableElements.push({ type: 'rollover', index: idx, points: 50, active: true });
  }

  // ── Spinner ─────────────────────────────────────────────────────
  // Represented as a small circle collider the ball passes through
  const spIdx = addCircle(200, 150, 5, 1.0);
  tableElements.push({ type: 'spinner', index: spIdx, points: 25, active: true });

  // ── Plunger ─────────────────────────────────────────────────────
  world.plunger = createPlunger(380, 100, 670);
}
