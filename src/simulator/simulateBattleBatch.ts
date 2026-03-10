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

export function simulateBattleBatchSummary(input: BattleInput, count: number): BattleBatchSummaryResult {
  const normalizedCount = Math.max(1, Math.trunc(count));
  const wins: Record<TeamId, number> = {
    A: 0,
    B: 0,
  };
  const teamMaxHpTotals: Record<TeamId, number> = {
    A: input.units.filter((unit) => unit.teamId === "A").reduce((sum, unit) => sum + getEffectiveMaxHp(unit), 0),
    B: input.units.filter((unit) => unit.teamId === "B").reduce((sum, unit) => sum + getEffectiveMaxHp(unit), 0),
  };
  const remainingHpTotals: Record<TeamId, number> = {
    A: 0,
    B: 0,
  };
  const maxHpTotalsOnWins: Record<TeamId, number> = {
    A: 0,
    B: 0,
  };
  let totalTerminalNetAdvantageA = 0;
  let draws = 0;
  let totalRounds = 0;
  let minRounds = Number.POSITIVE_INFINITY;
  let maxRounds = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < normalizedCount; index += 1) {
    const battleSeed = deriveBattleSeed(input.battle.randomSeed, index);
    const result = simulateBattle({
      ...input,
      battle: {
        ...input.battle,
        randomSeed: battleSeed,
      },
    });

    totalRounds += result.roundsCompleted;
    minRounds = Math.min(minRounds, result.roundsCompleted);
    maxRounds = Math.max(maxRounds, result.roundsCompleted);
    const remainingHpByTeam: Record<TeamId, number> = {
      A: result.finalUnits.filter((unit) => unit.teamId === "A").reduce((sum, unit) => sum + unit.currentHp, 0),
      B: result.finalUnits.filter((unit) => unit.teamId === "B").reduce((sum, unit) => sum + unit.currentHp, 0),
    };
    const terminalHpRates: Record<TeamId, number> = {
      A: teamMaxHpTotals.A > 0 ? remainingHpByTeam.A / teamMaxHpTotals.A : 0,
      B: teamMaxHpTotals.B > 0 ? remainingHpByTeam.B / teamMaxHpTotals.B : 0,
    };
    totalTerminalNetAdvantageA += terminalHpRates.A - terminalHpRates.B;

    if (result.winnerTeamId === "A" || result.winnerTeamId === "B") {
      wins[result.winnerTeamId] += 1;
      const winnerUnits = result.finalUnits.filter((unit) => unit.teamId === result.winnerTeamId);
      remainingHpTotals[result.winnerTeamId] += winnerUnits.reduce((sum, unit) => sum + unit.currentHp, 0);
      maxHpTotalsOnWins[result.winnerTeamId] += winnerUnits.reduce((sum, unit) => sum + getEffectiveMaxHp(unit), 0);
    } else {
      draws += 1;
    }
  }

  return {
    baseSeed: input.battle.randomSeed,
    totalBattles: normalizedCount,
    wins,
    draws,
    winRates: {
      A: roundToFourDecimals(wins.A / normalizedCount),
      B: roundToFourDecimals(wins.B / normalizedCount),
    },
    averageTerminalNetAdvantages: {
      A: roundToFourDecimals(totalTerminalNetAdvantageA / normalizedCount),
      B: roundToFourDecimals(-totalTerminalNetAdvantageA / normalizedCount),
    },
    remainingHpRatesOnWins: {
      A: maxHpTotalsOnWins.A > 0 ? roundToFourDecimals(remainingHpTotals.A / maxHpTotalsOnWins.A) : null,
      B: maxHpTotalsOnWins.B > 0 ? roundToFourDecimals(remainingHpTotals.B / maxHpTotalsOnWins.B) : null,
    },
    drawRate: roundToFourDecimals(draws / normalizedCount),
    averageRounds: roundToFourDecimals(totalRounds / normalizedCount),
    minRounds: Number.isFinite(minRounds) ? minRounds : 0,
    maxRounds: Number.isFinite(maxRounds) ? maxRounds : 0,
  };
}
