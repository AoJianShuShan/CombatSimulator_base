import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildProject } from "./build.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

await buildProject();

const moduleUrl = pathToFileURL(path.join(rootDir, "dist", "simulator", "simulateBattle.js")).href;
const attributeMacroModuleUrl = pathToFileURL(path.join(rootDir, "dist", "domain", "attributeMacros.js")).href;
const { simulateBattle } = await import(moduleUrl);
const { createDefaultUnitStats } = await import(attributeMacroModuleUrl);

const input = {
  battle: {
    maxRounds: 20,
    minimumDamage: 1,
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

if (JSON.stringify(result) !== JSON.stringify(replayResult)) {
  throw new Error("相同随机种子未得到完全一致的战斗结果");
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
    },
    null,
    2,
  ),
);
