import type {
  ActionType,
  ActionResolutionMode,
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
  currentAmmo: number;
  currentRage: number;
  initialOrder: number;
  lastRageUpdateMs: number;
  nextAttackTimeMs: number;
  nextSkillReadyRound: number;
  reloadUntilMs: number | null;
}

interface SeededRandom {
  next(): number;
  seed: number;
}

interface AttackResolutionBase {
  actionType: ActionType;
  actorId: string;
  actorName: string;
  isSkillAction: boolean;
  targetId: string;
  targetMaxHp: number;
  targetName: string;
}

interface AttackMissResolution extends AttackResolutionBase {
  effectiveHitChance: number;
  type: "miss";
}

interface AttackDamageResolution extends AttackResolutionBase {
  armorPenetration: number;
  armorMultiplier: number;
  armorReductionRate: number;
  armorValue: number;
  baseDamage: number;
  criticalMultiplier: number;
  damage: number;
  damageTakenMultiplier: number;
  effectiveAttack: number;
  effectiveDefense: number;
  elementMultiplier: number;
  elementRelation: "advantage" | "disadvantage" | "neutral";
  finalDamageMultiplier: number;
  headshotMultiplier: number;
  heroClassMultiplier: number;
  isCritical: boolean;
  isHeadshot: boolean;
  isMinimumDamageByDefense: boolean;
  outputMultiplier: number;
  scenarioMultiplier: number;
  skillMultiplier: number;
  skillTypeMultiplier: number;
  type: "damage";
}

type AttackResolution = AttackMissResolution | AttackDamageResolution;
type BattleEndReason = "teamEliminated" | "maxRounds" | "maxBattleTimeMs";

interface TimelineWindowContext {
  events: BattleEvent[];
  input: BattleInput;
  random: SeededRandom;
  round: number;
  timelineMs: number;
  units: RuntimeUnit[];
}

type TimelineDriver = (context: TimelineWindowContext) => void;

const EPSILON = 1e-6;
const FIRE_INTERVAL_BASE_MS = 60000;

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

function roundToTwoDecimals(value: number) {
  return Math.round(value * 100) / 100;
}

function roundToFourDecimals(value: number) {
  return Math.round(value * 10000) / 10000;
}

function normalizeTimelineValue(value: number) {
  return roundToFourDecimals(value);
}

function clampRage(value: number) {
  return Math.min(100, Math.max(0, roundToFourDecimals(value)));
}

function clampPercentage(value: number) {
  return Math.min(100, Math.max(0, value));
}

function clampMultiplier(value: number) {
  return Math.max(0, value);
}

function isTimelineReached(current: number, target: number) {
  return current + EPSILON >= target;
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

function getMagazineCapacity(stats: UnitStats) {
  return Math.max(1, Math.trunc(stats[unitStatRoleKeys.magazineCapacity]));
}

function getReloadTimeMs(stats: UnitStats) {
  return Math.max(0, stats[unitStatRoleKeys.reloadTimeMs]);
}

function getFireIntervalMs(stats: UnitStats) {
  return normalizeTimelineValue(FIRE_INTERVAL_BASE_MS / Math.max(1, stats[unitStatRoleKeys.fireRate]));
}

function getSkillCooldownRounds(stats: UnitStats) {
  return Math.max(0, Math.trunc(stats[unitStatRoleKeys.skillCooldownRounds]));
}

function getRageRecoverySpeed(stats: UnitStats) {
  return Math.max(0, stats[unitStatRoleKeys.rageRecoverySpeed]);
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

function cloneUnit(unit: UnitConfig, initialOrder: number, input: BattleInput): RuntimeUnit {
  const usesTimelineRage = input.battle.actionResolutionMode === "arpgSimultaneous";
  return {
    ...unit,
    currentHp: getEffectiveMaxHp(unit.stats),
    isAlive: true,
    currentAmmo: getMagazineCapacity(unit.stats),
    currentRage: usesTimelineRage ? clampRage(input.battle.initialRage) : 0,
    nextAttackTimeMs: 0,
    nextSkillReadyRound: 1,
    reloadUntilMs: null,
    initialOrder,
    lastRageUpdateMs: 0,
  };
}

function cloneRuntimeUnit(unit: RuntimeUnit): RuntimeUnit {
  return {
    ...unit,
    stats: {
      ...unit.stats,
    },
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
  return [...units].sort((left, right) => {
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

function sortSnapshotActionOrder(units: RuntimeUnit[]) {
  return [...units].sort((left, right) => left.initialOrder - right.initialOrder);
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

function createEvent(events: BattleEvent[], event: Omit<BattleEvent, "sequence" | "timeIndex" | "elapsedTimeMs"> & {
  elapsedTimeMs?: number;
}) {
  const elapsedTimeMs =
    typeof event.elapsedTimeMs === "number"
      ? event.elapsedTimeMs
      : typeof event.payload?.timelineMs === "number"
        ? event.payload.timelineMs
        : 0;
  events.push({
    sequence: events.length + 1,
    timeIndex: events.length,
    ...event,
    elapsedTimeMs,
  });
}

function syncRageAtTime(units: RuntimeUnit[], timelineMs: number, actionResolutionMode: ActionResolutionMode) {
  if (actionResolutionMode !== "arpgSimultaneous") {
    return;
  }

  for (const unit of units) {
    if (!unit.isAlive) {
      continue;
    }

    const deltaMs = Math.max(0, timelineMs - unit.lastRageUpdateMs);
    if (deltaMs > 0) {
      unit.currentRage = clampRage(unit.currentRage + (deltaMs * getRageRecoverySpeed(unit.stats)) / 1000);
    }

    unit.lastRageUpdateMs = timelineMs;
  }
}

function getActionType(actionResolutionMode: ActionResolutionMode, actor: RuntimeUnit, round: number): ActionType {
  if (actionResolutionMode === "turnBasedSpeed") {
    return round >= actor.nextSkillReadyRound ? "skill" : "normal";
  }

  return actor.currentRage >= 100 - EPSILON ? "skill" : "normal";
}

function resolveAttack(
  input: BattleInput,
  random: SeededRandom,
  actor: RuntimeUnit,
  target: RuntimeUnit,
  actionType: ActionType,
): AttackResolution {
  const isSkillAction = actionType === "skill";
  const effectiveHitChance = clampPercentage(
    actor.stats[unitStatRoleKeys.hitChance] - target.stats[unitStatRoleKeys.dodgeChance],
  );
  const hitRoll = random.next();
  if (hitRoll >= effectiveHitChance / 100) {
    return {
      actionType,
      actorId: actor.id,
      actorName: actor.name,
      effectiveHitChance,
      isSkillAction,
      targetId: target.id,
      targetMaxHp: getEffectiveMaxHp(target.stats),
      targetName: target.name,
      type: "miss",
    };
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
  const skillMultiplier = isSkillAction ? actor.stats[unitStatRoleKeys.skillMultiplier] / 100 : 1;
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

  return {
    actionType,
    actorId: actor.id,
    actorName: actor.name,
    armorMultiplier,
    armorReductionRate,
    armorPenetration: actor.stats[unitStatRoleKeys.armorPenetration],
    armorValue: target.stats[unitStatRoleKeys.armor],
    baseDamage,
    criticalMultiplier,
    damage,
    damageTakenMultiplier,
    effectiveAttack,
    effectiveDefense,
    elementMultiplier,
    elementRelation,
    finalDamageMultiplier,
    headshotMultiplier,
    heroClassMultiplier,
    isCritical,
    isHeadshot,
    isSkillAction,
    isMinimumDamageByDefense,
    outputMultiplier,
    scenarioMultiplier,
    skillMultiplier,
    skillTypeMultiplier,
    targetId: target.id,
    targetMaxHp: getEffectiveMaxHp(target.stats),
    targetName: target.name,
    type: "damage",
  };
}

function createTurnStartedEvent(
  events: BattleEvent[],
  round: number,
  timelineMs: number,
  actor: RuntimeUnit,
  target: RuntimeUnit,
  actionType: ActionType,
) {
  const isSkillAction = actionType === "skill";
  createEvent(events, {
    type: "turn_started",
    round,
    actorId: actor.id,
    targetId: target.id,
    summary: isSkillAction ? `${actor.name} 对 ${target.name} 释放技能` : `${actor.name} 对 ${target.name} 发起攻击`,
    payload: {
      actionType,
      timelineMs,
      fireRate: roundToTwoDecimals(Math.max(1, actor.stats[unitStatRoleKeys.fireRate])),
      currentAmmo: actor.currentAmmo,
      currentRage: roundToTwoDecimals(actor.currentRage),
      isSkillAction,
      magazineCapacity: getMagazineCapacity(actor.stats),
      nextSkillReadyRound: actor.nextSkillReadyRound,
      skillCooldownRounds: getSkillCooldownRounds(actor.stats),
    },
  });
}

function createAttackMissEvent(
  events: BattleEvent[],
  round: number,
  timelineMs: number,
  resolution: AttackMissResolution,
) {
  createEvent(events, {
    type: "attack_missed",
    round,
    actorId: resolution.actorId,
    targetId: resolution.targetId,
    summary:
      resolution.actionType === "skill"
        ? `${resolution.actorName} 对 ${resolution.targetName} 释放技能，但被闪避或未命中`
        : `${resolution.actorName} 攻击 ${resolution.targetName}，但被闪避或未命中`,
    payload: {
      actionType: resolution.actionType,
      timelineMs,
      hitChance: resolution.effectiveHitChance,
      isSkillAction: resolution.isSkillAction,
    },
  });
}

function createDamageAppliedEvent(
  events: BattleEvent[],
  round: number,
  timelineMs: number,
  resolution: AttackDamageResolution,
  targetCurrentHp: number,
) {
  const damageTags = `${resolution.isHeadshot ? "爆头" : ""}${resolution.isCritical ? "暴击" : ""}`;

  createEvent(events, {
    type: "damage_applied",
    round,
    actorId: resolution.actorId,
    targetId: resolution.targetId,
    summary:
      `${resolution.actorName} ${resolution.actionType === "skill" ? "释放技能攻击" : "攻击"} ${resolution.targetName}，` +
      `造成 ${resolution.damage} 点${damageTags}伤害，目标剩余 ${targetCurrentHp}/${resolution.targetMaxHp} HP` +
      `${resolution.isMinimumDamageByDefense ? "（不破防）" : ""}`,
    payload: {
      actionType: resolution.actionType,
      timelineMs,
      damage: resolution.damage,
      baseDamage: resolution.baseDamage,
      targetHp: targetCurrentHp,
      targetMaxHp: resolution.targetMaxHp,
      isCritical: resolution.isCritical,
      criticalMultiplier: roundToTwoDecimals(resolution.criticalMultiplier * 100),
      isHeadshot: resolution.isHeadshot,
      headshotMultiplier: roundToTwoDecimals(resolution.headshotMultiplier * 100),
      armorValue: resolution.armorValue,
      armorPenetration: resolution.armorPenetration,
      armorReductionRate: roundToTwoDecimals(resolution.armorReductionRate * 100),
      armorMultiplier: roundToTwoDecimals(resolution.armorMultiplier * 100),
      elementRelation: resolution.elementRelation,
      elementMultiplier: roundToTwoDecimals(resolution.elementMultiplier * 100),
      scenarioMultiplier: roundToTwoDecimals(resolution.scenarioMultiplier * 100),
      heroClassMultiplier: roundToTwoDecimals(resolution.heroClassMultiplier * 100),
      skillTypeMultiplier: roundToTwoDecimals(resolution.skillTypeMultiplier * 100),
      skillMultiplier: roundToTwoDecimals(resolution.skillMultiplier * 100),
      outputMultiplier: roundToTwoDecimals(resolution.outputMultiplier * 100),
      damageTakenMultiplier: roundToTwoDecimals(resolution.damageTakenMultiplier * 100),
      finalDamageMultiplier: roundToTwoDecimals(resolution.finalDamageMultiplier * 100),
      isMinimumDamageByDefense: resolution.isMinimumDamageByDefense,
      isSkillAction: resolution.isSkillAction,
      effectiveAttack: resolution.effectiveAttack,
      effectiveDefense: resolution.effectiveDefense,
    },
  });
}

function createReloadStartedEvent(events: BattleEvent[], round: number, timelineMs: number, actor: RuntimeUnit) {
  createEvent(events, {
    type: "reload_started",
    round,
    actorId: actor.id,
    summary: `${actor.name} 开始换弹`,
    payload: {
      timelineMs,
      fireRate: roundToTwoDecimals(Math.max(1, actor.stats[unitStatRoleKeys.fireRate])),
      currentAmmo: actor.currentAmmo,
      magazineCapacity: getMagazineCapacity(actor.stats),
      reloadTimeMs: roundToTwoDecimals(getReloadTimeMs(actor.stats)),
      reloadUntilMs: actor.reloadUntilMs,
      nextAttackTimeMs: actor.nextAttackTimeMs,
    },
  });
}

function createReloadCompletedEvent(events: BattleEvent[], round: number, timelineMs: number, actor: RuntimeUnit) {
  createEvent(events, {
    type: "reload_completed",
    round,
    actorId: actor.id,
    summary: `${actor.name} 完成换弹，弹匣恢复至 ${actor.currentAmmo} 发`,
    payload: {
      timelineMs,
      fireRate: roundToTwoDecimals(Math.max(1, actor.stats[unitStatRoleKeys.fireRate])),
      currentAmmo: actor.currentAmmo,
      magazineCapacity: getMagazineCapacity(actor.stats),
      nextAttackTimeMs: actor.nextAttackTimeMs,
    },
  });
}

function createUnitDefeatedEvent(
  events: BattleEvent[],
  round: number,
  timelineMs: number,
  target: RuntimeUnit,
  actorId?: string,
) {
  createEvent(events, {
    type: "unit_defeated",
    round,
    actorId,
    targetId: target.id,
    summary: `${target.name} 被击败`,
    payload: {
      timelineMs,
      targetHp: target.currentHp,
    },
  });
}

function getNextTimelineTime(units: RuntimeUnit[]) {
  let nextTimeline: number | null = null;

  for (const unit of units) {
    if (!unit.isAlive) {
      continue;
    }

    const candidate =
      unit.currentAmmo <= 0 && unit.reloadUntilMs !== null
        ? unit.reloadUntilMs
        : unit.nextAttackTimeMs;

    if (nextTimeline === null || candidate < nextTimeline - EPSILON) {
      nextTimeline = candidate;
    }
  }

  return nextTimeline === null ? null : normalizeTimelineValue(nextTimeline);
}

function completeReloadsAtTime(
  units: RuntimeUnit[],
  events: BattleEvent[],
  round: number,
  timelineMs: number,
) {
  const reloadingUnits = units
    .filter(
      (unit) =>
        unit.isAlive &&
        unit.currentAmmo <= 0 &&
        unit.reloadUntilMs !== null &&
        isTimelineReached(timelineMs, unit.reloadUntilMs),
    )
    .sort((left, right) => left.initialOrder - right.initialOrder);

  for (const unit of reloadingUnits) {
    unit.currentAmmo = getMagazineCapacity(unit.stats);
    unit.reloadUntilMs = null;
    createReloadCompletedEvent(events, round, timelineMs, unit);
  }
}

function getReadyAttackUnitsAtTime(units: RuntimeUnit[], timelineMs: number) {
  return units.filter(
    (unit) => unit.isAlive && unit.currentAmmo > 0 && isTimelineReached(timelineMs, unit.nextAttackTimeMs),
  );
}

function consumeAmmoAndSchedule(
  actor: RuntimeUnit,
  actionResolutionMode: ActionResolutionMode,
  timelineMs: number,
  events: BattleEvent[],
  round: number,
  emitReloadStartedEvent: boolean,
  actionType: ActionType,
) {
  actor.nextAttackTimeMs = normalizeTimelineValue(timelineMs + getFireIntervalMs(actor.stats));

  if (actionType === "skill") {
    if (actionResolutionMode === "turnBasedSpeed") {
      actor.nextSkillReadyRound = round + getSkillCooldownRounds(actor.stats) + 1;
    } else {
      actor.currentRage = 0;
      actor.lastRageUpdateMs = timelineMs;
    }
    actor.reloadUntilMs = null;
    return;
  }

  actor.currentAmmo = Math.max(0, actor.currentAmmo - 1);

  if (actor.currentAmmo > 0) {
    actor.reloadUntilMs = null;
    return;
  }

  actor.reloadUntilMs = normalizeTimelineValue(timelineMs + getReloadTimeMs(actor.stats));
  if (emitReloadStartedEvent) {
    createReloadStartedEvent(events, round, timelineMs, actor);
  }
}

function runTurnBasedTimelineWindow({
  events,
  input,
  random,
  round,
  timelineMs,
  units,
}: TimelineWindowContext) {
  const turnOrder = sortTurnOrder(getReadyAttackUnitsAtTime(units, timelineMs));

  for (const turnUnit of turnOrder) {
    const actor = units.find((unit) => unit.id === turnUnit.id) ?? null;
    if (!actor || !actor.isAlive || actor.currentAmmo <= 0 || !isTimelineReached(timelineMs, actor.nextAttackTimeMs)) {
      continue;
    }

    const target = pickTarget(units, actor, input.battle.targetingStrategy);
    if (!target) {
      break;
    }

    const actionType = getActionType(input.battle.actionResolutionMode, actor, round);
    createTurnStartedEvent(events, round, timelineMs, actor, target, actionType);
    const resolution = resolveAttack(input, random, actor, target, actionType);

    if (resolution.type === "miss") {
      createAttackMissEvent(events, round, timelineMs, resolution);
      consumeAmmoAndSchedule(actor, input.battle.actionResolutionMode, timelineMs, events, round, true, actionType);
      continue;
    }

    target.currentHp = Math.max(0, target.currentHp - resolution.damage);
    target.isAlive = target.currentHp > 0;
    createDamageAppliedEvent(events, round, timelineMs, resolution, target.currentHp);

    if (!target.isAlive) {
      createUnitDefeatedEvent(events, round, timelineMs, target, resolution.actorId);
    }

    consumeAmmoAndSchedule(actor, input.battle.actionResolutionMode, timelineMs, events, round, true, actionType);

    const remainingEnemies = getAliveUnitsByTeam(units, getOpponentTeamId(actor.teamId));
    if (remainingEnemies.length === 0) {
      break;
    }
  }
}

function runSimultaneousTimelineWindow({
  events,
  input,
  random,
  round,
  timelineMs,
  units,
}: TimelineWindowContext) {
  const snapshotUnits = units.map(cloneRuntimeUnit);
  const actionOrder = sortSnapshotActionOrder(getReadyAttackUnitsAtTime(snapshotUnits, timelineMs));
  const resolutions: AttackResolution[] = [];

  for (const actor of actionOrder) {
    const target = pickTarget(snapshotUnits, actor, input.battle.targetingStrategy);
    if (!target) {
      continue;
    }

    const actionType = getActionType(input.battle.actionResolutionMode, actor, round);
    createTurnStartedEvent(events, round, timelineMs, actor, target, actionType);
    resolutions.push(resolveAttack(input, random, actor, target, actionType));
  }

  const defeatedIds = new Set<string>();
  const defeatedOrder: string[] = [];

  for (const resolution of resolutions) {
    if (resolution.type === "miss") {
      createAttackMissEvent(events, round, timelineMs, resolution);
      continue;
    }

    const target = units.find((unit) => unit.id === resolution.targetId);
    if (!target) {
      continue;
    }

    target.currentHp = Math.max(0, target.currentHp - resolution.damage);
    target.isAlive = target.currentHp > 0;
    createDamageAppliedEvent(events, round, timelineMs, resolution, target.currentHp);

    if (!target.isAlive && !defeatedIds.has(target.id)) {
      defeatedIds.add(target.id);
      defeatedOrder.push(target.id);
    }
  }

  for (const targetId of defeatedOrder) {
    const target = units.find((unit) => unit.id === targetId);
    if (!target) {
      continue;
    }

    createUnitDefeatedEvent(events, round, timelineMs, target);
  }

  for (const actor of actionOrder) {
    const actualActor = units.find((unit) => unit.id === actor.id);
    if (!actualActor) {
      continue;
    }

    const actionType = getActionType(input.battle.actionResolutionMode, actor, round);
    consumeAmmoAndSchedule(
      actualActor,
      input.battle.actionResolutionMode,
      timelineMs,
      events,
      round,
      actualActor.isAlive,
      actionType,
    );
  }
}

const timelineDrivers: Record<ActionResolutionMode, TimelineDriver> = {
  arpgSimultaneous: runSimultaneousTimelineWindow,
  turnBasedSpeed: runTurnBasedTimelineWindow,
};

export function simulateBattle(input: BattleInput): BattleSimulationResult {
  const units = input.units.map((unit, index) => cloneUnit(unit, index, input));
  const events: BattleEvent[] = [];
  let roundsCompleted = 0;
  let lastTimelineMs = 0;
  let endReason: BattleEndReason = "teamEliminated";
  const random = createSeededRandom(input.battle.randomSeed);

  createEvent(events, {
    type: "battle_started",
    round: 0,
    summary: `${input.battle.teamNames.A} 与 ${input.battle.teamNames.B} 的战斗开始`,
    payload: {
      actionResolutionMode: input.battle.actionResolutionMode,
      initialRage: input.battle.initialRage,
      maxBattleTimeMs: input.battle.maxBattleTimeMs,
      maxRounds: input.battle.maxRounds,
      timelineMs: 0,
      unitCount: units.length,
    },
  });

  while (roundsCompleted < input.battle.maxRounds) {
    const teamAAlive = getAliveUnitsByTeam(units, "A");
    const teamBAlive = getAliveUnitsByTeam(units, "B");
    if (teamAAlive.length === 0 || teamBAlive.length === 0) {
      endReason = "teamEliminated";
      break;
    }

    const timelineMs = getNextTimelineTime(units);
    if (timelineMs === null) {
      endReason = "teamEliminated";
      break;
    }

    if (timelineMs > input.battle.maxBattleTimeMs) {
      endReason = "maxBattleTimeMs";
      break;
    }

    roundsCompleted += 1;
    lastTimelineMs = timelineMs;
    syncRageAtTime(units, timelineMs, input.battle.actionResolutionMode);

    createEvent(events, {
      type: "round_started",
      round: roundsCompleted,
      summary: `第 ${roundsCompleted} 轮开始`,
      payload: {
        actionResolutionMode: input.battle.actionResolutionMode,
        aliveA: teamAAlive.length,
        aliveB: teamBAlive.length,
        timelineMs,
      },
    });

    completeReloadsAtTime(units, events, roundsCompleted, timelineMs);
    timelineDrivers[input.battle.actionResolutionMode]({
      events,
      input,
      random,
      round: roundsCompleted,
      timelineMs,
      units,
    });
  }

  const aliveA = getAliveUnitsByTeam(units, "A");
  const aliveB = getAliveUnitsByTeam(units, "B");
  const winnerTeamId = aliveA.length > 0 && aliveB.length === 0 ? "A" : aliveB.length > 0 && aliveA.length === 0 ? "B" : null;
  if (winnerTeamId === null && endReason !== "maxBattleTimeMs") {
    endReason = roundsCompleted >= input.battle.maxRounds ? "maxRounds" : "teamEliminated";
  }

  createEvent(events, {
    type: "battle_ended",
    round: roundsCompleted,
    summary:
      winnerTeamId === null
        ? endReason === "maxBattleTimeMs"
          ? "战斗结束，达到最大战斗时长，结果按平局处理"
          : endReason === "maxRounds"
            ? "战斗结束，达到最大回合数，结果按平局处理"
            : "战斗结束，结果为平局"
        : `战斗结束，${input.battle.teamNames[winnerTeamId]}胜利！`,
    payload: {
      actionResolutionMode: input.battle.actionResolutionMode,
      winnerTeamId,
      aliveA: aliveA.length,
      aliveB: aliveB.length,
      endReason,
      maxBattleTimeMs: input.battle.maxBattleTimeMs,
      timelineMs: lastTimelineMs,
    },
  });

  return {
    randomSeed: random.seed,
    winnerTeamId,
    roundsCompleted,
    events,
    finalUnits: units.map(({ initialOrder, lastRageUpdateMs, ...unit }) => unit),
  };
}
