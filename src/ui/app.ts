import {
  unitAttributeMacroMap,
  unitStatRoleKeys,
} from "../domain/attributeMacros.ts";
import {
  battleConfigNumberMacroMap,
  battleConfigNumberMacros,
  formatBattleConfigValue,
  type BattleNumberFieldKey,
} from "../domain/battleConfigMacros.ts";
import {
  actionResolutionModeLabels,
  actionResolutionModeOrder,
  type ActionResolutionMode,
  attackElementLabels,
  attackElementOrder,
  type AttackElement,
  type BattleBatchSummaryResult,
  createBattleRandomSeed,
  createDefaultBattleInput,
  createDefaultUnit,
  type BattleEventType,
  type BattleInput,
  type BattleUnitState,
  protectionTypeLabels,
  protectionTypeOrder,
  type ProtectionType,
  type BattleSimulationResult,
  type TeamId,
  type TargetingStrategy,
  type UnitPosition,
  unitPositionLabels,
  unitPositionOrder,
} from "../domain/battle.ts";
import {
  normalizeDisplayName,
  validateAttackElement,
  validateBattleBatchCount,
  validateBattleInput,
  validateBattleNumberField,
  validateDisplayName,
  validateProtectionType,
  validateUnitPosition,
  validateUnitStatField,
} from "../domain/validation.ts";
import { simulateBattle } from "../simulator/simulateBattle.ts";
import { simulateBattleBatchSummary } from "../simulator/simulateBattleBatch.ts";
import { fetchBackendHealth, simulateBattleBatchByApi, simulateBattleByApi } from "./api.ts";

type SimulationMode = "local" | "backend";
type SimulationView = "single" | "batch";
type MessageTone = "error" | "success";
type HeroMetaTone = "a" | "accent" | "b" | "blue" | "neutral";
type ThemeMode = "light" | "dark" | "system";

interface RenderStateSnapshot {
  scrollX: number;
  scrollY: number;
  focusKey: string | null;
  selectionEnd: number | null;
  selectionStart: number | null;
}

interface SaveFilePickerWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

interface SaveFilePickerHandle {
  createWritable(): Promise<SaveFilePickerWritable>;
}

interface SaveFilePickerWindow extends Window {
  showSaveFilePicker?: (options: {
    excludeAcceptAllOption?: boolean;
    id?: string;
    suggestedName?: string;
    types?: Array<{
      accept: Record<string, string[]>;
      description: string;
    }>;
  }) => Promise<SaveFilePickerHandle>;
}

interface AppState {
  draft: BattleInput;
  result: BattleSimulationResult | null;
  batchSummary: BattleBatchSummaryResult | null;
  themeMode: ThemeMode;
  simulationMode: SimulationMode;
  simulationView: SimulationView;
  batchCount: number;
  backendBaseUrl: string;
  isSubmitting: boolean;
  isReplayPlaying: boolean;
  replayEventIndex: number;
  message: string | null;
  messageTone: MessageTone;
  editingUnitId: string | null;
  logFilters: {
    actor: string;
    summary: string;
    target: string;
  };
}

const themeModeStorageKey = "combat-simulator-theme-mode";

function normalizeThemeMode(value: string | null | undefined): ThemeMode {
  if (value === "dark" || value === "light" || value === "system") {
    return value;
  }

  return "system";
}

function getInitialThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "system";
  }

  try {
    return normalizeThemeMode(window.localStorage.getItem(themeModeStorageKey));
  } catch {
    return "system";
  }
}

function getResolvedThemeMode(themeMode: ThemeMode = state.themeMode): "light" | "dark" {
  if (themeMode !== "system") {
    return themeMode;
  }

  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  return "light";
}

const state: AppState = {
  draft: createDefaultBattleInput(),
  result: null,
  batchSummary: null,
  themeMode: getInitialThemeMode(),
  simulationMode: "local",
  simulationView: "single",
  batchCount: 100,
  backendBaseUrl: "http://127.0.0.1:8000",
  isSubmitting: false,
  isReplayPlaying: false,
  replayEventIndex: 0,
  message: null,
  messageTone: "success",
  editingUnitId: null,
  logFilters: {
    actor: "",
    summary: "",
    target: "",
  },
};

let replayTimerId: number | null = null;
let draggingUnitId: string | null = null;

interface DragDropTarget {
  teamId: TeamId;
  position: UnitPosition;
  index: number;
}

let activeDropIndicator: HTMLElement | null = null;
let activeDropTarget: DragDropTarget | null = null;

type UnitStatFieldKey = keyof typeof unitAttributeMacroMap;
type UnitDerivedMetricKey = "effectiveMaxHp" | "effectiveAttack" | "effectiveDefense";

const unitEditorAttributeSections: Array<{
  derivedMetrics?: Array<{ key: UnitDerivedMetricKey; label: string }>;
  rows: UnitStatFieldKey[][];
  title: string;
}> = [
  {
    title: "基础属性",
    derivedMetrics: [
      { key: "effectiveMaxHp", label: "有效生命" },
      { key: "effectiveAttack", label: "有效攻击" },
      { key: "effectiveDefense", label: "有效防御" },
    ],
    rows: [
      ["speed", "fireRate", "reloadTimeMs", "magazineCapacity"],
      ["maxHp", "maxHpRate"],
      ["attack", "attackRate", "defense", "defenseRate"],
      ["armor", "armorPenetration", "hitChance", "dodgeChance"],
    ],
  },
  {
    title: "爆发属性",
    rows: [["critChance", "critMultiplier", "headshotChance", "headshotMultiplier"]],
  },
  {
    title: "特殊加成",
    rows: [["skillTypeDamageBonus", "heroClassDamageBonus", "scenarioDamageBonus", "skillMultiplier"]],
  },
  {
    title: "最终结算",
    rows: [
      ["finalDamageBonus", "finalDamageReduction"],
      ["outputAmplify", "outputDecay", "damageTakenAmplify", "damageTakenReduction"],
    ],
  },
];

const targetingStrategyLabels: Record<TargetingStrategy, string> = {
  front: "前排优先",
  lowestHp: "优先最低生命",
  highestAttack: "优先最高攻击",
};

const battleEventTypeLabels: Record<BattleEventType, string> = {
  battle_started: "战斗开始",
  round_started: "回合开始",
  turn_started: "行动开始",
  reload_started: "开始换弹",
  reload_completed: "换弹完成",
  attack_missed: "攻击落空",
  damage_applied: "伤害结算",
  unit_defeated: "单位阵亡",
  battle_ended: "战斗结束",
};

const elementRelationLabels = {
  advantage: "元素克制",
  disadvantage: "元素被克",
  neutral: "元素中性",
} as const;

const battleEndReasonLabels = {
  teamEliminated: "一方被消灭",
  maxRounds: "达到最大回合数",
  maxBattleTimeMs: "达到最大战斗时长",
} as const;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getUnitsByTeam(teamId: TeamId) {
  return state.draft.units.filter((unit) => unit.teamId === teamId);
}

function getUnitsByTeamAndPosition(teamId: TeamId, position: UnitPosition) {
  return getUnitsByTeam(teamId).filter((unit) => unit.position === position);
}

function getUnitById(unitId: string) {
  return state.draft.units.find((unit) => unit.id === unitId) ?? null;
}

function getUnitLabel(unitId: string) {
  const unit = getUnitById(unitId);
  return unit ? unit.name.trim() || unit.id : unitId;
}

function getUnitPositionSlot(unitId: string) {
  const unit = getUnitById(unitId);
  if (!unit) {
    return 0;
  }

  return getUnitsByTeamAndPosition(unit.teamId, unit.position).findIndex((candidate) => candidate.id === unitId) + 1;
}

function setMessage(message: string | null, tone: MessageTone = "success") {
  state.message = message;
  state.messageTone = tone;
}

function clearMessage() {
  state.message = null;
  state.messageTone = "success";
}

function persistThemeMode() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(themeModeStorageKey, state.themeMode);
  } catch {
    // 忽略本地持久化失败，页面仍可继续使用。
  }
}

function applyThemeMode() {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = getResolvedThemeMode();
  document.documentElement.dataset.themeMode = state.themeMode;
}

function updateThemeMode(nextValue: string) {
  const nextThemeMode = normalizeThemeMode(nextValue);
  if (state.themeMode === nextThemeMode) {
    return;
  }

  state.themeMode = nextThemeMode;
  persistThemeMode();
  applyThemeMode();
}

function invalidateResult() {
  stopReplay();
  state.result = null;
  state.batchSummary = null;
  state.replayEventIndex = 0;
  clearMessage();
}

function getNextUnitOrder(teamId: TeamId) {
  const maxOrder = getUnitsByTeam(teamId).reduce((currentMax, unit) => {
    const match = unit.id.match(new RegExp(`^${teamId}-(\\d+)$`));
    const order = match ? Number(match[1]) : 0;
    return Math.max(currentMax, order);
  }, 0);

  return maxOrder + 1;
}

function setTeamUnits(teamId: TeamId, nextTeamUnits: BattleInput["units"]) {
  const teamUnitMap = new Map<TeamId, BattleInput["units"]>([
    ["A", teamId === "A" ? nextTeamUnits : getUnitsByTeam("A")],
    ["B", teamId === "B" ? nextTeamUnits : getUnitsByTeam("B")],
  ]);

  state.draft.units = (["A", "B"] as TeamId[]).flatMap((id) => teamUnitMap.get(id) ?? []);
}

function moveUnitToFormation(unitId: string, targetPosition: UnitPosition, targetIndex: number) {
  const unit = getUnitById(unitId);
  if (!unit) {
    return;
  }

  const teamUnits = getUnitsByTeam(unit.teamId);
  const groups = new Map<UnitPosition, BattleInput["units"]>(
    unitPositionOrder.map((position) => [position, teamUnits.filter((candidate) => candidate.position === position)]),
  );
  const sourceGroup = groups.get(unit.position) ?? [];
  const sourceIndex = sourceGroup.findIndex((candidate) => candidate.id === unitId);

  for (const position of unitPositionOrder) {
    groups.set(
      position,
      (groups.get(position) ?? []).filter((candidate) => candidate.id !== unitId),
    );
  }

  const targetGroup = [...(groups.get(targetPosition) ?? [])];
  const nextIndex =
    unit.position === targetPosition && sourceIndex >= 0 && sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  const normalizedIndex = Math.max(0, Math.min(nextIndex, targetGroup.length));
  targetGroup.splice(normalizedIndex, 0, { ...unit, position: targetPosition });
  groups.set(targetPosition, targetGroup);

  invalidateResult();
  setTeamUnits(
    unit.teamId,
    unitPositionOrder.flatMap((position) => groups.get(position) ?? []),
  );
}

function clearDropIndicatorState() {
  activeDropIndicator?.remove();
  activeDropIndicator = null;
  activeDropTarget = null;
}

function getTrackCards(track: HTMLElement) {
  return [...track.querySelectorAll<HTMLElement>("[data-action='drag-unit']")].filter(
    (card) => card.dataset.unitId !== draggingUnitId,
  );
}

function getDropIndexFromPointer(track: HTMLElement, clientY: number) {
  const cards = getTrackCards(track);
  for (const [index, card] of cards.entries()) {
    const rect = card.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      return index;
    }
  }

  return cards.length;
}

function updateDropIndicator(track: HTMLElement, target: DragDropTarget) {
  const cards = getTrackCards(track);
  const emptyHint = track.querySelector<HTMLElement>(".formation-empty");
  const anchor = cards[target.index] ?? emptyHint ?? null;

  if (!activeDropIndicator) {
    activeDropIndicator = document.createElement("div");
    activeDropIndicator.className = "formation-drop-indicator";
  }

  if (
    activeDropTarget?.teamId === target.teamId &&
    activeDropTarget.position === target.position &&
    activeDropTarget.index === target.index &&
    activeDropIndicator.parentElement === track
  ) {
    return;
  }

  track.insertBefore(activeDropIndicator, anchor);
  activeDropTarget = target;
}

function captureRenderState(): RenderStateSnapshot {
  const activeElement = document.activeElement;
  const focusKey =
    activeElement instanceof HTMLElement && activeElement.dataset.focusKey ? activeElement.dataset.focusKey : null;
  const supportsSelection =
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement;

  return {
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    focusKey,
    selectionStart: supportsSelection ? activeElement.selectionStart : null,
    selectionEnd: supportsSelection ? activeElement.selectionEnd : null,
  };
}

function restoreRenderState(snapshot: RenderStateSnapshot, container: HTMLElement) {
  window.scrollTo(snapshot.scrollX, snapshot.scrollY);

  if (!snapshot.focusKey) {
    return;
  }

  const target = [...container.querySelectorAll<HTMLElement>("[data-focus-key]")].find(
    (element) => element.dataset.focusKey === snapshot.focusKey,
  );
  if (!target) {
    return;
  }

  try {
    target.focus({ preventScroll: true });
  } catch {
    target.focus();
  }

  if (
    snapshot.selectionStart === null ||
    snapshot.selectionEnd === null ||
    (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement))
  ) {
    return;
  }

  try {
    target.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  } catch {
    // number 等输入类型不支持选择范围，忽略即可
  }
}

function updateUnitName(unitId: string, rawValue: string) {
  const error = validateDisplayName(rawValue, `单位 ${unitId} 名称`);
  if (error) {
    setMessage(error, "error");
    return;
  }

  const nextName = normalizeDisplayName(rawValue);
  invalidateResult();
  state.draft.units = state.draft.units.map((unit) => (unit.id === unitId ? { ...unit, name: nextName } : unit));
}

function updateUnitPosition(unitId: string, nextPosition: string) {
  const error = validateUnitPosition(nextPosition);
  if (error) {
    setMessage(`单位 ${getUnitLabel(unitId)} 的 ${error}`, "error");
    return;
  }

  const unit = getUnitById(unitId);
  if (!unit) {
    return;
  }

  if (unit.position === nextPosition) {
    return;
  }

  moveUnitToFormation(unitId, nextPosition as UnitPosition, getUnitsByTeamAndPosition(unit.teamId, nextPosition as UnitPosition).length);
}

function updateUnitAttackElement(unitId: string, nextAttackElement: string) {
  const error = validateAttackElement(nextAttackElement);
  if (error) {
    setMessage(`单位 ${getUnitLabel(unitId)} 的 ${error}`, "error");
    return;
  }

  invalidateResult();
  state.draft.units = state.draft.units.map((unit) =>
    unit.id === unitId ? { ...unit, attackElement: nextAttackElement as AttackElement } : unit
  );
}

function updateUnitProtectionType(unitId: string, nextProtectionType: string) {
  const error = validateProtectionType(nextProtectionType);
  if (error) {
    setMessage(`单位 ${getUnitLabel(unitId)} 的 ${error}`, "error");
    return;
  }

  invalidateResult();
  state.draft.units = state.draft.units.map((unit) =>
    unit.id === unitId ? { ...unit, protectionType: nextProtectionType as ProtectionType } : unit
  );
}

function updateUnitStat(unitId: string, field: string, rawValue: string) {
  const macro = unitAttributeMacroMap[field as keyof typeof unitAttributeMacroMap];
  if (!macro) {
    return;
  }

  const value = Number(rawValue);
  const error = validateUnitStatField(macro.key, value);
  if (error) {
    setMessage(`单位 ${getUnitLabel(unitId)} 的 ${error}`, "error");
    return;
  }

  invalidateResult();
  state.draft.units = state.draft.units.map((unit) => {
    if (unit.id !== unitId) {
      return unit;
    }

    return {
      ...unit,
      stats: {
        ...unit.stats,
        [field]: value,
      },
    };
  });
}

function updateBattleField(
  field: BattleNumberFieldKey | "targetingStrategy" | "actionResolutionMode",
  rawValue: string,
) {
  if (field === "targetingStrategy") {
    invalidateResult();
    state.draft.battle = {
      ...state.draft.battle,
      targetingStrategy: rawValue as TargetingStrategy,
    };
    return;
  }

  if (field === "actionResolutionMode") {
    invalidateResult();
    state.draft.battle = {
      ...state.draft.battle,
      actionResolutionMode: rawValue as ActionResolutionMode,
    };
    return;
  }

  const value = Number(rawValue);
  const error = validateBattleNumberField(field, value);
  if (error) {
    setMessage(error, "error");
    return;
  }

  invalidateResult();
  state.draft.battle = {
    ...state.draft.battle,
    [field]: value,
  };
}

function updateTeamName(teamId: TeamId, value: string) {
  const label = teamId === "A" ? "红方名称" : "蓝方名称";
  const error = validateDisplayName(value, label);
  if (error) {
    setMessage(error, "error");
    return;
  }

  invalidateResult();
  state.draft.battle = {
    ...state.draft.battle,
    teamNames: {
      ...state.draft.battle.teamNames,
      [teamId]: normalizeDisplayName(value),
    },
  };
}

function addUnit(teamId: TeamId) {
  invalidateResult();
  state.draft.units = [...state.draft.units, createDefaultUnit(teamId, getNextUnitOrder(teamId))];
}

function removeUnit(unitId: string) {
  const unit = getUnitById(unitId);
  if (!unit) {
    return;
  }

  if (getUnitsByTeam(unit.teamId).length <= 1) {
    setMessage(`${state.draft.battle.teamNames[unit.teamId]} 至少保留一个单位`, "error");
    return;
  }

  invalidateResult();
  state.draft.units = state.draft.units.filter((unit) => unit.id !== unitId);
  if (state.editingUnitId === unitId) {
    state.editingUnitId = null;
  }
}

function resetDraft() {
  stopReplay();
  state.draft = createDefaultBattleInput();
  state.result = null;
  state.batchSummary = null;
  clearMessage();
  state.isSubmitting = false;
  state.isReplayPlaying = false;
  state.replayEventIndex = 0;
  state.editingUnitId = null;
  state.logFilters = {
    actor: "",
    summary: "",
    target: "",
  };
}

function updateSimulationMode(mode: SimulationMode) {
  state.simulationMode = mode;
  clearMessage();
}

function updateSimulationView(view: SimulationView) {
  if (state.simulationView === view) {
    return;
  }

  stopReplay();
  state.simulationView = view;
  clearMessage();
}

function updateBatchCount(rawValue: string) {
  const value = Number(rawValue);
  const error = validateBattleBatchCount(value);
  if (error) {
    setMessage(error, "error");
    return;
  }

  state.batchCount = value;
  clearMessage();
}

function updateBackendBaseUrl(value: string) {
  state.backendBaseUrl = value.trim();
  clearMessage();
}

function refreshRandomSeed() {
  invalidateResult();
  state.draft.battle = {
    ...state.draft.battle,
    randomSeed: createBattleRandomSeed(),
  };
}

function openUnitEditor(unitId: string) {
  if (!getUnitById(unitId)) {
    return;
  }

  state.editingUnitId = unitId;
  clearMessage();
}

function closeUnitEditor() {
  state.editingUnitId = null;
  clearMessage();
}

async function saveJsonFile(filename: string, payload: unknown) {
  const pickerWindow = window as SaveFilePickerWindow;
  if (typeof pickerWindow.showSaveFilePicker !== "function") {
    setMessage("当前浏览器不支持自选保存目录，请使用新版 Edge 或 Chrome 打开本页面", "error");
    return;
  }

  try {
    const handle = await pickerWindow.showSaveFilePicker({
      id: "combat-simulator-export",
      suggestedName: filename,
      excludeAcceptAllOption: true,
      types: [
        {
          description: "JSON 配置文件",
          accept: {
            "application/json": [".json"],
          },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(payload, null, 2));
    await writable.close();
    setMessage(`已导出：${filename}`, "success");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }

    setMessage(error instanceof Error ? `导出失败：${error.message}` : "导出失败", "error");
  }
}

async function exportDraft() {
  await saveJsonFile("battle-input.json", state.draft);
}

function normalizeImportedBattleInput(payload: BattleInput) {
  const defaultInput = createDefaultBattleInput();

  return {
    battle: {
      ...defaultInput.battle,
      ...payload.battle,
      teamNames: {
        ...defaultInput.battle.teamNames,
        ...payload.battle.teamNames,
      },
    },
    units: payload.units.map((unit, index) => {
      const nextTeamId = unit.teamId === "B" ? "B" : "A";
      const defaultUnit = createDefaultUnit(nextTeamId, index + 1);
      return {
        ...defaultUnit,
        ...unit,
        stats: {
          ...defaultUnit.stats,
          ...unit.stats,
        },
      };
    }),
  } satisfies BattleInput;
}

function parseImportedBattleInput(payload: unknown) {
  if (!isPlainObject(payload)) {
    return { draft: null, error: "导入配置失败：根节点必须是对象" };
  }

  if (!isPlainObject(payload.battle)) {
    return { draft: null, error: "导入配置失败：battle 必须是对象" };
  }

  if (!isPlainObject(payload.battle.teamNames)) {
    return { draft: null, error: "导入配置失败：battle.teamNames 必须是对象" };
  }

  if (!Array.isArray(payload.units)) {
    return { draft: null, error: "导入配置失败：units 必须是数组" };
  }

  for (const [index, unit] of payload.units.entries()) {
    if (!isPlainObject(unit)) {
      return { draft: null, error: `导入配置失败：units[${index}] 必须是对象` };
    }

    if (!isPlainObject(unit.stats)) {
      return { draft: null, error: `导入配置失败：units[${index}].stats 必须是对象` };
    }
  }

  const draft = normalizeImportedBattleInput(payload as BattleInput);
  const error = validateBattleInput(draft);
  return error ? { draft: null, error } : { draft, error: null };
}

async function importDraft(file: File) {
  let text: string;
  try {
    text = await file.text();
  } catch {
    setMessage(`导入配置失败：无法读取文件 ${file.name}`, "error");
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    setMessage(`导入配置失败：${file.name} 不是合法 JSON`, "error");
    return;
  }

  const { draft, error } = parseImportedBattleInput(payload);
  if (!draft || error) {
    setMessage(error ?? "导入配置失败", "error");
    return;
  }

  stopReplay();
  state.draft = draft;
  state.result = null;
  state.batchSummary = null;
  state.replayEventIndex = 0;
  state.isSubmitting = false;
  state.isReplayPlaying = false;
  state.editingUnitId = null;
  state.logFilters = {
    actor: "",
    summary: "",
    target: "",
  };
  setMessage(`已导入配置：${file.name}`, "success");
}

async function exportResult() {
  const payload = state.simulationView === "single" ? state.result : state.batchSummary;
  if (!payload) {
    return;
  }

  await saveJsonFile(
    state.simulationView === "single" ? "battle-result.json" : "battle-batch-summary.json",
    payload,
  );
}

async function runSimulation() {
  if (state.isSubmitting) {
    return;
  }

  const validationError =
    state.simulationView === "single"
      ? validateBattleInput(state.draft)
      : validateBattleBatchCount(state.batchCount) ?? validateBattleInput(state.draft);
  if (validationError) {
    setMessage(validationError, "error");
    return;
  }

  state.isSubmitting = true;
  clearMessage();

  try {
    stopReplay();
    if (state.simulationView === "single") {
      state.result =
        state.simulationMode === "local"
          ? simulateBattle(state.draft)
          : await simulateBattleByApi(state.backendBaseUrl, state.draft);
      state.replayEventIndex = 0;
      state.isReplayPlaying = false;
      return;
    }

    state.batchSummary =
      state.simulationMode === "local"
        ? simulateBattleBatchSummary(state.draft, state.batchCount)
        : await simulateBattleBatchByApi(state.backendBaseUrl, {
            count: state.batchCount,
            input: state.draft,
          });
  } catch (error) {
    if (state.simulationView === "single") {
      state.result = null;
    } else {
      state.batchSummary = null;
    }
    setMessage(error instanceof Error ? error.message : "模拟请求失败", "error");
  } finally {
    state.isSubmitting = false;
  }
}

function stopReplay() {
  if (replayTimerId !== null) {
    window.clearInterval(replayTimerId);
    replayTimerId = null;
  }

  state.isReplayPlaying = false;
}

function getReplayEventCount() {
  return state.result?.events.length ?? 0;
}

function setReplayEventIndex(nextIndex: number) {
  const eventCount = getReplayEventCount();
  if (eventCount === 0) {
    state.replayEventIndex = 0;
    return;
  }

  state.replayEventIndex = Math.min(eventCount - 1, Math.max(0, nextIndex));
}

function stepReplay(offset: number) {
  setReplayEventIndex(state.replayEventIndex + offset);

  if (state.result && state.replayEventIndex >= state.result.events.length - 1) {
    stopReplay();
  }
}

function toggleReplay(container: HTMLElement) {
  if (!state.result) {
    return;
  }

  if (state.isReplayPlaying) {
    stopReplay();
    renderApp(container);
    return;
  }

  if (state.replayEventIndex >= state.result.events.length - 1) {
    state.replayEventIndex = 0;
  }

  state.isReplayPlaying = true;
  replayTimerId = window.setInterval(() => {
    if (!state.result || state.replayEventIndex >= state.result.events.length - 1) {
      stopReplay();
      renderApp(container);
      return;
    }

    stepReplay(1);
    renderApp(container);
  }, 500);
}

async function checkBackendHealth() {
  clearMessage();

  try {
    const health = await fetchBackendHealth(state.backendBaseUrl);
    setMessage(`后端连接正常：${health.service} / ${health.status}`, "success");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "后端连接失败", "error");
  }
}

function renderMessage() {
  if (!state.message) {
    return "";
  }

  return `<p class="message message-${state.messageTone}">${escapeHtml(state.message)}</p>`;
}

function formatSummaryRate(value: number) {
  const percent = Math.round(value * 10000) / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/\.?0+$/, "")}%`;
}

function formatNullableSummaryRate(value: number | null) {
  return value === null ? "-" : formatSummaryRate(value);
}

function formatSignedSummaryRate(value: number) {
  const formatted = formatSummaryRate(Math.abs(value));
  if (value > 0) {
    return `+${formatted}`;
  }

  if (value < 0) {
    return `-${formatted}`;
  }

  return formatted;
}

function getSimulationModeLabel(mode: SimulationMode) {
  return mode === "local" ? "前端本地运行" : "后端 API";
}

function renderHeroMeta(items: Array<{ label: string; tone?: HeroMetaTone; value: string }>) {
  return `
    <div class="hero-meta">
      ${items
        .map(
          (item) => `
            <div class="hero-pill hero-pill-${item.tone ?? "neutral"}">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value)}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderThemeSwitcher() {
  return `
    <div class="theme-switcher" role="group" aria-label="界面主题切换">
      <span class="theme-switcher-label">界面主题</span>
      <div class="theme-switcher-options">
        <button
          type="button"
          class="theme-switcher-button ${state.themeMode === "system" ? "is-active" : ""}"
          data-action="switch-theme"
          data-theme="system"
          aria-pressed="${state.themeMode === "system"}"
        >
          跟随系统
        </button>
        <button
          type="button"
          class="theme-switcher-button ${state.themeMode === "light" ? "is-active" : ""}"
          data-action="switch-theme"
          data-theme="light"
          aria-pressed="${state.themeMode === "light"}"
        >
          白天
        </button>
        <button
          type="button"
          class="theme-switcher-button ${state.themeMode === "dark" ? "is-active" : ""}"
          data-action="switch-theme"
          data-theme="dark"
          aria-pressed="${state.themeMode === "dark"}"
        >
          夜间
        </button>
      </div>
    </div>
  `;
}

function renderSimulationViewTabs() {
  return `
    <div class="view-switch" role="tablist" aria-label="执行视图">
      <button
        class="view-switch-button ${state.simulationView === "single" ? "is-active" : ""}"
        data-action="switch-simulation-view"
        data-view="single"
        role="tab"
        aria-selected="${state.simulationView === "single"}"
      >
        单场模拟
      </button>
      <button
        class="view-switch-button ${state.simulationView === "batch" ? "is-active" : ""}"
        data-action="switch-simulation-view"
        data-view="batch"
        role="tab"
        aria-selected="${state.simulationView === "batch"}"
      >
        多场统计
      </button>
    </div>
  `;
}

function renderReplayControls() {
  if (!state.result) {
    return `<p class="empty">运行模拟后，可以按事件时间轴逐步回放整场战斗。</p>`;
  }

  const currentEvent = state.result.events[state.replayEventIndex];
  const maxIndex = Math.max(0, state.result.events.length - 1);
  const primaryTimeLabel = getEventPrimaryTimeLabel();
  const primaryTimeValue = getEventPrimaryTimeValue(currentEvent);

  return `
    <div class="replay-panel">
      <div class="replay-toolbar">
        <button class="button button-secondary" data-action="replay-first" ${state.replayEventIndex === 0 ? "disabled" : ""}>首帧</button>
        <button class="button button-secondary" data-action="replay-prev" ${state.replayEventIndex === 0 ? "disabled" : ""}>上一步</button>
        <button class="button button-primary" data-action="replay-toggle">${state.isReplayPlaying ? "暂停" : "播放"}</button>
        <button class="button button-secondary" data-action="replay-next" ${state.replayEventIndex === maxIndex ? "disabled" : ""}>下一步</button>
        <button class="button button-secondary" data-action="replay-last" ${state.replayEventIndex === maxIndex ? "disabled" : ""}>末帧</button>
      </div>
      <div class="replay-status">
        <div class="summary-item">
          <span>当前事件</span>
          <strong>${state.replayEventIndex + 1} / ${state.result.events.length}</strong>
        </div>
        <div class="summary-item">
          <span>${primaryTimeLabel}</span>
          <strong>${primaryTimeValue}</strong>
        </div>
        <div class="summary-item">
          <span>事件类型</span>
          <strong>${escapeHtml(getBattleEventTypeLabel(currentEvent.type))}</strong>
        </div>
        <div class="summary-item">
          <span>随机种子</span>
          <strong>${state.result.randomSeed}</strong>
        </div>
      </div>
      <div class="field">
        <label>回放进度</label>
        <input type="range" min="0" max="${maxIndex}" value="${state.replayEventIndex}" data-action="replay-seek" />
      </div>
    </div>
  `;
}

function getEffectiveMaxHp(unit: BattleUnitState | BattleInput["units"][number]) {
  const stats = unit.stats;
  return Math.max(
    1,
    Math.floor(stats[unitStatRoleKeys.maxHpBase] * (1 + stats[unitStatRoleKeys.maxHpRate] / 100) + 0.5),
  );
}

function getEffectiveAttack(unit: BattleInput["units"][number]) {
  return Math.max(
    0,
    Math.floor(unit.stats[unitStatRoleKeys.attackBase] * (1 + unit.stats[unitStatRoleKeys.attackRate] / 100) + 0.5),
  );
}

function getEffectiveDefense(unit: BattleInput["units"][number]) {
  return Math.max(
    0,
    Math.floor(unit.stats[unitStatRoleKeys.defenseBase] * (1 + unit.stats[unitStatRoleKeys.defenseRate] / 100) + 0.5),
  );
}

function formatHpText(currentHp: number, maxHp: number | null) {
  return maxHp === null ? `${currentHp} HP` : `${currentHp}/${maxHp} HP`;
}

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase();
}

function renderEventHighlight(text: string, tone: "critical" | "miss") {
  return `<span class="event-highlight event-highlight-${tone}">${escapeHtml(text)}</span>`;
}

function getMinimumDamageNote(event: BattleSimulationResult["events"][number]) {
  return isMinimumDamageEvent(event) ? "（不破防）" : "";
}

function getBattleEventTypeLabel(type: BattleEventType) {
  return battleEventTypeLabels[type] ?? type;
}

function formatTimelineMs(value: number) {
  const formatCompactNumber = (nextValue: number) => {
    const roundedValue = Number(nextValue.toFixed(2));
    return Number.isInteger(roundedValue) ? `${roundedValue}` : `${roundedValue}`;
  };

  if (Math.abs(value) >= 1000) {
    return `${formatCompactNumber(value / 1000)} s`;
  }

  return `${formatCompactNumber(value)} ms`;
}

function getResultActionResolutionMode() {
  if (state.result) {
    const actionResolutionMode = state.result.events[0]?.payload?.actionResolutionMode;
    if (typeof actionResolutionMode === "string") {
      return actionResolutionMode as ActionResolutionMode;
    }
  }

  return state.draft.battle.actionResolutionMode;
}

function getEventPrimaryTimeLabel() {
  return getResultActionResolutionMode() === "turnBasedSpeed" ? "回合" : "时间";
}

function getEventPrimaryTimeValue(event: BattleSimulationResult["events"][number]) {
  if (getResultActionResolutionMode() === "turnBasedSpeed") {
    return `${event.round}`;
  }

  if (typeof event.payload?.timelineMs === "number") {
    return formatTimelineMs(event.payload.timelineMs);
  }

  return "-";
}

function getEventTargetMaxHp(event: BattleSimulationResult["events"][number]) {
  if (typeof event.payload?.targetMaxHp === "number") {
    return event.payload.targetMaxHp;
  }

  const target = event.targetId ? getUnitById(event.targetId) : null;
  return target ? getEffectiveMaxHp(target) : null;
}

function getEventSearchLabel(unitId: string | undefined) {
  if (!unitId) {
    return "";
  }

  const unit = getUnitById(unitId);
  if (!unit) {
    return unitId;
  }

  return `${unit.name.trim() || unit.id} ${unit.id}`;
}

function isMinimumDamageEvent(event: BattleSimulationResult["events"][number]) {
  if (event.type !== "damage_applied") {
    return false;
  }

  return event.payload?.isMinimumDamageByDefense === true;
}

function getEventSummaryText(event: BattleSimulationResult["events"][number]) {
  const actorName = event.actorId ? getUnitLabel(event.actorId) : null;
  const targetName = event.targetId ? getUnitLabel(event.targetId) : null;

  switch (event.type) {
    case "turn_started":
      return actorName && targetName ? `${actorName} 对 ${targetName} 发起攻击` : event.summary;
    case "reload_started":
    case "reload_completed":
      return event.summary;
    case "attack_missed":
      return actorName && targetName ? `${actorName} 攻击 ${targetName}，闪避/未命中` : event.summary;
    case "damage_applied": {
      const damage = typeof event.payload?.damage === "number" ? event.payload.damage : null;
      const targetHp = typeof event.payload?.targetHp === "number" ? event.payload.targetHp : null;
      if (actorName && targetName && damage !== null && targetHp !== null) {
        const damageTags = `${event.payload?.isHeadshot ? "爆头" : ""}${event.payload?.isCritical ? "暴击" : ""}`;
        return `${actorName} 对 ${targetName} 造成 ${damage} 点${damageTags}伤害，目标剩余 ${formatHpText(targetHp, getEventTargetMaxHp(event))}${getMinimumDamageNote(event)}`;
      }
      return event.summary;
    }
    case "unit_defeated":
      return targetName ? `${targetName} 被击败` : event.summary;
    case "battle_ended":
      if (event.payload?.winnerTeamId === null) {
        if (event.payload?.endReason === "maxBattleTimeMs") {
          return "战斗结束，达到最大战斗时长，结果按平局处理";
        }
        if (event.payload?.endReason === "maxRounds") {
          return "战斗结束，达到最大回合数，结果按平局处理";
        }
        return "战斗结束，结果为平局";
      }
      if (event.payload?.winnerTeamId === "A" || event.payload?.winnerTeamId === "B") {
        return `战斗结束，${state.draft.battle.teamNames[event.payload.winnerTeamId]}胜利！`;
      }
      return event.summary;
    default:
      return event.summary;
  }
}

function renderEventSummaryHtml(event: BattleSimulationResult["events"][number]) {
  const actorName = event.actorId ? getUnitLabel(event.actorId) : null;
  const targetName = event.targetId ? getUnitLabel(event.targetId) : null;

  switch (event.type) {
    case "turn_started":
      if (actorName && targetName) {
        return `${escapeHtml(actorName)} 对 ${escapeHtml(targetName)} 发起攻击`;
      }
      break;
    case "reload_started":
    case "reload_completed":
      return escapeHtml(event.summary);
    case "attack_missed":
      if (actorName && targetName) {
        return `${escapeHtml(actorName)} 攻击 ${escapeHtml(targetName)}，${renderEventHighlight("闪避/未命中", "miss")}`;
      }
      break;
    case "damage_applied": {
      const damage = typeof event.payload?.damage === "number" ? event.payload.damage : null;
      const targetHp = typeof event.payload?.targetHp === "number" ? event.payload.targetHp : null;
      if (actorName && targetName && damage !== null && targetHp !== null) {
        const headshotText = event.payload?.isHeadshot ? "爆头" : "";
        const criticalText = event.payload?.isCritical ? renderEventHighlight("暴击", "critical") : "";
        return `${escapeHtml(actorName)} 对 ${escapeHtml(targetName)} 造成 ${escapeHtml(String(damage))} 点${escapeHtml(headshotText)}${criticalText}伤害，目标剩余 ${escapeHtml(formatHpText(targetHp, getEventTargetMaxHp(event)))}${escapeHtml(getMinimumDamageNote(event))}`;
      }
      break;
    }
    case "unit_defeated":
      if (targetName) {
        return `${escapeHtml(targetName)} 被击败`;
      }
      break;
    case "battle_ended":
      if (event.payload?.winnerTeamId === null) {
        if (event.payload?.endReason === "maxBattleTimeMs") {
          return "战斗结束，达到最大战斗时长，结果按平局处理";
        }
        if (event.payload?.endReason === "maxRounds") {
          return "战斗结束，达到最大回合数，结果按平局处理";
        }
        return "战斗结束，结果为平局";
      }
      if (event.payload?.winnerTeamId === "A" || event.payload?.winnerTeamId === "B") {
        return `战斗结束，${escapeHtml(state.draft.battle.teamNames[event.payload.winnerTeamId])}胜利！`;
      }
      break;
    default:
      break;
  }

  return escapeHtml(getEventSummaryText(event));
}

function buildReplayUnits() {
  if (!state.result) {
    return [];
  }

  const units = state.draft.units.map<BattleUnitState>((unit) => ({
    ...unit,
    currentHp: getEffectiveMaxHp(unit),
    isAlive: true,
  }));

  for (const event of state.result.events.slice(0, state.replayEventIndex + 1)) {
    if (event.type !== "damage_applied" && event.type !== "unit_defeated") {
      continue;
    }

    const targetIndex = units.findIndex((unit) => unit.id === event.targetId);
    if (targetIndex < 0) {
      continue;
    }

    const targetHp =
      typeof event.payload?.targetHp === "number"
        ? event.payload.targetHp
        : event.type === "unit_defeated"
          ? 0
          : units[targetIndex].currentHp;

    units[targetIndex] = {
      ...units[targetIndex],
      currentHp: targetHp,
      isAlive: targetHp > 0,
    };
  }

  return units;
}

function matchesLogFilters(event: BattleSimulationResult["events"][number]) {
  const actorKeyword = normalizeSearchText(state.logFilters.actor);
  const targetKeyword = normalizeSearchText(state.logFilters.target);
  const summaryKeyword = normalizeSearchText(state.logFilters.summary);
  const actorText = normalizeSearchText(getEventSearchLabel(event.actorId));
  const targetText = normalizeSearchText(getEventSearchLabel(event.targetId));
  const summaryText = normalizeSearchText(getEventSummaryText(event));

  return (
    (!actorKeyword || actorText.includes(actorKeyword)) &&
    (!targetKeyword || targetText.includes(targetKeyword)) &&
    (!summaryKeyword || summaryText.includes(summaryKeyword))
  );
}

function applyLogFilters(container: HTMLElement) {
  const rows = container.querySelectorAll<HTMLTableRowElement>("[data-action='select-event']");
  let visibleCount = 0;

  rows.forEach((row) => {
    const eventIndex = Number(row.dataset.eventIndex ?? "-1");
    const event = Number.isInteger(eventIndex) && eventIndex >= 0 ? state.result?.events[eventIndex] : null;
    const matched = Boolean(event && matchesLogFilters(event));
    row.hidden = !matched;
    if (matched) {
      visibleCount += 1;
    }
  });

  const emptyRow = container.querySelector<HTMLTableRowElement>("[data-role='log-empty-row']");
  if (emptyRow) {
    emptyRow.hidden = visibleCount > 0;
  }
}

function getEventPayloadRows(event: BattleSimulationResult["events"][number]) {
  const payload = event.payload ?? {};
  const rows: Array<{ label: string; value: string }> = [];

  if (typeof payload.timelineMs === "number") {
    rows.push({ label: "时间点", value: formatTimelineMs(payload.timelineMs) });
  }

  switch (event.type) {
    case "battle_started":
      if (typeof payload.actionResolutionMode === "string") {
        rows.push({
          label: "行动结算模式",
          value:
            actionResolutionModeLabels[payload.actionResolutionMode as ActionResolutionMode] ?? payload.actionResolutionMode,
        });
      }
      if (typeof payload.maxRounds === "number") {
        rows.push({ label: battleConfigNumberMacroMap.maxRounds.label, value: formatBattleConfigValue("maxRounds", payload.maxRounds) });
      }
      if (typeof payload.maxBattleTimeMs === "number") {
        rows.push({
          label: "最大战斗时长",
          value: formatTimelineMs(payload.maxBattleTimeMs),
        });
      }
      if (typeof payload.unitCount === "number") {
        rows.push({ label: "单位总数", value: `${payload.unitCount}` });
      }
      rows.push({
        label: battleConfigNumberMacroMap.armorFormulaBase.label,
        value: formatBattleConfigValue("armorFormulaBase", state.draft.battle.armorFormulaBase),
      });
      rows.push({
        label: battleConfigNumberMacroMap.maxArmorDamageReduction.label,
        value: formatBattleConfigValue("maxArmorDamageReduction", state.draft.battle.maxArmorDamageReduction),
      });
      rows.push({
        label: battleConfigNumberMacroMap.elementAdvantageDamageRate.label,
        value: formatBattleConfigValue("elementAdvantageDamageRate", state.draft.battle.elementAdvantageDamageRate),
      });
      rows.push({
        label: battleConfigNumberMacroMap.elementDisadvantageDamageRate.label,
        value: formatBattleConfigValue("elementDisadvantageDamageRate", state.draft.battle.elementDisadvantageDamageRate),
      });
      break;
    case "round_started":
      if (typeof payload.actionResolutionMode === "string") {
        rows.push({
          label: "行动结算模式",
          value:
            actionResolutionModeLabels[payload.actionResolutionMode as ActionResolutionMode] ?? payload.actionResolutionMode,
        });
      }
      if (typeof payload.aliveA === "number") {
        rows.push({ label: "红方存活数", value: `${payload.aliveA}` });
      }
      if (typeof payload.aliveB === "number") {
        rows.push({ label: "蓝方存活数", value: `${payload.aliveB}` });
      }
      break;
    case "turn_started":
      if (typeof payload.fireRate === "number") {
        rows.push({ label: unitAttributeMacroMap.fireRate.label, value: `${payload.fireRate}` });
      }
      if (typeof payload.currentAmmo === "number") {
        rows.push({ label: "当前弹药", value: `${payload.currentAmmo}` });
      }
      if (typeof payload.magazineCapacity === "number") {
        rows.push({ label: "弹匣容量", value: `${payload.magazineCapacity}` });
      }
      break;
    case "reload_started":
      if (typeof payload.fireRate === "number") {
        rows.push({ label: unitAttributeMacroMap.fireRate.label, value: `${payload.fireRate}` });
      }
      if (typeof payload.currentAmmo === "number") {
        rows.push({ label: "当前弹药", value: `${payload.currentAmmo}` });
      }
      if (typeof payload.magazineCapacity === "number") {
        rows.push({ label: "弹匣容量", value: `${payload.magazineCapacity}` });
      }
      if (typeof payload.reloadTimeMs === "number") {
        rows.push({ label: "换弹动作时间", value: formatTimelineMs(payload.reloadTimeMs) });
      }
      if (typeof payload.reloadUntilMs === "number") {
        rows.push({ label: "换弹完成时间", value: formatTimelineMs(payload.reloadUntilMs) });
      }
      if (typeof payload.nextAttackTimeMs === "number") {
        rows.push({ label: "下一次攻击时间", value: formatTimelineMs(payload.nextAttackTimeMs) });
      }
      break;
    case "reload_completed":
      if (typeof payload.fireRate === "number") {
        rows.push({ label: unitAttributeMacroMap.fireRate.label, value: `${payload.fireRate}` });
      }
      if (typeof payload.currentAmmo === "number") {
        rows.push({ label: "当前弹药", value: `${payload.currentAmmo}` });
      }
      if (typeof payload.magazineCapacity === "number") {
        rows.push({ label: "弹匣容量", value: `${payload.magazineCapacity}` });
      }
      if (typeof payload.nextAttackTimeMs === "number") {
        rows.push({ label: "下一次攻击时间", value: formatTimelineMs(payload.nextAttackTimeMs) });
      }
      break;
    case "attack_missed":
      if (typeof payload.hitChance === "number") {
        rows.push({ label: "实际命中率%", value: `${payload.hitChance}%` });
      }
      break;
    case "damage_applied":
      if (typeof payload.baseDamage === "number") {
        rows.push({ label: "基础伤害", value: `${payload.baseDamage}` });
      }
      if (typeof payload.damage === "number") {
        rows.push({ label: "造成伤害", value: `${payload.damage}` });
      }
      if (typeof payload.targetHp === "number") {
        rows.push({
          label: "目标剩余生命",
          value: formatHpText(payload.targetHp, getEventTargetMaxHp(event)),
        });
      }
      if (typeof payload.isCritical === "boolean") {
        rows.push({ label: "是否暴击", value: payload.isCritical ? "是" : "否" });
      }
      if (typeof payload.criticalMultiplier === "number") {
        rows.push({ label: "暴击倍率%", value: `${payload.criticalMultiplier}%` });
      }
      if (typeof payload.isHeadshot === "boolean") {
        rows.push({ label: "是否爆头", value: payload.isHeadshot ? "是" : "否" });
      }
      if (typeof payload.headshotMultiplier === "number") {
        rows.push({ label: "爆头倍率%", value: `${payload.headshotMultiplier}%` });
      }
      if (typeof payload.effectiveAttack === "number") {
        rows.push({ label: "攻击值", value: `${payload.effectiveAttack}` });
      }
      if (typeof payload.effectiveDefense === "number") {
        rows.push({ label: "防御值", value: `${payload.effectiveDefense}` });
      }
      if (typeof payload.armorValue === "number") {
        rows.push({ label: "目标护甲", value: `${payload.armorValue}` });
      }
      if (typeof payload.armorPenetration === "number") {
        rows.push({ label: "攻击方穿甲", value: `${payload.armorPenetration}` });
      }
      if (typeof payload.armorReductionRate === "number") {
        rows.push({ label: "护甲减伤%", value: `${payload.armorReductionRate}%` });
      }
      if (typeof payload.elementRelation === "string") {
        rows.push({
          label: "元素关系",
          value: elementRelationLabels[payload.elementRelation as keyof typeof elementRelationLabels] ?? payload.elementRelation,
        });
      }
      if (typeof payload.elementMultiplier === "number") {
        rows.push({ label: "元素倍率%", value: `${payload.elementMultiplier}%` });
      }
      if (typeof payload.skillMultiplier === "number") {
        rows.push({ label: "技能倍率%", value: `${payload.skillMultiplier}%` });
      }
      if (typeof payload.scenarioMultiplier === "number") {
        rows.push({ label: "玩法场景倍率%", value: `${payload.scenarioMultiplier}%` });
      }
      if (typeof payload.heroClassMultiplier === "number") {
        rows.push({ label: "英雄职业倍率%", value: `${payload.heroClassMultiplier}%` });
      }
      if (typeof payload.skillTypeMultiplier === "number") {
        rows.push({ label: "技能类型倍率%", value: `${payload.skillTypeMultiplier}%` });
      }
      if (typeof payload.outputMultiplier === "number") {
        rows.push({ label: "输出乘区%", value: `${payload.outputMultiplier}%` });
      }
      if (typeof payload.damageTakenMultiplier === "number") {
        rows.push({ label: "承伤乘区%", value: `${payload.damageTakenMultiplier}%` });
      }
      if (typeof payload.finalDamageMultiplier === "number") {
        rows.push({ label: "最终乘区%", value: `${payload.finalDamageMultiplier}%` });
      }
      break;
    case "battle_ended":
      if (typeof payload.actionResolutionMode === "string") {
        rows.push({
          label: "行动结算模式",
          value:
            actionResolutionModeLabels[payload.actionResolutionMode as ActionResolutionMode] ?? payload.actionResolutionMode,
        });
      }
      if (payload.winnerTeamId === null) {
        rows.push({ label: "战斗结果", value: "平局" });
      } else if (payload.winnerTeamId === "A" || payload.winnerTeamId === "B") {
        rows.push({
          label: "战斗结果",
          value: `${state.draft.battle.teamNames[payload.winnerTeamId]}胜利！`,
        });
      }
      if (typeof payload.endReason === "string") {
        rows.push({
          label: "结束原因",
          value: battleEndReasonLabels[payload.endReason as keyof typeof battleEndReasonLabels] ?? payload.endReason,
        });
      }
      if (typeof payload.maxBattleTimeMs === "number") {
        rows.push({
          label: "最大战斗时长",
          value: formatTimelineMs(payload.maxBattleTimeMs),
        });
      }
      if (typeof payload.aliveA === "number") {
        rows.push({ label: "红方存活数", value: `${payload.aliveA}` });
      }
      if (typeof payload.aliveB === "number") {
        rows.push({ label: "蓝方存活数", value: `${payload.aliveB}` });
      }
      break;
    default:
      Object.entries(payload).forEach(([key, value]) => {
        rows.push({ label: key, value: String(value) });
      });
      break;
  }

  return rows;
}

function renderReplaySnapshot() {
  if (!state.result) {
    return "";
  }

  const replayUnits = buildReplayUnits();

  return `
    <div class="teams replay-snapshot">
      ${(["A", "B"] as TeamId[])
        .map((teamId) => {
          const teamUnits = replayUnits.filter((unit) => unit.teamId === teamId);

          return `
            <article class="panel panel-inner panel-replay-team panel-team-${teamId.toLowerCase()}">
              <div class="panel-body">
                <div class="panel-header">
                  <h3 class="panel-title">${escapeHtml(state.draft.battle.teamNames[teamId])} 当前状态</h3>
                </div>
                <div class="unit-list">
                  ${teamUnits
                    .map(
                      (unit) => `
                        <article class="unit-card unit-card-team-${unit.teamId.toLowerCase()} replay-unit ${unit.isAlive ? "" : "unit-card-defeated"}">
                          <header>
                            <strong>${escapeHtml(unit.name)}</strong>
                            <span class="badge badge-${unit.teamId.toLowerCase()}">${unit.isAlive ? "存活" : "阵亡"}</span>
                          </header>
                          <div class="replay-unit-stats">
                            <span>HP</span>
                            <strong>${unit.currentHp} / ${getEffectiveMaxHp(unit)}</strong>
                          </div>
                        </article>
                      `,
                    )
                    .join("")}
                </div>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderEventPayload() {
  if (!state.result) {
    return "";
  }

  const currentEvent = state.result.events[state.replayEventIndex];
  const payloadEntries = getEventPayloadRows(currentEvent);
  const payloadContent =
    payloadEntries.length === 0
      ? `<p class="empty">当前事件没有附加载荷。</p>`
      : `<div class="payload-grid">${payloadEntries
          .map(
            ({ label, value }) => `
              <div class="summary-item">
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(value)}</strong>
              </div>
            `,
          )
          .join("")}</div>`;

  return `
    <div class="event-detail">
      <p class="event-summary">${renderEventSummaryHtml(currentEvent)}</p>
      ${renderReplaySnapshot()}
      ${payloadContent}
    </div>
  `;
}

function renderUnitQuickStats(unit: BattleInput["units"][number]) {
  const items = [
    { label: "生命", value: `${getEffectiveMaxHp(unit)}` },
    { label: "攻击", value: `${getEffectiveAttack(unit)}` },
    { label: "防御", value: `${getEffectiveDefense(unit)}` },
    { label: "速度", value: `${unit.stats[unitStatRoleKeys.speed]}` },
  ];

  return `
    <div class="unit-quick-stats">
      ${items
        .map(
          (item) => `
            <div class="summary-item unit-quick-stat">
              <span>${item.label}</span>
              <strong>${escapeHtml(item.value)}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderUnitCard(unit: BattleInput["units"][number]) {
  const slot = getUnitPositionSlot(unit.id);

  return `
    <article class="unit-card unit-card-team-${unit.teamId.toLowerCase()} unit-card-compact" draggable="true" data-action="drag-unit" data-unit-id="${unit.id}">
      <div class="unit-card-name">
        <input
          class="unit-name-input"
          draggable="false"
          data-action="update-unit-name"
          data-unit-id="${unit.id}"
          data-focus-key="unit-name:${escapeHtml(unit.id)}"
          value="${escapeHtml(unit.name)}"
        />
      </div>
      <div class="unit-meta">
        <span class="badge badge-${unit.teamId.toLowerCase()}">${escapeHtml(unit.id)}</span>
        <span class="badge badge-neutral">${unitPositionLabels[unit.position]}</span>
        <span class="badge badge-neutral">${slot} 号位</span>
      </div>
      ${renderUnitQuickStats(unit)}
      <div class="unit-card-actions">
        <button class="button button-danger" data-action="remove-unit" data-unit-id="${unit.id}">移除</button>
        <button class="button button-ghost" data-action="edit-unit" data-unit-id="${unit.id}">属性详情</button>
      </div>
    </article>
  `;
}

function getUnitDerivedMetricValue(unit: BattleInput["units"][number], key: UnitDerivedMetricKey) {
  switch (key) {
    case "effectiveMaxHp":
      return `${getEffectiveMaxHp(unit)}`;
    case "effectiveAttack":
      return `${getEffectiveAttack(unit)}`;
    case "effectiveDefense":
      return `${getEffectiveDefense(unit)}`;
  }
}

function renderUnitStatField(unit: BattleInput["units"][number], field: UnitStatFieldKey) {
  const macro = unitAttributeMacroMap[field];

  return `
    <div class="field">
      <label>${escapeHtml(macro.label)}</label>
      <input
        type="number"
        min="${macro.min}"
        step="${macro.step}"
        data-action="update-unit-stat"
        data-unit-id="${unit.id}"
        data-field="${macro.key}"
        data-focus-key="unit-stat:${escapeHtml(unit.id)}:${macro.key}"
        value="${unit.stats[macro.key]}"
      />
    </div>
  `;
}

function renderUnitAttributeSections(unit: BattleInput["units"][number]) {
  return unitEditorAttributeSections
    .map(
      (section) => `
        <section class="unit-attribute-section">
          <header class="unit-attribute-section-header">
            <h3>${section.title}</h3>
          </header>
          ${
            section.derivedMetrics?.length
              ? `
                <div class="unit-attribute-derived-grid">
                  ${section.derivedMetrics
                    .map(
                      (metric) => `
                        <div class="summary-item unit-attribute-derived">
                          <span>${metric.label}</span>
                          <strong>${escapeHtml(getUnitDerivedMetricValue(unit, metric.key))}</strong>
                        </div>
                      `,
                    )
                    .join("")}
                </div>
              `
              : ""
          }
          <div class="unit-attribute-rows">
            ${section.rows
              .map(
                (row) => `
                  <div class="unit-attribute-row">
                    ${row.map((field) => renderUnitStatField(unit, field)).join("")}
                  </div>
                `,
              )
              .join("")}
          </div>
        </section>
      `,
    )
    .join("");
}

function renderFormationMatrix(teamId: TeamId) {
  const displayOrder = teamId === "A" ? [...unitPositionOrder].reverse() : unitPositionOrder;

  return `
    <div class="formation-grid formation-grid-team-${teamId.toLowerCase()} ${teamId === "A" ? "formation-grid-mirrored" : ""}">
      ${displayOrder
        .map((position) => {
          const units = getUnitsByTeamAndPosition(teamId, position);

          return `
            <section class="formation-column formation-column-${teamId.toLowerCase()}">
              <header class="formation-column-header">
                <h3>${unitPositionLabels[position]}</h3>
                <span>${units.length} 人</span>
              </header>
              <div class="formation-column-body">
                <div class="formation-track" data-action="formation-track" data-drop-team-id="${teamId}" data-drop-position="${position}">
                  ${units.length > 0 ? units.map((unit) => renderUnitCard(unit)).join("") : `<p class="empty formation-empty">拖入这里</p>`}
                </div>
              </div>
            </section>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderUnitEditorPage() {
  const unit = state.editingUnitId ? getUnitById(state.editingUnitId) : null;
  if (!unit) {
    return "";
  }

  return `
    <main class="page page-subpage">
      ${renderThemeSwitcher()}
      <section class="hero hero-subpage">
        <button class="button button-ghost" data-action="close-unit-editor">返回编队总览</button>
        <div class="hero-content">
          <div class="hero-kicker">单位编辑</div>
          <h1>${escapeHtml(unit.name)}</h1>
          <p>
            当前单位属于 ${escapeHtml(state.draft.battle.teamNames[unit.teamId])}，属性较多时统一在这里编辑，
            主页面只保留概览和结果区。
          </p>
          ${renderHeroMeta([
            { label: "所属队伍", tone: unit.teamId.toLowerCase() as HeroMetaTone, value: state.draft.battle.teamNames[unit.teamId] },
            { label: "攻击元素", tone: "neutral", value: attackElementLabels[unit.attackElement] },
            { label: "防护类型", tone: "neutral", value: protectionTypeLabels[unit.protectionType] },
          ])}
        </div>
      </section>

      <section class="layout">
        <article class="panel panel-editor panel-editor-${unit.teamId.toLowerCase()}">
          <div class="panel-body">
            <div class="panel-header">
              <h2 class="panel-title">基础信息</h2>
              <span class="badge badge-${unit.teamId.toLowerCase()}">${escapeHtml(unit.id)}</span>
            </div>
            <div class="grid-3">
              <div class="field">
                <label>攻击元素</label>
                <select data-action="update-unit-attack-element" data-unit-id="${unit.id}">
                  ${attackElementOrder
                    .map(
                      (attackElement) =>
                        `<option value="${attackElement}" ${unit.attackElement === attackElement ? "selected" : ""}>${attackElementLabels[attackElement]}</option>`,
                    )
                    .join("")}
                </select>
              </div>
              <div class="field">
                <label>防护类型</label>
                <select data-action="update-unit-protection-type" data-unit-id="${unit.id}">
                  ${protectionTypeOrder
                    .map(
                      (protectionType) =>
                        `<option value="${protectionType}" ${unit.protectionType === protectionType ? "selected" : ""}>${protectionTypeLabels[protectionType]}</option>`,
                    )
                    .join("")}
                </select>
              </div>
            </div>
          </div>
        </article>

        <article class="panel panel-editor panel-editor-${unit.teamId.toLowerCase()}">
          <div class="panel-body">
            <div class="panel-header">
              <h2 class="panel-title">属性详情</h2>
              <div class="toolbar">
                <button class="button button-secondary" data-action="close-unit-editor">完成编辑</button>
              </div>
            </div>
            <div class="unit-attribute-sections">${renderUnitAttributeSections(unit)}</div>
            ${renderMessage()}
          </div>
        </article>
      </section>
    </main>
  `;
}

function renderSingleSummary() {
  if (!state.result) {
    return `<p class="empty">运行一次模拟后，这里会展示胜负、回合数、幸存单位与完整事件流。</p>`;
  }

  const winner =
    state.result.winnerTeamId === null
      ? "平局"
      : `${state.draft.battle.teamNames[state.result.winnerTeamId]}胜利！`;
  const survivors = state.result.finalUnits.filter((unit) => unit.isAlive);
  const survivorText =
    survivors.length === 0
      ? "无"
      : survivors
          .map((unit) => `${escapeHtml(unit.name.trim() || unit.id)}：${escapeHtml(formatHpText(unit.currentHp, getEffectiveMaxHp(unit)))}`)
          .join("<br />");
  const winnerToneClass =
    state.result.winnerTeamId === null
      ? "summary-item-neutral"
      : `summary-item-highlight summary-item-team-${state.result.winnerTeamId.toLowerCase()}`;

  return `
    <div class="summary">
      <div class="summary-item summary-item-neutral">
        <span>随机种子</span>
        <strong>${state.result.randomSeed}</strong>
      </div>
      <div class="summary-item ${winnerToneClass}">
        <span>战斗结果</span>
        <strong>${escapeHtml(winner)}</strong>
      </div>
      <div class="summary-item summary-item-blue">
        <span>完成回合</span>
        <strong>${state.result.roundsCompleted}</strong>
      </div>
      <div class="summary-item summary-item-highlight">
        <span>幸存单位</span>
        <strong>${survivorText}</strong>
      </div>
    </div>
  `;
}

function renderBatchSummary() {
  if (!state.batchSummary) {
    return `<p class="empty">输入模拟场次后运行统计，这里会展示胜率、平局率与完成节奏摘要。</p>`;
  }

  const usesRoundMetrics = state.draft.battle.actionResolutionMode === "turnBasedSpeed";
  const averageCompletionLabel = usesRoundMetrics ? "平均完成回合" : "平均完成时间";
  const minCompletionLabel = usesRoundMetrics ? "最短回合" : "最短时间";
  const maxCompletionLabel = usesRoundMetrics ? "最长回合" : "最长时间";
  const averageCompletionValue = usesRoundMetrics
    ? `${state.batchSummary.averageRounds}`
    : formatTimelineMs(state.batchSummary.averageDurationMs);
  const minCompletionValue = usesRoundMetrics ? `${state.batchSummary.minRounds}` : formatTimelineMs(state.batchSummary.minDurationMs);
  const maxCompletionValue = usesRoundMetrics ? `${state.batchSummary.maxRounds}` : formatTimelineMs(state.batchSummary.maxDurationMs);

  return `
    <div class="summary">
      <div class="summary-item summary-item-neutral">
        <span>根种子</span>
        <strong>${state.batchSummary.baseSeed}</strong>
      </div>
      <div class="summary-item summary-item-highlight">
        <span>总场次</span>
        <strong>${state.batchSummary.totalBattles}</strong>
      </div>
      <div class="summary-item summary-item-team-a">
        <span>${escapeHtml(state.draft.battle.teamNames.A)}胜场 / 胜率</span>
        <strong>${state.batchSummary.wins.A} / ${formatSummaryRate(state.batchSummary.winRates.A)}</strong>
      </div>
      <div class="summary-item summary-item-team-b">
        <span>${escapeHtml(state.draft.battle.teamNames.B)}胜场 / 胜率</span>
        <strong>${state.batchSummary.wins.B} / ${formatSummaryRate(state.batchSummary.winRates.B)}</strong>
      </div>
      <div class="summary-item summary-item-team-a">
        <span>${escapeHtml(state.draft.battle.teamNames.A)}平均终局净优势</span>
        <strong>${formatSignedSummaryRate(state.batchSummary.averageTerminalNetAdvantages.A)}</strong>
      </div>
      <div class="summary-item summary-item-team-b">
        <span>${escapeHtml(state.draft.battle.teamNames.B)}平均终局净优势</span>
        <strong>${formatSignedSummaryRate(state.batchSummary.averageTerminalNetAdvantages.B)}</strong>
      </div>
      <div class="summary-item summary-item-team-a">
        <span>${escapeHtml(state.draft.battle.teamNames.A)}获胜场次总剩余血量%</span>
        <strong>${formatNullableSummaryRate(state.batchSummary.remainingHpRatesOnWins.A)}</strong>
      </div>
      <div class="summary-item summary-item-team-b">
        <span>${escapeHtml(state.draft.battle.teamNames.B)}获胜场次总剩余血量%</span>
        <strong>${formatNullableSummaryRate(state.batchSummary.remainingHpRatesOnWins.B)}</strong>
      </div>
      <div class="summary-item summary-item-neutral">
        <span>平局场次 / 占比</span>
        <strong>${state.batchSummary.draws} / ${formatSummaryRate(state.batchSummary.drawRate)}</strong>
      </div>
      <div class="summary-item summary-item-blue">
        <span>${averageCompletionLabel}</span>
        <strong>${averageCompletionValue}</strong>
      </div>
      <div class="summary-item summary-item-neutral">
        <span>${minCompletionLabel}</span>
        <strong>${minCompletionValue}</strong>
      </div>
      <div class="summary-item summary-item-neutral">
        <span>${maxCompletionLabel}</span>
        <strong>${maxCompletionValue}</strong>
      </div>
    </div>
  `;
}

function renderSummary() {
  return state.simulationView === "single" ? renderSingleSummary() : renderBatchSummary();
}

function renderLogTable() {
  if (!state.result) {
    return "";
  }

  const primaryTimeLabel = getEventPrimaryTimeLabel();
  const rows = state.result.events
    .map((event) => {
      const actor = state.draft.units.find((unit) => unit.id === event.actorId);
      const target = state.draft.units.find((unit) => unit.id === event.targetId);
      const actorBadge = actor ? `<span class="badge badge-${actor.teamId.toLowerCase()}">${escapeHtml(actor.name)}</span>` : "-";
      const targetBadge = target ? `<span class="badge badge-${target.teamId.toLowerCase()}">${escapeHtml(target.name)}</span>` : "-";
      const rowClassNames = [
        event.sequence - 1 === state.replayEventIndex ? "is-active" : "",
        isMinimumDamageEvent(event) ? "is-minimum-damage" : "",
      ]
        .filter(Boolean)
        .join(" ");

      return `
        <tr class="${rowClassNames}" data-action="select-event" data-event-index="${event.sequence - 1}">
          <td>${event.sequence}</td>
          <td>${getEventPrimaryTimeValue(event)}</td>
          <td>${escapeHtml(getBattleEventTypeLabel(event.type))}</td>
          <td>${actorBadge}</td>
          <td>${targetBadge}</td>
          <td>${renderEventSummaryHtml(event)}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="log-filters">
      <div class="field">
        <label>执行者筛选</label>
        <input
          data-action="update-log-filter"
          data-field="actor"
          data-focus-key="log-filter:actor"
          placeholder="支持模糊匹配名称或 ID"
          value="${escapeHtml(state.logFilters.actor)}"
        />
      </div>
      <div class="field">
        <label>目标筛选</label>
        <input
          data-action="update-log-filter"
          data-field="target"
          data-focus-key="log-filter:target"
          placeholder="支持模糊匹配名称或 ID"
          value="${escapeHtml(state.logFilters.target)}"
        />
      </div>
      <div class="field">
        <label>说明筛选</label>
        <input
          data-action="update-log-filter"
          data-field="summary"
          data-focus-key="log-filter:summary"
          placeholder="支持模糊匹配说明文字"
          value="${escapeHtml(state.logFilters.summary)}"
        />
      </div>
    </div>
    <div class="log-table-wrap">
      <table class="log-table">
        <thead>
          <tr>
            <th>#</th>
            <th>${primaryTimeLabel}</th>
            <th>事件类型</th>
            <th>执行者</th>
            <th>目标</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr class="log-empty-row" data-role="log-empty-row" hidden><td colspan="6">没有匹配的事件</td></tr>
        </tbody>
      </table>
    </div>
  `;
}

function renderMainPage() {
  const isSingleView = state.simulationView === "single";
  const canExport = isSingleView ? state.result !== null : state.batchSummary !== null;
  const battleNumberFieldsHtml = battleConfigNumberMacros
    .map(
      (macro) => `
        <div class="field">
          <label>${escapeHtml(macro.label)}</label>
          <input
            type="number"
            min="${macro.min}"
            ${macro.max === undefined ? "" : `max="${macro.max}"`}
            step="${macro.step}"
            data-action="update-battle"
            data-field="${macro.key}"
            data-focus-key="battle:${macro.key}"
            value="${state.draft.battle[macro.key]}"
          />
        </div>
      `,
    )
    .join("");

  return `
    <main class="page">
      ${renderThemeSwitcher()}
      <section class="hero">
        <div class="hero-kicker">内部工具 · 战斗规则验证</div>
        <h1>基础战斗模拟器</h1>
        <p>
          当前版本已经支持统一时间轴下的两种行动结算模式、射速、弹匣、换弹、元素关系与多乘区伤害结算。
          后续继续增加技能、状态和更复杂的时序规则时，可以直接在现有事件流和模拟引擎上迭代。
        </p>
        ${renderHeroMeta([
          { label: "执行方式", tone: state.simulationMode === "local" ? "accent" : "blue", value: getSimulationModeLabel(state.simulationMode) },
          { label: "当前视图", tone: "neutral", value: isSingleView ? "单场模拟" : `多场统计 · ${state.batchCount} 场` },
          { label: "行动结算", tone: "blue", value: actionResolutionModeLabels[state.draft.battle.actionResolutionMode] },
          { label: "目标策略", tone: "neutral", value: targetingStrategyLabels[state.draft.battle.targetingStrategy] },
        ])}
      </section>

      <section class="layout">
        <article class="panel panel-parameters">
          <div class="panel-body">
            <div class="panel-header">
              <h2 class="panel-title">整场战斗参数</h2>
              <div class="toolbar">
                <button class="button button-secondary" data-action="reset">恢复默认</button>
                <button class="button button-secondary" data-action="refresh-seed">刷新种子</button>
                <button class="button button-ghost" data-action="import-draft">导入配置</button>
                <button class="button button-ghost" data-action="export-draft">导出配置</button>
                <input type="file" accept=".json,application/json" data-action="import-draft-file" hidden />
                <button class="button button-primary" data-action="simulate" ${state.isSubmitting ? "disabled" : ""}>${state.isSubmitting ? "运行中..." : isSingleView ? "运行模拟" : "运行统计"}</button>
              </div>
            </div>
            ${renderSimulationViewTabs()}
            <div class="grid-3">
              <div class="field">
                <label>模拟执行方式</label>
                <select data-action="update-simulation-mode" data-focus-key="simulation-mode">
                  <option value="local" ${state.simulationMode === "local" ? "selected" : ""}>前端本地运行</option>
                  <option value="backend" ${state.simulationMode === "backend" ? "selected" : ""}>调用后端 API</option>
                </select>
              </div>
              <div class="field">
                <label>后端地址</label>
                <input data-action="update-backend-url" data-focus-key="backend-url" value="${escapeHtml(state.backendBaseUrl)}" />
              </div>
              <div class="field field-actions">
                <label>后端检查</label>
                <button class="button button-ghost" data-action="check-backend" ${state.isSubmitting ? "disabled" : ""}>检查连接</button>
              </div>
              <div class="field">
                <label>红方名称</label>
                <input
                  data-action="update-team-name"
                  data-team-id="A"
                  data-focus-key="team-name:A"
                  value="${escapeHtml(state.draft.battle.teamNames.A)}"
                />
              </div>
              <div class="field">
                <label>蓝方名称</label>
                <input
                  data-action="update-team-name"
                  data-team-id="B"
                  data-focus-key="team-name:B"
                  value="${escapeHtml(state.draft.battle.teamNames.B)}"
                />
              </div>
              ${battleNumberFieldsHtml}
              <div class="field">
                <label>目标策略</label>
                <select data-action="update-battle" data-field="targetingStrategy" data-focus-key="battle:targetingStrategy">
                  ${Object.entries(targetingStrategyLabels)
                    .map(
                      ([value, label]) =>
                        `<option value="${value}" ${state.draft.battle.targetingStrategy === value ? "selected" : ""}>${escapeHtml(label)}</option>`,
                    )
                    .join("")}
                </select>
              </div>
              <div class="field">
                <label>行动结算模式</label>
                <select
                  data-action="update-battle"
                  data-field="actionResolutionMode"
                  data-focus-key="battle:actionResolutionMode"
                >
                  ${actionResolutionModeOrder
                    .map(
                      (value) =>
                        `<option value="${value}" ${state.draft.battle.actionResolutionMode === value ? "selected" : ""}>${escapeHtml(actionResolutionModeLabels[value])}</option>`,
                    )
                    .join("")}
                </select>
              </div>
              ${isSingleView ? "" : `
                <div class="field">
                  <label>模拟场次</label>
                  <input
                    type="number"
                    min="1"
                    max="5000"
                    step="1"
                    data-action="update-batch-count"
                    data-focus-key="batch-count"
                    value="${state.batchCount}"
                  />
                </div>
              `}
            </div>
            ${renderMessage()}
          </div>
        </article>

        <section class="teams">
          ${(["A", "B"] as TeamId[])
            .map((teamId) => {
              const isTeamA = teamId === "A";
              const buttonStyle = isTeamA ? "button-secondary" : "button-ghost";

              return `
                <article class="panel panel-team panel-team-${teamId.toLowerCase()}">
                  <div class="panel-body">
                    <div class="panel-header">
                      <h2 class="panel-title">${escapeHtml(state.draft.battle.teamNames[teamId])} 编队</h2>
                      <button class="button ${buttonStyle}" data-action="add-unit" data-team-id="${teamId}">新增单位</button>
                    </div>
                    <p class="empty section-note">编队按前排、中排、后排展示。“前排优先”策略会先攻击敌方前排，前排清空后再打中排、后排。</p>
                    ${renderFormationMatrix(teamId)}
                  </div>
                </article>
              `;
            })
            .join("")}
        </section>

        <article class="panel panel-results">
          <div class="panel-body">
            <div class="panel-header">
              <h2 class="panel-title">${isSingleView ? "模拟结果" : "统计结果"}</h2>
              <div class="toolbar">
                <button class="button button-ghost" data-action="export-result" ${canExport ? "" : "disabled"}>导出结果</button>
              </div>
            </div>
            ${renderSummary()}
          </div>
        </article>

        ${isSingleView
          ? `
            <article class="panel panel-replay">
              <div class="panel-body">
                <div class="panel-header">
                  <h2 class="panel-title">战斗回放</h2>
                </div>
                ${renderReplayControls()}
              </div>
            </article>

            <article class="panel panel-current-event">
              <div class="panel-body">
                <div class="panel-header">
                  <h2 class="panel-title">当前事件</h2>
                </div>
                ${renderEventPayload()}
              </div>
            </article>

            <article class="panel panel-log">
              <div class="panel-body">
                <div class="panel-header">
                  <h2 class="panel-title">事件日志</h2>
                </div>
                ${renderLogTable()}
              </div>
            </article>
          `
          : ""}
      </section>
    </main>
  `;
}

function renderApp(container: HTMLElement) {
  applyThemeMode();
  const snapshot = captureRenderState();
  container.innerHTML = state.editingUnitId ? renderUnitEditorPage() : renderMainPage();
  bindEvents(container);
  restoreRenderState(snapshot, container);
}

function bindEvents(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>("[data-action='drag-unit']").forEach((card) => {
    card.addEventListener("dragstart", (event) => {
      const handle = event.currentTarget as HTMLElement;
      const activeElement = document.activeElement;
      if (
        handle.draggable === false ||
        (activeElement instanceof HTMLInputElement &&
          activeElement.dataset.action === "update-unit-name" &&
          handle.contains(activeElement))
      ) {
        event.preventDefault();
        return;
      }

      draggingUnitId = handle.dataset.unitId ?? null;
      handle.classList.add("is-dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggingUnitId ?? "");
      }
    });

    card.addEventListener("dragend", (event) => {
      const handle = event.currentTarget as HTMLElement;
      draggingUnitId = null;
      clearDropIndicatorState();
      handle.classList.remove("is-dragging");
    });
  });

  container.querySelectorAll<HTMLElement>("[data-action='formation-track']").forEach((track) => {
    track.addEventListener("dragover", (event) => {
      if (!draggingUnitId) {
        return;
      }

      const draggingUnit = getUnitById(draggingUnitId);
      const targetTeamId = track.dataset.dropTeamId as TeamId | undefined;
      const targetPosition = track.dataset.dropPosition as UnitPosition | undefined;
      if (!draggingUnit || !targetTeamId || !targetPosition || draggingUnit.teamId !== targetTeamId) {
        return;
      }

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      updateDropIndicator(track, {
        teamId: targetTeamId,
        position: targetPosition,
        index: getDropIndexFromPointer(track, event.clientY),
      });
    });

    track.addEventListener("dragleave", (event) => {
      const relatedTarget = event.relatedTarget;
      if (relatedTarget instanceof Node && track.contains(relatedTarget)) {
        return;
      }

      if (activeDropIndicator?.parentElement === track) {
        clearDropIndicatorState();
      }
    });

    track.addEventListener("drop", (event) => {
      if (!draggingUnitId) {
        return;
      }

      const draggingUnit = getUnitById(draggingUnitId);
      const targetTeamId = track.dataset.dropTeamId as TeamId | undefined;
      const targetPosition = track.dataset.dropPosition as UnitPosition | undefined;
      const targetIndex = activeDropTarget?.teamId === targetTeamId && activeDropTarget.position === targetPosition
        ? activeDropTarget.index
        : getDropIndexFromPointer(track, event.clientY);
      if (!draggingUnit || !targetTeamId || !targetPosition || draggingUnit.teamId !== targetTeamId) {
        return;
      }

      event.preventDefault();
      const unitId = draggingUnitId;
      draggingUnitId = null;
      clearDropIndicatorState();
      moveUnitToFormation(unitId, targetPosition, targetIndex);
      renderApp(container);
    });
  });

  container.querySelectorAll<HTMLInputElement>("[data-action='update-unit-name']").forEach((input) => {
    const syncCardDragState = (enabled: boolean) => {
      const card = input.closest<HTMLElement>("[data-action='drag-unit']");
      if (!card) {
        return;
      }

      card.draggable = enabled;
    };

    input.addEventListener("pointerdown", () => {
      syncCardDragState(false);
    });

    input.addEventListener("focus", () => {
      syncCardDragState(false);
    });

    input.addEventListener("blur", () => {
      syncCardDragState(true);
    });

    input.addEventListener("change", (event) => {
      const target = event.currentTarget as HTMLInputElement;
      updateUnitName(target.dataset.unitId ?? "", target.value);
      renderApp(container);
    });
  });

  container.querySelectorAll<HTMLInputElement>("[data-action='update-unit-stat']").forEach((input) => {
    input.addEventListener("change", (event) => {
      const target = event.currentTarget as HTMLInputElement;
      updateUnitStat(target.dataset.unitId ?? "", target.dataset.field ?? "", target.value);
      renderApp(container);
    });
  });

  container.querySelectorAll<HTMLSelectElement>("[data-action='update-unit-position']").forEach((input) => {
    input.addEventListener("change", (event) => {
      const target = event.currentTarget as HTMLSelectElement;
      updateUnitPosition(target.dataset.unitId ?? "", target.value);
      renderApp(container);
    });
  });

  container.querySelectorAll<HTMLSelectElement>("[data-action='update-unit-attack-element']").forEach((input) => {
    input.addEventListener("change", (event) => {
      const target = event.currentTarget as HTMLSelectElement;
      updateUnitAttackElement(target.dataset.unitId ?? "", target.value);
      renderApp(container);
    });
  });

  container.querySelectorAll<HTMLSelectElement>("[data-action='update-unit-protection-type']").forEach((input) => {
    input.addEventListener("change", (event) => {
      const target = event.currentTarget as HTMLSelectElement;
      updateUnitProtectionType(target.dataset.unitId ?? "", target.value);
      renderApp(container);
    });
  });

  container.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-action='update-battle']").forEach((input) => {
    input.addEventListener("change", (event) => {
      const target = event.currentTarget as HTMLInputElement | HTMLSelectElement;
      updateBattleField(
        (target.dataset.field as BattleNumberFieldKey | "targetingStrategy" | "actionResolutionMode") ?? "maxRounds",
        target.value,
      );
      renderApp(container);
    });
  });

  container.querySelectorAll<HTMLInputElement>("[data-action='update-team-name']").forEach((input) => {
    input.addEventListener("change", (event) => {
      const target = event.currentTarget as HTMLInputElement;
      updateTeamName((target.dataset.teamId as TeamId) ?? "A", target.value);
      renderApp(container);
    });
  });

  container.querySelectorAll<HTMLButtonElement>("[data-action='add-unit']").forEach((button) => {
    button.addEventListener("click", () => {
      addUnit((button.dataset.teamId as TeamId) ?? "A");
      renderApp(container);
    });
  });

  container.querySelectorAll<HTMLButtonElement>("[data-action='remove-unit']").forEach((button) => {
    button.addEventListener("click", () => {
      removeUnit(button.dataset.unitId ?? "");
      renderApp(container);
    });
  });

  container.querySelectorAll<HTMLButtonElement>("[data-action='edit-unit']").forEach((button) => {
    button.addEventListener("click", () => {
      openUnitEditor(button.dataset.unitId ?? "");
      renderApp(container);
    });
  });

  container.querySelectorAll<HTMLButtonElement>("[data-action='close-unit-editor']").forEach((button) => {
    button.addEventListener("click", () => {
      closeUnitEditor();
      renderApp(container);
    });
  });

  container.querySelectorAll<HTMLButtonElement>("[data-action='switch-theme']").forEach((button) => {
    button.addEventListener("click", () => {
      updateThemeMode(button.dataset.theme ?? "light");
      renderApp(container);
    });
  });

  container.querySelector<HTMLSelectElement>("[data-action='update-simulation-mode']")?.addEventListener("change", (event) => {
    const target = event.currentTarget as HTMLSelectElement;
    updateSimulationMode((target.value as SimulationMode) ?? "local");
    renderApp(container);
  });

  container.querySelectorAll<HTMLButtonElement>("[data-action='switch-simulation-view']").forEach((button) => {
    button.addEventListener("click", () => {
      updateSimulationView((button.dataset.view as SimulationView) ?? "single");
      renderApp(container);
    });
  });

  container.querySelector<HTMLInputElement>("[data-action='update-batch-count']")?.addEventListener("change", (event) => {
    const target = event.currentTarget as HTMLInputElement;
    updateBatchCount(target.value);
    renderApp(container);
  });

  container.querySelector<HTMLInputElement>("[data-action='update-backend-url']")?.addEventListener("change", (event) => {
    const target = event.currentTarget as HTMLInputElement;
    updateBackendBaseUrl(target.value);
    renderApp(container);
  });

  container.querySelector("[data-action='check-backend']")?.addEventListener("click", async () => {
    await checkBackendHealth();
    renderApp(container);
  });

  container.querySelector("[data-action='simulate']")?.addEventListener("click", async () => {
    stopReplay();
    await runSimulation();
    renderApp(container);
  });

  container.querySelector("[data-action='reset']")?.addEventListener("click", () => {
    resetDraft();
    renderApp(container);
  });

  container.querySelector("[data-action='refresh-seed']")?.addEventListener("click", () => {
    refreshRandomSeed();
    renderApp(container);
  });

  container.querySelector("[data-action='export-draft']")?.addEventListener("click", async () => {
    await exportDraft();
    renderApp(container);
  });

  container.querySelector("[data-action='import-draft']")?.addEventListener("click", () => {
    container.querySelector<HTMLInputElement>("[data-action='import-draft-file']")?.click();
  });

  container.querySelector<HTMLInputElement>("[data-action='import-draft-file']")?.addEventListener("change", async (event) => {
    const target = event.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    target.value = "";
    if (!file) {
      return;
    }

    await importDraft(file);
    renderApp(container);
  });

  container.querySelector("[data-action='export-result']")?.addEventListener("click", async () => {
    await exportResult();
    renderApp(container);
  });

  container.querySelectorAll<HTMLInputElement>("[data-action='update-log-filter']").forEach((input) => {
    input.addEventListener("compositionstart", () => {
      input.dataset.composing = "true";
    });

    input.addEventListener("compositionend", (event) => {
      input.dataset.composing = "false";
      const target = event.currentTarget as HTMLInputElement;
      const field = target.dataset.field as "actor" | "summary" | "target" | undefined;
      if (!field) {
        return;
      }

      state.logFilters = {
        ...state.logFilters,
        [field]: target.value,
      };
      applyLogFilters(container);
    });

    input.addEventListener("input", (event) => {
      const target = event.currentTarget as HTMLInputElement;
      const field = target.dataset.field as "actor" | "summary" | "target" | undefined;
      if (!field) {
        return;
      }

      state.logFilters = {
        ...state.logFilters,
        [field]: target.value,
      };
      if (target.dataset.composing === "true") {
        return;
      }

      applyLogFilters(container);
    });
  });

  container.querySelector("[data-action='replay-toggle']")?.addEventListener("click", () => {
    toggleReplay(container);
    renderApp(container);
  });

  container.querySelector("[data-action='replay-first']")?.addEventListener("click", () => {
    stopReplay();
    setReplayEventIndex(0);
    renderApp(container);
  });

  container.querySelector("[data-action='replay-prev']")?.addEventListener("click", () => {
    stopReplay();
    stepReplay(-1);
    renderApp(container);
  });

  container.querySelector("[data-action='replay-next']")?.addEventListener("click", () => {
    stopReplay();
    stepReplay(1);
    renderApp(container);
  });

  container.querySelector("[data-action='replay-last']")?.addEventListener("click", () => {
    stopReplay();
    setReplayEventIndex(getReplayEventCount() - 1);
    renderApp(container);
  });

  container.querySelector<HTMLInputElement>("[data-action='replay-seek']")?.addEventListener("input", (event) => {
    stopReplay();
    const target = event.currentTarget as HTMLInputElement;
    setReplayEventIndex(Number(target.value));
    renderApp(container);
  });

  container.querySelectorAll<HTMLElement>("[data-action='select-event']").forEach((row) => {
    row.addEventListener("click", () => {
      stopReplay();
      setReplayEventIndex(Number(row.dataset.eventIndex ?? "0"));
      renderApp(container);
    });
  });

  applyLogFilters(container);
}

function bindSystemThemeListener() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return;
  }

  const mediaQueryList = window.matchMedia("(prefers-color-scheme: dark)");
  const handleChange = () => {
    if (state.themeMode === "system") {
      applyThemeMode();
    }
  };

  if (typeof mediaQueryList.addEventListener === "function") {
    mediaQueryList.addEventListener("change", handleChange);
    return;
  }

  mediaQueryList.addListener(handleChange);
}

export function mountApp(container: HTMLElement) {
  applyThemeMode();
  bindSystemThemeListener();
  renderApp(container);
}
