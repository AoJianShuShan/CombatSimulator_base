import { createDefaultUnitStats } from "./attributeMacros.ts";
import { battleNumberDefaults } from "./battleConfigMacros.ts";

export type TeamId = "A" | "B";
export type TargetingStrategy = "front" | "lowestHp" | "highestAttack";
export type ActionResolutionMode = "arpgSimultaneous" | "turnBasedSpeed";
export type UnitPosition = "front" | "middle" | "back";
export type AttackElement = "none" | "physical" | "fire" | "electromagnetic" | "corrosive";
export type ProtectionType = "none" | "heatArmor" | "insulatedArmor" | "bioArmor" | "heavyArmor";

export const unitPositionOrder: UnitPosition[] = ["front", "middle", "back"];
export const unitPositionLabels: Record<UnitPosition, string> = {
  front: "前排",
  middle: "中排",
  back: "后排",
};

export const attackElementLabels: Record<AttackElement, string> = {
  none: "无",
  physical: "物理",
  fire: "火焰",
  electromagnetic: "电磁",
  corrosive: "腐蚀",
};
export const attackElementOrder: AttackElement[] = ["none", "physical", "fire", "electromagnetic", "corrosive"];

export const protectionTypeLabels: Record<ProtectionType, string> = {
  none: "无",
  heatArmor: "隔热甲",
  insulatedArmor: "绝缘甲",
  bioArmor: "生化甲",
  heavyArmor: "重甲",
};
export const protectionTypeOrder: ProtectionType[] = ["none", "heatArmor", "insulatedArmor", "bioArmor", "heavyArmor"];

export const actionResolutionModeLabels: Record<ActionResolutionMode, string> = {
  arpgSimultaneous: "Arpg同时出手",
  turnBasedSpeed: "回合制速度高者先手",
};
export const actionResolutionModeOrder: ActionResolutionMode[] = ["arpgSimultaneous", "turnBasedSpeed"];

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
  armor: number;
  armorPenetration: number;
  headshotChance: number;
  headshotMultiplier: number;
  scenarioDamageBonus: number;
  heroClassDamageBonus: number;
  skillTypeDamageBonus: number;
  finalDamageBonus: number;
  finalDamageReduction: number;
  skillMultiplier: number;
  outputAmplify: number;
  outputDecay: number;
  damageTakenAmplify: number;
  damageTakenReduction: number;
}

export interface UnitConfig {
  id: string;
  teamId: TeamId;
  name: string;
  position: UnitPosition;
  attackElement: AttackElement;
  protectionType: ProtectionType;
  stats: UnitStats;
  extras?: Record<string, boolean | number | string>;
}

export interface BattleConfig {
  maxRounds: number;
  minimumDamage: number;
  randomSeed: number;
  targetingStrategy: TargetingStrategy;
  actionResolutionMode: ActionResolutionMode;
  armorFormulaBase: number;
  maxArmorDamageReduction: number;
  elementAdvantageDamageRate: number;
  elementDisadvantageDamageRate: number;
  teamNames: Record<TeamId, string>;
  extras?: Record<string, boolean | number | string>;
}

export interface BattleInput {
  battle: BattleConfig;
  units: UnitConfig[];
}

export interface BattleBatchRequest {
  count: number;
  input: BattleInput;
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

export interface BattleBatchSummaryResult {
  baseSeed: number;
  totalBattles: number;
  wins: Record<TeamId, number>;
  draws: number;
  winRates: Record<TeamId, number>;
  averageTerminalNetAdvantages: Record<TeamId, number>;
  remainingHpRatesOnWins: Record<TeamId, number | null>;
  drawRate: number;
  averageRounds: number;
  minRounds: number;
  maxRounds: number;
}

export function createBattleRandomSeed() {
  return Math.trunc(Date.now()) >>> 0;
}

export function getDefaultUnitPosition(order: number): UnitPosition {
  return unitPositionOrder[(Math.max(1, order) - 1) % unitPositionOrder.length];
}

export function createDefaultUnit(teamId: TeamId, order: number): UnitConfig {
  const prefix = teamId === "A" ? "红" : "蓝";
  const defaultSpeed = teamId === "A" ? 10 : 9;

  return {
    id: `${teamId}-${order}`,
    teamId,
    name: `${prefix}方单位${order}`,
    position: getDefaultUnitPosition(order),
    attackElement: "none",
    protectionType: "none",
    stats: {
      ...createDefaultUnitStats(),
      speed: defaultSpeed,
    },
    extras: {},
  };
}

export function createDefaultBattleInput(): BattleInput {
  return {
    battle: {
      ...battleNumberDefaults,
      randomSeed: createBattleRandomSeed(),
      targetingStrategy: "front",
      actionResolutionMode: "arpgSimultaneous",
      teamNames: {
        A: "红方",
        B: "蓝方",
      },
      extras: {},
    },
    units: [createDefaultUnit("A", 1), createDefaultUnit("A", 2), createDefaultUnit("B", 1), createDefaultUnit("B", 2)],
  };
}
