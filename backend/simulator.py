from __future__ import annotations

from copy import deepcopy
from math import floor
from typing import Any, Callable, cast

from backend.attribute_macros import get_unit_stat_role_keys
from backend.models import (
    ActionResolutionMode,
    AttackElement,
    BattleBatchSummaryResult,
    BattleInput,
    ProtectionType,
    TargetingStrategy,
    TeamId,
    UnitConfig,
    UnitPosition,
)


RuntimeUnit = dict[str, Any]
AttackResolution = dict[str, Any]
TimelineDriver = Callable[[BattleInput, list[RuntimeUnit], list[dict[str, Any]], int, float, "SeededRandom"], None]
BattleEndReason = str
UNIT_STAT_ROLE_KEYS = get_unit_stat_role_keys()
FIRE_INTERVAL_BASE_MS = 60000.0
TIME_EPSILON = 1e-6
UNIT_POSITION_PRIORITY: dict[UnitPosition, int] = {
    "front": 0,
    "middle": 1,
    "back": 2,
}
ATTACK_ELEMENT_ADVANTAGE_MAP: dict[AttackElement, ProtectionType] = {
    "physical": "heatArmor",
    "fire": "insulatedArmor",
    "electromagnetic": "bioArmor",
    "corrosive": "heavyArmor",
}
ATTACK_ELEMENT_DISADVANTAGE_MAP: dict[AttackElement, ProtectionType] = {
    "physical": "heavyArmor",
    "fire": "heatArmor",
    "electromagnetic": "insulatedArmor",
    "corrosive": "bioArmor",
}


class SeededRandom:
    def __init__(self, seed: int) -> None:
        self.seed = seed & 0xFFFFFFFF
        if self.seed == 0:
            self.seed = 0x6D2B79F5
        self._state = self.seed

    def next(self) -> float:
        self._state ^= (self._state << 13) & 0xFFFFFFFF
        self._state &= 0xFFFFFFFF
        self._state ^= self._state >> 17
        self._state &= 0xFFFFFFFF
        self._state ^= (self._state << 5) & 0xFFFFFFFF
        self._state &= 0xFFFFFFFF
        return self._state / 4294967296


def _round_half_up(value: float) -> int:
    return floor(value + 0.5)


def _round_to_two_decimals(value: float) -> float:
    return round(value, 2)


def _round_to_four_decimals(value: float) -> float:
    return round(value, 4)


def _normalize_timeline_value(value: float) -> float:
    return _round_to_four_decimals(value)


def _clamp_percentage(value: float) -> float:
    return max(0.0, min(100.0, value))


def _clamp_multiplier(value: float) -> float:
    return max(0.0, value)


def _is_timeline_ready(value: float, timeline_ms: float) -> bool:
    return value <= timeline_ms + TIME_EPSILON


def _mix_seed(base_seed: int, index: int) -> int:
    value = (int(base_seed) & 0xFFFFFFFF) ^ ((index + 1) * 0x9E3779B9 & 0xFFFFFFFF)
    value ^= value >> 16
    value = (value * 0x85EBCA6B) & 0xFFFFFFFF
    value ^= value >> 13
    value = (value * 0xC2B2AE35) & 0xFFFFFFFF
    value ^= value >> 16
    return value & 0xFFFFFFFF


def derive_battle_seed(base_seed: int, index: int) -> int:
    return int(base_seed) if index <= 0 else _mix_seed(base_seed, index)


def _get_scaled_stat(base_value: float, rate: float) -> int:
    return max(0, _round_half_up(base_value * (1 + rate / 100)))


def _get_effective_max_hp(unit_or_stats: RuntimeUnit | dict[str, Any]) -> int:
    stats = unit_or_stats["stats"] if "stats" in unit_or_stats else unit_or_stats
    return max(
        1,
        _get_scaled_stat(
            float(stats[UNIT_STAT_ROLE_KEYS["maxHpBase"]]),
            float(stats[UNIT_STAT_ROLE_KEYS["maxHpRate"]]),
        ),
    )


def _get_battle_duration_ms(result: dict[str, Any]) -> float:
    events = result.get("events")
    if not isinstance(events, list) or len(events) == 0:
        return 0.0

    last_event = events[-1]
    elapsed_time_ms = last_event.get("elapsedTimeMs") if isinstance(last_event, dict) else None
    return float(elapsed_time_ms) if isinstance(elapsed_time_ms, (int, float)) else 0.0


def _get_effective_attack(unit_or_stats: RuntimeUnit | dict[str, Any]) -> int:
    stats = unit_or_stats["stats"] if "stats" in unit_or_stats else unit_or_stats
    return _get_scaled_stat(
        float(stats[UNIT_STAT_ROLE_KEYS["attackBase"]]),
        float(stats[UNIT_STAT_ROLE_KEYS["attackRate"]]),
    )


def _get_effective_defense(unit_or_stats: RuntimeUnit | dict[str, Any]) -> int:
    stats = unit_or_stats["stats"] if "stats" in unit_or_stats else unit_or_stats
    return _get_scaled_stat(
        float(stats[UNIT_STAT_ROLE_KEYS["defenseBase"]]),
        float(stats[UNIT_STAT_ROLE_KEYS["defenseRate"]]),
    )


def _get_magazine_capacity(stats: dict[str, Any]) -> int:
    return max(1, int(float(stats[UNIT_STAT_ROLE_KEYS["magazineCapacity"]])))


def _get_reload_time_ms(stats: dict[str, Any]) -> float:
    return max(0.0, float(stats[UNIT_STAT_ROLE_KEYS["reloadTimeMs"]]))


def _get_fire_interval_ms(stats: dict[str, Any]) -> float:
    fire_rate = max(1.0, float(stats[UNIT_STAT_ROLE_KEYS["fireRate"]]))
    return _normalize_timeline_value(FIRE_INTERVAL_BASE_MS / fire_rate)


def _get_armor_reduction_rate(battle: dict[str, Any], actor: RuntimeUnit, target: RuntimeUnit) -> float:
    armor_gap = max(
        0.0,
        float(target["stats"][UNIT_STAT_ROLE_KEYS["armor"]]) - float(actor["stats"][UNIT_STAT_ROLE_KEYS["armorPenetration"]]),
    )
    if armor_gap <= 0:
        return 0.0

    formula_base = max(0.0, float(battle["armorFormulaBase"]))
    denominator = formula_base + armor_gap
    if denominator <= 0:
        return 0.0

    raw_reduction_rate = armor_gap / denominator
    max_reduction_rate = _clamp_percentage(float(battle["maxArmorDamageReduction"])) / 100
    return min(max_reduction_rate, raw_reduction_rate)


def _get_element_relation(battle: dict[str, Any], actor: RuntimeUnit, target: RuntimeUnit) -> tuple[str, float]:
    actor_element = cast(AttackElement, actor["attackElement"])
    target_protection = cast(ProtectionType, target["protectionType"])

    if actor_element == "none" or target_protection == "none":
        return "neutral", 1.0

    if ATTACK_ELEMENT_ADVANTAGE_MAP[actor_element] == target_protection:
        return "advantage", float(battle["elementAdvantageDamageRate"]) / 100

    if ATTACK_ELEMENT_DISADVANTAGE_MAP[actor_element] == target_protection:
        return "disadvantage", float(battle["elementDisadvantageDamageRate"]) / 100

    return "neutral", 1.0


def _clone_unit(unit: UnitConfig, initial_order: int) -> RuntimeUnit:
    runtime_unit: RuntimeUnit = {
        **deepcopy(unit),
        "currentAmmo": _get_magazine_capacity(unit["stats"]),
        "currentHp": _get_effective_max_hp(unit),
        "initialOrder": initial_order,
        "isAlive": True,
        "nextAttackTimeMs": 0.0,
        "reloadUntilMs": None,
    }
    return runtime_unit


def _clone_runtime_unit(unit: RuntimeUnit) -> RuntimeUnit:
    return {
        **unit,
        "stats": dict(unit["stats"]),
    }


def _get_alive_units_by_team(units: list[RuntimeUnit], team_id: TeamId) -> list[RuntimeUnit]:
    return [unit for unit in units if unit["teamId"] == team_id and unit["isAlive"]]


def _get_opponent_team_id(team_id: TeamId) -> TeamId:
    return cast(TeamId, "B" if team_id == "A" else "A")


def _compare_target_priority(unit: RuntimeUnit) -> tuple[int, int]:
    return (
        UNIT_POSITION_PRIORITY[cast(UnitPosition, unit["position"])],
        int(unit["initialOrder"]),
    )


def _sort_turn_order(units: list[RuntimeUnit]) -> list[RuntimeUnit]:
    return sorted(
        units,
        key=lambda unit: (
            -int(unit["stats"][UNIT_STAT_ROLE_KEYS["speed"]]),
            str(unit["teamId"]),
            int(unit["initialOrder"]),
        ),
    )


def _get_simultaneous_action_order(units: list[RuntimeUnit]) -> list[RuntimeUnit]:
    return sorted(units, key=lambda unit: int(unit["initialOrder"]))


def _pick_target(
    units: list[RuntimeUnit],
    actor: RuntimeUnit,
    targeting_strategy: TargetingStrategy,
) -> RuntimeUnit | None:
    targets = _get_alive_units_by_team(units, _get_opponent_team_id(cast(TeamId, actor["teamId"])))
    if not targets:
        return None

    if targeting_strategy == "lowestHp":
        return min(
            targets,
            key=lambda unit: (
                int(unit["currentHp"]),
                *_compare_target_priority(unit),
            ),
        )

    if targeting_strategy == "highestAttack":
        return min(
            targets,
            key=lambda unit: (
                -_get_effective_attack(unit),
                *_compare_target_priority(unit),
            ),
        )

    if targeting_strategy == "front":
        return min(
            targets,
            key=lambda unit: _compare_target_priority(unit),
        )

    raise ValueError(f"不支持的目标策略: {targeting_strategy}")


def _create_event(events: list[dict[str, Any]], event: dict[str, Any]) -> None:
    payload = event.get("payload")
    elapsed_time_ms = event.get("elapsedTimeMs")
    if not isinstance(elapsed_time_ms, (int, float)) and isinstance(payload, dict):
        timeline_ms = payload.get("timelineMs")
        if isinstance(timeline_ms, (int, float)):
            elapsed_time_ms = timeline_ms

    normalized_event = {"sequence": len(events) + 1, "timeIndex": len(events), **event, "elapsedTimeMs": elapsed_time_ms or 0}
    if normalized_event.get("actorId") is None:
        normalized_event.pop("actorId", None)
    if normalized_event.get("targetId") is None:
        normalized_event.pop("targetId", None)
    events.append(normalized_event)


def _resolve_attack(
    battle_input: BattleInput,
    random: SeededRandom,
    actor: RuntimeUnit,
    target: RuntimeUnit,
) -> AttackResolution:
    battle = battle_input["battle"]
    effective_hit_chance = _clamp_percentage(
        float(actor["stats"][UNIT_STAT_ROLE_KEYS["hitChance"]])
        - float(target["stats"][UNIT_STAT_ROLE_KEYS["dodgeChance"]]),
    )
    hit_roll = random.next()
    if hit_roll >= effective_hit_chance / 100:
        return {
            "type": "miss",
            "actorId": actor["id"],
            "actorName": actor["name"],
            "targetId": target["id"],
            "targetName": target["name"],
            "targetMaxHp": _get_effective_max_hp(target),
            "effectiveHitChance": effective_hit_chance,
        }

    effective_attack = _get_effective_attack(actor)
    effective_defense = _get_effective_defense(target)
    is_minimum_damage_by_defense = effective_attack - effective_defense < int(battle["minimumDamage"])
    base_damage = max(
        int(battle["minimumDamage"]),
        effective_attack - effective_defense,
    )
    armor_reduction_rate = _get_armor_reduction_rate(battle, actor, target)
    armor_multiplier = 1 - armor_reduction_rate
    crit_roll = random.next()
    is_critical = crit_roll < _clamp_percentage(float(actor["stats"][UNIT_STAT_ROLE_KEYS["critChance"]])) / 100
    critical_multiplier = float(actor["stats"][UNIT_STAT_ROLE_KEYS["critMultiplier"]]) / 100 if is_critical else 1.0
    headshot_roll = random.next()
    is_headshot = headshot_roll < _clamp_percentage(float(actor["stats"][UNIT_STAT_ROLE_KEYS["headshotChance"]])) / 100
    headshot_multiplier = float(actor["stats"][UNIT_STAT_ROLE_KEYS["headshotMultiplier"]]) / 100 if is_headshot else 1.0
    element_relation, element_multiplier = _get_element_relation(battle, actor, target)
    scenario_multiplier = 1 + float(actor["stats"][UNIT_STAT_ROLE_KEYS["scenarioDamageBonus"]]) / 100
    hero_class_multiplier = 1 + float(actor["stats"][UNIT_STAT_ROLE_KEYS["heroClassDamageBonus"]]) / 100
    skill_type_multiplier = 1 + float(actor["stats"][UNIT_STAT_ROLE_KEYS["skillTypeDamageBonus"]]) / 100
    skill_multiplier = float(actor["stats"][UNIT_STAT_ROLE_KEYS["skillMultiplier"]]) / 100
    output_multiplier = _clamp_multiplier(
        1 + (
            float(actor["stats"][UNIT_STAT_ROLE_KEYS["outputAmplify"]])
            - float(actor["stats"][UNIT_STAT_ROLE_KEYS["outputDecay"]])
        ) / 100,
    )
    damage_taken_multiplier = _clamp_multiplier(
        1 + (
            float(target["stats"][UNIT_STAT_ROLE_KEYS["damageTakenAmplify"]])
            - float(target["stats"][UNIT_STAT_ROLE_KEYS["damageTakenReduction"]])
        ) / 100,
    )
    final_damage_multiplier = _clamp_multiplier(
        1 + (
            float(actor["stats"][UNIT_STAT_ROLE_KEYS["finalDamageBonus"]])
            - float(target["stats"][UNIT_STAT_ROLE_KEYS["finalDamageReduction"]])
        ) / 100,
    )
    damage_before_round = (
        base_damage
        * armor_multiplier
        * critical_multiplier
        * headshot_multiplier
        * element_multiplier
        * scenario_multiplier
        * hero_class_multiplier
        * skill_type_multiplier
        * skill_multiplier
        * output_multiplier
        * damage_taken_multiplier
        * final_damage_multiplier
    )
    damage = max(int(battle["minimumDamage"]), _round_half_up(damage_before_round))

    return {
        "type": "damage",
        "actorId": actor["id"],
        "actorName": actor["name"],
        "targetId": target["id"],
        "targetName": target["name"],
        "targetMaxHp": _get_effective_max_hp(target),
        "effectiveAttack": effective_attack,
        "effectiveDefense": effective_defense,
        "baseDamage": base_damage,
        "damage": damage,
        "armorValue": float(target["stats"][UNIT_STAT_ROLE_KEYS["armor"]]),
        "armorPenetration": float(actor["stats"][UNIT_STAT_ROLE_KEYS["armorPenetration"]]),
        "armorReductionRate": armor_reduction_rate,
        "armorMultiplier": armor_multiplier,
        "isCritical": is_critical,
        "criticalMultiplier": critical_multiplier,
        "isHeadshot": is_headshot,
        "headshotMultiplier": headshot_multiplier,
        "elementRelation": element_relation,
        "elementMultiplier": element_multiplier,
        "scenarioMultiplier": scenario_multiplier,
        "heroClassMultiplier": hero_class_multiplier,
        "skillTypeMultiplier": skill_type_multiplier,
        "skillMultiplier": skill_multiplier,
        "outputMultiplier": output_multiplier,
        "damageTakenMultiplier": damage_taken_multiplier,
        "finalDamageMultiplier": final_damage_multiplier,
        "isMinimumDamageByDefense": is_minimum_damage_by_defense,
    }


def _create_turn_started_event(
    events: list[dict[str, Any]],
    round_index: int,
    timeline_ms: float,
    actor: RuntimeUnit,
    target: RuntimeUnit,
) -> None:
    _create_event(
        events,
        {
            "type": "turn_started",
            "round": round_index,
            "actorId": actor["id"],
            "targetId": target["id"],
            "summary": f'{actor["name"]} 对 {target["name"]} 发起攻击',
            "payload": {
                "fireRate": _round_to_two_decimals(max(1.0, float(actor["stats"][UNIT_STAT_ROLE_KEYS["fireRate"]]))),
                "currentAmmo": int(actor["currentAmmo"]),
                "magazineCapacity": _get_magazine_capacity(actor["stats"]),
                "timelineMs": timeline_ms,
            },
        },
    )


def _create_attack_missed_event(
    events: list[dict[str, Any]],
    round_index: int,
    timeline_ms: float,
    resolution: AttackResolution,
) -> None:
    _create_event(
        events,
        {
            "type": "attack_missed",
            "round": round_index,
            "actorId": resolution["actorId"],
            "targetId": resolution["targetId"],
            "summary": f'{resolution["actorName"]} 攻击 {resolution["targetName"]}，但被闪避或未命中',
            "payload": {
                "hitChance": resolution["effectiveHitChance"],
                "timelineMs": timeline_ms,
            },
        },
    )


def _create_damage_applied_event(
    events: list[dict[str, Any]],
    round_index: int,
    timeline_ms: float,
    resolution: AttackResolution,
    target_current_hp: int,
) -> None:
    damage_tags = f'{"爆头" if resolution["isHeadshot"] else ""}{"暴击" if resolution["isCritical"] else ""}'
    _create_event(
        events,
        {
            "type": "damage_applied",
            "round": round_index,
            "actorId": resolution["actorId"],
            "targetId": resolution["targetId"],
            "summary": (
                f'{resolution["actorName"]} 对 {resolution["targetName"]} 造成 {resolution["damage"]} 点{damage_tags}伤害，'
                f'目标剩余 {target_current_hp}/{resolution["targetMaxHp"]} HP'
                f'{"（不破防）" if resolution["isMinimumDamageByDefense"] else ""}'
            ),
            "payload": {
                "damage": resolution["damage"],
                "baseDamage": resolution["baseDamage"],
                "targetHp": target_current_hp,
                "targetMaxHp": resolution["targetMaxHp"],
                "isCritical": resolution["isCritical"],
                "criticalMultiplier": _round_to_two_decimals(float(resolution["criticalMultiplier"]) * 100),
                "isHeadshot": resolution["isHeadshot"],
                "headshotMultiplier": _round_to_two_decimals(float(resolution["headshotMultiplier"]) * 100),
                "armorValue": resolution["armorValue"],
                "armorPenetration": resolution["armorPenetration"],
                "armorReductionRate": _round_to_two_decimals(float(resolution["armorReductionRate"]) * 100),
                "armorMultiplier": _round_to_two_decimals(float(resolution["armorMultiplier"]) * 100),
                "elementRelation": resolution["elementRelation"],
                "elementMultiplier": _round_to_two_decimals(float(resolution["elementMultiplier"]) * 100),
                "scenarioMultiplier": _round_to_two_decimals(float(resolution["scenarioMultiplier"]) * 100),
                "heroClassMultiplier": _round_to_two_decimals(float(resolution["heroClassMultiplier"]) * 100),
                "skillTypeMultiplier": _round_to_two_decimals(float(resolution["skillTypeMultiplier"]) * 100),
                "skillMultiplier": _round_to_two_decimals(float(resolution["skillMultiplier"]) * 100),
                "outputMultiplier": _round_to_two_decimals(float(resolution["outputMultiplier"]) * 100),
                "damageTakenMultiplier": _round_to_two_decimals(float(resolution["damageTakenMultiplier"]) * 100),
                "finalDamageMultiplier": _round_to_two_decimals(float(resolution["finalDamageMultiplier"]) * 100),
                "isMinimumDamageByDefense": resolution["isMinimumDamageByDefense"],
                "effectiveAttack": resolution["effectiveAttack"],
                "effectiveDefense": resolution["effectiveDefense"],
                "timelineMs": timeline_ms,
            },
        },
    )


def _create_reload_started_event(
    events: list[dict[str, Any]],
    round_index: int,
    timeline_ms: float,
    unit: RuntimeUnit,
) -> None:
    _create_event(
        events,
        {
            "type": "reload_started",
            "round": round_index,
            "actorId": unit["id"],
            "summary": f'{unit["name"]} 开始换弹',
            "payload": {
                "fireRate": _round_to_two_decimals(max(1.0, float(unit["stats"][UNIT_STAT_ROLE_KEYS["fireRate"]]))),
                "currentAmmo": int(unit["currentAmmo"]),
                "magazineCapacity": _get_magazine_capacity(unit["stats"]),
                "nextAttackTimeMs": _normalize_timeline_value(float(unit["nextAttackTimeMs"])),
                "reloadTimeMs": _round_to_two_decimals(_get_reload_time_ms(unit["stats"])),
                "reloadUntilMs": unit["reloadUntilMs"],
                "timelineMs": timeline_ms,
            },
        },
    )


def _create_reload_completed_event(
    events: list[dict[str, Any]],
    round_index: int,
    timeline_ms: float,
    unit: RuntimeUnit,
) -> None:
    _create_event(
        events,
        {
            "type": "reload_completed",
            "round": round_index,
            "actorId": unit["id"],
            "summary": f'{unit["name"]} 完成换弹，弹匣恢复至 {unit["currentAmmo"]} 发',
            "payload": {
                "fireRate": _round_to_two_decimals(max(1.0, float(unit["stats"][UNIT_STAT_ROLE_KEYS["fireRate"]]))),
                "currentAmmo": int(unit["currentAmmo"]),
                "magazineCapacity": _get_magazine_capacity(unit["stats"]),
                "nextAttackTimeMs": _normalize_timeline_value(float(unit["nextAttackTimeMs"])),
                "timelineMs": timeline_ms,
            },
        },
    )


def _create_unit_defeated_event(
    events: list[dict[str, Any]],
    round_index: int,
    timeline_ms: float,
    target: RuntimeUnit,
    actor_id: str | None = None,
) -> None:
    _create_event(
        events,
        {
            "type": "unit_defeated",
            "round": round_index,
            "actorId": actor_id,
            "targetId": target["id"],
            "summary": f'{target["name"]} 被击败',
            "payload": {
                "timelineMs": timeline_ms,
                "targetHp": int(target["currentHp"]),
            },
        },
    )


def _get_next_timeline_ms_for_unit(unit: RuntimeUnit) -> float | None:
    if not unit["isAlive"]:
        return None

    if int(unit["currentAmmo"]) <= 0 and unit["reloadUntilMs"] is not None:
        return float(unit["reloadUntilMs"])

    return float(unit["nextAttackTimeMs"])


def _get_next_timeline_ms(units: list[RuntimeUnit]) -> float | None:
    next_timeline_ms: float | None = None

    for unit in units:
        candidate = _get_next_timeline_ms_for_unit(unit)
        if candidate is None:
            continue

        if next_timeline_ms is None or candidate < next_timeline_ms - TIME_EPSILON:
            next_timeline_ms = candidate

    return None if next_timeline_ms is None else _normalize_timeline_value(next_timeline_ms)


def _complete_reloads_at_time(
    units: list[RuntimeUnit],
    events: list[dict[str, Any]],
    round_index: int,
    timeline_ms: float,
) -> None:
    reload_ready_units = sorted(
        [
            unit
            for unit in units
            if unit["isAlive"]
            and int(unit["currentAmmo"]) <= 0
            and unit["reloadUntilMs"] is not None
            and _is_timeline_ready(float(unit["reloadUntilMs"]), timeline_ms)
        ],
        key=lambda unit: int(unit["initialOrder"]),
    )

    for unit in reload_ready_units:
        unit["currentAmmo"] = _get_magazine_capacity(unit["stats"])
        unit["reloadUntilMs"] = None
        _create_reload_completed_event(events, round_index, timeline_ms, unit)


def _get_attack_ready_units_at_time(units: list[RuntimeUnit], timeline_ms: float) -> list[RuntimeUnit]:
    return [
        unit
        for unit in units
        if unit["isAlive"] and int(unit["currentAmmo"]) > 0 and _is_timeline_ready(float(unit["nextAttackTimeMs"]), timeline_ms)
    ]


def _advance_actor_timeline_after_attack(
    actor: RuntimeUnit,
    events: list[dict[str, Any]],
    round_index: int,
    timeline_ms: float,
    emit_reload_event: bool,
) -> None:
    actor["currentAmmo"] = max(0, int(actor["currentAmmo"]) - 1)
    actor["nextAttackTimeMs"] = _normalize_timeline_value(timeline_ms + _get_fire_interval_ms(actor["stats"]))

    if int(actor["currentAmmo"]) > 0:
        return

    actor["reloadUntilMs"] = _normalize_timeline_value(timeline_ms + _get_reload_time_ms(actor["stats"]))
    if emit_reload_event:
        _create_reload_started_event(events, round_index, timeline_ms, actor)


def _run_sequential_timeline_window(
    battle_input: BattleInput,
    units: list[RuntimeUnit],
    events: list[dict[str, Any]],
    round_index: int,
    timeline_ms: float,
    random: SeededRandom,
) -> None:
    targeting_strategy = cast(TargetingStrategy, battle_input["battle"]["targetingStrategy"])

    for next_actor in _sort_turn_order(_get_attack_ready_units_at_time(units, timeline_ms)):
        actor = next((unit for unit in units if unit["id"] == next_actor["id"]), None)
        if (
            actor is None
            or not actor["isAlive"]
            or int(actor["currentAmmo"]) <= 0
            or not _is_timeline_ready(float(actor["nextAttackTimeMs"]), timeline_ms)
        ):
            continue

        target = _pick_target(units, actor, targeting_strategy)
        if target is None:
            break

        _create_turn_started_event(events, round_index, timeline_ms, actor, target)
        resolution = _resolve_attack(battle_input, random, actor, target)

        if resolution["type"] == "miss":
            _create_attack_missed_event(events, round_index, timeline_ms, resolution)
        else:
            target["currentHp"] = max(0, int(target["currentHp"]) - int(resolution["damage"]))
            target["isAlive"] = target["currentHp"] > 0
            _create_damage_applied_event(events, round_index, timeline_ms, resolution, int(target["currentHp"]))

            if not target["isAlive"]:
                _create_unit_defeated_event(events, round_index, timeline_ms, target, cast(str, resolution["actorId"]))

        _advance_actor_timeline_after_attack(actor, events, round_index, timeline_ms, bool(actor["isAlive"]))

        remaining_enemies = _get_alive_units_by_team(
            units,
            _get_opponent_team_id(cast(TeamId, actor["teamId"])),
        )
        if not remaining_enemies:
            break


def _run_simultaneous_timeline_window(
    battle_input: BattleInput,
    units: list[RuntimeUnit],
    events: list[dict[str, Any]],
    round_index: int,
    timeline_ms: float,
    random: SeededRandom,
) -> None:
    targeting_strategy = cast(TargetingStrategy, battle_input["battle"]["targetingStrategy"])
    snapshot_units = [_clone_runtime_unit(unit) for unit in units]
    action_order = _get_simultaneous_action_order(_get_attack_ready_units_at_time(snapshot_units, timeline_ms))
    actor_ids: list[str] = []
    resolutions: list[AttackResolution] = []

    for actor in action_order:
        target = _pick_target(snapshot_units, actor, targeting_strategy)
        if target is None:
            continue

        _create_turn_started_event(events, round_index, timeline_ms, actor, target)
        actor_ids.append(cast(str, actor["id"]))
        resolutions.append(_resolve_attack(battle_input, random, actor, target))

    defeated_ids: set[str] = set()
    defeated_order: list[str] = []

    for resolution in resolutions:
        if resolution["type"] == "miss":
            _create_attack_missed_event(events, round_index, timeline_ms, resolution)
            continue

        target = next((unit for unit in units if unit["id"] == resolution["targetId"]), None)
        if target is None:
            continue

        target["currentHp"] = max(0, int(target["currentHp"]) - int(resolution["damage"]))
        target["isAlive"] = target["currentHp"] > 0
        _create_damage_applied_event(events, round_index, timeline_ms, resolution, int(target["currentHp"]))

        if not target["isAlive"] and target["id"] not in defeated_ids:
            defeated_ids.add(cast(str, target["id"]))
            defeated_order.append(cast(str, target["id"]))

    for target_id in defeated_order:
        target = next((unit for unit in units if unit["id"] == target_id), None)
        if target is None:
            continue

        _create_unit_defeated_event(events, round_index, timeline_ms, target)

    for actor_id in actor_ids:
        actor = next((unit for unit in units if unit["id"] == actor_id), None)
        if actor is None:
            continue

        _advance_actor_timeline_after_attack(actor, events, round_index, timeline_ms, bool(actor["isAlive"]))


TIMELINE_DRIVERS: dict[ActionResolutionMode, TimelineDriver] = {
    "arpgSimultaneous": _run_simultaneous_timeline_window,
    "turnBasedSpeed": _run_sequential_timeline_window,
}


def simulate_battle(payload: BattleInput) -> dict[str, Any]:
    units = [_clone_unit(unit, index) for index, unit in enumerate(payload["units"])]
    events: list[dict[str, Any]] = []
    rounds_completed = 0
    last_timeline_ms = 0.0
    end_reason: BattleEndReason = "teamEliminated"
    battle = payload["battle"]
    random = SeededRandom(int(battle.get("randomSeed", 1)))
    action_resolution_mode = cast(ActionResolutionMode, battle["actionResolutionMode"])

    _create_event(
        events,
        {
            "type": "battle_started",
            "round": 0,
            "summary": f'{battle["teamNames"]["A"]} 与 {battle["teamNames"]["B"]} 的战斗开始',
            "payload": {
                "actionResolutionMode": action_resolution_mode,
                "maxBattleTimeMs": battle["maxBattleTimeMs"],
                "maxRounds": battle["maxRounds"],
                "timelineMs": 0,
                "unitCount": len(units),
            },
        },
    )

    while rounds_completed < int(battle["maxRounds"]):
        team_a_alive = _get_alive_units_by_team(units, "A")
        team_b_alive = _get_alive_units_by_team(units, "B")
        if not team_a_alive or not team_b_alive:
            end_reason = "teamEliminated"
            break

        timeline_ms = _get_next_timeline_ms(units)
        if timeline_ms is None:
            end_reason = "teamEliminated"
            break

        if timeline_ms > float(battle["maxBattleTimeMs"]):
            end_reason = "maxBattleTimeMs"
            break

        rounds_completed += 1
        last_timeline_ms = timeline_ms
        _create_event(
            events,
                {
                    "type": "round_started",
                    "round": rounds_completed,
                    "summary": f"第 {rounds_completed} 轮开始",
                    "payload": {
                        "actionResolutionMode": action_resolution_mode,
                        "aliveA": len(team_a_alive),
                    "aliveB": len(team_b_alive),
                    "timelineMs": timeline_ms,
                },
            },
        )

        _complete_reloads_at_time(units, events, rounds_completed, timeline_ms)
        TIMELINE_DRIVERS[action_resolution_mode](payload, units, events, rounds_completed, timeline_ms, random)

    alive_a = _get_alive_units_by_team(units, "A")
    alive_b = _get_alive_units_by_team(units, "B")
    winner_team_id: TeamId | None
    if alive_a and not alive_b:
        winner_team_id = "A"
    elif alive_b and not alive_a:
        winner_team_id = "B"
    else:
        winner_team_id = None

    if winner_team_id is None and end_reason != "maxBattleTimeMs":
        end_reason = "maxRounds" if rounds_completed >= int(battle["maxRounds"]) else "teamEliminated"

    _create_event(
        events,
        {
            "type": "battle_ended",
            "round": rounds_completed,
            "summary": (
                "战斗结束，达到最大战斗时长，结果按平局处理"
                if winner_team_id is None and end_reason == "maxBattleTimeMs"
                else "战斗结束，达到最大回合数，结果按平局处理"
                if winner_team_id is None and end_reason == "maxRounds"
                else "战斗结束，结果为平局"
                if winner_team_id is None
                else f'战斗结束，{battle["teamNames"][winner_team_id]}胜利！'
            ),
            "payload": {
                "actionResolutionMode": action_resolution_mode,
                "aliveA": len(alive_a),
                "aliveB": len(alive_b),
                "endReason": end_reason,
                "maxBattleTimeMs": battle["maxBattleTimeMs"],
                "timelineMs": last_timeline_ms,
                "winnerTeamId": winner_team_id,
            },
        },
    )

    final_units: list[dict[str, Any]] = []
    for unit in units:
        final_units.append({key: value for key, value in unit.items() if key != "initialOrder"})

    return {
        "randomSeed": random.seed,
        "winnerTeamId": winner_team_id,
        "roundsCompleted": rounds_completed,
        "events": events,
        "finalUnits": final_units,
    }


def simulate_battle_batch_summary(payload: BattleInput, count: int) -> BattleBatchSummaryResult:
    normalized_count = max(1, int(count))
    wins = {
        "A": 0,
        "B": 0,
    }
    team_max_hp_totals = {
        "A": sum(
            _get_effective_max_hp(_clone_unit(unit, index))
            for index, unit in enumerate(payload["units"])
            if unit["teamId"] == "A"
        ),
        "B": sum(
            _get_effective_max_hp(_clone_unit(unit, index))
            for index, unit in enumerate(payload["units"])
            if unit["teamId"] == "B"
        ),
    }
    remaining_hp_totals = {
        "A": 0,
        "B": 0,
    }
    max_hp_totals_on_wins = {
        "A": 0,
        "B": 0,
    }
    total_terminal_net_advantage_a = 0.0
    draws = 0
    total_rounds = 0
    total_duration_ms = 0.0
    min_rounds = float("inf")
    max_rounds = float("-inf")
    min_duration_ms = float("inf")
    max_duration_ms = float("-inf")

    for index in range(normalized_count):
        battle_seed = derive_battle_seed(int(payload["battle"]["randomSeed"]), index)
        result = simulate_battle(
            {
                **payload,
                "battle": {
                    **payload["battle"],
                    "randomSeed": battle_seed,
                },
            }
        )

        rounds_completed = int(result["roundsCompleted"])
        duration_ms = _get_battle_duration_ms(result)
        total_rounds += rounds_completed
        total_duration_ms += duration_ms
        min_rounds = min(min_rounds, rounds_completed)
        max_rounds = max(max_rounds, rounds_completed)
        min_duration_ms = min(min_duration_ms, duration_ms)
        max_duration_ms = max(max_duration_ms, duration_ms)
        remaining_hp_by_team = {
            "A": sum(int(unit["currentHp"]) for unit in result["finalUnits"] if unit["teamId"] == "A"),
            "B": sum(int(unit["currentHp"]) for unit in result["finalUnits"] if unit["teamId"] == "B"),
        }
        terminal_hp_rates = {
            "A": remaining_hp_by_team["A"] / team_max_hp_totals["A"] if team_max_hp_totals["A"] > 0 else 0.0,
            "B": remaining_hp_by_team["B"] / team_max_hp_totals["B"] if team_max_hp_totals["B"] > 0 else 0.0,
        }
        total_terminal_net_advantage_a += terminal_hp_rates["A"] - terminal_hp_rates["B"]

        winner_team_id = result["winnerTeamId"]
        if winner_team_id in {"A", "B"}:
            wins[winner_team_id] += 1
            winner_units = [unit for unit in result["finalUnits"] if unit["teamId"] == winner_team_id]
            remaining_hp_totals[winner_team_id] += sum(int(unit["currentHp"]) for unit in winner_units)
            max_hp_totals_on_wins[winner_team_id] += sum(_get_effective_max_hp(unit) for unit in winner_units)
        else:
            draws += 1

    return {
        "baseSeed": int(payload["battle"]["randomSeed"]),
        "totalBattles": normalized_count,
        "wins": wins,
        "draws": draws,
        "winRates": {
            "A": _round_to_four_decimals(wins["A"] / normalized_count),
            "B": _round_to_four_decimals(wins["B"] / normalized_count),
        },
        "averageTerminalNetAdvantages": {
            "A": _round_to_four_decimals(total_terminal_net_advantage_a / normalized_count),
            "B": _round_to_four_decimals(-total_terminal_net_advantage_a / normalized_count),
        },
        "remainingHpRatesOnWins": {
            "A": _round_to_four_decimals(remaining_hp_totals["A"] / max_hp_totals_on_wins["A"])
            if max_hp_totals_on_wins["A"] > 0
            else None,
            "B": _round_to_four_decimals(remaining_hp_totals["B"] / max_hp_totals_on_wins["B"])
            if max_hp_totals_on_wins["B"] > 0
            else None,
        },
        "drawRate": _round_to_four_decimals(draws / normalized_count),
        "averageRounds": _round_to_four_decimals(total_rounds / normalized_count),
        "minRounds": int(min_rounds) if min_rounds != float("inf") else 0,
        "maxRounds": int(max_rounds) if max_rounds != float("-inf") else 0,
        "averageDurationMs": _round_to_four_decimals(total_duration_ms / normalized_count),
        "minDurationMs": _round_to_four_decimals(min_duration_ms) if min_duration_ms != float("inf") else 0.0,
        "maxDurationMs": _round_to_four_decimals(max_duration_ms) if max_duration_ms != float("-inf") else 0.0,
    }
