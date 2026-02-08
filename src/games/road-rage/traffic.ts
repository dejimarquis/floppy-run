// Traffic system — cars and trucks as road obstacles

import { SEGMENT_LENGTH } from './road';

export interface Vehicle {
  type: 'sedan' | 'truck' | 'bus' | 'pickup';
  x: number;
  z: number;
  speed: number;
  color: string;
  width: number;
}

const VEHICLE_COLORS: Record<string, string[]> = {
  sedan: ['#cc2222', '#2255cc', '#eeeeee', '#aaaaaa', '#222222', '#22aa44', '#cccc22'],
  truck: ['#dddddd', '#999999', '#8B7355'],
  bus: ['#ccaa00', '#dddddd'],
  pickup: ['#cc3333', '#222222', '#3355aa', '#dddddd'],
};

const VEHICLE_WIDTHS: Record<string, number> = {
  sedan: 0.2,
  truck: 0.25,
  bus: 0.28,
  pickup: 0.22,
};

const VEHICLE_SPEEDS = { min: 80, max: 150 };
const LANE_POSITIONS = [-0.45, 0, 0.45];
const COLLISION_X = 0.22;
const COLLISION_Z = 180;

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function createTraffic(count: number, roadLength: number): Vehicle[] {
  const types: Vehicle['type'][] = ['sedan', 'sedan', 'sedan', 'truck', 'pickup', 'pickup', 'bus'];
  const vehicles: Vehicle[] = [];
  const minZ = 600 * SEGMENT_LENGTH; // no traffic near start line
  const spacing = (roadLength - minZ) / count;

  for (let i = 0; i < count; i++) {
    const type = randomItem(types);
    vehicles.push({
      type,
      x: randomItem(LANE_POSITIONS) + (Math.random() - 0.5) * 0.08,
      z: minZ + i * spacing + Math.random() * spacing * 0.5,
      speed: VEHICLE_SPEEDS.min + Math.random() * (VEHICLE_SPEEDS.max - VEHICLE_SPEEDS.min),
      color: randomItem(VEHICLE_COLORS[type]),
      width: VEHICLE_WIDTHS[type],
    });
  }
  return vehicles;
}

export function updateTraffic(vehicles: Vehicle[], dt: number, roadLength: number): void {
  for (const v of vehicles) {
    v.z += v.speed * dt;
    if (v.z >= roadLength) v.z -= roadLength;
  }
}

export function checkVehicleCollision(x: number, z: number, vehicles: Vehicle[]): Vehicle | null {
  for (const v of vehicles) {
    const dz = Math.abs(v.z - z);
    const dx = Math.abs(v.x - x);
    if (dz < COLLISION_Z && dx < COLLISION_X) return v;
  }
  return null;
}

// Draw vehicles from rear perspective
export function renderVehicle(
  ctx: CanvasRenderingContext2D,
  vehicle: Vehicle,
  screenX: number,
  screenY: number,
  scale: number,
): void {
  const s = Math.max(scale * 40, 1);
  if (s < 2) return;

  ctx.save();
  ctx.translate(Math.round(screenX), Math.round(screenY));

  switch (vehicle.type) {
    case 'sedan':
      drawSedan(ctx, s, vehicle.color);
      break;
    case 'truck':
      drawTruck(ctx, s, vehicle.color);
      break;
    case 'bus':
      drawBus(ctx, s, vehicle.color);
      break;
    case 'pickup':
      drawPickup(ctx, s, vehicle.color);
      break;
  }

  ctx.restore();
}

function drawSedan(ctx: CanvasRenderingContext2D, s: number, color: string): void {
  const w = s * 0.75;
  const h = s * 0.5;
  // Body
  ctx.fillStyle = color;
  ctx.fillRect(-w, -h, w * 2, h * 0.7);
  // Roof (smaller, centered)
  ctx.fillStyle = darken(color, 30);
  ctx.fillRect(-w * 0.7, -h - h * 0.3, w * 1.4, h * 0.35);
  // Rear window
  ctx.fillStyle = '#446688';
  ctx.fillRect(-w * 0.55, -h - h * 0.22, w * 1.1, h * 0.2);
  // Taillights
  ctx.fillStyle = '#ff2222';
  ctx.fillRect(-w - 1, -h * 0.6, s * 0.08, s * 0.06);
  ctx.fillRect(w - s * 0.08 + 1, -h * 0.6, s * 0.08, s * 0.06);
  // Wheels
  ctx.fillStyle = '#111';
  ctx.fillRect(-w - s * 0.06, -h * 0.1, s * 0.1, s * 0.12);
  ctx.fillRect(w - s * 0.04, -h * 0.1, s * 0.1, s * 0.12);
}

function drawTruck(ctx: CanvasRenderingContext2D, s: number, color: string): void {
  const w = s * 0.85;
  const h = s * 0.65;
  // Cargo
  ctx.fillStyle = color;
  ctx.fillRect(-w, -h, w * 2, h);
  // Cargo outline
  ctx.fillStyle = darken(color, 20);
  ctx.fillRect(-w, -h, w * 2, h * 0.08);
  ctx.fillRect(-w, -h, w * 0.05, h);
  ctx.fillRect(w - w * 0.05, -h, w * 0.05, h);
  // Taillights
  ctx.fillStyle = '#ff3300';
  ctx.fillRect(-w, -h * 0.3, s * 0.07, s * 0.1);
  ctx.fillRect(w - s * 0.07, -h * 0.3, s * 0.07, s * 0.1);
  // Wheels
  ctx.fillStyle = '#111';
  ctx.fillRect(-w - s * 0.05, -s * 0.05, s * 0.1, s * 0.14);
  ctx.fillRect(w - s * 0.05, -s * 0.05, s * 0.1, s * 0.14);
}

function drawBus(ctx: CanvasRenderingContext2D, s: number, color: string): void {
  const w = s * 0.95;
  const h = s * 0.7;
  // Body
  ctx.fillStyle = color;
  ctx.fillRect(-w, -h, w * 2, h);
  // Window row
  ctx.fillStyle = '#446688';
  const winY = -h + h * 0.15;
  const winH = h * 0.35;
  for (let i = 0; i < 5; i++) {
    const wx = -w + w * 0.15 + i * (w * 2 * 0.17);
    ctx.fillRect(wx, winY, w * 0.25, winH);
  }
  // Rear lights
  ctx.fillStyle = '#ff2200';
  ctx.fillRect(-w, -h * 0.4, s * 0.06, s * 0.12);
  ctx.fillRect(w - s * 0.06, -h * 0.4, s * 0.06, s * 0.12);
  // Wheels
  ctx.fillStyle = '#111';
  ctx.fillRect(-w - s * 0.04, -s * 0.05, s * 0.1, s * 0.15);
  ctx.fillRect(w - s * 0.06, -s * 0.05, s * 0.1, s * 0.15);
}

function drawPickup(ctx: CanvasRenderingContext2D, s: number, color: string): void {
  const w = s * 0.8;
  const h = s * 0.5;
  // Bed (open)
  ctx.fillStyle = darken(color, 15);
  ctx.fillRect(-w, -h * 0.6, w * 2, h * 0.6);
  // Cab (top portion, shorter than full width)
  ctx.fillStyle = color;
  ctx.fillRect(-w * 0.6, -h - h * 0.15, w * 1.2, h * 0.45);
  // Rear window
  ctx.fillStyle = '#446688';
  ctx.fillRect(-w * 0.45, -h - h * 0.08, w * 0.9, h * 0.2);
  // Taillights
  ctx.fillStyle = '#ff2222';
  ctx.fillRect(-w, -h * 0.35, s * 0.06, s * 0.06);
  ctx.fillRect(w - s * 0.06, -h * 0.35, s * 0.06, s * 0.06);
  // Wheels
  ctx.fillStyle = '#111';
  ctx.fillRect(-w - s * 0.05, -s * 0.03, s * 0.1, s * 0.12);
  ctx.fillRect(w - s * 0.05, -s * 0.03, s * 0.1, s * 0.12);
}

function darken(hex: string, amount: number): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount);
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
