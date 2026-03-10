import type {
  AttackElement,
  BattleEvent,
  BattleInput,
  BattleSimulationResult,
  BattleUnitState,
  ProtectionType,
  TeamId,
  UnitConfig,
  UnitPosition,
} from "../domain/battle.ts";
import { unitStatRoleKeys } from "../domain/attributeMacros.ts";
import type { TargetingStrategy, UnitStats } from "../domain/battle.ts";

interface RuntimeUnit extends BattleUnitState {
  initialOrder: number;
}

interface SeededRandom {
  next(): number;
  seed: number;
}

const unitPositionPriority: Record<UnitPosition, number> = {
  front: 0,
  middle: 1,
  back: 2,
};

const attackElementAdvantageMap: Partial<Record<AttackElement, ProtectionType>> = {
  physical: "heatArmor",
  fire: "insulatedArmor",
  electromagnetic: "bioArmor",
  corrosive: "heavyArmor",
};

const attackElementDisadvantageMap: Partial<Record<AttackElement, ProtectionType>> = {
  physical: "heavyArmor",
  fire: "heatArmor",
  electromagnetic: "insulatedArmor",
  corrosive: "bioArmor",
};

function roundHalfUp(value: number) {
  return Math.floor(value + 0.5);
}

function clampPercentage(value: number) {
  return Math.min(100, Math.max(0, value));
}

function clampMultiplier(value: number) {
  return Math.max(0, value);
}

function roundToTwoDecimals(value: number) {
  return Math.round(value * 100) / 100;
}

function getScaledStat(baseValue: number, rate: number) {
  return Math.max(0, roundHalfUp(baseValue * (1 + rate / 100)));
}

function getEffectiveMaxHp(stats: UnitStats) {
  return Math.max(1, getScaledStat(stats[unitStatRoleKeys.maxHpBase], stats[unitStatRoleKeys.maxHpRate]));
}

function getEffectiveAttack(stats: UnitStats) {
  return getScaledStat(stats[unitStatRoleKeys.attackBase], stats[unitStatRoleKeys.attackRate]);
}

function getEffectiveDefense(stats: UnitStats) {
  return getScaledStat(stats[unitStatRoleKeys.defenseBase], stats[unitStatRoleKeys.defenseRate]);
}

function getArmorReductionRate(input: BattleInput, actor: RuntimeUnit, target: RuntimeUnit) {
  const armorGap = Math.max(0, target.stats[unitStatRoleKeys.armor] - actor.stats[unitStatRoleKeys.armorPenetration]);
  if (armorGap <= 0) {
    return 0;
  }

  const formulaBase = Math.max(0, input.battle.armorFormulaBase);
  const denominator = formulaBase + armorGap;
  if (denominator <= 0) {
    return 0;
  }

  const rawReductionRate = armorGap / denominator;
  const maxReductionRate = clampPercentage(input.battle.maxArmorDamageReduction) / 100;
  return Math.min(maxReductionRate, rawReductionRate);
}

function getElementRelation(input: BattleInput, actor: RuntimeUnit, target: RuntimeUnit) {
  if (actor.attackElement === "none" || target.protectionType === "none") {
    return {
      relation: "neutral",
      multiplier: 1,
    } as const;
  }

  if (attackElementAdvantageMap[actor.attackElement] === target.protectionType) {
    return {
      relation: "advantage",
      multiplier: input.battle.elementAdvantageDamageRate / 100,
    } as const;
  }

  if (attackElementDisadvantageMap[actor.attackElement] === target.protectionType) {
    return {
      relation: "disadvantage",
      multiplier: input.battle.elementDisadvantageDamageRate / 100,
    } as const;
  }

  return {
    relation: "neutral",
    multiplier: 1,
  } as const;
}

function createSeededRandom(seed: number): SeededRandom {
  let state = Math.trunc(seed) >>> 0;
  if (state === 0) {
    state = 0x6d2b79f5;
  }

  return {
    seed: state,
    next() {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >>> 17;
      state >>>= 0;
      state ^= state << 5;
      state >>>= 0;
      return state / 4294967296;
    },
  };
}

function cloneUnit(unit: UnitConfig, initialOrder: number): RuntimeUnit {
  return {
    ...unit,
    currentHp: getEffectiveMaxHp(unit.stats),
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

function compareByInitialTargetPriority(left: RuntimeUnit, right: RuntimeUnit) {
  const leftPositionPriority = unitPositionPriority[left.position];
  const rightPositionPriority = unitPositionPriority[right.position];
  if (leftPositionPriority !== rightPositionPriority) {
    return leftPositionPriority - rightPositionPriority;
  }

  return left.initialOrder - right.initialOrder;
}

function sortTurnOrder(units: RuntimeUnit[]) {
  return [...units]
    .filter((unit) => unit.isAlive)
    .sort((left, right) => {
      const leftSpeed = left.stats[unitStatRoleKeys.speed];
      const rightSpeed = right.stats[unitStatRoleKeys.speed];
      if (leftSpeed !== rightSpeed) {
        return rightSpeed - leftSpeed;
      }

      if (left.teamId !== right.teamId) {
        return left.teamId.localeCompare(right.teamId);
      }

      return left.initialOrder - right.initialOrder;
    });
}

function pickTarget(units: RuntimeUnit[], actor: RuntimeUnit, targetingStrategy: TargetingStrategy) {
  const targets = getAliveUnitsByTeam(units, getOpponentTeamId(actor.teamId));
  if (targets.length === 0) {
    return null;
  }

  switch (targetingStrategy) {
    case "lowestHp":
      return [...targets].sort((left, right) => {
        if (left.currentHp !== right.currentHp) {
          return left.currentHp - right.currentHp;
        }

        return compareByInitialTargetPriority(left, right);
      })[0];
    case "highestAttack":
      return [...targets].sort((left, right) => {
        const leftAttack = getEffectiveAttack(left.stats);
        const rightAttack = getEffectiveAttack(right.stats);
        if (leftAttack !== rightAttack) {
          return rightAttack - leftAttack;
        }

        return compareByInitialTargetPriority(left, right);
      })[0];
    case "front":
      return [...targets].sort(compareByInitialTargetPriority)[0];
  }
}

function createEvent(
  events: BattleEvent[],
  event: Omit<BattleEvent, "sequence">,
) {
  events.push({
    sequence: events.length + 1,
    timeIndex: events.length,
    ...event,
  });
}

export function simulateBattle(input: BattleInput): BattleSimulationResult {
  const units = input.units.map((unit, index) => cloneUnit(unit, index));
  const events: BattleEvent[] = [];
  let roundsCompleted = 0;
  const random = createSeededRandom(input.battle.randomSeed);

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

      const target = pickTarget(units, actor, input.battle.targetingStrategy);
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

      const effectiveHitChance = clampPercentage(
        actor.stats[unitStatRoleKeys.hitChance] - target.stats[unitStatRoleKeys.dodgeChance],
      );
      const hitRoll = random.next();
      if (hitRoll >= effectiveHitChance / 100) {
        createEvent(events, {
          type: "attack_missed",
          round,
          actorId: actor.id,
          targetId: target.id,
          summary: `${actor.name} 攻击 ${target.name}，但被闪避或未命中`,
          payload: {
            hitChance: effectiveHitChance,
          },
        });
        continue;
      }

      const effectiveAttack = getEffectiveAttack(actor.stats);
      const effectiveDefense = getEffectiveDefense(target.stats);
      const isMinimumDamageByDefense = effectiveAttack - effectiveDefense < input.battle.minimumDamage;
      const baseDamage = Math.max(input.battle.minimumDamage, effectiveAttack - effectiveDefense);
      const armorReductionRate = getArmorReductionRate(input, actor, target);
      const armorMultiplier = 1 - armorReductionRate;
      const critRoll = random.next();
      const isCritical = critRoll < clampPercentage(actor.stats[unitStatRoleKeys.critChance]) / 100;
      const criticalMultiplier = isCritical ? actor.stats[unitStatRoleKeys.critMultiplier] / 100 : 1;
      const headshotRoll = random.next();
      const isHeadshot = headshotRoll < clampPercentage(actor.stats[unitStatRoleKeys.headshotChance]) / 100;
      const headshotMultiplier = isHeadshot ? actor.stats[unitStatRoleKeys.headshotMultiplier] / 100 : 1;
      const { relation: elementRelation, multiplier: elementMultiplier } = getElementRelation(input, actor, target);
      const scenarioMultiplier = 1 + actor.stats[unitStatRoleKeys.scenarioDamageBonus] / 100;
      const heroClassMultiplier = 1 + actor.stats[unitStatRoleKeys.heroClassDamageBonus] / 100;
      const skillTypeMultiplier = 1 + actor.stats[unitStatRoleKeys.skillTypeDamageBonus] / 100;
      const skillMultiplier = actor.stats[unitStatRoleKeys.skillMultiplier] / 100;
      const outputMultiplier = clampMultiplier(
        1 + (actor.stats[unitStatRoleKeys.outputAmplify] - actor.stats[unitStatRoleKeys.outputDecay]) / 100,
      );
      const damageTakenMultiplier = clampMultiplier(
        1 + (target.stats[unitStatRoleKeys.damageTakenAmplify] - target.stats[unitStatRoleKeys.damageTakenReduction]) / 100,
      );
      const finalDamageMultiplier = clampMultiplier(
        1 + (actor.stats[unitStatRoleKeys.finalDamageBonus] - target.stats[unitStatRoleKeys.finalDamageReduction]) / 100,
      );
      const damageBeforeRound =
        baseDamage *
        armorMultiplier *
        criticalMultiplier *
        headshotMultiplier *
        elementMultiplier *
        scenarioMultiplier *
        heroClassMultiplier *
        skillTypeMultiplier *
        skillMultiplier *
        outputMultiplier *
        damageTakenMultiplier *
        finalDamageMultiplier;
      const damage = Math.max(input.battle.minimumDamage, roundHalfUp(damageBeforeRound));
      target.currentHp = Math.max(0, target.currentHp - damage);
      target.isAlive = target.currentHp > 0;
      const targetMaxHp = getEffectiveMaxHp(target.stats);
      const damageTags = `${isHeadshot ? "爆头" : ""}${isCritical ? "暴击" : ""}`;

      createEvent(events, {
        type: "damage_applied",
        round,
        actorId: actor.id,
        targetId: target.id,
        summary: `${actor.name} 对 ${target.name} 造成 ${damage} 点${damageTags}伤害，目标剩余 ${target.currentHp}/${targetMaxHp} HP${isMinimumDamageByDefense ? "（不破防）" : ""}`,
        payload: {
          damage,
          baseDamage,
          targetHp: target.currentHp,
          targetMaxHp,
          isCritical,
          criticalMultiplier: roundToTwoDecimals(criticalMultiplier * 100),
          isHeadshot,
          headshotMultiplier: roundToTwoDecimals(headshotMultiplier * 100),
          armorValue: target.stats[unitStatRoleKeys.armor],
          armorPenetration: actor.stats[unitStatRoleKeys.armorPenetration],
          armorReductionRate: roundToTwoDecimals(armorReductionRate * 100),
          armorMultiplier: roundToTwoDecimals(armorMultiplier * 100),
          elementRelation,
          elementMultiplier: roundToTwoDecimals(elementMultiplier * 100),
          scenarioMultiplier: roundToTwoDecimals(scenarioMultiplier * 100),
          heroClassMultiplier: roundToTwoDecimals(heroClassMultiplier * 100),
          skillTypeMultiplier: roundToTwoDecimals(skillTypeMultiplier * 100),
          skillMultiplier: roundToTwoDecimals(skillMultiplier * 100),
          outputMultiplier: roundToTwoDecimals(outputMultiplier * 100),
          damageTakenMultiplier: roundToTwoDecimals(damageTakenMultiplier * 100),
          finalDamageMultiplier: roundToTwoDecimals(finalDamageMultiplier * 100),
          isMinimumDamageByDefense,
          effectiveAttack,
          effectiveDefense,
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
        : `战斗结束，${input.battle.teamNames[winnerTeamId]}胜利！`,
    payload: {
      winnerTeamId,
      aliveA: aliveA.length,
      aliveB: aliveB.length,
    },
  });

  return {
    randomSeed: random.seed,
    winnerTeamId,
    roundsCompleted,
    events,
    finalUnits: units.map(({ initialOrder, ...unit }) => unit),
  };
}
