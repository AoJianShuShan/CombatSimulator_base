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
    actionResolutionMode: "arpgSimultaneous",
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
const simultaneousDrawResult = simulateBattle({
  battle: {
    ...battleNumberDefaults,
    maxRounds: 1,
    minimumDamage: 1,
    randomSeed: 20260311,
    targetingStrategy: "front",
    actionResolutionMode: "arpgSimultaneous",
    teamNames: {
      A: "红队",
      B: "蓝队",
    },
  },
  units: [
    {
      id: "A-1",
      teamId: "A",
      name: "同步红方",
      position: "front",
      attackElement: "none",
      protectionType: "none",
      stats: {
        ...createDefaultUnitStats(),
        maxHp: 10,
        attack: 99,
        defense: 0,
        speed: 1,
        hitChance: 100,
        dodgeChance: 0,
      },
    },
    {
      id: "B-1",
      teamId: "B",
      name: "同步蓝方",
      position: "front",
      attackElement: "none",
      protectionType: "none",
      stats: {
        ...createDefaultUnitStats(),
        maxHp: 10,
        attack: 99,
        defense: 0,
        speed: 99,
        hitChance: 100,
        dodgeChance: 0,
      },
    },
  ],
});
const turnBasedResult = simulateBattle({
  battle: {
    ...battleNumberDefaults,
    maxRounds: 1,
    minimumDamage: 1,
    randomSeed: 20260311,
    targetingStrategy: "front",
    actionResolutionMode: "turnBasedSpeed",
    teamNames: {
      A: "红队",
      B: "蓝队",
    },
  },
  units: [
    {
      id: "A-1",
      teamId: "A",
      name: "速度红方",
      position: "front",
      attackElement: "none",
      protectionType: "none",
      stats: {
        ...createDefaultUnitStats(),
        maxHp: 10,
        attack: 99,
        defense: 0,
        speed: 1,
        hitChance: 100,
        dodgeChance: 0,
      },
    },
    {
      id: "B-1",
      teamId: "B",
      name: "速度蓝方",
      position: "front",
      attackElement: "none",
      protectionType: "none",
      stats: {
        ...createDefaultUnitStats(),
        maxHp: 10,
        attack: 99,
        defense: 0,
        speed: 99,
        hitChance: 100,
        dodgeChance: 0,
      },
    },
  ],
});
const fireRateResult = simulateBattle({
  battle: {
    ...battleNumberDefaults,
    maxRounds: 2,
    minimumDamage: 1,
    randomSeed: 20260312,
    targetingStrategy: "front",
    actionResolutionMode: "arpgSimultaneous",
    teamNames: {
      A: "红队",
      B: "蓝队",
    },
  },
  units: [
    {
      id: "A-1",
      teamId: "A",
      name: "高射速红方",
      position: "front",
      attackElement: "none",
      protectionType: "none",
      stats: {
        ...createDefaultUnitStats(),
        maxHp: 100,
        attack: 5,
        defense: 0,
        speed: 1,
        fireRate: 120,
        magazineCapacity: 30,
        hitChance: 100,
        dodgeChance: 0,
      },
    },
    {
      id: "B-1",
      teamId: "B",
      name: "低射速蓝方",
      position: "front",
      attackElement: "none",
      protectionType: "none",
      stats: {
        ...createDefaultUnitStats(),
        maxHp: 100,
        attack: 5,
        defense: 0,
        speed: 99,
        fireRate: 60,
        magazineCapacity: 30,
        hitChance: 100,
        dodgeChance: 0,
      },
    },
  ],
});
const reloadResult = simulateBattle({
  battle: {
    ...battleNumberDefaults,
    maxRounds: 2,
    minimumDamage: 1,
    randomSeed: 20260313,
    targetingStrategy: "front",
    actionResolutionMode: "arpgSimultaneous",
    teamNames: {
      A: "红队",
      B: "蓝队",
    },
  },
  units: [
    {
      id: "A-1",
      teamId: "A",
      name: "换弹红方",
      position: "front",
      attackElement: "none",
      protectionType: "none",
      stats: {
        ...createDefaultUnitStats(),
        maxHp: 100,
        attack: 5,
        defense: 0,
        speed: 1,
        fireRate: 120,
        reloadTimeMs: 800,
        magazineCapacity: 1,
        hitChance: 100,
        dodgeChance: 0,
      },
    },
    {
      id: "B-1",
      teamId: "B",
      name: "受击蓝方",
      position: "front",
      attackElement: "none",
      protectionType: "none",
      stats: {
        ...createDefaultUnitStats(),
        maxHp: 100,
        attack: 1,
        defense: 0,
        speed: 1,
        fireRate: 60,
        magazineCapacity: 30,
        hitChance: 100,
        dodgeChance: 0,
      },
    },
  ],
});
const turnBasedTimelineResult = simulateBattle({
  battle: {
    ...battleNumberDefaults,
    maxRounds: 2,
    minimumDamage: 1,
    randomSeed: 20260314,
    targetingStrategy: "front",
    actionResolutionMode: "turnBasedSpeed",
    teamNames: {
      A: "红队",
      B: "蓝队",
    },
  },
  units: [
    {
      id: "A-1",
      teamId: "A",
      name: "高射速低速度红方",
      position: "front",
      attackElement: "none",
      protectionType: "none",
      stats: {
        ...createDefaultUnitStats(),
        maxHp: 100,
        attack: 5,
        defense: 0,
        speed: 1,
        fireRate: 120,
        magazineCapacity: 30,
        hitChance: 100,
        dodgeChance: 0,
      },
    },
    {
      id: "B-1",
      teamId: "B",
      name: "低射速高速度蓝方",
      position: "front",
      attackElement: "none",
      protectionType: "none",
      stats: {
        ...createDefaultUnitStats(),
        maxHp: 100,
        attack: 5,
        defense: 0,
        speed: 99,
        fireRate: 60,
        magazineCapacity: 30,
        hitChance: 100,
        dodgeChance: 0,
      },
    },
  ],
});
const maxBattleTimeResult = simulateBattle({
  battle: {
    ...battleNumberDefaults,
    maxRounds: 10,
    maxBattleTimeMs: 700,
    minimumDamage: 1,
    randomSeed: 20260316,
    targetingStrategy: "front",
    actionResolutionMode: "arpgSimultaneous",
    teamNames: {
      A: "红队",
      B: "蓝队",
    },
  },
  units: [
    {
      id: "A-1",
      teamId: "A",
      name: "限时红方",
      position: "front",
      attackElement: "none",
      protectionType: "none",
      stats: {
        ...createDefaultUnitStats(),
        maxHp: 100,
        attack: 5,
        defense: 0,
        speed: 1,
        fireRate: 120,
        reloadTimeMs: 800,
        magazineCapacity: 1,
        hitChance: 100,
        dodgeChance: 0,
      },
    },
    {
      id: "B-1",
      teamId: "B",
      name: "限时蓝方",
      position: "front",
      attackElement: "none",
      protectionType: "none",
      stats: {
        ...createDefaultUnitStats(),
        maxHp: 100,
        attack: 1,
        defense: 0,
        speed: 1,
        fireRate: 60,
        reloadTimeMs: 1200,
        magazineCapacity: 30,
        hitChance: 100,
        dodgeChance: 0,
      },
    },
  ],
});

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
  singleBatchResult.maxRounds !== result.roundsCompleted ||
  singleBatchResult.averageDurationMs !== (result.events.at(-1)?.payload?.timelineMs ?? 0) ||
  singleBatchResult.minDurationMs !== (result.events.at(-1)?.payload?.timelineMs ?? 0) ||
  singleBatchResult.maxDurationMs !== (result.events.at(-1)?.payload?.timelineMs ?? 0)
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

if (
  simultaneousDrawResult.winnerTeamId !== null ||
  simultaneousDrawResult.finalUnits.some((unit) => unit.isAlive)
) {
  throw new Error("Arpg即时制（时间）模式未正确处理同归于尽");
}

if (
  turnBasedResult.winnerTeamId !== "B" ||
  turnBasedResult.finalUnits.find((unit) => unit.id === "A-1")?.isAlive !== false ||
  turnBasedResult.finalUnits.find((unit) => unit.id === "B-1")?.isAlive !== true
) {
  throw new Error("回合制速度高者先手模式未正确按速度决定先手");
}

const fireRateTurnSequence = fireRateResult.events
  .filter((event) => event.type === "turn_started")
  .map((event) => `${event.actorId}@${event.payload?.timelineMs ?? "?"}`)
  .join("|");
const firstFireRateTurnEvent = fireRateResult.events.find((event) => event.type === "turn_started" && event.actorId === "A-1");
if (fireRateTurnSequence !== "A-1@0|B-1@0|A-1@500") {
  throw new Error(`射速未正确影响行动频率: ${fireRateTurnSequence}`);
}
if (firstFireRateTurnEvent?.payload?.fireRate !== 120) {
  throw new Error(`turn_started 事件未透出射速: ${firstFireRateTurnEvent?.payload?.fireRate ?? "missing"}`);
}

const reloadStartedEvent = reloadResult.events.find((event) => event.type === "reload_started" && event.actorId === "A-1");
const reloadCompletedEvent = reloadResult.events.find((event) => event.type === "reload_completed" && event.actorId === "A-1");
const reloadTurnTimes = reloadResult.events
  .filter((event) => event.type === "turn_started" && event.actorId === "A-1")
  .map((event) => event.payload?.timelineMs ?? null);
if (
  reloadStartedEvent?.payload?.reloadUntilMs !== 800 ||
  reloadCompletedEvent?.payload?.timelineMs !== 800 ||
  JSON.stringify(reloadTurnTimes) !== JSON.stringify([0, 800])
) {
  throw new Error("弹匣与换弹时间未正确驱动下一次行动");
}

const turnBasedTimelineSequence = turnBasedTimelineResult.events
  .filter((event) => event.type === "turn_started")
  .map((event) => `${event.actorId}@${event.payload?.timelineMs ?? "?"}`)
  .join("|");
if (turnBasedTimelineSequence !== "B-1@0|A-1@0|A-1@500") {
  throw new Error(`回合制速度模式未正确处理同一时刻先后手与射速频率: ${turnBasedTimelineSequence}`);
}

const maxBattleTimeEventTimes = maxBattleTimeResult.events
  .map((event) => (typeof event.payload?.timelineMs === "number" ? event.payload.timelineMs : 0));
if (
  maxBattleTimeResult.roundsCompleted !== 1 ||
  maxBattleTimeResult.events.some((event) => event.type === "reload_completed") ||
  maxBattleTimeResult.events.some((event) => event.type === "turn_started" && event.payload?.timelineMs === 800) ||
  maxBattleTimeResult.events.at(-1)?.payload?.endReason !== "maxBattleTimeMs" ||
  Math.max(...maxBattleTimeEventTimes) > 700
) {
  throw new Error("最大战斗时长未正确限制时间轴推进");
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
      simultaneousDrawWinner: simultaneousDrawResult.winnerTeamId,
      turnBasedWinner: turnBasedResult.winnerTeamId,
      fireRateTurnSequence,
      reloadTurnTimes,
      turnBasedTimelineSequence,
      maxBattleTimeRounds: maxBattleTimeResult.roundsCompleted,
      maxBattleTimeEndReason: maxBattleTimeResult.events.at(-1)?.payload?.endReason ?? null,
      batchSummary: batchResult,
    },
    null,
    2,
  ),
);
