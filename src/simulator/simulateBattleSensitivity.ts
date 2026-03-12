import {
  createSensitivitySweepValues,
  type BattleSensitivityPointResult,
  type BattleSensitivityProgress,
  type BattleSensitivityRequest,
  type BattleSensitivityResult,
} from "../domain/analysis.ts";
import type { BattleInput } from "../domain/battle.ts";
import { simulateBattleBatchSummary, simulateBattleBatchSummaryCancelable } from "./simulateBattleBatch.ts";

interface SensitivityRunOptions {
  onProgress?: (progress: BattleSensitivityProgress) => void;
  signal?: AbortSignal;
}

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

function cloneBattleInput(input: BattleInput): BattleInput {
  return {
    battle: {
      ...input.battle,
      teamNames: {
        ...input.battle.teamNames,
      },
      extras: input.battle.extras ? { ...input.battle.extras } : undefined,
    },
    units: input.units.map((unit) => ({
      ...unit,
      stats: {
        ...unit.stats,
      },
      extras: unit.extras ? { ...unit.extras } : undefined,
    })),
  };
}

function resolveSensitivityActualValue(baseValue: number, deltaValue: number) {
  const precision = Math.max(getNumberPrecision(baseValue), getNumberPrecision(deltaValue));
  return roundToPrecision(baseValue + deltaValue, precision);
}

function applySensitivityPoint(input: BattleInput, request: BattleSensitivityRequest, value: number) {
  if (request.axis.scope !== "unitStat") {
    throw new Error(`敏感性分析目标类型不支持: ${request.axis.scope}`);
  }

  const nextInput = cloneBattleInput(input);
  const targetUnit = nextInput.units.find((unit) => unit.id === request.axis.unitId);
  if (!targetUnit) {
    throw new Error(`敏感性分析目标单位不存在: ${request.axis.unitId}`);
  }

  const actualValue = resolveSensitivityActualValue(targetUnit.stats[request.axis.field], value);
  targetUnit.stats[request.axis.field] = actualValue;
  return {
    actualValue,
    nextInput,
  };
}

function createSensitivityResult(
  request: BattleSensitivityRequest,
  values: number[],
  points: BattleSensitivityPointResult[],
): BattleSensitivityResult {
  return {
    baseSeed: request.input.battle.randomSeed,
    axis: request.axis,
    sweep: request.sweep,
    pointCount: values.length,
    battlesPerPoint: request.battlesPerPoint,
    totalBattles: values.length * request.battlesPerPoint,
    points,
  };
}

export function simulateBattleSensitivity(request: BattleSensitivityRequest): BattleSensitivityResult {
  const values = createSensitivitySweepValues(request.sweep);
  const points = values.map((value, index) => {
    const appliedPoint = applySensitivityPoint(request.input, request, value);
    return {
      index,
      value,
      actualValue: appliedPoint.actualValue,
      summary: simulateBattleBatchSummary(appliedPoint.nextInput, request.battlesPerPoint),
    };
  });

  return createSensitivityResult(request, values, points);
}

export async function simulateBattleSensitivityCancelable(
  request: BattleSensitivityRequest,
  options: SensitivityRunOptions = {},
): Promise<BattleSensitivityResult> {
  const values = createSensitivitySweepValues(request.sweep);
  const totalPoints = values.length;
  const totalBattles = totalPoints * request.battlesPerPoint;
  const points: BattleSensitivityPointResult[] = [];

  for (const [index, value] of values.entries()) {
    const appliedPoint = applySensitivityPoint(request.input, request, value);
    const summary = await simulateBattleBatchSummaryCancelable(
      appliedPoint.nextInput,
      request.battlesPerPoint,
      {
        signal: options.signal,
        onProgress: (completed) => {
          options.onProgress?.({
            completedBattles: index * request.battlesPerPoint + completed,
            completedPoints: index + (completed >= request.battlesPerPoint ? 1 : 0),
            currentPointIndex: index,
            currentValue: value,
            totalBattles,
            totalPoints,
          });
        },
      },
    );

    points.push({
      index,
      value,
      actualValue: appliedPoint.actualValue,
      summary,
    });

    options.onProgress?.({
      completedBattles: (index + 1) * request.battlesPerPoint,
      completedPoints: index + 1,
      currentPointIndex: index,
      currentValue: value,
      totalBattles,
      totalPoints,
    });
  }

  return createSensitivityResult(request, values, points);
}
