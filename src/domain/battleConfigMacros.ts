export type BattleNumberFieldKey =
  | "maxRounds"
  | "minimumDamage"
  | "randomSeed"
  | "armorFormulaBase"
  | "maxArmorDamageReduction"
  | "elementAdvantageDamageRate"
  | "elementDisadvantageDamageRate";

interface BattleConfigNumberMacroDefinition {
  key: BattleNumberFieldKey;
  label: string;
  default: number;
  min: number;
  max?: number;
  step: number;
  suffix?: string;
}

interface BattleConfigMacroDocument {
  requiredRule: string;
  battleNumberFields: BattleConfigNumberMacroDefinition[];
}

async function loadBattleConfigMacroDocument() {
  const configUrl = new URL("../config/battle-config-macros.json", import.meta.url);

  if (typeof window === "undefined") {
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(configUrl, "utf8");
    return JSON.parse(content) as BattleConfigMacroDocument;
  }

  const response = await fetch(configUrl);
  if (!response.ok) {
    throw new Error(`加载整场战斗参数定义失败：HTTP ${response.status}`);
  }

  return (await response.json()) as BattleConfigMacroDocument;
}

function validateBattleConfigMacroDocument(document: BattleConfigMacroDocument) {
  const keySet = new Set<string>();

  for (const macro of document.battleNumberFields) {
    if (keySet.has(macro.key)) {
      throw new Error(`整场战斗参数定义存在重复 key: ${macro.key}`);
    }

    keySet.add(macro.key);
  }

  return document;
}

const battleConfigMacroDocument = validateBattleConfigMacroDocument(await loadBattleConfigMacroDocument());

export const battleConfigMacroRule = battleConfigMacroDocument.requiredRule;
export const battleConfigNumberMacros = Object.freeze(battleConfigMacroDocument.battleNumberFields);
export const battleConfigNumberMacroMap = Object.freeze(
  Object.fromEntries(battleConfigNumberMacros.map((macro) => [macro.key, macro])) as Record<
    BattleNumberFieldKey,
    BattleConfigNumberMacroDefinition
  >,
);
export const battleNumberDefaults = Object.freeze(
  Object.fromEntries(battleConfigNumberMacros.map((macro) => [macro.key, macro.default])) as Record<
    BattleNumberFieldKey,
    number
  >,
);

export function formatBattleConfigValue(field: BattleNumberFieldKey, value: number) {
  const macro = battleConfigNumberMacroMap[field];
  return `${value}${macro.suffix ?? ""}`;
}
