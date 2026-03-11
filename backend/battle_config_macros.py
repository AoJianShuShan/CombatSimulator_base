from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import NotRequired, TypedDict, cast


ROOT_DIR = Path(__file__).resolve().parent.parent
BATTLE_CONFIG_MACRO_PATH = ROOT_DIR / "src" / "config" / "battle-config-macros.json"


class BattleConfigNumberMacroDefinition(TypedDict):
    key: str
    label: str
    default: int | float
    defaultFactory: NotRequired[str]
    min: int | float
    max: NotRequired[int | float]
    step: int | float
    suffix: NotRequired[str]


class BattleConfigMacroDocument(TypedDict):
    requiredRule: str
    battleNumberFields: list[BattleConfigNumberMacroDefinition]


@lru_cache(maxsize=1)
def load_battle_config_macro_document() -> BattleConfigMacroDocument:
    document = cast(BattleConfigMacroDocument, json.loads(BATTLE_CONFIG_MACRO_PATH.read_text(encoding="utf-8")))
    key_set: set[str] = set()

    for macro in document["battleNumberFields"]:
        key = str(macro["key"])
        if key in key_set:
            raise ValueError(f"整场战斗参数定义存在重复 key: {key}")

        key_set.add(key)

    return document


def get_battle_config_macro_rule() -> str:
    return str(load_battle_config_macro_document()["requiredRule"])


def get_battle_number_macros() -> list[BattleConfigNumberMacroDefinition]:
    return list(load_battle_config_macro_document()["battleNumberFields"])


def get_battle_number_defaults() -> dict[str, int | float]:
    return {str(macro["key"]): macro["default"] for macro in load_battle_config_macro_document()["battleNumberFields"]}
