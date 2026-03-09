import { createDefaultUnitStats } from "./attributeMacros.ts";

export type TeamId = "A" | "B";
export type TargetingStrategy = "front" | "lowestHp" | "highestAttack";

export interface UnitStats {
  maxHp: number;
  maxHpRate: number;
  attack: number;
  attackRate: number;
  defense: number;
  defenseRate: number;
  speed: number;
  critChance: number;
  critMultiplier: number;
  hitChance: number;
  dodgeChance: number;
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
  randomSeed: number;
  targetingStrategy: TargetingStrategy;
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
  | "attack_missed"
  | "damage_applied"
  | "unit_defeated"
  | "battle_ended";

export interface BattleEvent {
  sequence: number;
  timeIndex: number;
  type: BattleEventType;
  round: number;
  actorId?: string;
  targetId?: string;
  summary: string;
  payload?: Record<string, boolean | number | string | null>;
}

export interface BattleSimulationResult {
  randomSeed: number;
  winnerTeamId: TeamId | null;
  roundsCompleted: number;
  events: BattleEvent[];
  finalUnits: BattleUnitState[];
}

export function createBattleRandomSeed() {
  return Math.trunc(Date.now()) >>> 0;
}

export function createDefaultUnit(teamId: TeamId, order: number): UnitConfig {
  const prefix = teamId === "A" ? "红" : "蓝";

  return {
    id: `${teamId}-${order}`,
    teamId,
    name: `${prefix}方单位${order}`,
    stats: {
      ...createDefaultUnitStats(),
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
      randomSeed: createBattleRandomSeed(),
      targetingStrategy: "front",
      teamNames: {
        A: "红方",
        B: "蓝方",
      },
      extras: {},
    },
    units: [createDefaultUnit("A", 1), createDefaultUnit("A", 2), createDefaultUnit("B", 1), createDefaultUnit("B", 2)],
  };
}
