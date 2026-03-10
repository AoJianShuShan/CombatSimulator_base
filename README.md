# 基础战斗模拟器

一个零依赖的战斗模拟器骨架，当前包含：

- 前端 Web TypeScript：配置 N vs N 阵容、运行模拟、查看事件日志
- 前端可用交互：刷新随机种子、逐事件回放、导出配置与结果 JSON
- 前端本地模拟引擎：纯函数执行战斗，不依赖 UI
- Python 后端：标准库 HTTP API，可在 WSL 或 Windows 启动

## 重要约束

- 新增属性或扩展属性算法前，必须先更新 [attribute-macros.json](/mnt/e/aiproj/基础战斗模拟器/src/config/attribute-macros.json)。
- 前端 UI、默认值、本地模拟器、后端模拟器、测试与文档，必须复用同一份属性宏定义。
- 详细约束见 [attribute-macro-contract.md](/mnt/e/aiproj/基础战斗模拟器/docs/attribute-macro-contract.md)。

## 运行

### 前端构建

```bash
npm run build
npm run smoke
```

### 后端启动

WSL / Linux:

```bash
cd "/mnt/e/AIProJ/基础战斗模拟器"
HOST=127.0.0.1 PORT=8000 "./scripts/run-backend.sh"
```

Windows PowerShell:

```powershell
Set-Location "E:\AIProJ\基础战斗模拟器"
$env:HOST = "127.0.0.1"
$env:PORT = "8000"
.\scripts\run-backend.ps1
```

前端里将“模拟执行方式”切到“调用后端 API”，后端地址填 `http://127.0.0.1:8000` 即可。

## 基础可用版能力

- 配置战斗参数、阵容与单位属性
- 配置单位前、中、后排站位，并在页面上按矩阵查看编队
- 在前端本地运行，或切换为调用后端 API
- 固定 `randomSeed` 后重复运行，得到可复现的事件流
- 基于 `timeIndex` 对事件逐步回放、播放、暂停和跳转
- 导出当前配置 JSON 与模拟结果 JSON，便于复现和留档

## 当前规则

- 双方单位按速度从高到低行动
- 每场战斗都带 `randomSeed`，前后端用同一种子驱动伪随机，保证可复现重播
- 每个单位都带显式站位：前排、中排、后排
- `前排优先` 策略会先攻击敌方前排；前排清空后再打中排，最后才打后排
- 有效生命 / 攻击 / 防御：`固定值 * (1 + 百分比 / 100)`，结果取整后参与计算
- 命中判定：`max(0, min(100, 命中 - 闪避))`
- 伤害公式：`max(最小伤害, 有效攻击 - 有效防御)`；暴击后再乘以暴击倍率
- 任一方全灭或达到最大回合数后结束
- 每个事件都带稳定递增的 `timeIndex`，作为战斗内时间序号
- 输出完整事件流：战斗开始、回合开始、单位行动、未命中、伤害、死亡、战斗结束

## 目录

```text
backend/      Python HTTP 后端
src/
  domain/      领域模型
  simulator/   战斗引擎
  ui/          前端页面
scripts/       本地 build / dev / smoke 脚本
dist/          构建输出
```

## HTTP API

- `GET /health`
- `POST /simulate`

`POST /simulate` 请求体对齐 [battle.ts](/mnt/e/AIProJ/基础战斗模拟器/src/domain/battle.ts) 中的 `BattleInput`，响应体对齐 `BattleSimulationResult`。
其中 `BattleInput.battle.randomSeed` 用于伪随机重播，`BattleSimulationResult.events[*].timeIndex` 用于事件时间轴。

## 跨环境使用

- 后端跑在 WSL 时，Windows 浏览器通常可直接访问 `http://localhost:8000`
- 后端跑在 Windows 时，前端同样访问 `http://localhost:8000`
- 前端当前保留“本地运行”模式，后端未启动时也能继续调试规则

## 后续扩展建议

- 单位参数：技能、冷却、Buff / Debuff
- 战斗参数：随机种子、地图、阵型、行动条
- 后端化：将 `src/domain` 与 `src/simulator` 提取为共享协议，前端只负责配置与可视化
