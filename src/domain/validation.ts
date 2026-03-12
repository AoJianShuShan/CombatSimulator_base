import {
  createSensitivitySweepValues,
  sensitivityBattlesPerPointMax,
  sensitivityBattlesPerPointMin,
  sensitivityMaxPointCount,
  sensitivityMaxTotalBattles,
  type BattleSensitivityConfig,
  type BattleSensitivityRequest,
} from "./analysis.ts";
import { unitAttributeMacroMap, unitAttributeMacros } from "./attributeMacros.ts";
import {
  type BattleNumberFieldKey,
  battleConfigNumberMacroMap,
  battleConfigNumberMacros,
} from "./battleConfigMacros.ts";
import type {
  ActionResolutionMode,
  AttackElement,
  BattleBatchRequest,
  BattleInput,
  ProtectionType,
  TargetingStrategy,
  TeamId,
  UnitConfig,
  UnitPosition,
} from "./battle.ts";

export const battleBatchCountMin = 1;
export const battleBatchCountMax = 5000;

interface NumberRule {
  label: string;
  min: number;
  max?: number;
  step: number;
  integer: boolean;
}

const supportedTeamIds: TeamId[] = ["A", "B"];
const supportedTargetingStrategies = new Set<TargetingStrategy>(["front", "lowestHp", "highestAttack"]);
const supportedActionResolutionModes = new Set<ActionResolutionMode>(["arpgSimultaneous", "turnBasedSpeed"]);
const supportedUnitPositions = new Set<UnitPosition>(["front", "middle", "back"]);
const supportedAttackElements = new Set<AttackElement>(["none", "physical", "fire", "electromagnetic", "corrosive"]);
const supportedProtectionTypes = new Set<ProtectionType>(["none", "heatArmor", "insulatedArmor", "bioArmor", "heavyArmor"]);

function isAlignedToStep(value: number, step: number) {
  if (step <= 0) {
    return true;
  }

  const ratio = value / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-9;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? `${value}` : `${value}`;
}

function validateNumberRule(value: number, rule: NumberRule) {
  if (!Number.isFinite(value)) {
    return `${rule.label} 必须是合法数值`;
  }

  if (rule.integer && !Number.isInteger(value)) {
    return `${rule.label} 必须是整数`;
  }

  if (value < rule.min) {
    return `${rule.label} 必须大于等于 ${formatNumber(rule.min)}`;
  }

  if (rule.max !== undefined && value > rule.max) {
    return `${rule.label} 必须小于等于 ${formatNumber(rule.max)}`;
  }

  if (!isAlignedToStep(value, rule.step)) {
    return `${rule.label} 必须按 ${formatNumber(rule.step)} 的步进输入`;
  }

  return null;
}

function getUnitLabel(unit: Pick<UnitConfig, "id" | "name">) {
  return unit.name.trim() || unit.id;
}

function getSensitivityAxisTargetUnit(input: BattleInput, config: Pick<BattleSensitivityConfig, "axis">) {
  return config.axis.scope === "unitStat"
    ? input.units.find((candidate) => candidate.id === config.axis.unitId) ?? null
    : null;
}

export function getSensitivityAxisBaseValue(input: BattleInput, config: Pick<BattleSensitivityConfig, "axis">) {
  const unit = getSensitivityAxisTargetUnit(input, config);
  if (!unit || config.axis.scope !== "unitStat") {
    return null;
  }

  return unit.stats[config.axis.field];
}

export function validateSensitivitySweepDeltaValue(
  input: BattleInput,
  config: Pick<BattleSensitivityConfig, "axis">,
  value: number,
  label: string,
) {
  if (config.axis.scope !== "unitStat") {
    return `敏感性分析目标类型不支持: ${config.axis.scope}`;
  }

  const unit = getSensitivityAxisTargetUnit(input, config);
  if (!unit) {
    return `敏感性分析目标单位不存在: ${config.axis.unitId}`;
  }

  const macro = unitAttributeMacroMap[config.axis.field];
  if (!macro) {
    return `敏感性分析属性不支持: ${config.axis.field}`;
  }

  if (!Number.isFinite(value)) {
    return `${label}必须是合法数值`;
  }

  if (!isAlignedToStep(value, macro.step)) {
    return `${label}必须按 ${formatNumber(macro.step)} 的步进输入`;
  }

  const actualValue = unit.stats[config.axis.field] + value;
  if (actualValue < macro.min) {
    return `${label}后的结果值不能小于 ${formatNumber(macro.min)}（当前基准值 ${formatNumber(unit.stats[config.axis.field])}，结果值 ${formatNumber(actualValue)}）`;
  }

  return null;
}

export function normalizeDisplayName(value: string) {
  return typeof value === "string" ? value.trim() : "";
}

export function validateDisplayName(value: string, label: string) {
  return normalizeDisplayName(value) ? null : `${label} 不能为空`;
}

export function validateBattleNumberField(field: BattleNumberFieldKey, value: number) {
  const macro = battleConfigNumberMacroMap[field];
  return validateNumberRule(value, {
    label: macro.label,
    min: macro.min,
    max: macro.max,
    step: macro.step,
    integer: Number.isInteger(macro.step),
  });
}

export function validateUnitStatField(field: keyof typeof unitAttributeMacroMap, value: number) {
  const macro = unitAttributeMacroMap[field];
  return validateNumberRule(value, {
    label: macro.label,
    min: macro.min,
    step: macro.step,
    integer: Number.isInteger(macro.step),
  });
}

export function validateUnitPosition(value: string) {
  return supportedUnitPositions.has(value as UnitPosition) ? null : `站位不支持: ${value}`;
}

export function validateAttackElement(value: string) {
  return supportedAttackElements.has(value as AttackElement) ? null : `攻击元素不支持: ${value}`;
}

export function validateProtectionType(value: string) {
  return supportedProtectionTypes.has(value as ProtectionType) ? null : `防护类型不支持: ${value}`;
}

export function validateBattleInput(input: BattleInput) {
  for (const macro of battleConfigNumberMacros) {
    const battleFieldError = validateBattleNumberField(macro.key, input.battle[macro.key]);
    if (battleFieldError) {
      return battleFieldError;
    }
  }

  const teamNameError =
    validateDisplayName(input.battle.teamNames.A, "红方名称") ??
    validateDisplayName(input.battle.teamNames.B, "蓝方名称");
  if (teamNameError) {
    return teamNameError;
  }

  if (!supportedTargetingStrategies.has(input.battle.targetingStrategy)) {
    return `目标策略不支持: ${input.battle.targetingStrategy}`;
  }

  if (!supportedActionResolutionModes.has(input.battle.actionResolutionMode)) {
    return `行动结算模式不支持: ${input.battle.actionResolutionMode}`;
  }

  if (input.units.length === 0) {
    return "至少需要一个单位";
  }

  const seenIds = new Set<string>();
  const teamCounts = new Map<TeamId, number>(supportedTeamIds.map((teamId) => [teamId, 0]));

  for (const unit of input.units) {
    if (seenIds.has(unit.id)) {
      return `单位 ID 重复: ${unit.id}`;
    }
    seenIds.add(unit.id);

    if (!supportedTeamIds.includes(unit.teamId)) {
      return `单位 ${unit.id} 的队伍不支持: ${unit.teamId}`;
    }
    teamCounts.set(unit.teamId, (teamCounts.get(unit.teamId) ?? 0) + 1);

    const unitNameError = validateDisplayName(unit.name, `单位 ${unit.id} 名称`);
    if (unitNameError) {
      return unitNameError;
    }

    const positionError = validateUnitPosition(unit.position);
    if (positionError) {
      return `单位 ${getUnitLabel(unit)} 的 ${positionError}`;
    }

    const attackElementError = validateAttackElement(unit.attackElement);
    if (attackElementError) {
      return `单位 ${getUnitLabel(unit)} 的 ${attackElementError}`;
    }

    const protectionTypeError = validateProtectionType(unit.protectionType);
    if (protectionTypeError) {
      return `单位 ${getUnitLabel(unit)} 的 ${protectionTypeError}`;
    }

    for (const macro of unitAttributeMacros) {
      const fieldError = validateUnitStatField(macro.key, unit.stats[macro.key]);
      if (fieldError) {
        return `单位 ${getUnitLabel(unit)} 的 ${fieldError}`;
      }
    }
  }

  for (const teamId of supportedTeamIds) {
    if ((teamCounts.get(teamId) ?? 0) === 0) {
      return `${input.battle.teamNames[teamId]} 至少需要一个单位`;
    }
  }

  return null;
}

export function validateBattleBatchCount(value: number) {
  if (!Number.isFinite(value)) {
    return "模拟场次必须是合法数值";
  }

  if (!Number.isInteger(value)) {
    return "模拟场次必须是整数";
  }

  if (value < battleBatchCountMin) {
    return `模拟场次必须大于等于 ${battleBatchCountMin}`;
  }

  if (value > battleBatchCountMax) {
    return `模拟场次必须小于等于 ${battleBatchCountMax}`;
  }

  return null;
}

export function validateBattleBatchRequest(request: BattleBatchRequest) {
  return validateBattleBatchCount(request.count) ?? validateBattleInput(request.input);
}

export function validateSensitivityBattlesPerPoint(value: number) {
  if (!Number.isFinite(value)) {
    return "每点模拟场次必须是合法数值";
  }

  if (!Number.isInteger(value)) {
    return "每点模拟场次必须是整数";
  }

  if (value < sensitivityBattlesPerPointMin) {
    return `每点模拟场次必须大于等于 ${sensitivityBattlesPerPointMin}`;
  }

  if (value > sensitivityBattlesPerPointMax) {
    return `每点模拟场次必须小于等于 ${sensitivityBattlesPerPointMax}`;
  }

  return null;
}

export function validateBattleSensitivityConfig(input: BattleInput, config: BattleSensitivityConfig) {
  if (config.axis.scope !== "unitStat") {
    return `敏感性分析目标类型不支持: ${config.axis.scope}`;
  }

  const unit = getSensitivityAxisTargetUnit(input, config);
  if (!unit) {
    return `敏感性分析目标单位不存在: ${config.axis.unitId}`;
  }

  const macro = unitAttributeMacroMap[config.axis.field];
  if (!macro) {
    return `敏感性分析属性不支持: ${config.axis.field}`;
  }

  const startError = validateSensitivitySweepDeltaValue(input, config, config.sweep.start, "敏感性分析起始增幅");
  if (startError) {
    return startError;
  }

  const endError = validateSensitivitySweepDeltaValue(input, config, config.sweep.end, "敏感性分析结束增幅");
  if (endError) {
    return endError;
  }

  if (!Number.isFinite(config.sweep.step)) {
    return "敏感性分析步进必须是合法数值";
  }

  if (config.sweep.step <= 0) {
    return "敏感性分析步进必须大于 0";
  }

  if (!isAlignedToStep(config.sweep.step, macro.step)) {
    return `敏感性分析步进必须按 ${formatNumber(macro.step)} 的步进输入`;
  }

  const pointCount = getSensitivitySweepPointCount(config.sweep);
  if (pointCount === null) {
    return "敏感性分析范围与步进不匹配，无法整除生成取值点";
  }

  if (pointCount > sensitivityMaxPointCount) {
    return `敏感性分析扫描点数必须小于等于 ${sensitivityMaxPointCount}`;
  }

  const battlesPerPointError = validateSensitivityBattlesPerPoint(config.battlesPerPoint);
  if (battlesPerPointError) {
    return battlesPerPointError;
  }

  const totalBattles = pointCount * config.battlesPerPoint;
  if (totalBattles > sensitivityMaxTotalBattles) {
    return `敏感性分析总模拟次数必须小于等于 ${sensitivityMaxTotalBattles}`;
  }

  try {
    createSensitivitySweepValues(config.sweep);
  } catch (error) {
    return error instanceof Error ? error.message : "敏感性分析扫描值生成失败";
  }

  return null;
}

export function validateBattleSensitivityRequest(request: BattleSensitivityRequest) {
  return validateBattleInput(request.input) ?? validateBattleSensitivityConfig(request.input, request);
}

function getSensitivitySweepPointCount(sweep: BattleSensitivityConfig["sweep"]) {
  try {
    return createSensitivitySweepValues(sweep).length;
  } catch {
    return null;
  }
}
