import type { UnitStatKey } from "./attributeMacros.ts";
import type { BattleBatchSummaryResult, BattleInput } from "./battle.ts";

export type SensitivityAxisScope = "unitStat";

export interface SensitivityAxisUnitStat {
  scope: "unitStat";
  unitId: string;
  field: UnitStatKey;
}

export type SensitivityAxis = SensitivityAxisUnitStat;

export interface SensitivitySweep {
  start: number;
  end: number;
  step: number;
}

export interface BattleSensitivityConfig {
  axis: SensitivityAxis;
  sweep: SensitivitySweep;
  battlesPerPoint: number;
}

export interface BattleSensitivityRequest extends BattleSensitivityConfig {
  input: BattleInput;
}

export interface BattleSensitivityPointResult {
  index: number;
  value: number;
  actualValue: number;
  summary: BattleBatchSummaryResult;
}

export interface BattleSensitivityResult {
  baseSeed: number;
  axis: SensitivityAxis;
  sweep: SensitivitySweep;
  pointCount: number;
  battlesPerPoint: number;
  totalBattles: number;
  points: BattleSensitivityPointResult[];
}

export interface BattleSensitivityProgress {
  completedBattles: number;
  completedPoints: number;
  currentPointIndex: number;
  currentValue: number;
  totalBattles: number;
  totalPoints: number;
}

export const sensitivityBattlesPerPointMin = 1;
export const sensitivityBattlesPerPointMax = 5000;
export const sensitivityMaxPointCount = 100;
export const sensitivityMaxTotalBattles = 100000;
export const defaultSensitivityBattlesPerPoint = 100;

function getNumberPrecision(value: number) {
  const text = `${value}`;
  if (!text.includes(".")) {
    return 0;
  }

  return text.length - text.indexOf(".") - 1;
}

function roundToPrecision(value: number, precision: number) {
  if (precision <= 0) {
    return Math.round(value);
  }

  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function isAlignedToStep(value: number, step: number) {
  if (step <= 0) {
    return false;
  }

  const ratio = value / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-9;
}

export function getSensitivitySweepPointCount(sweep: SensitivitySweep) {
  if (!Number.isFinite(sweep.start) || !Number.isFinite(sweep.end) || !Number.isFinite(sweep.step) || sweep.step <= 0) {
    return null;
  }

  const distance = Math.abs(sweep.end - sweep.start);
  if (!isAlignedToStep(distance, sweep.step)) {
    return null;
  }

  return Math.round(distance / sweep.step) + 1;
}

export function createSensitivitySweepValues(sweep: SensitivitySweep) {
  const pointCount = getSensitivitySweepPointCount(sweep);
  if (pointCount === null) {
    throw new Error("敏感性扫描区间不合法，无法生成取值点");
  }

  const precision = Math.max(getNumberPrecision(sweep.start), getNumberPrecision(sweep.end), getNumberPrecision(sweep.step));
  const direction = sweep.start <= sweep.end ? 1 : -1;

  return Array.from({ length: pointCount }, (_, index) => roundToPrecision(sweep.start + direction * index * sweep.step, precision));
}
