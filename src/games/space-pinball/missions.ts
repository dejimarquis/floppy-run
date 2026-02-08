export type MissionType = 'drop_targets' | 'ramp_loop' | 'rollover_lanes' | 'bumper_frenzy';

export interface Mission {
  type: MissionType;
  title: string;
  description: string;
  target: number;
  progress: number;
  completed: boolean;
  reward: number;
}

export interface MissionState {
  currentMission: Mission | null;
  missionsCompleted: number;
  rank: number;
  rankNames: string[];
}

const MISSION_DEFS: { type: MissionType; title: string; description: string; target: number; reward: number }[] = [
  { type: 'drop_targets', title: 'Clear the Deck', description: 'Hit all 3 drop targets', target: 3, reward: 15000 },
  { type: 'ramp_loop', title: 'Ramp Runner', description: 'Complete 3 ramp shots', target: 3, reward: 20000 },
  { type: 'rollover_lanes', title: 'Lane Master', description: 'Light all 3 rollover lanes', target: 3, reward: 10000 },
  { type: 'bumper_frenzy', title: 'Bumper Blitz', description: 'Hit bumpers 15 times', target: 15, reward: 12000 },
];

const RANK_NAMES = ['Cadet', 'Ensign', 'Lieutenant', 'Commander', 'Captain', 'Admiral'];

export function createMissionState(): MissionState {
  return {
    currentMission: null,
    missionsCompleted: 0,
    rank: 0,
    rankNames: [...RANK_NAMES],
  };
}

export function startNextMission(state: MissionState): void {
  const idx = state.missionsCompleted % MISSION_DEFS.length;
  const cycle = Math.floor(state.missionsCompleted / MISSION_DEFS.length);
  const def = MISSION_DEFS[idx];
  const rewardMultiplier = Math.pow(1.5, cycle);

  state.currentMission = {
    type: def.type,
    title: def.title,
    description: def.description,
    target: def.target,
    progress: 0,
    completed: false,
    reward: Math.round(def.reward * rewardMultiplier),
  };
}

function advanceMission(state: MissionState, type: MissionType): boolean {
  const m = state.currentMission;
  if (!m || m.completed || m.type !== type) return false;

  m.progress++;
  if (m.progress >= m.target) {
    m.completed = true;
    state.missionsCompleted++;
    state.rank = Math.min(
      Math.floor(state.missionsCompleted / 2),
      state.rankNames.length - 1,
    );
    return true;
  }
  return false;
}

export function onDropTarget(state: MissionState): boolean {
  return advanceMission(state, 'drop_targets');
}

export function onRamp(state: MissionState): boolean {
  return advanceMission(state, 'ramp_loop');
}

export function onRollover(state: MissionState): boolean {
  return advanceMission(state, 'rollover_lanes');
}

export function onBumper(state: MissionState): boolean {
  return advanceMission(state, 'bumper_frenzy');
}

export function getMissionDisplay(state: MissionState): { title: string; progress: string } | null {
  const m = state.currentMission;
  if (!m || m.completed) return null;
  return {
    title: m.title,
    progress: `${m.progress}/${m.target}`,
  };
}
