from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, NotRequired, TypedDict, cast


ROOT_DIR = Path(__file__).resolve().parent.parent
ATTRIBUTE_MACRO_PATH = ROOT_DIR / "src" / "config" / "attribute-macros.json"


class AttributeMacroDefinition(TypedDict):
    key: str
    label: str
    default: int | float
    teamDefaults: NotRequired[dict[str, int | float]]
    min: int | float
    step: int | float
    role: str


class AttributeMacroDocument(TypedDict):
    requiredRule: str
    unitAttributes: list[AttributeMacroDefinition]


@lru_cache(maxsize=1)
def load_attribute_macro_document() -> AttributeMacroDocument:
    document = cast(AttributeMacroDocument, json.loads(ATTRIBUTE_MACRO_PATH.read_text(encoding="utf-8")))
    key_set: set[str] = set()
    role_set: set[str] = set()

    for macro in document["unitAttributes"]:
        key = str(macro["key"])
        role = str(macro["role"])
        if key in key_set:
            raise ValueError(f"属性宏定义存在重复 key: {key}")

        if role in role_set:
            raise ValueError(f"属性宏定义存在重复 role: {role}")

        key_set.add(key)
        role_set.add(role)

    return document


def get_attribute_macro_rule() -> str:
    return str(load_attribute_macro_document()["requiredRule"])


def get_unit_attribute_macros() -> list[AttributeMacroDefinition]:
    return list(load_attribute_macro_document()["unitAttributes"])


def get_unit_stat_defaults() -> dict[str, int | float]:
    return {str(macro["key"]): macro["default"] for macro in load_attribute_macro_document()["unitAttributes"]}


def get_unit_stat_role_keys() -> dict[str, str]:
    return {str(macro["role"]): str(macro["key"]) for macro in load_attribute_macro_document()["unitAttributes"]}
