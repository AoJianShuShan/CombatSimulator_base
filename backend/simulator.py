from __future__ import annotations

from copy import deepcopy
from math import floor
from typing import Any, cast

from backend.attribute_macros import get_unit_stat_role_keys
from backend.models import AttackElement, BattleInput, ProtectionType, TargetingStrategy, TeamId, UnitConfig, UnitPosition


RuntimeUnit = dict[str, Any]
UNIT_STAT_ROLE_KEYS = get_unit_stat_role_keys()
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


def _clamp_percentage(value: float) -> float:
    return max(0.0, min(100.0, value))


def _clamp_multiplier(value: float) -> float:
    return max(0.0, value)


def _round_to_two_decimals(value: float) -> float:
    return round(value, 2)


def _get_scaled_stat(base_value: float, rate: float) -> int:
    return max(0, _round_half_up(base_value * (1 + rate / 100)))


def _get_effective_max_hp(unit: RuntimeUnit) -> int:
    stats = unit["stats"]
    return max(
        1,
        _get_scaled_stat(
            float(stats[UNIT_STAT_ROLE_KEYS["maxHpBase"]]),
            float(stats[UNIT_STAT_ROLE_KEYS["maxHpRate"]]),
        ),
    )


def _get_effective_attack(unit: RuntimeUnit) -> int:
    stats = unit["stats"]
    return _get_scaled_stat(
        float(stats[UNIT_STAT_ROLE_KEYS["attackBase"]]),
        float(stats[UNIT_STAT_ROLE_KEYS["attackRate"]]),
    )


def _get_effective_defense(unit: RuntimeUnit) -> int:
    stats = unit["stats"]
    return _get_scaled_stat(
        float(stats[UNIT_STAT_ROLE_KEYS["defenseBase"]]),
        float(stats[UNIT_STAT_ROLE_KEYS["defenseRate"]]),
    )


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
        "currentHp": 0,
        "isAlive": True,
        "initialOrder": initial_order,
    }
    runtime_unit["currentHp"] = _get_effective_max_hp(runtime_unit)
    return runtime_unit


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
    alive_units = [unit for unit in units if unit["isAlive"]]
    return sorted(
        alive_units,
        key=lambda unit: (
            -int(unit["stats"][UNIT_STAT_ROLE_KEYS["speed"]]),
            str(unit["teamId"]),
            int(unit["initialOrder"]),
        ),
    )


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
    events.append({"sequence": len(events) + 1, "timeIndex": len(events), **event})


def simulate_battle(payload: BattleInput) -> dict[str, Any]:
    units = [_clone_unit(unit, index) for index, unit in enumerate(payload["units"])]
    events: list[dict[str, Any]] = []
    rounds_completed = 0
    battle = payload["battle"]
    random = SeededRandom(int(battle.get("randomSeed", 1)))
    targeting_strategy = cast(TargetingStrategy, battle["targetingStrategy"])

    _create_event(
        events,
        {
            "type": "battle_started",
            "round": 0,
            "summary": f'{battle["teamNames"]["A"]} 与 {battle["teamNames"]["B"]} 的战斗开始',
            "payload": {
                "maxRounds": battle["maxRounds"],
                "unitCount": len(units),
            },
        },
    )

    for round_index in range(1, int(battle["maxRounds"]) + 1):
        team_a_alive = _get_alive_units_by_team(units, "A")
        team_b_alive = _get_alive_units_by_team(units, "B")
        if not team_a_alive or not team_b_alive:
            break

        rounds_completed = round_index
        _create_event(
            events,
            {
                "type": "round_started",
                "round": round_index,
                "summary": f"第 {round_index} 回合开始",
                "payload": {
                    "aliveA": len(team_a_alive),
                    "aliveB": len(team_b_alive),
                },
            },
        )

        for actor in _sort_turn_order(units):
            if not actor["isAlive"]:
                continue

            target = _pick_target(units, actor, targeting_strategy)
            if target is None:
                break

            _create_event(
                events,
                {
                    "type": "turn_started",
                    "round": round_index,
                    "actorId": actor["id"],
                    "targetId": target["id"],
                    "summary": f'{actor["name"]} 对 {target["name"]} 发起攻击',
                },
            )

            effective_hit_chance = _clamp_percentage(
                float(actor["stats"][UNIT_STAT_ROLE_KEYS["hitChance"]])
                - float(target["stats"][UNIT_STAT_ROLE_KEYS["dodgeChance"]]),
            )
            hit_roll = random.next()
            if hit_roll >= effective_hit_chance / 100:
                _create_event(
                    events,
                    {
                        "type": "attack_missed",
                        "round": round_index,
                        "actorId": actor["id"],
                        "targetId": target["id"],
                        "summary": f'{actor["name"]} 攻击 {target["name"]}，但被闪避或未命中',
                        "payload": {
                            "hitChance": effective_hit_chance,
                        },
                    },
                )
                continue

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
            target["currentHp"] = max(0, int(target["currentHp"]) - damage)
            target["isAlive"] = target["currentHp"] > 0
            target_max_hp = _get_effective_max_hp(target)
            damage_tags = f'{"爆头" if is_headshot else ""}{"暴击" if is_critical else ""}'

            _create_event(
                events,
                {
                    "type": "damage_applied",
                    "round": round_index,
                    "actorId": actor["id"],
                    "targetId": target["id"],
                    "summary": f'{actor["name"]} 对 {target["name"]} 造成 {damage} 点{damage_tags}伤害，目标剩余 {target["currentHp"]}/{target_max_hp} HP{"（不破防）" if is_minimum_damage_by_defense else ""}',
                    "payload": {
                        "damage": damage,
                        "baseDamage": base_damage,
                        "targetHp": target["currentHp"],
                        "targetMaxHp": target_max_hp,
                        "isCritical": is_critical,
                        "criticalMultiplier": _round_to_two_decimals(critical_multiplier * 100),
                        "isHeadshot": is_headshot,
                        "headshotMultiplier": _round_to_two_decimals(headshot_multiplier * 100),
                        "armorValue": float(target["stats"][UNIT_STAT_ROLE_KEYS["armor"]]),
                        "armorPenetration": float(actor["stats"][UNIT_STAT_ROLE_KEYS["armorPenetration"]]),
                        "armorReductionRate": _round_to_two_decimals(armor_reduction_rate * 100),
                        "armorMultiplier": _round_to_two_decimals(armor_multiplier * 100),
                        "elementRelation": element_relation,
                        "elementMultiplier": _round_to_two_decimals(element_multiplier * 100),
                        "scenarioMultiplier": _round_to_two_decimals(scenario_multiplier * 100),
                        "heroClassMultiplier": _round_to_two_decimals(hero_class_multiplier * 100),
                        "skillTypeMultiplier": _round_to_two_decimals(skill_type_multiplier * 100),
                        "skillMultiplier": _round_to_two_decimals(skill_multiplier * 100),
                        "outputMultiplier": _round_to_two_decimals(output_multiplier * 100),
                        "damageTakenMultiplier": _round_to_two_decimals(damage_taken_multiplier * 100),
                        "finalDamageMultiplier": _round_to_two_decimals(final_damage_multiplier * 100),
                        "isMinimumDamageByDefense": is_minimum_damage_by_defense,
                        "effectiveAttack": effective_attack,
                        "effectiveDefense": effective_defense,
                    },
                },
            )

            if not target["isAlive"]:
                _create_event(
                    events,
                    {
                        "type": "unit_defeated",
                        "round": round_index,
                        "actorId": actor["id"],
                        "targetId": target["id"],
                        "summary": f'{target["name"]} 被击败',
                    },
                )

            remaining_enemies = _get_alive_units_by_team(
                units,
                _get_opponent_team_id(cast(TeamId, actor["teamId"])),
            )
            if not remaining_enemies:
                break

    alive_a = _get_alive_units_by_team(units, "A")
    alive_b = _get_alive_units_by_team(units, "B")
    winner_team_id: TeamId | None
    if alive_a and not alive_b:
        winner_team_id = "A"
    elif alive_b and not alive_a:
        winner_team_id = "B"
    else:
        winner_team_id = None

    _create_event(
        events,
        {
            "type": "battle_ended",
            "round": rounds_completed,
            "summary": "战斗结束，结果为平局"
            if winner_team_id is None
            else f'战斗结束，{battle["teamNames"][winner_team_id]}胜利！',
            "payload": {
                "winnerTeamId": winner_team_id,
                "aliveA": len(alive_a),
                "aliveB": len(alive_b),
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
