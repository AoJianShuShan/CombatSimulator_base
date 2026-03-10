type UnitStatKey =
  | "maxHp"
  | "maxHpRate"
  | "attack"
  | "attackRate"
  | "defense"
  | "defenseRate"
  | "speed"
  | "critChance"
  | "critMultiplier"
  | "hitChance"
  | "dodgeChance"
  | "armor"
  | "armorPenetration"
  | "headshotChance"
  | "headshotMultiplier"
  | "scenarioDamageBonus"
  | "heroClassDamageBonus"
  | "skillTypeDamageBonus"
  | "finalDamageBonus"
  | "finalDamageReduction"
  | "skillMultiplier"
  | "outputAmplify"
  | "outputDecay"
  | "damageTakenAmplify"
  | "damageTakenReduction";

type UnitStatRole =
  | "maxHpBase"
  | "maxHpRate"
  | "attackBase"
  | "attackRate"
  | "defenseBase"
  | "defenseRate"
  | "speed"
  | "critChance"
  | "critMultiplier"
  | "hitChance"
  | "dodgeChance"
  | "armor"
  | "armorPenetration"
  | "headshotChance"
  | "headshotMultiplier"
  | "scenarioDamageBonus"
  | "heroClassDamageBonus"
  | "skillTypeDamageBonus"
  | "finalDamageBonus"
  | "finalDamageReduction"
  | "skillMultiplier"
  | "outputAmplify"
  | "outputDecay"
  | "damageTakenAmplify"
  | "damageTakenReduction";

interface AttributeMacroDefinition {
  key: UnitStatKey;
  label: string;
  default: number;
  min: number;
  step: number;
  role: UnitStatRole;
}

interface AttributeMacroDocument {
  requiredRule: string;
  unitAttributes: AttributeMacroDefinition[];
}

async function loadAttributeMacroDocument() {
  const configUrl = new URL("../config/attribute-macros.json", import.meta.url);

  if (typeof window === "undefined") {
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(configUrl, "utf8");
    return JSON.parse(content) as AttributeMacroDocument;
  }

  const response = await fetch(configUrl);
  if (!response.ok) {
    throw new Error(`加载属性宏定义失败：HTTP ${response.status}`);
  }

  return (await response.json()) as AttributeMacroDocument;
}

function validateAttributeMacroDocument(document: AttributeMacroDocument) {
  const keySet = new Set<string>();
  const roleSet = new Set<string>();

  for (const macro of document.unitAttributes) {
    if (keySet.has(macro.key)) {
      throw new Error(`属性宏定义存在重复 key: ${macro.key}`);
    }

    if (roleSet.has(macro.role)) {
      throw new Error(`属性宏定义存在重复 role: ${macro.role}`);
    }

    keySet.add(macro.key);
    roleSet.add(macro.role);
  }

  return document;
}

const attributeMacroDocument = validateAttributeMacroDocument(await loadAttributeMacroDocument());

export const attributeMacroRule = attributeMacroDocument.requiredRule;
export const unitAttributeMacros = Object.freeze(attributeMacroDocument.unitAttributes);
export const unitAttributeMacroMap = Object.freeze(
  Object.fromEntries(unitAttributeMacros.map((macro) => [macro.key, macro])) as Record<UnitStatKey, AttributeMacroDefinition>,
);
export const unitStatRoleKeys = Object.freeze(
  Object.fromEntries(unitAttributeMacros.map((macro) => [macro.role, macro.key])) as Record<UnitStatRole, UnitStatKey>,
);
export const unitStatDefaults = Object.freeze(
  Object.fromEntries(unitAttributeMacros.map((macro) => [macro.key, macro.default])) as Record<UnitStatKey, number>,
);

export function createDefaultUnitStats() {
  return { ...unitStatDefaults };
}
