from __future__ import annotations

import math
from typing import Any

from backend.attribute_macros import get_unit_attribute_macros
from backend.battle_config_macros import get_battle_number_macros


SUPPORTED_TEAM_IDS = {"A", "B"}
SUPPORTED_TARGETING_STRATEGIES = {"front", "lowestHp", "highestAttack"}
SUPPORTED_UNIT_POSITIONS = {"front", "middle", "back"}
SUPPORTED_ATTACK_ELEMENTS = {"none", "physical", "fire", "electromagnetic", "corrosive"}
SUPPORTED_PROTECTION_TYPES = {"none", "heatArmor", "insulatedArmor", "bioArmor", "heavyArmor"}
BATTLE_BATCH_COUNT_MIN = 1
BATTLE_BATCH_COUNT_MAX = 5000


def _require_object(value: Any, field_name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} 必须是对象")

    return value


def _require_list(value: Any, field_name: str) -> list[Any]:
    if not isinstance(value, list):
        raise ValueError(f"{field_name} 必须是数组")

    return value


def _require_string(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} 必须是非空字符串")

    return value


def _require_number(value: Any, field_name: str) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field_name} 必须是数值")

    if not math.isfinite(float(value)):
        raise ValueError(f"{field_name} 必须是有限数值")

    return value


def _require_integer(value: Any, field_name: str) -> int:
    number = _require_number(value, field_name)
    if not float(number).is_integer():
        raise ValueError(f"{field_name} 必须是整数")

    return int(number)


def _is_aligned_to_step(value: float, step: float) -> bool:
    if step <= 0:
        return True

    ratio = value / step
    return abs(ratio - round(ratio)) < 1e-9


def _require_battle_number(value: Any, field_name: str, step: int | float) -> int | float:
    return _require_integer(value, field_name) if float(step).is_integer() else _require_number(value, field_name)


def validate_battle_input(payload: dict[str, Any]) -> None:
    battle = _require_object(payload.get("battle"), "battle")
    units = _require_list(payload.get("units"), "units")

    if len(units) == 0:
        raise ValueError("units 不能为空")

    _validate_battle_config(battle)
    _validate_units(units)


def validate_battle_batch_request(payload: dict[str, Any]) -> None:
    input_payload = _require_object(payload.get("input"), "input")
    count = _require_integer(payload.get("count"), "count")

    if count < BATTLE_BATCH_COUNT_MIN:
        raise ValueError(f"count 必须大于等于 {BATTLE_BATCH_COUNT_MIN}")

    if count > BATTLE_BATCH_COUNT_MAX:
        raise ValueError(f"count 必须小于等于 {BATTLE_BATCH_COUNT_MAX}")

    validate_battle_input(input_payload)


def _validate_battle_config(battle: dict[str, Any]) -> None:
    targeting_strategy = battle.get("targetingStrategy")
    team_names = _require_object(battle.get("teamNames"), "battle.teamNames")

    for macro in get_battle_number_macros():
        key = str(macro["key"])
        field_name = f"battle.{key}"
        value = _require_battle_number(battle.get(key), field_name, macro["step"])

        if float(value) < float(macro["min"]):
            raise ValueError(f"{field_name} 必须大于等于 {macro['min']}")

        if "max" in macro and float(value) > float(macro["max"]):
            raise ValueError(f"{field_name} 必须小于等于 {macro['max']}")

        if not _is_aligned_to_step(float(value), float(macro["step"])):
            raise ValueError(f"{field_name} 必须按步进 {macro['step']} 输入")

    if targeting_strategy not in SUPPORTED_TARGETING_STRATEGIES:
        raise ValueError(f"battle.targetingStrategy 不支持: {targeting_strategy}")

    for team_id in sorted(SUPPORTED_TEAM_IDS):
        _require_string(team_names.get(team_id), f"battle.teamNames.{team_id}")


def _validate_units(units: list[Any]) -> None:
    team_counts = {team_id: 0 for team_id in SUPPORTED_TEAM_IDS}
    seen_unit_ids: set[str] = set()
    attribute_macros = get_unit_attribute_macros()

    for index, unit in enumerate(units):
        unit_object = _require_object(unit, f"units[{index}]")
        unit_id = _require_string(unit_object.get("id"), f"units[{index}].id")
        if unit_id in seen_unit_ids:
            raise ValueError(f"units[{index}].id 重复: {unit_id}")
        seen_unit_ids.add(unit_id)

        team_id = unit_object.get("teamId")
        if team_id not in SUPPORTED_TEAM_IDS:
            raise ValueError(f"units[{index}].teamId 不支持: {team_id}")
        team_counts[str(team_id)] += 1

        _require_string(unit_object.get("name"), f"units[{index}].name")
        position = unit_object.get("position")
        if position not in SUPPORTED_UNIT_POSITIONS:
            raise ValueError(f"units[{index}].position 不支持: {position}")
        attack_element = unit_object.get("attackElement")
        if attack_element not in SUPPORTED_ATTACK_ELEMENTS:
            raise ValueError(f"units[{index}].attackElement 不支持: {attack_element}")
        protection_type = unit_object.get("protectionType")
        if protection_type not in SUPPORTED_PROTECTION_TYPES:
            raise ValueError(f"units[{index}].protectionType 不支持: {protection_type}")
        stats = _require_object(unit_object.get("stats"), f"units[{index}].stats")

        for macro in attribute_macros:
            key = str(macro["key"])
            value = _require_number(stats.get(key), f"units[{index}].stats.{key}")
            if float(value) < float(macro["min"]):
                raise ValueError(f"units[{index}].stats.{key} 必须大于等于 {macro['min']}")
            if not _is_aligned_to_step(float(value), float(macro["step"])):
                raise ValueError(f"units[{index}].stats.{key} 必须按步进 {macro['step']} 输入")

    for team_id in sorted(SUPPORTED_TEAM_IDS):
        if team_counts[team_id] == 0:
            raise ValueError(f"队伍 {team_id} 至少需要一个单位")
