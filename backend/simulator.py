from __future__ import annotations

from copy import deepcopy
from math import floor
from typing import Any, cast

from backend.attribute_macros import get_unit_stat_role_keys
from backend.models import BattleInput, TargetingStrategy, TeamId, UnitConfig


RuntimeUnit = dict[str, Any]
UNIT_STAT_ROLE_KEYS = get_unit_stat_role_keys()


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


def _compare_target_priority(unit: RuntimeUnit) -> tuple[str, int]:
    return (str(unit["teamId"]), int(unit["initialOrder"]))


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
            base_damage = max(
                int(battle["minimumDamage"]),
                effective_attack - effective_defense,
            )
            crit_roll = random.next()
            is_critical = crit_roll < _clamp_percentage(float(actor["stats"][UNIT_STAT_ROLE_KEYS["critChance"]])) / 100
            damage = (
                max(
                    int(battle["minimumDamage"]),
                    _round_half_up(base_damage * float(actor["stats"][UNIT_STAT_ROLE_KEYS["critMultiplier"]]) / 100),
                )
                if is_critical
                else base_damage
            )
            target["currentHp"] = max(0, int(target["currentHp"]) - damage)
            target["isAlive"] = target["currentHp"] > 0

            _create_event(
                events,
                {
                    "type": "damage_applied",
                    "round": round_index,
                    "actorId": actor["id"],
                    "targetId": target["id"],
                    "summary": f'{actor["name"]} 对 {target["name"]} 造成 {damage} 点{"暴击" if is_critical else ""}伤害，目标剩余 {target["currentHp"]} HP',
                    "payload": {
                        "damage": damage,
                        "targetHp": target["currentHp"],
                        "isCritical": is_critical,
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
            else f'战斗结束，胜利方为 {battle["teamNames"][winner_team_id]}',
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
