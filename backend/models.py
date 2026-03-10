from __future__ import annotations

from typing import Literal, NotRequired, TypedDict


TeamId = Literal["A", "B"]
TargetingStrategy = Literal["front", "lowestHp", "highestAttack"]
UnitPosition = Literal["front", "middle", "back"]
AttackElement = Literal["none", "physical", "fire", "electromagnetic", "corrosive"]
ProtectionType = Literal["none", "heatArmor", "insulatedArmor", "bioArmor", "heavyArmor"]


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
    armor: int | float
    armorPenetration: int | float
    headshotChance: int | float
    headshotMultiplier: int | float
    scenarioDamageBonus: int | float
    heroClassDamageBonus: int | float
    skillTypeDamageBonus: int | float
    finalDamageBonus: int | float
    finalDamageReduction: int | float
    skillMultiplier: int | float
    outputAmplify: int | float
    outputDecay: int | float
    damageTakenAmplify: int | float
    damageTakenReduction: int | float


class UnitConfig(TypedDict):
    id: str
    teamId: TeamId
    name: str
    position: UnitPosition
    attackElement: AttackElement
    protectionType: ProtectionType
    stats: UnitStats
    extras: NotRequired[dict[str, bool | int | float | str]]


class BattleConfig(TypedDict):
    maxRounds: int
    minimumDamage: int
    randomSeed: int
    targetingStrategy: TargetingStrategy
    armorFormulaBase: int | float
    maxArmorDamageReduction: int | float
    elementAdvantageDamageRate: int | float
    elementDisadvantageDamageRate: int | float
    teamNames: dict[TeamId, str]
    extras: NotRequired[dict[str, bool | int | float | str]]


class BattleInput(TypedDict):
    battle: BattleConfig
    units: list[UnitConfig]


class TeamCountSummary(TypedDict):
    A: int
    B: int


class TeamRateSummary(TypedDict):
    A: float
    B: float


class BattleBatchRequest(TypedDict):
    count: int
    input: BattleInput


class BattleBatchSummaryResult(TypedDict):
    baseSeed: int
    totalBattles: int
    wins: TeamCountSummary
    draws: int
    winRates: TeamRateSummary
    averageTerminalNetAdvantages: TeamRateSummary
    remainingHpRatesOnWins: dict[TeamId, float | None]
    drawRate: float
    averageRounds: float
    minRounds: int
    maxRounds: int
