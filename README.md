# 基础战斗模拟器

一个零依赖的战斗模拟器骨架，当前提供：

- 前端 Web TypeScript：配置阵容、编辑单位、运行模拟、查看结果与事件日志
- 前端本地模拟引擎：纯函数执行战斗，不依赖 UI
- Python 后端：标准库 HTTP API，可在 WSL、Linux 或 Windows 启动
- 本地构建、冒烟测试、属性审计脚本

## 文档入口

- [属性宏定义契约](./docs/attribute-macro-contract.md)
- [整场战斗参数宏契约](./docs/battle-config-macro-contract.md)
- [当前战斗规则说明](./docs/combat-rules.md)
- [战斗伤害公式说明](./docs/damage-formula.md)

## 当前能力

- 配置整场战斗参数、阵容与单位属性
- 以矩阵形式编辑前、中、后排编队，并支持拖拽调整同排顺序与跨排移动
- 通过二级页面编辑单位属性详情，并查看只读的有效生命、有效攻击、有效防御
- 支持导入配置 JSON、导出配置 JSON、导出模拟结果 JSON
- 支持前端本地运行，或切换为调用后端 API
- 固定 `randomSeed` 后重复运行，得到可复现的事件流
- 结果页支持逐事件回放、日志模糊筛选、关键伤害高亮

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

- 不使用行动条；每回合开始时，按速度从高到低排本回合行动顺序
- 每个单位带显式站位：前排、中排、后排
- `前排优先` 会按敌方前排 -> 中排 -> 后排选择目标，同排内再按初始编队顺序
- 有效生命 / 攻击 / 防御：`固定值 * (1 + 百分比 / 100)`，结果按四舍五入取整
- 命中判定：`max(0, min(100, 命中 - 闪避))`
- 伤害由基础伤害、护甲减伤、暴击、爆头、元素关系、技能倍率、各类增减伤乘区共同决定
- 任一方全灭或达到最大回合数后结束

详细公式与元素克制关系见 [当前战斗规则说明](./docs/combat-rules.md)。

## HTTP API

- `GET /health`
- `POST /simulate`

`POST /simulate` 请求体对齐 [`src/domain/battle.ts`](./src/domain/battle.ts) 中的 `BattleInput`，响应体对齐 `BattleSimulationResult`。
其中 `BattleInput.battle.randomSeed` 用于伪随机重播，`BattleSimulationResult.events[*].timeIndex` 用于事件时间轴。

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
