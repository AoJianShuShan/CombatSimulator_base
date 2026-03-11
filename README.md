# 基础战斗模拟器

一个零依赖的战斗模拟器骨架，当前提供：

- 前端 Web TypeScript：配置阵容、编辑单位、运行模拟、查看结果与事件日志
- 前端执行视图切换：单场模拟 / 多场统计
- 前端可用交互：刷新随机种子、逐事件回放、导出配置与结果 JSON
- 前端本地模拟引擎：纯函数执行战斗，不依赖 UI
- Python 后端：标准库 HTTP API，可在 WSL、Linux 或 Windows 启动
- 本地构建、冒烟测试、属性审计脚本

## 文档入口

- [属性宏定义契约](./docs/attribute-macro-contract.md)
- [整场战斗参数宏契约](./docs/battle-config-macro-contract.md)
- [当前战斗规则说明](./docs/combat-rules.md)
- [战斗伤害公式说明](./docs/damage-formula.md)
- [N 场战斗摘要设计与落地记录](./docs/n-battle-summary-plan.md)
- [时间事件驱动改造设计与落地记录](./docs/timeline-combat-design.md)

## 当前能力

- 配置整场战斗参数、阵容与单位属性
- 以矩阵形式编辑前、中、后排编队，并支持拖拽调整同排顺序与跨排移动
- 通过二级页面编辑单位属性详情，并查看只读的有效生命、有效攻击、有效防御
- 单位已支持 `射速（发/min）`、`换弹动作时间（ms）`、`弹匣最大容量（发）`
- 支持导入配置 JSON、导出配置 JSON、导出模拟结果 JSON
- 支持前端本地运行，或切换为调用后端 API
- 支持在同一份配置上运行 N 场统计，输出胜率、终局净优势、剩余血量与完成节奏摘要
- 固定 `randomSeed` 后重复运行，得到可复现的事件流
- 结果页支持逐事件回放、日志模糊筛选、关键伤害高亮，并显示换弹事件
- 整场战斗已支持 `最大战斗时长(ms)`，可与 `最大回合数` 一起作为终止条件；若因上限结束且双方仍存活，则按平局处理

## 重要约束

- 新增单位数值属性或扩展属性算法前，必须先更新 `src/config/attribute-macros.json`
- 新增整场战斗数值参数前，必须先更新 `src/config/battle-config-macros.json`
- 前端 UI、默认值、导入兼容、前后端校验、前端模拟器、后端模拟器、测试与文档，必须复用同一份定义
- 当前“统一宏”覆盖的是数值类配置；`targetingStrategy`、`attackElement`、`protectionType` 这类枚举仍定义在领域模型中

## 运行

### 给同事最快使用

- 只想打开页面并直接模拟：双击项目根目录的 `start-local.bat`
- 需要连后端 API 一起跑：双击项目根目录的 `start-fullstack.bat`
- 两个脚本都会自动打开浏览器到 `http://127.0.0.1:4173`
- `start-local.bat` 只需要 Node.js
- `start-fullstack.bat` 需要 Node.js 和 Python 3

### 前端开发服务器

```bash
npm run dev
```

默认监听 `http://127.0.0.1:4173`。

### 前端构建与冒烟测试

```bash
npm run build
npm run smoke
```

### 属性计算审计

```bash
node ./scripts/attribute-audit.mjs
```

这个脚本会固定其他属性，只改变单一变量，检查前后关键数值变化、边界保护和前后端一致性。

### 后端启动

WSL / Linux:

```bash
HOST=127.0.0.1 PORT=8000 ./scripts/run-backend.sh
```

Windows PowerShell:

```powershell
$env:HOST = "127.0.0.1"
$env:PORT = "8000"
.\scripts\run-backend.ps1
```

前端里将“模拟执行方式”切到“调用后端 API”，后端地址填 `http://127.0.0.1:8000` 即可。

## 当前战斗规则概览

- 不使用行动条
- 支持两种行动结算模式：
  - `Arpg即时制（时间）`：按统一时间轴推进；同一时间点内基于快照同时提交攻击并统一扣血；默认使用这个模式
  - `回合制速度高者先手`：同样按统一时间轴推进；同一时间点内按速度从高到低依次结算
- 每个单位带显式站位：前排、中排、后排
- `前排优先` 会按敌方前排 -> 中排 -> 后排选择目标，同排内再按初始编队顺序
- `速度` 只决定 `回合制速度高者先手` 模式下同一时间点的先后手，不决定行动频率
- `射速` 决定两次攻击之间的冷却时间：`60000 / 射速`
- 每次攻击消耗 `1` 发弹药；弹匣打空后开始换弹；只有射击冷却和换弹都完成后才能再次开火
- 战斗会在 `最大回合数` 或 `最大战斗时长(ms)` 任一条件先达到时结束；若因上限结束且双方都还存活，则按平局处理
- 有效生命 / 攻击 / 防御：`固定值 * (1 + 百分比 / 100)`，结果按四舍五入取整
- 每场战斗都带 `randomSeed`，前后端用同一种子驱动伪随机，保证可复现重播
- 命中判定：`max(0, min(100, 命中 - 闪避))`
- 伤害由基础伤害、护甲减伤、暴击、爆头、元素关系、技能倍率、各类增减伤乘区共同决定
- 任一方全灭、双方同时全灭，或达到最大回合数 / 最大战斗时长(ms) 后结束；达到上限但双方都还存活时按平局处理

详细公式与元素克制关系见 [当前战斗规则说明](./docs/combat-rules.md)。

## HTTP API

- `GET /health`
- `POST /simulate`
- `POST /simulate-batch`

`POST /simulate` 请求体对齐 [`src/domain/battle.ts`](./src/domain/battle.ts) 中的 `BattleInput`，响应体对齐 `BattleSimulationResult`。
其中 `BattleInput.battle.randomSeed` 用于伪随机重播，`BattleSimulationResult.events[*].timeIndex` 表示稳定递增的事件索引，真正的战斗时间看事件 payload 里的 `timelineMs`。

`POST /simulate-batch` 请求体格式为 `{ input: BattleInput, count: number }`，返回 N 场战斗的最终摘要统计，不返回完整事件流。

## 目录

```text
backend/      Python HTTP 后端
docs/         规则与契约文档
src/
  domain/      领域模型与宏定义加载
  simulator/   战斗引擎
  ui/          前端页面
scripts/       build / dev / smoke / 审计 / 启动脚本
dist/          构建输出
```
