export type TeamId = "A" | "B";

export interface UnitStats {
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
}

export interface UnitConfig {
  id: string;
  teamId: TeamId;
  name: string;
  stats: UnitStats;
  extras?: Record<string, boolean | number | string>;
}

export interface BattleConfig {
  maxRounds: number;
  minimumDamage: number;
  teamNames: Record<TeamId, string>;
  extras?: Record<string, boolean | number | string>;
}

export interface BattleInput {
  battle: BattleConfig;
  units: UnitConfig[];
}

export interface BattleUnitState extends UnitConfig {
  currentHp: number;
  isAlive: boolean;
}

export type BattleEventType =
  | "battle_started"
  | "round_started"
  | "turn_started"
  | "damage_applied"
  | "unit_defeated"
  | "battle_ended";

export interface BattleEvent {
  sequence: number;
  type: BattleEventType;
  round: number;
  actorId?: string;
  targetId?: string;
  summary: string;
  payload?: Record<string, boolean | number | string | null>;
}

export interface BattleSimulationResult {
  winnerTeamId: TeamId | null;
  roundsCompleted: number;
  events: BattleEvent[];
  finalUnits: BattleUnitState[];
}

export function createDefaultUnit(teamId: TeamId, order: number): UnitConfig {
  const prefix = teamId === "A" ? "红" : "蓝";

  return {
    id: `${teamId}-${order}`,
    teamId,
    name: `${prefix}方单位${order}`,
    stats: {
      maxHp: 30,
      attack: 10,
      defense: 3,
      speed: Math.max(1, 10 - order),
    },
    extras: {},
  };
}

export function createDefaultBattleInput(): BattleInput {
  return {
    battle: {
      maxRounds: 20,
      minimumDamage: 1,
      teamNames: {
        A: "红方",
        B: "蓝方",
      },
      extras: {},
    },
    units: [createDefaultUnit("A", 1), createDefaultUnit("A", 2), createDefaultUnit("B", 1), createDefaultUnit("B", 2)],
  };
}
