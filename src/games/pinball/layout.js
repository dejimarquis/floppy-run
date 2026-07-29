/**
 * Space Cadet: Nova — table layout.
 *
 * Pure data. Both the physics world and the rendered geometry are generated
 * from these numbers, so they can never drift apart.
 *
 * Units are metres. x = across, y = up-table, z = height above the playfield.
 */

const D = Math.PI / 180;

export const L = {
  // ---- overall board -------------------------------------------------
  half: 0.27, // inner wall half-width (left wall x = -half)
  boardX0: -0.298,
  boardX1: 0.298,
  boardY0: -0.045,
  boardY1: 1.115,
  wallH: 0.032,
  wallT: 0.0075,

  ballR: 0.0135,
  incline: 6.5 * D,

  // ---- shooter lane --------------------------------------------------
  laneIn: 0.236, // divider between lane and playfield
  laneOut: 0.270, // outer wall of the lane
  laneBottom: 0.045,
  laneTop: 0.800,
  gateY: 0.742,

  // ---- top arc / orbit ------------------------------------------------
  arcC: [0, 0.8],
  arcR: 0.27,
  orbitGuideX: -0.2255,
  orbitGuideY0: 0.5,
  orbitGuideY1: 0.798,

  // ---- field centre (shifted by the shooter lane) ---------------------
  cx: -0.017,

  // ---- flippers -------------------------------------------------------
  flipL: { x: -0.105, y: 0.152, len: 0.072, rest: -31 * D, up: 33 * D, side: -1 },
  flipR: { x: 0.071, y: 0.152, len: 0.072, rest: 180 * D + 31 * D, up: 180 * D - 33 * D, side: 1 },
  flipU: { x: 0.104, y: 0.548, len: 0.058, rest: 180 * D + 26 * D, up: 180 * D - 34 * D, side: 1 },

  // ---- lower guides ---------------------------------------------------
  outerLowerL: [
    [-0.27, 0.33],
    [-0.268, 0.205],
    [-0.246, 0.118],
    [-0.199, 0.054],
    [-0.142, 0.016],
  ],
  dividerL: [
    [-0.214, 0.302],
    [-0.196, 0.206],
    [-0.148, 0.184],
    [-0.1, 0.172],
  ],
  outerLowerR: [
    [0.236, 0.33],
    [0.234, 0.205],
    [0.212, 0.118],
    [0.165, 0.054],
    [0.108, 0.016],
  ],
  dividerR: [
    [0.18, 0.302],
    [0.162, 0.206],
    [0.114, 0.184],
    [0.066, 0.172],
  ],

  // ---- slingshots (A = top, B = bottom/inner, C = outer) --------------
  slingL: [
    [-0.194, 0.336],
    [-0.118, 0.226],
    [-0.206, 0.242],
  ],
  slingR: [
    [0.16, 0.336],
    [0.084, 0.226],
    [0.172, 0.242],
  ],

  // ---- pop bumpers ----------------------------------------------------
  bumpers: [
    { x: -0.101, y: 0.699, r: 0.029, id: 'bumperA', c: 0xff3c62 },
    { x: 0.063, y: 0.699, r: 0.029, id: 'bumperB', c: 0x2fd0ff },
    { x: -0.019, y: 0.789, r: 0.029, id: 'bumperC', c: 0xffc32a },
  ],
  bumperGuideL: [
    [-0.158, 0.6],
    [-0.166, 0.7],
    [-0.15, 0.79],
  ],
  bumperGuideR: [
    [0.12, 0.6],
    [0.128, 0.7],
    [0.112, 0.79],
  ],

  // ---- NOVA top lanes -------------------------------------------------
  laneGuideX: [-0.153, -0.086, -0.019, 0.048, 0.115],
  laneGuideY0: 0.858,
  laneGuideY1: 0.962,
  laneLetters: ['N', 'O', 'V', 'A'],

  // ---- drop targets (left bank, angled) -------------------------------
  dropBank: {
    from: [-0.222, 0.472],
    to: [-0.128, 0.428],
    count: 4,
    w: 0.019,
  },

  // ---- standup targets ------------------------------------------------
  standups: [
    { x: 0.207, y: 0.46, a: 200 * D, id: 'stand0' },
    { x: 0.216, y: 0.523, a: 196 * D, id: 'stand1' },
    { x: 0.222, y: 0.586, a: 192 * D, id: 'stand2' },
  ],

  // ---- saucer / kickout ------------------------------------------------
  saucer: { x: 0.014, y: 0.575, r: 0.0225 },

  // ---- captive ball ----------------------------------------------------
  // Sits in open mid-field, NOT in the left return lane: a dead-end alley
  // dropped into a narrow lane turns that lane into a ball trap, because a
  // ball arriving from above lands on the alley's closed end with nowhere to
  // roll. In open field it simply rolls off the sides.
  captive: { x: -0.058, y: 0.502, r: 0.0135, travel: 0.03 },

  // ---- spinner ---------------------------------------------------------
  spinner: { x: -0.253, y: 0.6, w: 0.03, a: 90 * D },

  // ---- ramps (wireform habitrails) -------------------------------------
  rampLeft: [
    [-0.138, 0.342, 0.000],
    [-0.172, 0.404, 0.019],
    [-0.198, 0.474, 0.041],
    [-0.212, 0.546, 0.059],
    [-0.214, 0.616, 0.071],
    [-0.202, 0.682, 0.078],
    [-0.180, 0.732, 0.080],
  ],
  rampRight: [
    [ 0.126, 0.352, 0.000],
    [ 0.162, 0.420, 0.020],
    [ 0.188, 0.500, 0.044],
    [ 0.200, 0.586, 0.063],
    [ 0.196, 0.672, 0.076],
    [ 0.172, 0.752, 0.083],
    [ 0.126, 0.812, 0.086],
    [ 0.060, 0.846, 0.086],
  ],

  // ---- rollover lamps in the in/outlanes -------------------------------
  rollovers: [
    { x: -0.238, y: 0.18, id: 'outlaneL', label: 'SPECIAL' },
    { x: -0.152, y: 0.19, id: 'inlaneL', label: 'BOOST' },
    { x: 0.204, y: 0.18, id: 'outlaneR', label: 'SPECIAL' },
    { x: 0.118, y: 0.19, id: 'inlaneR', label: 'BOOST' },
  ],

  plunger: { x: 0.253, y: 0.062 },
};

/** mirror an x coordinate about the field centre */
export function mx(x) {
  return 2 * L.cx - x;
}

export const DEG = D;
