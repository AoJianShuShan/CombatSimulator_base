from __future__ import annotations

from typing import Literal, NotRequired, TypedDict


TeamId = Literal["A", "B"]
TargetingStrategy = Literal["front", "lowestHp", "highestAttack"]


class UnitStats(TypedDict):
    maxHp: int
    maxHpRate: int | float
    attack: int
    attackRate: int | float
    defense: int
    defenseRate: int | float
    speed: int
    critChance: int | float
    critMultiplier: int | float
    hitChance: int | float
    dodgeChance: int | float


class UnitConfig(TypedDict):
    id: str
    teamId: TeamId
    name: str
    stats: UnitStats
    extras: NotRequired[dict[str, bool | int | float | str]]


class BattleConfig(TypedDict):
    maxRounds: int
    minimumDamage: int
    randomSeed: int
    targetingStrategy: TargetingStrategy
    teamNames: dict[TeamId, str]
    extras: NotRequired[dict[str, bool | int | float | str]]


class BattleInput(TypedDict):
    battle: BattleConfig
    units: list[UnitConfig]
