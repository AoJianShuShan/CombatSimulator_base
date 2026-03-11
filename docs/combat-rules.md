# 当前战斗规则说明

更完整的单次伤害结算过程与边界处理，见 [战斗伤害公式说明](./damage-formula.md)。

## 执行模型

- 不使用行动条
- 当前所有模式都按“统一时间轴”推进，不再使用固定间隔的传统回合循环
- 支持两种行动结算模式：
  - `Arpg即时制（时间）`
  - `回合制速度高者先手`
- 默认模式是 `Arpg即时制（时间）`
- 单位站位为 `前排 / 中排 / 后排`

### Arpg即时制（时间）

- 每次先找到当前最早需要处理的时间点
- 先结算这个时间点刚好完成的换弹
- 再记录这个时间点开始时仍然可以开火的单位列表
- 这份列表里的所有单位，都视为本时间点已经拿到出手机会
- 每个单位的目标选择、命中、暴击、爆头和伤害数值，都基于这个时间点开始时的战场快照计算
- 这个时间点内的所有攻击都计算完成后，再统一扣血和判定死亡
- 因此，被这个时间点击杀的单位，只要它在这个时间点开始时还活着，它这次攻击仍然会生效
- 这个模式下允许出现双方同时死亡
- `速度` 在这个模式下不参与行动顺序

### 回合制速度高者先手

- 每次先找到当前最早需要处理的时间点
- 先结算这个时间点刚好完成的换弹
- 这个时间点内所有可行动单位按速度从高到低排序后依次行动
- 速度相同时，先按 `teamId`，再按单位初始编队顺序稳定排序
- 同一时间点内，先被击杀的单位，后续就不会再行动
- `速度` 只在这个模式下决定同一时间点的先后手，不决定行动频率

## 时序属性

- `射速（发/min）` 决定攻击冷却时间：`60000 / 射速`
- 开局弹匣默认装满
- 每次普通攻击消耗 `1` 发弹药
- 如果这次攻击后弹匣打空，则单位立即进入换弹
- `换弹动作时间（ms）` 决定换弹完成所需时长
- 单位只有同时满足：
  - 自己的攻击冷却结束
  - 自己的换弹已经完成
  才能再次开火
- `弹匣最大容量（发）` 越大，连续开火次数越多，换弹频率越低
- `最大战斗时长（ms）` 作为整场战斗上限存在；一旦下一个时间点超出这个上限，就停止继续推进；若此时双方都还存活，则结果按平局处理

## 目标策略

- `前排优先`：按敌方前排 -> 中排 -> 后排选择目标；同排内按初始编队顺序
- `最低当前生命`：优先攻击当前生命最低的敌人；相同则回落到站位优先级与初始编队顺序
- `最高有效攻击`：优先攻击有效攻击最高的敌人；相同则回落到站位优先级与初始编队顺序

在 `Arpg即时制（时间）` 模式下，以上目标策略基于“该时间点开始时的战场快照”选择目标，不会因为这个时间点中途已受伤或已阵亡而重新改选。

## 有效属性

- 有效生命：`round(maxHp * (1 + maxHpRate / 100))`，最小为 `1`
- 有效攻击：`round(attack * (1 + attackRate / 100))`，最小为 `0`
- 有效防御：`round(defense * (1 + defenseRate / 100))`，最小为 `0`
- 这里的 `round` 指四舍五入到整数

## 命中判定

- 有效命中：`clamp(hitChance - dodgeChance, 0, 100)`
- 若随机数未命中，则记录 `attack_missed`

## 伤害公式

### 1. 基础伤害

```text
baseDamage = max(minimumDamage, effectiveAttack - effectiveDefense)
```

若 `effectiveAttack - effectiveDefense < minimumDamage`，仍强制造成最小伤害，并在日志中标记 `（不破防）`。

### 2. 护甲减伤

```text
armorGap = max(0, targetArmor - actorArmorPenetration)
rawArmorReduction = armorGap / (armorFormulaBase + armorGap)
armorReduction = min(maxArmorDamageReduction, rawArmorReduction)
armorMultiplier = 1 - armorReduction
```

- `armorFormulaBase` 由整场战斗参数填写，默认 `200`
- `maxArmorDamageReduction` 由整场战斗参数填写，默认 `75%`
- 若 `armorGap <= 0`，护甲减伤视为 `0`

### 3. 暴击与爆头

- 暴击独立判定：`critChance` 成功后乘 `critMultiplier / 100`
- 爆头独立判定：`headshotChance` 成功后乘 `headshotMultiplier / 100`
- 爆头与暴击互不抢占概率，可以同时生效

### 4. 元素克制

- 只要攻击元素或防护类型任一方为 `无`，元素乘区按 `1`
- 默认克制表：
  - 物理克制隔热甲，被重甲克制
  - 火焰克制绝缘甲，被隔热甲克制
  - 电磁克制生化甲，被绝缘甲克制
  - 腐蚀克制重甲，被生化甲克制
- 克制造伤倍率默认 `120%`
- 被克造伤倍率默认 `80%`

### 5. 其他乘区

```text
scenarioMultiplier = 1 + scenarioDamageBonus / 100
heroClassMultiplier = 1 + heroClassDamageBonus / 100
skillTypeMultiplier = 1 + skillTypeDamageBonus / 100
skillMultiplier = skillMultiplier / 100
outputMultiplier = max(0, 1 + (outputAmplify - outputDecay) / 100)
damageTakenMultiplier = max(0, 1 + (damageTakenAmplify - damageTakenReduction) / 100)
finalDamageMultiplier = max(0, 1 + (finalDamageBonus - finalDamageReduction) / 100)
```

### 6. 最终伤害

```text
damageBeforeRound =
  baseDamage
  * armorMultiplier
  * criticalMultiplier
  * headshotMultiplier
  * elementMultiplier
  * scenarioMultiplier
  * heroClassMultiplier
  * skillTypeMultiplier
  * skillMultiplier
  * outputMultiplier
  * damageTakenMultiplier
  * finalDamageMultiplier

damage = max(minimumDamage, round(damageBeforeRound))
```

## 战斗结束

- 任一方全灭时立即结束
- `Arpg即时制（时间）` 模式下，若同一时间点统一结算后双方同时全灭，则结果记为平局
- 或达到 `maxRounds`，结果按平局处理
- 或达到 `maxBattleTimeMs`，结果按平局处理
- 结果支持显示胜方与幸存单位剩余生命，例如 `23/30 HP`

## 事件日志

- 当前事件类型：
  - `battle_started`
  - `round_started`
  - `turn_started`
  - `reload_started`
  - `reload_completed`
  - `attack_missed`
  - `damage_applied`
  - `unit_defeated`
  - `battle_ended`
- 所有事件都带稳定递增的 `timeIndex`，它表示事件索引，不表示毫秒时间
- 事件附加载荷里会记录当前时间点 `timelineMs`
- 伤害事件会记录当前生命、最大生命、暴击、爆头、护甲减伤、元素关系和各乘区信息

## 一致性要求

- 前端本地模拟与后端 API 必须产出同口径结果
- 建议在规则变更后至少执行：

```bash
npm run smoke
node ./scripts/attribute-audit.mjs
python3 -m py_compile backend/models.py backend/validation.py backend/simulator.py backend/server.py backend/battle_config_macros.py
```
