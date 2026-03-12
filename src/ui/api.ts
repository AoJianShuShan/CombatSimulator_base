import type {
  BattleSensitivityPointResult,
  BattleSensitivityRequest,
  BattleSensitivityResult,
} from "../domain/analysis.ts";
import type {
  BattleEvent,
  BattleBatchRequest,
  BattleBatchSummaryResult,
  BattleInput,
  BattleSimulationResult,
  BattleUnitState,
  BattleEventType,
  TeamId,
  UnitPosition,
  AttackElement,
  ProtectionType,
} from "../domain/battle.ts";
import { unitAttributeMacros } from "../domain/attributeMacros.ts";

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "");
}

const supportedEventTypes = new Set<BattleEventType>([
  "battle_started",
  "round_started",
  "turn_started",
  "attack_missed",
  "damage_applied",
  "reload_started",
  "reload_completed",
  "unit_defeated",
  "battle_ended",
]);
const supportedTeamIds = new Set<TeamId>(["A", "B"]);
const supportedUnitPositions = new Set<UnitPosition>(["front", "middle", "back"]);
const supportedAttackElements = new Set<AttackElement>(["none", "physical", "fire", "electromagnetic", "corrosive"]);
const supportedProtectionTypes = new Set<ProtectionType>(["none", "heatArmor", "insulatedArmor", "bioArmor", "heavyArmor"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`${label} 必须是对象`);
  }
}

function assertFiniteNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} 必须是合法数值`);
  }
}

function assertInteger(value: unknown, label: string) {
  assertFiniteNumber(value, label);
  if (!Number.isInteger(value)) {
    throw new Error(`${label} 必须是整数`);
  }
}

function assertString(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new Error(`${label} 必须是字符串`);
  }
}

function assertBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} 必须是布尔值`);
  }
}

function assertOptionalString(value: unknown, label: string) {
  if (value !== undefined) {
    assertString(value, label);
  }
}

function assertTeamId(value: unknown, label: string): asserts value is TeamId {
  if (!supportedTeamIds.has(value as TeamId)) {
    throw new Error(`${label} 不支持: ${String(value)}`);
  }
}

function assertNullableTeamId(value: unknown, label: string) {
  if (value !== null) {
    assertTeamId(value, label);
  }
}

function assertScalarPayload(value: unknown, label: string) {
  assertPlainObject(value, label);
  for (const [key, fieldValue] of Object.entries(value)) {
    const type = typeof fieldValue;
    if (fieldValue !== null && type !== "boolean" && type !== "number" && type !== "string") {
      throw new Error(`${label}.${key} 必须是标量`);
    }
  }
}

function assertBattleEvent(event: unknown, index: number): asserts event is BattleEvent {
  assertPlainObject(event, `events[${index}]`);
  assertInteger(event.sequence, `events[${index}].sequence`);
  assertInteger(event.timeIndex, `events[${index}].timeIndex`);
  assertFiniteNumber(event.elapsedTimeMs, `events[${index}].elapsedTimeMs`);
  if (!supportedEventTypes.has(event.type as BattleEventType)) {
    throw new Error(`events[${index}].type 不支持: ${String(event.type)}`);
  }
  assertInteger(event.round, `events[${index}].round`);
  assertOptionalString(event.actorId, `events[${index}].actorId`);
  assertOptionalString(event.targetId, `events[${index}].targetId`);
  assertString(event.summary, `events[${index}].summary`);
  if (event.payload !== undefined) {
    assertScalarPayload(event.payload, `events[${index}].payload`);
  }
}

function assertBattleUnitState(unit: unknown, index: number): asserts unit is BattleUnitState {
  assertPlainObject(unit, `finalUnits[${index}]`);
  assertString(unit.id, `finalUnits[${index}].id`);
  assertTeamId(unit.teamId, `finalUnits[${index}].teamId`);
  assertString(unit.name, `finalUnits[${index}].name`);
  if (!supportedUnitPositions.has(unit.position as UnitPosition)) {
    throw new Error(`finalUnits[${index}].position 不支持: ${String(unit.position)}`);
  }
  if (!supportedAttackElements.has(unit.attackElement as AttackElement)) {
    throw new Error(`finalUnits[${index}].attackElement 不支持: ${String(unit.attackElement)}`);
  }
  if (!supportedProtectionTypes.has(unit.protectionType as ProtectionType)) {
    throw new Error(`finalUnits[${index}].protectionType 不支持: ${String(unit.protectionType)}`);
  }
  assertPlainObject(unit.stats, `finalUnits[${index}].stats`);
  for (const macro of unitAttributeMacros) {
    assertFiniteNumber(unit.stats[macro.key], `finalUnits[${index}].stats.${macro.key}`);
  }
  assertFiniteNumber(unit.currentHp, `finalUnits[${index}].currentHp`);
  assertBoolean(unit.isAlive, `finalUnits[${index}].isAlive`);
  if (unit.currentAmmo !== undefined) {
    assertFiniteNumber(unit.currentAmmo, `finalUnits[${index}].currentAmmo`);
  }
  if (unit.nextAttackTimeMs !== undefined) {
    assertFiniteNumber(unit.nextAttackTimeMs, `finalUnits[${index}].nextAttackTimeMs`);
  }
  if (unit.reloadUntilMs !== undefined && unit.reloadUntilMs !== null) {
    assertFiniteNumber(unit.reloadUntilMs, `finalUnits[${index}].reloadUntilMs`);
  }
}

function parseBattleSimulationResult(payload: unknown): BattleSimulationResult {
  assertPlainObject(payload, "后端单场模拟响应");
  assertInteger(payload.randomSeed, "randomSeed");
  assertNullableTeamId(payload.winnerTeamId, "winnerTeamId");
  assertInteger(payload.roundsCompleted, "roundsCompleted");
  if (!Array.isArray(payload.events)) {
    throw new Error("events 必须是数组");
  }
  payload.events.forEach((event, index) => assertBattleEvent(event, index));
  if (!Array.isArray(payload.finalUnits)) {
    throw new Error("finalUnits 必须是数组");
  }
  payload.finalUnits.forEach((unit, index) => assertBattleUnitState(unit, index));
  return payload as BattleSimulationResult;
}

function assertRatePair(value: unknown, label: string) {
  assertPlainObject(value, label);
  assertFiniteNumber(value.A, `${label}.A`);
  assertFiniteNumber(value.B, `${label}.B`);
}

function assertIntegerPair(value: unknown, label: string) {
  assertPlainObject(value, label);
  assertInteger(value.A, `${label}.A`);
  assertInteger(value.B, `${label}.B`);
}

function parseBattleBatchSummaryResult(payload: unknown): BattleBatchSummaryResult {
  assertPlainObject(payload, "后端多场统计响应");
  assertInteger(payload.baseSeed, "baseSeed");
  assertInteger(payload.totalBattles, "totalBattles");
  assertIntegerPair(payload.wins, "wins");
  assertInteger(payload.draws, "draws");
  assertRatePair(payload.winRates, "winRates");
  assertRatePair(payload.averageTerminalNetAdvantages, "averageTerminalNetAdvantages");
  assertPlainObject(payload.remainingHpRatesOnWins, "remainingHpRatesOnWins");
  if (payload.remainingHpRatesOnWins.A !== null) {
    assertFiniteNumber(payload.remainingHpRatesOnWins.A, "remainingHpRatesOnWins.A");
  }
  if (payload.remainingHpRatesOnWins.B !== null) {
    assertFiniteNumber(payload.remainingHpRatesOnWins.B, "remainingHpRatesOnWins.B");
  }
  assertFiniteNumber(payload.drawRate, "drawRate");
  assertFiniteNumber(payload.averageRounds, "averageRounds");
  assertInteger(payload.minRounds, "minRounds");
  assertInteger(payload.maxRounds, "maxRounds");
  assertFiniteNumber(payload.averageDurationMs, "averageDurationMs");
  assertFiniteNumber(payload.minDurationMs, "minDurationMs");
  assertFiniteNumber(payload.maxDurationMs, "maxDurationMs");
  return payload as BattleBatchSummaryResult;
}

function assertSensitivityAxis(value: unknown, label: string) {
  assertPlainObject(value, label);
  if (value.scope !== "unitStat") {
    throw new Error(`${label}.scope 不支持: ${String(value.scope)}`);
  }
  assertString(value.unitId, `${label}.unitId`);
  if (!unitAttributeMacros.some((macro) => macro.key === value.field)) {
    throw new Error(`${label}.field 不支持: ${String(value.field)}`);
  }
}

function assertSensitivitySweep(value: unknown, label: string) {
  assertPlainObject(value, label);
  assertFiniteNumber(value.start, `${label}.start`);
  assertFiniteNumber(value.end, `${label}.end`);
  assertFiniteNumber(value.step, `${label}.step`);
}

function parseBattleSensitivityPointResult(payload: unknown, index: number): BattleSensitivityPointResult {
  assertPlainObject(payload, `points[${index}]`);
  assertInteger(payload.index, `points[${index}].index`);
  assertFiniteNumber(payload.value, `points[${index}].value`);
  return {
    index: payload.index,
    value: payload.value,
    summary: parseBattleBatchSummaryResult(payload.summary),
  };
}

function parseBattleSensitivityResult(payload: unknown): BattleSensitivityResult {
  assertPlainObject(payload, "后端敏感性分析响应");
  assertInteger(payload.baseSeed, "baseSeed");
  assertSensitivityAxis(payload.axis, "axis");
  assertSensitivitySweep(payload.sweep, "sweep");
  assertInteger(payload.pointCount, "pointCount");
  assertInteger(payload.battlesPerPoint, "battlesPerPoint");
  assertInteger(payload.totalBattles, "totalBattles");
  if (!Array.isArray(payload.points)) {
    throw new Error("points 必须是数组");
  }

  return {
    baseSeed: payload.baseSeed,
    axis: payload.axis as BattleSensitivityResult["axis"],
    sweep: payload.sweep as BattleSensitivityResult["sweep"],
    pointCount: payload.pointCount,
    battlesPerPoint: payload.battlesPerPoint,
    totalBattles: payload.totalBattles,
    points: payload.points.map((point, index) => parseBattleSensitivityPointResult(point, index)),
  };
}

function parseBackendHealth(payload: unknown): { status: string; service: string } {
  assertPlainObject(payload, "后端健康检查响应");
  assertString(payload.status, "status");
  assertString(payload.service, "service");
  return payload as { status: string; service: string };
}

interface RequestOptions {
  signal?: AbortSignal;
}

export async function simulateBattleByApi(
  baseUrl: string,
  input: BattleInput,
  options: RequestOptions = {},
): Promise<BattleSimulationResult> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/simulate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    signal: options.signal,
  });

  if (!response.ok) {
    let message = `后端模拟失败：HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload.message) {
        message = payload.message;
      }
    } catch {
      return Promise.reject(new Error(message));
    }

    throw new Error(message);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("后端返回了无法解析的 JSON 响应");
  }

  return parseBattleSimulationResult(payload);
}

export async function simulateBattleBatchByApi(
  baseUrl: string,
  request: BattleBatchRequest,
  options: RequestOptions = {},
): Promise<BattleBatchSummaryResult> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/simulate-batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal: options.signal,
  });

  if (!response.ok) {
    let message = `后端批量模拟失败：HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload.message) {
        message = payload.message;
      }
    } catch {
      return Promise.reject(new Error(message));
    }

    throw new Error(message);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("后端批量模拟返回了无法解析的 JSON 响应");
  }

  return parseBattleBatchSummaryResult(payload);
}

export async function simulateBattleSensitivityByApi(
  baseUrl: string,
  request: BattleSensitivityRequest,
  options: RequestOptions = {},
): Promise<BattleSensitivityResult> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/simulate-sensitivity`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal: options.signal,
  });

  if (!response.ok) {
    let message = `后端敏感性分析失败：HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload.message) {
        message = payload.message;
      }
    } catch {
      return Promise.reject(new Error(message));
    }

    throw new Error(message);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("后端敏感性分析返回了无法解析的 JSON 响应");
  }

  return parseBattleSensitivityResult(payload);
}

export async function fetchBackendHealth(
  baseUrl: string,
  options: RequestOptions = {},
): Promise<{ status: string; service: string }> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/health`, {
    signal: options.signal,
  });

  if (!response.ok) {
    let message = `后端健康检查失败：HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload.message) {
        message = payload.message;
      }
    } catch {
      return Promise.reject(new Error(message));
    }

    throw new Error(message);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("后端健康检查返回了无法解析的 JSON 响应");
  }

  return parseBackendHealth(payload);
}
