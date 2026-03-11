# 整场战斗参数宏契约

## 强制规则

重要：新增整场战斗数值参数前，必须先更新 `src/config/battle-config-macros.json`。前端 UI、默认值、导入兼容、前后端校验、测试与文档都必须复用同一份整场战斗参数定义，禁止各处重复硬编码参数口径。

## 适用范围

- `battle` 下所有“数值型、可编辑、可校验”的参数，统一归 `battle-config-macros.json`
- 当前已纳入：
  - `maxRounds`
  - `minimumDamage`
  - `armorFormulaBase`
  - `maxArmorDamageReduction`
  - `elementAdvantageDamageRate`
  - `elementDisadvantageDamageRate`
  - `randomSeed`

## 不属于这份宏的内容

- 枚举或文本类型字段，例如：
  - `targetingStrategy`
  - `teamNames`
- 单位侧属性，这些仍归 `src/config/attribute-macros.json`

## 当前要求

- 前端页面字段标签、默认值、最小值、步进和百分号后缀，必须从这份定义派生
- 前端导入配置时，对整场战斗数值参数的兼容补全必须复用这份定义
- 前端校验与 Python 后端校验必须复用同一份定义
- Smoke test、属性审计脚本、README 与规则文档变更时，必须同步核对这份定义

## 扩展流程

1. 先修改 `src/config/battle-config-macros.json`
2. 再修改依赖该参数的前端渲染、校验与模拟算法
3. 再同步 Python 后端校验与模拟算法
4. 最后更新测试与文档，确认前后端结果一致
