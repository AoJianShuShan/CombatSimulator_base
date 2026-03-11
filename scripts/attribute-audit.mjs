import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildProject } from "./build.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const backendBaseUrl = (process.env.BACKEND_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");

await buildProject();

const simulatorModuleUrl = pathToFileURL(path.join(rootDir, "dist", "simulator", "simulateBattle.js")).href;
const attributeMacroModuleUrl = pathToFileURL(path.join(rootDir, "dist", "domain", "attributeMacros.js")).href;
const battleConfigMacroModuleUrl = pathToFileURL(path.join(rootDir, "dist", "domain", "battleConfigMacros.js")).href;
const validationModuleUrl = pathToFileURL(path.join(rootDir, "dist", "domain", "validation.js")).href;

const { simulateBattle } = await import(simulatorModuleUrl);
const { createDefaultUnitStats, unitAttributeMacros, unitStatRoleKeys } = await import(attributeMacroModuleUrl);
const { battleNumberDefaults, battleConfigNumberMacros } = await import(battleConfigMacroModuleUrl);
const { validateBattleInput } = await import(validationModuleUrl);

const ACTOR_ID = "A-1";
const TARGET_ID = "B-1";
const unitLabelMap = {
  [ACTOR_ID]: "红方测试单位",
  [TARGET_ID]: "蓝方测试单位",
};

const attackElementAdvantageMap = {
  physical: "heatArmor",
  fire: "insulatedArmor",
  electromagnetic: "bioArmor",
  corrosive: "heavyArmor",
};

const attackElementDisadvantageMap = {
  physical: "heavyArmor",
  fire: "heatArmor",
  electromagnetic: "insulatedArmor",
  corrosive: "bioArmor",
};

function roundHalfUp(value) {
  return Math.floor(value + 0.5);
}

function roundToFour(value) {
  return Math.round(value * 10000) / 10000;
}

function clampPercentage(value) {
  return Math.min(100, Math.max(0, value));
}

function clampMultiplier(value) {
  return Math.max(0, value);
}

function getScaledStat(baseValue, rate) {
  return Math.max(0, roundHalfUp(baseValue * (1 + rate / 100)));
}

function getEffectiveMaxHp(stats) {
  return Math.max(1, getScaledStat(stats[unitStatRoleKeys.maxHpBase], stats[unitStatRoleKeys.maxHpRate]));
}

function getEffectiveAttack(stats) {
  return getScaledStat(stats[unitStatRoleKeys.attackBase], stats[unitStatRoleKeys.attackRate]);
}

function getEffectiveDefense(stats) {
  return getScaledStat(stats[unitStatRoleKeys.defenseBase], stats[unitStatRoleKeys.defenseRate]);
}

function getArmorReductionRate(input, actor, target) {
  const armorGap = Math.max(0, target.stats[unitStatRoleKeys.armor] - actor.stats[unitStatRoleKeys.armorPenetration]);
  if (armorGap <= 0) {
    return 0;
  }

  const denominator = Math.max(0, input.battle.armorFormulaBase) + armorGap;
  if (denominator <= 0) {
    return 0;
  }

  return Math.min(clampPercentage(input.battle.maxArmorDamageReduction) / 100, armorGap / denominator);
}

function getElementRelation(input, actor, target) {
  if (actor.attackElement === "none" || target.protectionType === "none") {
    return { relation: "neutral", multiplier: 1 };
  }

  if (attackElementAdvantageMap[actor.attackElement] === target.protectionType) {
    return { relation: "advantage", multiplier: input.battle.elementAdvantageDamageRate / 100 };
  }

  if (attackElementDisadvantageMap[actor.attackElement] === target.protectionType) {
    return { relation: "disadvantage", multiplier: input.battle.elementDisadvantageDamageRate / 100 };
  }

  return { relation: "neutral", multiplier: 1 };
}

function compareByInitialTargetPriority(left, right) {
  const priorityMap = { front: 0, middle: 1, back: 2 };
  const leftPriority = priorityMap[left.position];
  const rightPriority = priorityMap[right.position];
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  return left.initialOrder - right.initialOrder;
}

function sortTurnOrder(units) {
  return [...units]
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

function getActionOrder(units, actionResolutionMode) {
  if (actionResolutionMode === "arpgSimultaneous") {
    return [...units].sort((left, right) => left.initialOrder - right.initialOrder);
  }

  return sortTurnOrder(units);
}

function pickTarget(units, actor, targetingStrategy) {
  const targets = units.filter((unit) => unit.teamId !== actor.teamId);
  if (targets.length === 0) {
    return null;
  }

  if (targetingStrategy === "lowestHp") {
    return [...targets].sort((left, right) => {
      const leftHp = getEffectiveMaxHp(left.stats);
      const rightHp = getEffectiveMaxHp(right.stats);
      if (leftHp !== rightHp) {
        return leftHp - rightHp;
      }

      return compareByInitialTargetPriority(left, right);
    })[0];
  }

  if (targetingStrategy === "highestAttack") {
    return [...targets].sort((left, right) => {
      const leftAttack = getEffectiveAttack(left.stats);
      const rightAttack = getEffectiveAttack(right.stats);
      if (leftAttack !== rightAttack) {
        return rightAttack - leftAttack;
      }

      return compareByInitialTargetPriority(left, right);
    })[0];
  }

  return [...targets].sort(compareByInitialTargetPriority)[0];
}

function createBaseInput({ actor = {}, actorStats = {}, battle = {}, target = {}, targetStats = {} } = {}) {
  return {
    battle: {
      ...battleNumberDefaults,
      maxRounds: 1,
      minimumDamage: 1,
      randomSeed: 20260310,
      targetingStrategy: "front",
      actionResolutionMode: "turnBasedSpeed",
      armorFormulaBase: 200,
      maxArmorDamageReduction: 75,
      elementAdvantageDamageRate: 120,
      elementDisadvantageDamageRate: 80,
      teamNames: {
        A: "红队",
        B: "蓝队",
      },
      ...battle,
    },
    units: [
      {
        id: ACTOR_ID,
        teamId: "A",
        name: unitLabelMap[ACTOR_ID],
        position: "front",
        attackElement: "none",
        protectionType: "none",
        stats: {
          ...createDefaultUnitStats(),
          maxHp: 100,
          maxHpRate: 0,
          attack: 40,
          attackRate: 0,
          defense: 10,
          defenseRate: 0,
          speed: 10,
          critChance: 0,
          critMultiplier: 150,
          hitChance: 100,
          dodgeChance: 0,
          armor: 0,
          armorPenetration: 0,
          headshotChance: 0,
          headshotMultiplier: 200,
          scenarioDamageBonus: 0,
          heroClassDamageBonus: 0,
          skillTypeDamageBonus: 0,
          finalDamageBonus: 0,
          finalDamageReduction: 0,
          skillMultiplier: 100,
          outputAmplify: 0,
          outputDecay: 0,
          damageTakenAmplify: 0,
          damageTakenReduction: 0,
          ...actorStats,
        },
        ...actor,
      },
      {
        id: TARGET_ID,
        teamId: "B",
        name: unitLabelMap[TARGET_ID],
        position: "front",
        attackElement: "none",
        protectionType: "none",
        stats: {
          ...createDefaultUnitStats(),
          maxHp: 100,
          maxHpRate: 0,
          attack: 20,
          attackRate: 0,
          defense: 10,
          defenseRate: 0,
          speed: 1,
          critChance: 0,
          critMultiplier: 150,
          hitChance: 100,
          dodgeChance: 0,
          armor: 0,
          armorPenetration: 0,
          headshotChance: 0,
          headshotMultiplier: 200,
          scenarioDamageBonus: 0,
          heroClassDamageBonus: 0,
          skillTypeDamageBonus: 0,
          finalDamageBonus: 0,
          finalDamageReduction: 0,
          skillMultiplier: 100,
          outputAmplify: 0,
          outputDecay: 0,
          damageTakenAmplify: 0,
          damageTakenReduction: 0,
          ...targetStats,
        },
        ...target,
      },
    ],
  };
}

function formatRatioPercent(value) {
  if (value == null) {
    return "-";
  }

  const percentValue = roundToFour(value * 100);
  return `${Number.isInteger(percentValue) ? percentValue : percentValue.toFixed(2).replace(/\.?0+$/, "")}%`;
}

function formatPercent(value) {
  if (value == null) {
    return "-";
  }

  return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/\.?0+$/, "")}%`;
}

function formatValue(value) {
  if (value == null) {
    return "-";
  }

  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }

  return `${value}`;
}

function formatMetrics(metrics) {
  return Object.entries(metrics)
    .map(([key, value]) => `${key}: ${formatValue(value)}`)
    .join(" | ");
}

function computeExpectedFirstAction(input) {
  const runtimeUnits = input.units.map((unit, initialOrder) => ({ ...structuredClone(unit), initialOrder }));
  const turnOrder = getActionOrder(runtimeUnits, input.battle.actionResolutionMode);
  const actor = turnOrder[0] ?? null;
  const target = actor ? pickTarget(runtimeUnits, actor, input.battle.targetingStrategy) : null;
  const focusActorTurnIndex = turnOrder.findIndex((unit) => unit.id === ACTOR_ID);

  if (!actor || !target) {
    return {
      firstTurnActorId: actor?.id ?? null,
      focusActorTurnIndex: focusActorTurnIndex >= 0 ? focusActorTurnIndex + 1 : null,
      outcome: "无结果",
    };
  }

  const effectiveHitChance = clampPercentage(actor.stats[unitStatRoleKeys.hitChance] - target.stats[unitStatRoleKeys.dodgeChance]);
  const hitDeterministic = effectiveHitChance <= 0 ? false : effectiveHitChance >= 100 ? true : null;

  const critChanceClamped = clampPercentage(actor.stats[unitStatRoleKeys.critChance]);
  const headshotChanceClamped = clampPercentage(actor.stats[unitStatRoleKeys.headshotChance]);
  const isCritical = hitDeterministic === false ? false : critChanceClamped <= 0 ? false : critChanceClamped >= 100 ? true : null;
  const isHeadshot = hitDeterministic === false ? false : headshotChanceClamped <= 0 ? false : headshotChanceClamped >= 100 ? true : null;

  const effectiveAttack = getEffectiveAttack(actor.stats);
  const effectiveDefense = getEffectiveDefense(target.stats);
  const baseDamage = Math.max(input.battle.minimumDamage, effectiveAttack - effectiveDefense);
  const armorReductionRate = getArmorReductionRate(input, actor, target);
  const { relation: elementRelation, multiplier: elementMultiplier } = getElementRelation(input, actor, target);
  const criticalMultiplier = isCritical ? actor.stats[unitStatRoleKeys.critMultiplier] / 100 : 1;
  const headshotMultiplier = isHeadshot ? actor.stats[unitStatRoleKeys.headshotMultiplier] / 100 : 1;
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
    (1 - armorReductionRate) *
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
  const damage = hitDeterministic
    ? Math.max(input.battle.minimumDamage, roundHalfUp(damageBeforeRound))
    : null;
  const targetMaxHp = getEffectiveMaxHp(target.stats);
  const targetHpAfter = damage == null ? null : Math.max(0, targetMaxHp - damage);

  return {
    armorGap: Math.max(0, target.stats[unitStatRoleKeys.armor] - actor.stats[unitStatRoleKeys.armorPenetration]),
    armorReductionRate,
    baseDamage,
    criticalMultiplier,
    damage,
    damageBeforeRound,
    damageTakenMultiplier,
    effectiveAttack,
    effectiveDefense,
    effectiveHitChance,
    elementMultiplier,
    elementRelation,
    finalDamageMultiplier,
    firstTurnActorId: actor.id,
    focusActorTurnIndex: focusActorTurnIndex >= 0 ? focusActorTurnIndex + 1 : null,
    headshotMultiplier,
    heroClassMultiplier,
    isCritical,
    isHeadshot,
    isMinimumDamageByDefense: effectiveAttack - effectiveDefense < input.battle.minimumDamage,
    outcome: hitDeterministic === false ? "未命中" : hitDeterministic === true ? "命中" : "不确定",
    outputMultiplier,
    scenarioMultiplier,
    skillMultiplier,
    skillTypeMultiplier,
    targetHpAfter,
    targetMaxHp,
  };
}

function collectActualFirstAction(input, result) {
  const expected = computeExpectedFirstAction(input);
  const turnEvents = result.events.filter((event) => event.type === "turn_started");
  const firstResolutionEvent =
    result.events.find((event) => event.type === "attack_missed" || event.type === "damage_applied") ?? null;
  const missEvent = firstResolutionEvent?.type === "attack_missed" ? firstResolutionEvent : null;
  const damageEvent = firstResolutionEvent?.type === "damage_applied" ? firstResolutionEvent : null;
  const focusActorTurnIndex = turnEvents.findIndex((event) => event.actorId === ACTOR_ID);

  return {
    ...expected,
    armorReductionRate:
      typeof damageEvent?.payload?.armorReductionRate === "number"
        ? damageEvent.payload.armorReductionRate / 100
        : expected.armorReductionRate,
    baseDamage: typeof damageEvent?.payload?.baseDamage === "number" ? damageEvent.payload.baseDamage : expected.baseDamage,
    criticalMultiplier:
      typeof damageEvent?.payload?.criticalMultiplier === "number"
        ? damageEvent.payload.criticalMultiplier / 100
        : expected.criticalMultiplier,
    damage: typeof damageEvent?.payload?.damage === "number" ? damageEvent.payload.damage : expected.damage,
    damageTakenMultiplier:
      typeof damageEvent?.payload?.damageTakenMultiplier === "number"
        ? damageEvent.payload.damageTakenMultiplier / 100
        : expected.damageTakenMultiplier,
    effectiveAttack:
      typeof damageEvent?.payload?.effectiveAttack === "number"
        ? damageEvent.payload.effectiveAttack
        : expected.effectiveAttack,
    effectiveDefense:
      typeof damageEvent?.payload?.effectiveDefense === "number"
        ? damageEvent.payload.effectiveDefense
        : expected.effectiveDefense,
    effectiveHitChance:
      typeof missEvent?.payload?.hitChance === "number" ? missEvent.payload.hitChance : expected.effectiveHitChance,
    elementMultiplier:
      typeof damageEvent?.payload?.elementMultiplier === "number"
        ? damageEvent.payload.elementMultiplier / 100
        : expected.elementMultiplier,
    elementRelation:
      typeof damageEvent?.payload?.elementRelation === "string" ? damageEvent.payload.elementRelation : expected.elementRelation,
    finalDamageMultiplier:
      typeof damageEvent?.payload?.finalDamageMultiplier === "number"
        ? damageEvent.payload.finalDamageMultiplier / 100
        : expected.finalDamageMultiplier,
    firstTurnActorId: turnEvents[0]?.actorId ?? expected.firstTurnActorId,
    focusActorTurnIndex: focusActorTurnIndex >= 0 ? focusActorTurnIndex + 1 : expected.focusActorTurnIndex,
    headshotMultiplier:
      typeof damageEvent?.payload?.headshotMultiplier === "number"
        ? damageEvent.payload.headshotMultiplier / 100
        : expected.headshotMultiplier,
    heroClassMultiplier:
      typeof damageEvent?.payload?.heroClassMultiplier === "number"
        ? damageEvent.payload.heroClassMultiplier / 100
        : expected.heroClassMultiplier,
    isCritical:
      typeof damageEvent?.payload?.isCritical === "boolean" ? damageEvent.payload.isCritical : expected.isCritical,
    isHeadshot:
      typeof damageEvent?.payload?.isHeadshot === "boolean" ? damageEvent.payload.isHeadshot : expected.isHeadshot,
    isMinimumDamageByDefense:
      typeof damageEvent?.payload?.isMinimumDamageByDefense === "boolean"
        ? damageEvent.payload.isMinimumDamageByDefense
        : expected.isMinimumDamageByDefense,
    outcome: damageEvent ? "命中" : missEvent ? "未命中" : "无结果",
    outputMultiplier:
      typeof damageEvent?.payload?.outputMultiplier === "number"
        ? damageEvent.payload.outputMultiplier / 100
        : expected.outputMultiplier,
    scenarioMultiplier:
      typeof damageEvent?.payload?.scenarioMultiplier === "number"
        ? damageEvent.payload.scenarioMultiplier / 100
        : expected.scenarioMultiplier,
    skillMultiplier:
      typeof damageEvent?.payload?.skillMultiplier === "number"
        ? damageEvent.payload.skillMultiplier / 100
        : expected.skillMultiplier,
    skillTypeMultiplier:
      typeof damageEvent?.payload?.skillTypeMultiplier === "number"
        ? damageEvent.payload.skillTypeMultiplier / 100
        : expected.skillTypeMultiplier,
    targetHpAfter:
      typeof damageEvent?.payload?.targetHp === "number" ? damageEvent.payload.targetHp : expected.targetHpAfter,
    targetMaxHp:
      typeof damageEvent?.payload?.targetMaxHp === "number" ? damageEvent.payload.targetMaxHp : expected.targetMaxHp,
  };
}

function normalizeForComparison(snapshot) {
  return {
    armorGap: snapshot.armorGap ?? null,
    armorReductionRate: snapshot.armorReductionRate == null ? null : roundToFour(snapshot.armorReductionRate),
    baseDamage: snapshot.baseDamage ?? null,
    criticalMultiplier: snapshot.criticalMultiplier == null ? null : roundToFour(snapshot.criticalMultiplier),
    damage: snapshot.damage ?? null,
    damageTakenMultiplier: snapshot.damageTakenMultiplier == null ? null : roundToFour(snapshot.damageTakenMultiplier),
    effectiveAttack: snapshot.effectiveAttack ?? null,
    effectiveDefense: snapshot.effectiveDefense ?? null,
    effectiveHitChance: snapshot.effectiveHitChance ?? null,
    elementMultiplier: snapshot.elementMultiplier == null ? null : roundToFour(snapshot.elementMultiplier),
    elementRelation: snapshot.elementRelation ?? null,
    finalDamageMultiplier: snapshot.finalDamageMultiplier == null ? null : roundToFour(snapshot.finalDamageMultiplier),
    firstTurnActorId: snapshot.firstTurnActorId ?? null,
    focusActorTurnIndex: snapshot.focusActorTurnIndex ?? null,
    headshotMultiplier: snapshot.headshotMultiplier == null ? null : roundToFour(snapshot.headshotMultiplier),
    heroClassMultiplier: snapshot.heroClassMultiplier == null ? null : roundToFour(snapshot.heroClassMultiplier),
    isCritical: snapshot.isCritical ?? null,
    isHeadshot: snapshot.isHeadshot ?? null,
    isMinimumDamageByDefense: snapshot.isMinimumDamageByDefense ?? null,
    outcome: snapshot.outcome ?? null,
    outputMultiplier: snapshot.outputMultiplier == null ? null : roundToFour(snapshot.outputMultiplier),
    scenarioMultiplier: snapshot.scenarioMultiplier == null ? null : roundToFour(snapshot.scenarioMultiplier),
    skillMultiplier: snapshot.skillMultiplier == null ? null : roundToFour(snapshot.skillMultiplier),
    skillTypeMultiplier: snapshot.skillTypeMultiplier == null ? null : roundToFour(snapshot.skillTypeMultiplier),
    targetHpAfter: snapshot.targetHpAfter ?? null,
    targetMaxHp: snapshot.targetMaxHp ?? null,
  };
}

async function checkBackendAvailability() {
  try {
    const response = await fetch(`${backendBaseUrl}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function simulateByBackend(input) {
  const response = await fetch(`${backendBaseUrl}/simulate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message ?? `HTTP ${response.status}`);
  }

  return response.json();
}

function makeStatCase({
  after,
  actor = {},
  actorStats = {},
  before,
  battle = {},
  expect,
  inspect,
  key,
  label,
  side,
  target = {},
  targetStats = {},
}) {
  return {
    after,
    before,
    buildInput(value) {
      return createBaseInput({
        actor,
        actorStats: side === "actor" ? { ...actorStats, [key]: value } : actorStats,
        battle,
        target,
        targetStats: side === "target" ? { ...targetStats, [key]: value } : targetStats,
      });
    },
    expect,
    inspect,
    key,
    label,
  };
}

const inspectHp = (snapshot) => ({
  有效生命: snapshot.targetMaxHp,
  首次受击后生命: snapshot.targetHpAfter == null ? "-" : `${snapshot.targetHpAfter}/${snapshot.targetMaxHp}`,
});

const inspectAttack = (snapshot) => ({
  有效攻击: snapshot.effectiveAttack,
  基础伤害: snapshot.baseDamage,
  实际伤害: snapshot.damage,
});

const inspectDefense = (snapshot) => ({
  有效防御: snapshot.effectiveDefense,
  基础伤害: snapshot.baseDamage,
  实际伤害: snapshot.damage,
  不破防: snapshot.isMinimumDamageByDefense,
});

const inspectSpeed = (snapshot) => ({
  首个行动者: unitLabelMap[snapshot.firstTurnActorId] ?? snapshot.firstTurnActorId,
  红方出手顺位: snapshot.focusActorTurnIndex,
  首次结果: snapshot.outcome,
});

const inspectCrit = (snapshot) => ({
  是否暴击: snapshot.isCritical,
  暴击倍率: formatRatioPercent(snapshot.criticalMultiplier),
  实际伤害: snapshot.damage,
});

const inspectHit = (snapshot) => ({
  有效命中率: formatPercent(snapshot.effectiveHitChance),
  首次结果: snapshot.outcome,
});

const inspectArmor = (snapshot) => ({
  护甲差值: snapshot.armorGap,
  护甲减伤: formatRatioPercent(snapshot.armorReductionRate),
  实际伤害: snapshot.damage,
});

const inspectHeadshot = (snapshot) => ({
  是否爆头: snapshot.isHeadshot,
  爆头倍率: formatRatioPercent(snapshot.headshotMultiplier),
  实际伤害: snapshot.damage,
});

const inspectScenario = (snapshot) => ({
  玩法场景乘区: formatRatioPercent(snapshot.scenarioMultiplier),
  实际伤害: snapshot.damage,
});

const inspectHero = (snapshot) => ({
  英雄职业乘区: formatRatioPercent(snapshot.heroClassMultiplier),
  实际伤害: snapshot.damage,
});

const inspectSkillType = (snapshot) => ({
  技能类型乘区: formatRatioPercent(snapshot.skillTypeMultiplier),
  实际伤害: snapshot.damage,
});

const inspectFinal = (snapshot) => ({
  最终乘区: formatRatioPercent(snapshot.finalDamageMultiplier),
  实际伤害: snapshot.damage,
});

const inspectSkillMultiplier = (snapshot) => ({
  技能倍率乘区: formatRatioPercent(snapshot.skillMultiplier),
  实际伤害: snapshot.damage,
});

const inspectOutput = (snapshot) => ({
  输出乘区: formatRatioPercent(snapshot.outputMultiplier),
  实际伤害: snapshot.damage,
});

const inspectDamageTaken = (snapshot) => ({
  承伤乘区: formatRatioPercent(snapshot.damageTakenMultiplier),
  实际伤害: snapshot.damage,
});

const auditCases = [
  makeStatCase({ key: "maxHp", label: "最大生命", side: "target", before: 100, after: 160, inspect: inspectHp, expect: (before, after) => after.targetMaxHp > before.targetMaxHp }),
  makeStatCase({ key: "maxHpRate", label: "生命%", side: "target", before: 0, after: 50, inspect: inspectHp, expect: (before, after) => after.targetMaxHp > before.targetMaxHp }),
  makeStatCase({ key: "attack", label: "攻击", side: "actor", before: 40, after: 60, inspect: inspectAttack, expect: (before, after) => after.damage > before.damage }),
  makeStatCase({ key: "attackRate", label: "攻击%", side: "actor", before: 0, after: 50, inspect: inspectAttack, expect: (before, after) => after.damage > before.damage }),
  makeStatCase({ key: "defense", label: "防御", side: "target", before: 10, after: 30, inspect: inspectDefense, expect: (before, after) => after.damage < before.damage }),
  makeStatCase({ key: "defenseRate", label: "防御%", side: "target", before: 0, after: 100, inspect: inspectDefense, expect: (before, after) => after.damage < before.damage }),
  makeStatCase({
    key: "speed",
    label: "速度",
    side: "actor",
    before: 8,
    after: 12,
    inspect: inspectSpeed,
    targetStats: { speed: 10 },
    expect: (before, after) => before.firstTurnActorId === TARGET_ID && after.firstTurnActorId === ACTOR_ID,
  }),
  makeStatCase({ key: "critChance", label: "暴击率%", side: "actor", before: 0, after: 100, inspect: inspectCrit, expect: (before, after) => before.isCritical === false && after.isCritical === true }),
  makeStatCase({
    key: "critMultiplier",
    label: "暴击倍率%",
    side: "actor",
    before: 150,
    after: 250,
    actorStats: { critChance: 100 },
    inspect: inspectCrit,
    expect: (before, after) => after.damage > before.damage,
  }),
  makeStatCase({ key: "hitChance", label: "命中%", side: "actor", before: 0, after: 100, inspect: inspectHit, expect: (before, after) => before.outcome === "未命中" && after.outcome === "命中" }),
  makeStatCase({ key: "dodgeChance", label: "闪避%", side: "target", before: 100, after: 0, inspect: inspectHit, expect: (before, after) => before.outcome === "未命中" && after.outcome === "命中" }),
  makeStatCase({ key: "armor", label: "护甲", side: "target", before: 0, after: 200, inspect: inspectArmor, expect: (before, after) => after.armorReductionRate > before.armorReductionRate && after.damage < before.damage }),
  makeStatCase({
    key: "armorPenetration",
    label: "穿甲",
    side: "actor",
    before: 0,
    after: 200,
    targetStats: { armor: 200 },
    inspect: inspectArmor,
    expect: (before, after) => after.armorReductionRate < before.armorReductionRate && after.damage > before.damage,
  }),
  makeStatCase({ key: "headshotChance", label: "爆头率%", side: "actor", before: 0, after: 100, inspect: inspectHeadshot, expect: (before, after) => before.isHeadshot === false && after.isHeadshot === true }),
  makeStatCase({
    key: "headshotMultiplier",
    label: "爆头倍率%",
    side: "actor",
    before: 200,
    after: 300,
    actorStats: { headshotChance: 100 },
    inspect: inspectHeadshot,
    expect: (before, after) => after.damage > before.damage,
  }),
  makeStatCase({ key: "scenarioDamageBonus", label: "玩法场景增伤%", side: "actor", before: 0, after: 50, inspect: inspectScenario, expect: (before, after) => after.damage > before.damage }),
  makeStatCase({ key: "heroClassDamageBonus", label: "英雄职业增伤%", side: "actor", before: 0, after: 50, inspect: inspectHero, expect: (before, after) => after.damage > before.damage }),
  makeStatCase({ key: "skillTypeDamageBonus", label: "技能类型增伤%", side: "actor", before: 0, after: 50, inspect: inspectSkillType, expect: (before, after) => after.damage > before.damage }),
  makeStatCase({ key: "finalDamageBonus", label: "最终增伤%", side: "actor", before: 0, after: 50, inspect: inspectFinal, expect: (before, after) => after.damage > before.damage }),
  makeStatCase({ key: "finalDamageReduction", label: "最终减伤%", side: "target", before: 0, after: 50, inspect: inspectFinal, expect: (before, after) => after.damage < before.damage }),
  makeStatCase({ key: "skillMultiplier", label: "技能倍率%", side: "actor", before: 100, after: 150, inspect: inspectSkillMultiplier, expect: (before, after) => after.damage > before.damage }),
  makeStatCase({ key: "outputAmplify", label: "输出增幅%", side: "actor", before: 0, after: 50, inspect: inspectOutput, expect: (before, after) => after.damage > before.damage }),
  makeStatCase({ key: "outputDecay", label: "输出衰减%", side: "actor", before: 0, after: 50, inspect: inspectOutput, expect: (before, after) => after.damage < before.damage }),
  makeStatCase({ key: "damageTakenAmplify", label: "承伤加深%", side: "target", before: 0, after: 50, inspect: inspectDamageTaken, expect: (before, after) => after.damage > before.damage }),
  makeStatCase({ key: "damageTakenReduction", label: "承伤减免%", side: "target", before: 0, after: 50, inspect: inspectDamageTaken, expect: (before, after) => after.damage < before.damage }),
];

const softBoundaryCases = [
  {
    label: "生命% = -100",
    input: createBaseInput({ targetStats: { maxHpRate: -100 } }),
    describe(snapshot) {
      return `有效生命保底到 ${snapshot.targetMaxHp}，不会掉到 0`;
    },
  },
  {
    label: "攻击% = -100",
    input: createBaseInput({ actorStats: { attackRate: -100 } }),
    describe(snapshot) {
      return `有效攻击降到 ${snapshot.effectiveAttack}，伤害仍受最小伤害保底影响`;
    },
  },
  {
    label: "防御% = -100",
    input: createBaseInput({ targetStats: { defenseRate: -100 } }),
    describe(snapshot) {
      return `有效防御降到 ${snapshot.effectiveDefense}，不会出现负防御`;
    },
  },
  {
    label: "暴击率% = 180",
    input: createBaseInput({ actorStats: { critChance: 180 } }),
    describe(snapshot) {
      return `输入超过 100%，运行时按 ${formatPercent(clampPercentage(180))} 处理，首次暴击 = ${formatValue(snapshot.isCritical)}`;
    },
  },
  {
    label: "爆头率% = 180",
    input: createBaseInput({ actorStats: { headshotChance: 180 } }),
    describe(snapshot) {
      return `输入超过 100%，运行时按 ${formatPercent(clampPercentage(180))} 处理，首次爆头 = ${formatValue(snapshot.isHeadshot)}`;
    },
  },
  {
    label: "命中% = 180",
    input: createBaseInput({ actorStats: { hitChance: 180 } }),
    describe(snapshot) {
      return `有效命中率会截到 ${formatPercent(snapshot.effectiveHitChance)}`;
    },
  },
  {
    label: "闪避% = 180",
    input: createBaseInput({ targetStats: { dodgeChance: 180 } }),
    describe(snapshot) {
      return `有效命中率会截到 ${formatPercent(snapshot.effectiveHitChance)}，首次结果 = ${snapshot.outcome}`;
    },
  },
  {
    label: "穿甲 > 护甲",
    input: createBaseInput({ actorStats: { armorPenetration: 300 }, targetStats: { armor: 100 } }),
    describe(snapshot) {
      return `护甲差值保底为 ${snapshot.armorGap}，护甲减伤 = ${formatRatioPercent(snapshot.armorReductionRate)}`;
    },
  },
  {
    label: "技能倍率% = 0",
    input: createBaseInput({ actorStats: { skillMultiplier: 0 } }),
    describe(snapshot) {
      return `技能乘区变成 ${formatRatioPercent(snapshot.skillMultiplier)}，但最终伤害仍保底为 ${snapshot.damage}`;
    },
  },
  {
    label: "输出衰减% = 250",
    input: createBaseInput({ actorStats: { outputDecay: 250 } }),
    describe(snapshot) {
      return `输出乘区被截到 ${formatRatioPercent(snapshot.outputMultiplier)}，最终伤害仍保底为 ${snapshot.damage}`;
    },
  },
  {
    label: "承伤减免% = 250",
    input: createBaseInput({ targetStats: { damageTakenReduction: 250 } }),
    describe(snapshot) {
      return `承伤乘区被截到 ${formatRatioPercent(snapshot.damageTakenMultiplier)}，最终伤害仍保底为 ${snapshot.damage}`;
    },
  },
  {
    label: "最终减伤% = 250",
    input: createBaseInput({ targetStats: { finalDamageReduction: 250 } }),
    describe(snapshot) {
      return `最终乘区被截到 ${formatRatioPercent(snapshot.finalDamageMultiplier)}，最终伤害仍保底为 ${snapshot.damage}`;
    },
  },
];

const issues = [];
const reportLines = [];
const backendAvailable = await checkBackendAvailability();

reportLines.push("=== 属性计算审计 ===");
reportLines.push(`后端对比: ${backendAvailable ? `已连接 ${backendBaseUrl}` : "未连接，跳过前后端一致性对比"}`);
reportLines.push("");

for (const auditCase of auditCases) {
  const beforeInput = auditCase.buildInput(auditCase.before);
  const afterInput = auditCase.buildInput(auditCase.after);
  const beforeValidationError = validateBattleInput(beforeInput);
  const afterValidationError = validateBattleInput(afterInput);

  if (beforeValidationError) {
    issues.push(`${auditCase.label} 的对照前置样本校验失败: ${beforeValidationError}`);
    continue;
  }
  if (afterValidationError) {
    issues.push(`${auditCase.label} 的对照后置样本校验失败: ${afterValidationError}`);
    continue;
  }

  const beforeFrontSnapshot = collectActualFirstAction(beforeInput, simulateBattle(beforeInput));
  const afterFrontSnapshot = collectActualFirstAction(afterInput, simulateBattle(afterInput));
  const expectedBefore = computeExpectedFirstAction(beforeInput);
  const expectedAfter = computeExpectedFirstAction(afterInput);

  if (JSON.stringify(normalizeForComparison(beforeFrontSnapshot)) !== JSON.stringify(normalizeForComparison(expectedBefore))) {
    issues.push(`${auditCase.label} 的前置样本计算与预期不一致`);
  }
  if (JSON.stringify(normalizeForComparison(afterFrontSnapshot)) !== JSON.stringify(normalizeForComparison(expectedAfter))) {
    issues.push(`${auditCase.label} 的后置样本计算与预期不一致`);
  }
  if (!auditCase.expect(beforeFrontSnapshot, afterFrontSnapshot)) {
    issues.push(`${auditCase.label} 的前后变化方向不符合预期`);
  }

  let backendStatus = "未检查";
  if (backendAvailable) {
    try {
      const beforeBackendSnapshot = collectActualFirstAction(beforeInput, await simulateByBackend(beforeInput));
      const afterBackendSnapshot = collectActualFirstAction(afterInput, await simulateByBackend(afterInput));
      const matched =
        JSON.stringify(normalizeForComparison(beforeBackendSnapshot)) ===
          JSON.stringify(normalizeForComparison(beforeFrontSnapshot)) &&
        JSON.stringify(normalizeForComparison(afterBackendSnapshot)) ===
          JSON.stringify(normalizeForComparison(afterFrontSnapshot));
      backendStatus = matched ? "一致" : "不一致";
      if (!matched) {
        issues.push(`${auditCase.label} 的前后端结果不一致`);
      }
    } catch (error) {
      backendStatus = `检查失败: ${error instanceof Error ? error.message : "未知错误"}`;
      issues.push(`${auditCase.label} 的后端对比失败: ${backendStatus}`);
    }
  }

  reportLines.push(`[${auditCase.label}] ${auditCase.before} -> ${auditCase.after}`);
  reportLines.push(`  变化前: ${formatMetrics(auditCase.inspect(beforeFrontSnapshot))}`);
  reportLines.push(`  变化后: ${formatMetrics(auditCase.inspect(afterFrontSnapshot))}`);
  reportLines.push(`  前后端: ${backendStatus}`);
}

reportLines.push("");
reportLines.push("=== 输入边界校验 ===");

for (const macro of unitAttributeMacros) {
  const validInput = createBaseInput({ actorStats: { [macro.key]: macro.min } });
  const invalidInput = createBaseInput({ actorStats: { [macro.key]: macro.min - macro.step } });
  const validError = validateBattleInput(validInput);
  const invalidError = validateBattleInput(invalidInput);
  const line = `${macro.label}: 最小值 ${macro.min} ${validError ? "失败" : "通过"} / 低于最小值 ${macro.min - macro.step} ${invalidError ? "已拦截" : "未拦截"}`;
  reportLines.push(line);

  if (validError) {
    issues.push(`${macro.label} 的最小值样本本应通过，但返回了错误: ${validError}`);
  }
  if (!invalidError) {
    issues.push(`${macro.label} 的低于最小值样本未被拦截`);
  }
}

for (const macro of battleConfigNumberMacros) {
  const validInput = createBaseInput({ battle: { [macro.key]: macro.min } });
  const invalidLowInput = createBaseInput({ battle: { [macro.key]: macro.min - macro.step } });
  const validError = validateBattleInput(validInput);
  const invalidLowError = validateBattleInput(invalidLowInput);
  const parts = [`${macro.label}: 最小值 ${macro.min} ${validError ? "失败" : "通过"}`, `低于最小值 ${macro.min - macro.step} ${invalidLowError ? "已拦截" : "未拦截"}`];

  if (validError) {
    issues.push(`${macro.label} 的最小值样本本应通过，但返回了错误: ${validError}`);
  }
  if (!invalidLowError) {
    issues.push(`${macro.label} 的低于最小值样本未被拦截`);
  }

  if (macro.max !== undefined) {
    const invalidHighInput = createBaseInput({ battle: { [macro.key]: macro.max + macro.step } });
    const invalidHighError = validateBattleInput(invalidHighInput);
    parts.push(`高于最大值 ${macro.max + macro.step} ${invalidHighError ? "已拦截" : "未拦截"}`);
    if (!invalidHighError) {
      issues.push(`${macro.label} 的高于最大值样本未被拦截`);
    }
  }

  reportLines.push(parts.join(" / "));
}

reportLines.push("");
reportLines.push("=== 运行时软边界提醒 ===");

for (const boundaryCase of softBoundaryCases) {
  const validationError = validateBattleInput(boundaryCase.input);
  if (validationError) {
    issues.push(`${boundaryCase.label} 的软边界样本不应校验失败，但返回了错误: ${validationError}`);
    continue;
  }

  const snapshot = collectActualFirstAction(boundaryCase.input, simulateBattle(boundaryCase.input));
  reportLines.push(`[提醒] ${boundaryCase.label}: ${boundaryCase.describe(snapshot)}`);
}

reportLines.push("");
reportLines.push("=== 审计结论 ===");
reportLines.push(issues.length === 0 ? "未发现计算错误、前后端口径不一致或边界校验漏拦截。" : `发现 ${issues.length} 个问题，请查看下方问题列表。`);

if (issues.length > 0) {
  reportLines.push("");
  reportLines.push("=== 问题列表 ===");
  issues.forEach((issue, index) => {
    reportLines.push(`${index + 1}. ${issue}`);
  });
}

console.log(reportLines.join("\n"));

if (issues.length > 0) {
  process.exitCode = 1;
}
