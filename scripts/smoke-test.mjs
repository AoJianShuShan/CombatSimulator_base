import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildProject } from "./build.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

await buildProject();

const moduleUrl = pathToFileURL(path.join(rootDir, "dist", "simulator", "simulateBattle.js")).href;
const { simulateBattle } = await import(moduleUrl);

const result = simulateBattle({
  battle: {
    maxRounds: 20,
    minimumDamage: 1,
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
      stats: { maxHp: 30, attack: 10, defense: 3, speed: 8 },
    },
    {
      id: "A-2",
      teamId: "A",
      name: "战士A2",
      stats: { maxHp: 24, attack: 8, defense: 2, speed: 9 },
    },
    {
      id: "B-1",
      teamId: "B",
      name: "战士B1",
      stats: { maxHp: 25, attack: 7, defense: 2, speed: 6 },
    },
    {
      id: "B-2",
      teamId: "B",
      name: "战士B2",
      stats: { maxHp: 32, attack: 9, defense: 4, speed: 5 },
    },
  ],
});

console.log(
  JSON.stringify(
    {
      winnerTeamId: result.winnerTeamId,
      roundsCompleted: result.roundsCompleted,
      eventCount: result.events.length,
      survivingUnits: result.finalUnits.filter((unit) => unit.isAlive).map((unit) => unit.name),
    },
    null,
    2,
  ),
);
