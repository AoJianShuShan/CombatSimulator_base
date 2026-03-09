import type {
  BattleEvent,
  BattleInput,
  BattleSimulationResult,
  BattleUnitState,
  TeamId,
  UnitConfig,
} from "../domain/battle.ts";

interface RuntimeUnit extends BattleUnitState {
  initialOrder: number;
}

function cloneUnit(unit: UnitConfig, initialOrder: number): RuntimeUnit {
  return {
    ...unit,
    currentHp: unit.stats.maxHp,
    isAlive: true,
    initialOrder,
  };
}

function getAliveUnitsByTeam(units: RuntimeUnit[], teamId: TeamId) {
  return units.filter((unit) => unit.teamId === teamId && unit.isAlive);
}

function getOpponentTeamId(teamId: TeamId): TeamId {
  return teamId === "A" ? "B" : "A";
}

function sortTurnOrder(units: RuntimeUnit[]) {
  return [...units]
    .filter((unit) => unit.isAlive)
    .sort((left, right) => {
      if (left.stats.speed !== right.stats.speed) {
        return right.stats.speed - left.stats.speed;
      }

      if (left.teamId !== right.teamId) {
        return left.teamId.localeCompare(right.teamId);
      }

      return left.initialOrder - right.initialOrder;
    });
}

function pickTarget(units: RuntimeUnit[], actor: RuntimeUnit) {
  const targets = getAliveUnitsByTeam(units, getOpponentTeamId(actor.teamId));
  return targets[0] ?? null;
}

function createEvent(
  events: BattleEvent[],
  event: Omit<BattleEvent, "sequence">,
) {
  events.push({
    sequence: events.length + 1,
    ...event,
  });
}

export function simulateBattle(input: BattleInput): BattleSimulationResult {
  const units = input.units.map((unit, index) => cloneUnit(unit, index));
  const events: BattleEvent[] = [];
  let roundsCompleted = 0;

  createEvent(events, {
    type: "battle_started",
    round: 0,
    summary: `${input.battle.teamNames.A} 与 ${input.battle.teamNames.B} 的战斗开始`,
    payload: {
      maxRounds: input.battle.maxRounds,
      unitCount: units.length,
    },
  });

  for (let round = 1; round <= input.battle.maxRounds; round += 1) {
    const teamAAlive = getAliveUnitsByTeam(units, "A");
    const teamBAlive = getAliveUnitsByTeam(units, "B");
    if (teamAAlive.length === 0 || teamBAlive.length === 0) {
      break;
    }

    roundsCompleted = round;
    createEvent(events, {
      type: "round_started",
      round,
      summary: `第 ${round} 回合开始`,
      payload: {
        aliveA: teamAAlive.length,
        aliveB: teamBAlive.length,
      },
    });

    const turnOrder = sortTurnOrder(units);
    for (const actor of turnOrder) {
      if (!actor.isAlive) {
        continue;
      }

      const target = pickTarget(units, actor);
      if (!target) {
        break;
      }

      createEvent(events, {
        type: "turn_started",
        round,
        actorId: actor.id,
        targetId: target.id,
        summary: `${actor.name} 对 ${target.name} 发起攻击`,
      });

      const damage = Math.max(input.battle.minimumDamage, actor.stats.attack - target.stats.defense);
      target.currentHp = Math.max(0, target.currentHp - damage);
      target.isAlive = target.currentHp > 0;

      createEvent(events, {
        type: "damage_applied",
        round,
        actorId: actor.id,
        targetId: target.id,
        summary: `${actor.name} 对 ${target.name} 造成 ${damage} 点伤害，目标剩余 ${target.currentHp} HP`,
        payload: {
          damage,
          targetHp: target.currentHp,
        },
      });

      if (!target.isAlive) {
        createEvent(events, {
          type: "unit_defeated",
          round,
          actorId: actor.id,
          targetId: target.id,
          summary: `${target.name} 被击败`,
        });
      }

      const remainingEnemies = getAliveUnitsByTeam(units, getOpponentTeamId(actor.teamId));
      if (remainingEnemies.length === 0) {
        break;
      }
    }
  }

  const aliveA = getAliveUnitsByTeam(units, "A");
  const aliveB = getAliveUnitsByTeam(units, "B");
  const winnerTeamId = aliveA.length > 0 && aliveB.length === 0 ? "A" : aliveB.length > 0 && aliveA.length === 0 ? "B" : null;

  createEvent(events, {
    type: "battle_ended",
    round: roundsCompleted,
    summary:
      winnerTeamId === null
        ? "战斗结束，结果为平局"
        : `战斗结束，胜利方为 ${input.battle.teamNames[winnerTeamId]}`,
    payload: {
      winnerTeamId,
      aliveA: aliveA.length,
      aliveB: aliveB.length,
    },
  });

  return {
    winnerTeamId,
    roundsCompleted,
    events,
    finalUnits: units.map(({ initialOrder, ...unit }) => unit),
  };
}
