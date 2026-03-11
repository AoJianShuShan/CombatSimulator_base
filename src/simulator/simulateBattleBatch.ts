import type { BattleBatchSummaryResult, BattleInput, TeamId } from "../domain/battle.ts";
import { simulateBattle } from "./simulateBattle.ts";

function roundToFourDecimals(value: number) {
  return Math.round(value * 10000) / 10000;
}

function mixSeed(baseSeed: number, index: number) {
  let value = (Math.trunc(baseSeed) >>> 0) ^ Math.imul((index + 1) >>> 0, 0x9e3779b9);
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b) >>> 0;
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35) >>> 0;
  value ^= value >>> 16;
  return value >>> 0;
}

export function deriveBattleSeed(baseSeed: number, index: number) {
  return index <= 0 ? Math.trunc(baseSeed) : mixSeed(baseSeed, index);
}

function getEffectiveMaxHp(unit: BattleInput["units"][number] | ReturnType<typeof simulateBattle>["finalUnits"][number]) {
  const { stats } = unit;
  return Math.max(1, Math.floor(stats.maxHp * (1 + stats.maxHpRate / 100) + 0.5));
}

function getBattleDurationMs(result: ReturnType<typeof simulateBattle>) {
  const elapsedTimeMs = result.events.at(-1)?.elapsedTimeMs;
  return typeof elapsedTimeMs === "number" ? elapsedTimeMs : 0;
}

interface BatchAccumulator {
  count: number;
  draws: number;
  maxDurationMs: number;
  maxHpTotalsOnWins: Record<TeamId, number>;
  maxRounds: number;
  minDurationMs: number;
  minRounds: number;
  remainingHpTotals: Record<TeamId, number>;
  teamMaxHpTotals: Record<TeamId, number>;
  totalDurationMs: number;
  totalRounds: number;
  totalTerminalNetAdvantageA: number;
  wins: Record<TeamId, number>;
}

interface BatchRunOptions {
  onProgress?: (completed: number, total: number) => void;
  signal?: AbortSignal;
}

const localBatchYieldInterval = 50;

function createAbortError(message: string) {
  if (typeof DOMException === "function") {
    return new DOMException(message, "AbortError");
  }

  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function ensureNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError(typeof signal.reason === "string" ? signal.reason : "运行已停止");
  }
}

function waitForYield() {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    return new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }

  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createBatchAccumulator(input: BattleInput, count: number): BatchAccumulator {
  return {
    count,
    draws: 0,
    maxDurationMs: Number.NEGATIVE_INFINITY,
    maxHpTotalsOnWins: {
      A: 0,
      B: 0,
    },
    maxRounds: Number.NEGATIVE_INFINITY,
    minDurationMs: Number.POSITIVE_INFINITY,
    minRounds: Number.POSITIVE_INFINITY,
    remainingHpTotals: {
      A: 0,
      B: 0,
    },
    teamMaxHpTotals: {
      A: input.units.filter((unit) => unit.teamId === "A").reduce((sum, unit) => sum + getEffectiveMaxHp(unit), 0),
      B: input.units.filter((unit) => unit.teamId === "B").reduce((sum, unit) => sum + getEffectiveMaxHp(unit), 0),
    },
    totalDurationMs: 0,
    totalRounds: 0,
    totalTerminalNetAdvantageA: 0,
    wins: {
      A: 0,
      B: 0,
    },
  };
}

function appendBattleResult(accumulator: BatchAccumulator, result: ReturnType<typeof simulateBattle>) {
  accumulator.totalRounds += result.roundsCompleted;
  const durationMs = getBattleDurationMs(result);
  accumulator.totalDurationMs += durationMs;
  accumulator.minRounds = Math.min(accumulator.minRounds, result.roundsCompleted);
  accumulator.maxRounds = Math.max(accumulator.maxRounds, result.roundsCompleted);
  accumulator.minDurationMs = Math.min(accumulator.minDurationMs, durationMs);
  accumulator.maxDurationMs = Math.max(accumulator.maxDurationMs, durationMs);
  const remainingHpByTeam: Record<TeamId, number> = {
    A: result.finalUnits.filter((unit) => unit.teamId === "A").reduce((sum, unit) => sum + unit.currentHp, 0),
    B: result.finalUnits.filter((unit) => unit.teamId === "B").reduce((sum, unit) => sum + unit.currentHp, 0),
  };
  const terminalHpRates: Record<TeamId, number> = {
    A: accumulator.teamMaxHpTotals.A > 0 ? remainingHpByTeam.A / accumulator.teamMaxHpTotals.A : 0,
    B: accumulator.teamMaxHpTotals.B > 0 ? remainingHpByTeam.B / accumulator.teamMaxHpTotals.B : 0,
  };
  accumulator.totalTerminalNetAdvantageA += terminalHpRates.A - terminalHpRates.B;

  if (result.winnerTeamId === "A" || result.winnerTeamId === "B") {
    accumulator.wins[result.winnerTeamId] += 1;
    const winnerUnits = result.finalUnits.filter((unit) => unit.teamId === result.winnerTeamId);
    accumulator.remainingHpTotals[result.winnerTeamId] += winnerUnits.reduce((sum, unit) => sum + unit.currentHp, 0);
    accumulator.maxHpTotalsOnWins[result.winnerTeamId] += winnerUnits.reduce((sum, unit) => sum + getEffectiveMaxHp(unit), 0);
    return;
  }

  accumulator.draws += 1;
}

function finalizeBatchAccumulator(input: BattleInput, accumulator: BatchAccumulator): BattleBatchSummaryResult {
  const normalizedCount = accumulator.count;

  return {
    baseSeed: input.battle.randomSeed,
    totalBattles: normalizedCount,
    wins: accumulator.wins,
    draws: accumulator.draws,
    winRates: {
      A: roundToFourDecimals(accumulator.wins.A / normalizedCount),
      B: roundToFourDecimals(accumulator.wins.B / normalizedCount),
    },
    averageTerminalNetAdvantages: {
      A: roundToFourDecimals(accumulator.totalTerminalNetAdvantageA / normalizedCount),
      B: roundToFourDecimals(-accumulator.totalTerminalNetAdvantageA / normalizedCount),
    },
    remainingHpRatesOnWins: {
      A:
        accumulator.maxHpTotalsOnWins.A > 0
          ? roundToFourDecimals(accumulator.remainingHpTotals.A / accumulator.maxHpTotalsOnWins.A)
          : null,
      B:
        accumulator.maxHpTotalsOnWins.B > 0
          ? roundToFourDecimals(accumulator.remainingHpTotals.B / accumulator.maxHpTotalsOnWins.B)
          : null,
    },
    drawRate: roundToFourDecimals(accumulator.draws / normalizedCount),
    averageRounds: roundToFourDecimals(accumulator.totalRounds / normalizedCount),
    minRounds: Number.isFinite(accumulator.minRounds) ? accumulator.minRounds : 0,
    maxRounds: Number.isFinite(accumulator.maxRounds) ? accumulator.maxRounds : 0,
    averageDurationMs: roundToFourDecimals(accumulator.totalDurationMs / normalizedCount),
    minDurationMs: Number.isFinite(accumulator.minDurationMs) ? roundToFourDecimals(accumulator.minDurationMs) : 0,
    maxDurationMs: Number.isFinite(accumulator.maxDurationMs) ? roundToFourDecimals(accumulator.maxDurationMs) : 0,
  };
}

export function simulateBattleBatchSummary(input: BattleInput, count: number): BattleBatchSummaryResult {
  const normalizedCount = Math.max(1, Math.trunc(count));
  const accumulator = createBatchAccumulator(input, normalizedCount);

  for (let index = 0; index < normalizedCount; index += 1) {
    const battleSeed = deriveBattleSeed(input.battle.randomSeed, index);
    appendBattleResult(
      accumulator,
      simulateBattle({
        ...input,
        battle: {
          ...input.battle,
          randomSeed: battleSeed,
        },
      }),
    );
  }

  return finalizeBatchAccumulator(input, accumulator);
}

export async function simulateBattleBatchSummaryCancelable(
  input: BattleInput,
  count: number,
  options: BatchRunOptions = {},
): Promise<BattleBatchSummaryResult> {
  const normalizedCount = Math.max(1, Math.trunc(count));
  const accumulator = createBatchAccumulator(input, normalizedCount);

  for (let index = 0; index < normalizedCount; index += 1) {
    ensureNotAborted(options.signal);
    const battleSeed = deriveBattleSeed(input.battle.randomSeed, index);
    appendBattleResult(
      accumulator,
      simulateBattle({
        ...input,
        battle: {
          ...input.battle,
          randomSeed: battleSeed,
        },
      }),
    );
    options.onProgress?.(index + 1, normalizedCount);

    if ((index + 1) % localBatchYieldInterval === 0 && index + 1 < normalizedCount) {
      await waitForYield();
    }
  }

  return finalizeBatchAccumulator(input, accumulator);
}
