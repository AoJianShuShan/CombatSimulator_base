from __future__ import annotations

from typing import Any

from backend.attribute_macros import get_unit_attribute_macros


SUPPORTED_TEAM_IDS = {"A", "B"}
SUPPORTED_TARGETING_STRATEGIES = {"front", "lowestHp", "highestAttack"}


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

    return value


def validate_battle_input(payload: dict[str, Any]) -> None:
    battle = _require_object(payload.get("battle"), "battle")
    units = _require_list(payload.get("units"), "units")

    if len(units) == 0:
        raise ValueError("units 不能为空")

    _validate_battle_config(battle)
    _validate_units(units)


def _validate_battle_config(battle: dict[str, Any]) -> None:
    max_rounds = _require_number(battle.get("maxRounds"), "battle.maxRounds")
    minimum_damage = _require_number(battle.get("minimumDamage"), "battle.minimumDamage")
    random_seed = _require_number(battle.get("randomSeed"), "battle.randomSeed")
    targeting_strategy = battle.get("targetingStrategy")
    team_names = _require_object(battle.get("teamNames"), "battle.teamNames")

    if int(max_rounds) < 1:
        raise ValueError("battle.maxRounds 必须大于等于 1")

    if int(minimum_damage) < 1:
        raise ValueError("battle.minimumDamage 必须大于等于 1")

    if int(random_seed) < 0:
        raise ValueError("battle.randomSeed 必须大于等于 0")

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
        stats = _require_object(unit_object.get("stats"), f"units[{index}].stats")

        for macro in attribute_macros:
            key = str(macro["key"])
            value = _require_number(stats.get(key), f"units[{index}].stats.{key}")
            if float(value) < float(macro["min"]):
                raise ValueError(f"units[{index}].stats.{key} 必须大于等于 {macro['min']}")

    for team_id in sorted(SUPPORTED_TEAM_IDS):
        if team_counts[team_id] == 0:
            raise ValueError(f"队伍 {team_id} 至少需要一个单位")
