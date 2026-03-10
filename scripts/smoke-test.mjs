import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildProject } from "./build.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

await buildProject();

const moduleUrl = pathToFileURL(path.join(rootDir, "dist", "simulator", "simulateBattle.js")).href;
const batchModuleUrl = pathToFileURL(path.join(rootDir, "dist", "simulator", "simulateBattleBatch.js")).href;
const attributeMacroModuleUrl = pathToFileURL(path.join(rootDir, "dist", "domain", "attributeMacros.js")).href;
const battleConfigMacroModuleUrl = pathToFileURL(path.join(rootDir, "dist", "domain", "battleConfigMacros.js")).href;
const { simulateBattle } = await import(moduleUrl);
const { simulateBattleBatchSummary } = await import(batchModuleUrl);
const { createDefaultUnitStats } = await import(attributeMacroModuleUrl);
const { battleNumberDefaults } = await import(battleConfigMacroModuleUrl);

const input = {
  battle: {
    ...battleNumberDefaults,
    maxRounds: 20,
    randomSeed: 20260310,
    targetingStrategy: "highestAttack",
    teamNames: {
      A: "红队",
      B: "蓝队",
    },
  },
  units: [
    {
      id: "A-1",
      teamId: "A",
      name: "战士A1",
      position: "front",
      attackElement: "physical",
      protectionType: "heavyArmor",
      stats: {
        ...createDefaultUnitStats(),
        maxHp: 30,
        maxHpRate: 20,
        attack: 10,
        attackRate: 30,
        defense: 3,
        defenseRate: 0,
        speed: 8,
        critChance: 25,
        critMultiplier: 180,
        hitChance: 100,
        dodgeChance: 0,
      },
    },
    {
      id: "A-2",
      teamId: "A",
      name: "战士A2",
      position: "middle",
      attackElement: "fire",
      protectionType: "heatArmor",
      stats: {
        ...createDefaultUnitStats(),
        maxHp: 24,
        maxHpRate: 0,
        attack: 8,
        attackRate: 0,
        defense: 2,
        defenseRate: 20,
        speed: 9,
        critChance: 0,
        critMultiplier: 150,
        hitChance: 85,
        dodgeChance: 10,
      },
    },
    {
      id: "B-1",
      teamId: "B",
      name: "战士B1",
      position: "front",
      attackElement: "electromagnetic",
      protectionType: "bioArmor",
      stats: {
        ...createDefaultUnitStats(),
        maxHp: 25,
        maxHpRate: 10,
        attack: 7,
        attackRate: 15,
        defense: 2,
        defenseRate: 0,
        speed: 6,
        critChance: 10,
        critMultiplier: 160,
        hitChance: 95,
        dodgeChance: 5,
      },
    },
    {
      id: "B-2",
      teamId: "B",
      name: "战士B2",
      position: "back",
      attackElement: "corrosive",
      protectionType: "insulatedArmor",
      stats: {
        ...createDefaultUnitStats(),
        maxHp: 32,
        maxHpRate: 0,
        attack: 9,
        attackRate: 25,
        defense: 4,
        defenseRate: 10,
        speed: 5,
        critChance: 20,
        critMultiplier: 200,
        hitChance: 100,
        dodgeChance: 0,
      },
    },
  ],
};

const result = simulateBattle(input);
const replayResult = simulateBattle(input);
const batchResult = simulateBattleBatchSummary(input, 8);
const singleBatchResult = simulateBattleBatchSummary(input, 1);

if (JSON.stringify(result) !== JSON.stringify(replayResult)) {
  throw new Error("相同随机种子未得到完全一致的战斗结果");
}

if (singleBatchResult.totalBattles !== 1) {
  throw new Error("批量摘要基础结构异常");
}

if (
  singleBatchResult.totalBattles !== 1 ||
  singleBatchResult.averageRounds !== result.roundsCompleted ||
  singleBatchResult.minRounds !== result.roundsCompleted ||
  singleBatchResult.maxRounds !== result.roundsCompleted
) {
  throw new Error("count = 1 的批量摘要与单场结果统计不一致");
}

if (
  (result.winnerTeamId === "A" && singleBatchResult.wins.A !== 1) ||
  (result.winnerTeamId === "B" && singleBatchResult.wins.B !== 1) ||
  (result.winnerTeamId === null && singleBatchResult.draws !== 1)
) {
  throw new Error("count = 1 的批量摘要胜负统计不一致");
}

if (result.winnerTeamId === "A" || result.winnerTeamId === "B") {
  const winningUnits = result.finalUnits.filter((unit) => unit.teamId === result.winnerTeamId);
  const remainingHp = winningUnits.reduce((sum, unit) => sum + unit.currentHp, 0);
  const totalMaxHp = winningUnits.reduce((sum, unit) => sum + Math.max(1, Math.floor(unit.stats.maxHp * (1 + unit.stats.maxHpRate / 100) + 0.5)), 0);
  const expectedRemainingHpRate = Math.round((remainingHp / totalMaxHp) * 10000) / 10000;
  if (singleBatchResult.remainingHpRatesOnWins[result.winnerTeamId] !== expectedRemainingHpRate) {
    throw new Error("count = 1 的批量摘要剩余血量统计不一致");
  }
}

const totalMaxHpByTeam = {
  A: input.units.filter((unit) => unit.teamId === "A").reduce((sum, unit) => sum + Math.max(1, Math.floor(unit.stats.maxHp * (1 + unit.stats.maxHpRate / 100) + 0.5)), 0),
  B: input.units.filter((unit) => unit.teamId === "B").reduce((sum, unit) => sum + Math.max(1, Math.floor(unit.stats.maxHp * (1 + unit.stats.maxHpRate / 100) + 0.5)), 0),
};
const remainingHpByTeam = {
  A: result.finalUnits.filter((unit) => unit.teamId === "A").reduce((sum, unit) => sum + unit.currentHp, 0),
  B: result.finalUnits.filter((unit) => unit.teamId === "B").reduce((sum, unit) => sum + unit.currentHp, 0),
};
const expectedNetAdvantageA = Math.round(((remainingHpByTeam.A / totalMaxHpByTeam.A) - (remainingHpByTeam.B / totalMaxHpByTeam.B)) * 10000) / 10000;
if (
  singleBatchResult.averageTerminalNetAdvantages.A !== expectedNetAdvantageA ||
  singleBatchResult.averageTerminalNetAdvantages.B !== -expectedNetAdvantageA
) {
  throw new Error("count = 1 的批量摘要终局净优势统计不一致");
}

console.log(
  JSON.stringify(
    {
      randomSeed: result.randomSeed,
      winnerTeamId: result.winnerTeamId,
      roundsCompleted: result.roundsCompleted,
      eventCount: result.events.length,
      finalTimeIndex: result.events.at(-1)?.timeIndex ?? null,
      survivingUnits: result.finalUnits.filter((unit) => unit.isAlive).map((unit) => unit.name),
      batchSummary: batchResult,
    },
    null,
    2,
  ),
);
