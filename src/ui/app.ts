import {
  unitAttributeMacroMap,
  unitAttributeMacros,
  unitStatRoleKeys,
} from "../domain/attributeMacros.ts";
import {
  createBattleRandomSeed,
  createDefaultBattleInput,
  createDefaultUnit,
  type BattleInput,
  type BattleUnitState,
  type BattleSimulationResult,
  type TeamId,
  type TargetingStrategy,
} from "../domain/battle.ts";
import { simulateBattle } from "../simulator/simulateBattle.ts";
import { fetchBackendHealth, simulateBattleByApi } from "./api.ts";

type SimulationMode = "local" | "backend";

interface AppState {
  draft: BattleInput;
  result: BattleSimulationResult | null;
  simulationMode: SimulationMode;
  backendBaseUrl: string;
  isSubmitting: boolean;
  isReplayPlaying: boolean;
  replayEventIndex: number;
  message: string | null;
}

const state: AppState = {
  draft: createDefaultBattleInput(),
  result: null,
  simulationMode: "local",
  backendBaseUrl: "http://127.0.0.1:8000",
  isSubmitting: false,
  isReplayPlaying: false,
  replayEventIndex: 0,
  message: null,
};

let replayTimerId: number | null = null;

const targetingStrategyLabels: Record<TargetingStrategy, string> = {
  front: "首个存活敌人",
  lowestHp: "优先最低生命",
  highestAttack: "优先最高攻击",
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getUnitsByTeam(teamId: TeamId) {
  return state.draft.units.filter((unit) => unit.teamId === teamId);
}

function invalidateResult() {
  stopReplay();
  state.result = null;
  state.replayEventIndex = 0;
  state.message = null;
}

function getNextUnitOrder(teamId: TeamId) {
  const maxOrder = getUnitsByTeam(teamId).reduce((currentMax, unit) => {
    const match = unit.id.match(new RegExp(`^${teamId}-(\\d+)$`));
    const order = match ? Number(match[1]) : 0;
    return Math.max(currentMax, order);
  }, 0);

  return maxOrder + 1;
}

function updateUnit(unitId: string, field: string, rawValue: string) {
  invalidateResult();
  state.draft.units = state.draft.units.map((unit) => {
    if (unit.id !== unitId) {
      return unit;
    }

    if (field === "name") {
      return { ...unit, name: rawValue || unit.name };
    }

    const value = Number(rawValue);
    if (Number.isNaN(value)) {
      return unit;
    }

    const macro = unitAttributeMacroMap[field as keyof typeof unitAttributeMacroMap];
    if (!macro) {
      return unit;
    }

    return {
      ...unit,
      stats: {
        ...unit.stats,
        [field]: Math.max(macro.min, value),
      },
    };
  });
}

function updateBattleField(
  field: "maxRounds" | "minimumDamage" | "randomSeed" | "targetingStrategy",
  rawValue: string,
) {
  if (field === "targetingStrategy") {
    invalidateResult();
    state.draft.battle = {
      ...state.draft.battle,
      targetingStrategy: rawValue as TargetingStrategy,
    };
    return;
  }

  const value = Number(rawValue);
  if (Number.isNaN(value)) {
    return;
  }

  invalidateResult();
  state.draft.battle = {
    ...state.draft.battle,
    [field]: field === "randomSeed" ? Math.max(0, Math.trunc(value)) : Math.max(1, value),
  };
}

function updateTeamName(teamId: TeamId, value: string) {
  invalidateResult();
  state.draft.battle = {
    ...state.draft.battle,
    teamNames: {
      ...state.draft.battle.teamNames,
      [teamId]: value || state.draft.battle.teamNames[teamId],
    },
  };
}

function addUnit(teamId: TeamId) {
  invalidateResult();
  state.draft.units = [...state.draft.units, createDefaultUnit(teamId, getNextUnitOrder(teamId))];
}

function removeUnit(unitId: string) {
  invalidateResult();
  state.draft.units = state.draft.units.filter((unit) => unit.id !== unitId);
}

function resetDraft() {
  stopReplay();
  state.draft = createDefaultBattleInput();
  state.result = null;
  state.message = null;
  state.isSubmitting = false;
  state.isReplayPlaying = false;
  state.replayEventIndex = 0;
}

function updateSimulationMode(mode: SimulationMode) {
  state.simulationMode = mode;
  state.message = null;
}

function updateBackendBaseUrl(value: string) {
  state.backendBaseUrl = value;
  state.message = null;
}

function refreshRandomSeed() {
  invalidateResult();
  state.draft.battle = {
    ...state.draft.battle,
    randomSeed: createBattleRandomSeed(),
  };
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportDraft() {
  downloadJson("battle-input.json", state.draft);
}

function exportResult() {
  if (!state.result) {
    return;
  }

  downloadJson("battle-result.json", state.result);
}

async function runSimulation() {
  if (state.isSubmitting) {
    return;
  }

  state.isSubmitting = true;
  state.message = null;

  try {
    state.result =
      state.simulationMode === "local"
        ? simulateBattle(state.draft)
        : await simulateBattleByApi(state.backendBaseUrl, state.draft);
    state.replayEventIndex = 0;
    state.isReplayPlaying = false;
  } catch (error) {
    state.result = null;
    state.message = error instanceof Error ? error.message : "模拟请求失败";
  } finally {
    state.isSubmitting = false;
  }
}

function stopReplay() {
  if (replayTimerId !== null) {
    window.clearInterval(replayTimerId);
    replayTimerId = null;
  }

  state.isReplayPlaying = false;
}

function getReplayEventCount() {
  return state.result?.events.length ?? 0;
}

function setReplayEventIndex(nextIndex: number) {
  const eventCount = getReplayEventCount();
  if (eventCount === 0) {
    state.replayEventIndex = 0;
    return;
  }

  state.replayEventIndex = Math.min(eventCount - 1, Math.max(0, nextIndex));
}

function stepReplay(offset: number) {
  setReplayEventIndex(state.replayEventIndex + offset);

  if (state.result && state.replayEventIndex >= state.result.events.length - 1) {
    stopReplay();
  }
}

function toggleReplay(container: HTMLElement) {
  if (!state.result) {
    return;
  }

  if (state.isReplayPlaying) {
    stopReplay();
    renderApp(container);
    return;
  }

  if (state.replayEventIndex >= state.result.events.length - 1) {
    state.replayEventIndex = 0;
  }

  state.isReplayPlaying = true;
  replayTimerId = window.setInterval(() => {
    if (!state.result || state.replayEventIndex >= state.result.events.length - 1) {
      stopReplay();
      renderApp(container);
      return;
    }

    stepReplay(1);
    renderApp(container);
  }, 500);
}

async function checkBackendHealth() {
  state.message = null;

  try {
    const health = await fetchBackendHealth(state.backendBaseUrl);
    state.message = `后端连接正常：${health.service} / ${health.status}`;
  } catch (error) {
    state.message = error instanceof Error ? error.message : "后端连接失败";
  }
}

function renderMessage() {
  if (!state.message) {
    return "";
  }

  return `<p class="message">${escapeHtml(state.message)}</p>`;
}

function renderReplayControls() {
  if (!state.result) {
    return `<p class="empty">运行模拟后，可以按事件时间轴逐步回放整场战斗。</p>`;
  }

  const currentEvent = state.result.events[state.replayEventIndex];
  const maxIndex = Math.max(0, state.result.events.length - 1);

  return `
    <div class="replay-panel">
      <div class="replay-toolbar">
        <button class="button button-secondary" data-action="replay-first" ${state.replayEventIndex === 0 ? "disabled" : ""}>首帧</button>
        <button class="button button-secondary" data-action="replay-prev" ${state.replayEventIndex === 0 ? "disabled" : ""}>上一步</button>
        <button class="button button-primary" data-action="replay-toggle">${state.isReplayPlaying ? "暂停" : "播放"}</button>
        <button class="button button-secondary" data-action="replay-next" ${state.replayEventIndex === maxIndex ? "disabled" : ""}>下一步</button>
        <button class="button button-secondary" data-action="replay-last" ${state.replayEventIndex === maxIndex ? "disabled" : ""}>末帧</button>
      </div>
      <div class="replay-status">
        <div class="summary-item">
          <span>当前事件</span>
          <strong>${state.replayEventIndex + 1} / ${state.result.events.length}</strong>
        </div>
        <div class="summary-item">
          <span>时间序号</span>
          <strong>${currentEvent.timeIndex}</strong>
        </div>
        <div class="summary-item">
          <span>事件类型</span>
          <strong>${escapeHtml(currentEvent.type)}</strong>
        </div>
        <div class="summary-item">
          <span>随机种子</span>
          <strong>${state.result.randomSeed}</strong>
        </div>
      </div>
      <div class="field">
        <label>回放进度</label>
        <input type="range" min="0" max="${maxIndex}" value="${state.replayEventIndex}" data-action="replay-seek" />
      </div>
    </div>
  `;
}

function getEffectiveMaxHp(unit: BattleUnitState | BattleInput["units"][number]) {
  const stats = unit.stats;
  return Math.max(
    1,
    Math.floor(stats[unitStatRoleKeys.maxHpBase] * (1 + stats[unitStatRoleKeys.maxHpRate] / 100) + 0.5),
  );
}

function buildReplayUnits() {
  if (!state.result) {
    return [];
  }

  const units = state.draft.units.map<BattleUnitState>((unit) => ({
    ...unit,
    currentHp: getEffectiveMaxHp(unit),
    isAlive: true,
  }));

  for (const event of state.result.events.slice(0, state.replayEventIndex + 1)) {
    if (event.type !== "damage_applied" && event.type !== "unit_defeated") {
      continue;
    }

    const targetIndex = units.findIndex((unit) => unit.id === event.targetId);
    if (targetIndex < 0) {
      continue;
    }

    const targetHp =
      typeof event.payload?.targetHp === "number"
        ? event.payload.targetHp
        : event.type === "unit_defeated"
          ? 0
          : units[targetIndex].currentHp;

    units[targetIndex] = {
      ...units[targetIndex],
      currentHp: targetHp,
      isAlive: targetHp > 0,
    };
  }

  return units;
}

function renderReplaySnapshot() {
  if (!state.result) {
    return "";
  }

  const replayUnits = buildReplayUnits();

  return `
    <div class="teams replay-snapshot">
      ${(["A", "B"] as TeamId[])
        .map((teamId) => {
          const teamUnits = replayUnits.filter((unit) => unit.teamId === teamId);

          return `
            <article class="panel panel-inner">
              <div class="panel-body">
                <div class="panel-header">
                  <h3 class="panel-title">${escapeHtml(state.draft.battle.teamNames[teamId])} 当前状态</h3>
                </div>
                <div class="unit-list">
                  ${teamUnits
                    .map(
                      (unit) => `
                        <article class="unit-card replay-unit ${unit.isAlive ? "" : "unit-card-defeated"}">
                          <header>
                            <strong>${escapeHtml(unit.name)}</strong>
                            <span class="badge badge-${unit.teamId.toLowerCase()}">${unit.isAlive ? "存活" : "阵亡"}</span>
                          </header>
                          <div class="replay-unit-stats">
                            <span>HP</span>
                            <strong>${unit.currentHp} / ${getEffectiveMaxHp(unit)}</strong>
                          </div>
                        </article>
                      `,
                    )
                    .join("")}
                </div>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderEventPayload() {
  if (!state.result) {
    return "";
  }

  const currentEvent = state.result.events[state.replayEventIndex];
  const payloadEntries = Object.entries(currentEvent.payload ?? {});
  const payloadContent =
    payloadEntries.length === 0
      ? `<p class="empty">当前事件没有附加载荷。</p>`
      : `<div class="payload-grid">${payloadEntries
          .map(
            ([key, value]) => `
              <div class="summary-item">
                <span>${escapeHtml(key)}</span>
                <strong>${escapeHtml(String(value))}</strong>
              </div>
            `,
          )
          .join("")}</div>`;

  return `
    <div class="event-detail">
      <p class="event-summary">${escapeHtml(currentEvent.summary)}</p>
      ${renderReplaySnapshot()}
      ${payloadContent}
    </div>
  `;
}

function renderUnitCard(teamId: TeamId) {
  return getUnitsByTeam(teamId)
    .map(
      (unit) => `
        <article class="unit-card">
          <header>
            <strong>${escapeHtml(unit.name)}</strong>
            <button class="button button-danger" data-action="remove-unit" data-unit-id="${unit.id}">移除</button>
          </header>
          <div class="field-grid">
            <div class="field">
              <label>名称</label>
              <input data-action="update-unit" data-unit-id="${unit.id}" data-field="name" value="${escapeHtml(unit.name)}" />
            </div>
            ${unitAttributeMacros
              .map(
                (macro) => `
                  <div class="field">
                    <label>${escapeHtml(macro.label)}</label>
                    <input
                      type="number"
                      min="${macro.min}"
                      step="${macro.step}"
                      data-action="update-unit"
                      data-unit-id="${unit.id}"
                      data-field="${macro.key}"
                      value="${unit.stats[macro.key]}"
                    />
                  </div>
                `,
              )
              .join("")}
          </div>
        </article>
      `,
    )
    .join("");
}

function renderSummary() {
  if (!state.result) {
    return `<p class="empty">运行一次模拟后，这里会展示胜负、回合数、幸存单位与完整事件流。</p>`;
  }

  const winner =
    state.result.winnerTeamId === null
      ? "平局"
      : state.draft.battle.teamNames[state.result.winnerTeamId];
  const survivors = state.result.finalUnits.filter((unit) => unit.isAlive);
  const survivorText = survivors.length === 0 ? "无" : survivors.map((unit) => unit.name).join("、");

  return `
    <div class="summary">
      <div class="summary-item">
        <span>随机种子</span>
        <strong>${state.result.randomSeed}</strong>
      </div>
      <div class="summary-item">
        <span>战斗结果</span>
        <strong>${escapeHtml(winner)}</strong>
      </div>
      <div class="summary-item">
        <span>完成回合</span>
        <strong>${state.result.roundsCompleted}</strong>
      </div>
      <div class="summary-item">
        <span>事件总数</span>
        <strong>${state.result.events.length}</strong>
      </div>
      <div class="summary-item">
        <span>幸存单位</span>
        <strong>${escapeHtml(survivorText)}</strong>
      </div>
    </div>
  `;
}

function renderLogTable() {
  if (!state.result) {
    return "";
  }

  const rows = state.result.events
    .map((event) => {
      const actor = state.draft.units.find((unit) => unit.id === event.actorId);
      const target = state.draft.units.find((unit) => unit.id === event.targetId);
      const actorBadge = actor ? `<span class="badge badge-${actor.teamId.toLowerCase()}">${escapeHtml(actor.name)}</span>` : "-";
      const targetBadge = target ? `<span class="badge badge-${target.teamId.toLowerCase()}">${escapeHtml(target.name)}</span>` : "-";

      return `
        <tr class="${event.sequence - 1 === state.replayEventIndex ? "is-active" : ""}" data-action="select-event" data-event-index="${event.sequence - 1}">
          <td>${event.sequence}</td>
          <td>${event.timeIndex}</td>
          <td>${event.round}</td>
          <td>${escapeHtml(event.type)}</td>
          <td>${actorBadge}</td>
          <td>${targetBadge}</td>
          <td>${escapeHtml(event.summary)}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <table class="log-table">
      <thead>
        <tr>
          <th>#</th>
          <th>时间序号</th>
          <th>回合</th>
          <th>事件类型</th>
          <th>执行者</th>
          <th>目标</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderApp(container: HTMLElement) {
  container.innerHTML = `
    <main class="page">
      <section class="hero">
        <h1>基础战斗模拟器</h1>
        <p>
          当前版本只实现最简单的攻击-防御回合制，但模型已经分离出单位参数、整场战斗参数与事件流。
          后续你给出更复杂的属性、技能和算法后，可以直接在领域模型和模拟引擎上继续叠加。
        </p>
      </section>

      <section class="layout">
        <article class="panel">
          <div class="panel-body">
            <div class="panel-header">
              <h2 class="panel-title">整场战斗参数</h2>
              <div class="toolbar">
                <button class="button button-secondary" data-action="reset">恢复默认</button>
                <button class="button button-secondary" data-action="refresh-seed">刷新种子</button>
                <button class="button button-ghost" data-action="export-draft">导出配置</button>
                <button class="button button-primary" data-action="simulate" ${state.isSubmitting ? "disabled" : ""}>${state.isSubmitting ? "运行中..." : "运行模拟"}</button>
              </div>
            </div>
            <div class="grid-3">
              <div class="field">
                <label>模拟执行方式</label>
                <select data-action="update-simulation-mode">
                  <option value="local" ${state.simulationMode === "local" ? "selected" : ""}>前端本地运行</option>
                  <option value="backend" ${state.simulationMode === "backend" ? "selected" : ""}>调用后端 API</option>
                </select>
              </div>
              <div class="field">
                <label>后端地址</label>
                <input data-action="update-backend-url" value="${escapeHtml(state.backendBaseUrl)}" />
              </div>
              <div class="field field-actions">
                <label>后端检查</label>
                <button class="button button-ghost" data-action="check-backend" ${state.isSubmitting ? "disabled" : ""}>检查连接</button>
              </div>
              <div class="field">
                <label>红方名称</label>
                <input data-action="update-team-name" data-team-id="A" value="${escapeHtml(state.draft.battle.teamNames.A)}" />
              </div>
              <div class="field">
                <label>蓝方名称</label>
                <input data-action="update-team-name" data-team-id="B" value="${escapeHtml(state.draft.battle.teamNames.B)}" />
              </div>
              <div class="field">
                <label>最大回合数</label>
                <input type="number" min="1" data-action="update-battle" data-field="maxRounds" value="${state.draft.battle.maxRounds}" />
              </div>
              <div class="field">
                <label>最小伤害</label>
                <input type="number" min="1" data-action="update-battle" data-field="minimumDamage" value="${state.draft.battle.minimumDamage}" />
              </div>
              <div class="field">
                <label>随机种子</label>
                <input type="number" min="0" data-action="update-battle" data-field="randomSeed" value="${state.draft.battle.randomSeed}" />
              </div>
              <div class="field">
                <label>目标策略</label>
                <select data-action="update-battle" data-field="targetingStrategy">
                  ${Object.entries(targetingStrategyLabels)
                    .map(
                      ([value, label]) =>
                        `<option value="${value}" ${state.draft.battle.targetingStrategy === value ? "selected" : ""}>${escapeHtml(label)}</option>`,
                    )
                    .join("")}
                </select>
              </div>
              <div class="field">
                <label>行动顺序</label>
                <input value="按速度降序" disabled />
              </div>
            </div>
            ${renderMessage()}
          </div>
        </article>

        <section class="teams">
          ${(["A", "B"] as TeamId[])
            .map((teamId) => {
              const isTeamA = teamId === "A";
              const buttonStyle = isTeamA ? "button-secondary" : "button-ghost";

              return `
                <article class="panel">
                  <div class="panel-body">
                    <div class="panel-header">
                      <h2 class="panel-title">${escapeHtml(state.draft.battle.teamNames[teamId])} 编队</h2>
                      <button class="button ${buttonStyle}" data-action="add-unit" data-team-id="${teamId}">新增单位</button>
                    </div>
                    <div class="unit-list">
                      ${renderUnitCard(teamId)}
                    </div>
                  </div>
                </article>
              `;
            })
            .join("")}
        </section>

        <article class="panel">
          <div class="panel-body">
            <div class="panel-header">
              <h2 class="panel-title">模拟结果</h2>
              <div class="toolbar">
                <button class="button button-ghost" data-action="export-result" ${state.result ? "" : "disabled"}>导出结果</button>
              </div>
            </div>
            ${renderSummary()}
          </div>
        </article>

        <article class="panel">
          <div class="panel-body">
            <div class="panel-header">
              <h2 class="panel-title">战斗回放</h2>
            </div>
            ${renderReplayControls()}
          </div>
        </article>

        <article class="panel">
          <div class="panel-body">
            <div class="panel-header">
              <h2 class="panel-title">当前事件</h2>
            </div>
            ${renderEventPayload()}
          </div>
        </article>

        <article class="panel">
          <div class="panel-body">
            <div class="panel-header">
              <h2 class="panel-title">事件日志</h2>
            </div>
            ${renderLogTable()}
          </div>
        </article>
      </section>
    </main>
  `;

  bindEvents(container);
}

function bindEvents(container: HTMLElement) {
  container.querySelectorAll<HTMLInputElement>("[data-action='update-unit']").forEach((input) => {
    input.addEventListener("input", (event) => {
      const target = event.currentTarget as HTMLInputElement;
      updateUnit(target.dataset.unitId ?? "", target.dataset.field ?? "", target.value);
      renderApp(container);
    });
  });

  container.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-action='update-battle']").forEach((input) => {
    input.addEventListener("input", (event) => {
      const target = event.currentTarget as HTMLInputElement | HTMLSelectElement;
      updateBattleField(
        (target.dataset.field as "maxRounds" | "minimumDamage" | "randomSeed" | "targetingStrategy") ?? "maxRounds",
        target.value,
      );
      renderApp(container);
    });
  });

  container.querySelectorAll<HTMLInputElement>("[data-action='update-team-name']").forEach((input) => {
    input.addEventListener("input", (event) => {
      const target = event.currentTarget as HTMLInputElement;
      updateTeamName((target.dataset.teamId as TeamId) ?? "A", target.value);
      renderApp(container);
    });
  });

  container.querySelectorAll<HTMLButtonElement>("[data-action='add-unit']").forEach((button) => {
    button.addEventListener("click", () => {
      addUnit((button.dataset.teamId as TeamId) ?? "A");
      renderApp(container);
    });
  });

  container.querySelectorAll<HTMLButtonElement>("[data-action='remove-unit']").forEach((button) => {
    button.addEventListener("click", () => {
      removeUnit(button.dataset.unitId ?? "");
      renderApp(container);
    });
  });

  container.querySelector<HTMLSelectElement>("[data-action='update-simulation-mode']")?.addEventListener("change", (event) => {
    const target = event.currentTarget as HTMLSelectElement;
    updateSimulationMode((target.value as SimulationMode) ?? "local");
    renderApp(container);
  });

  container.querySelector<HTMLInputElement>("[data-action='update-backend-url']")?.addEventListener("input", (event) => {
    const target = event.currentTarget as HTMLInputElement;
    updateBackendBaseUrl(target.value);
    renderApp(container);
  });

  container.querySelector("[data-action='check-backend']")?.addEventListener("click", async () => {
    await checkBackendHealth();
    renderApp(container);
  });

  container.querySelector("[data-action='simulate']")?.addEventListener("click", async () => {
    stopReplay();
    await runSimulation();
    renderApp(container);
  });

  container.querySelector("[data-action='reset']")?.addEventListener("click", () => {
    resetDraft();
    renderApp(container);
  });

  container.querySelector("[data-action='refresh-seed']")?.addEventListener("click", () => {
    refreshRandomSeed();
    renderApp(container);
  });

  container.querySelector("[data-action='export-draft']")?.addEventListener("click", () => {
    exportDraft();
  });

  container.querySelector("[data-action='export-result']")?.addEventListener("click", () => {
    exportResult();
  });

  container.querySelector("[data-action='replay-toggle']")?.addEventListener("click", () => {
    toggleReplay(container);
    renderApp(container);
  });

  container.querySelector("[data-action='replay-first']")?.addEventListener("click", () => {
    stopReplay();
    setReplayEventIndex(0);
    renderApp(container);
  });

  container.querySelector("[data-action='replay-prev']")?.addEventListener("click", () => {
    stopReplay();
    stepReplay(-1);
    renderApp(container);
  });

  container.querySelector("[data-action='replay-next']")?.addEventListener("click", () => {
    stopReplay();
    stepReplay(1);
    renderApp(container);
  });

  container.querySelector("[data-action='replay-last']")?.addEventListener("click", () => {
    stopReplay();
    setReplayEventIndex(getReplayEventCount() - 1);
    renderApp(container);
  });

  container.querySelector<HTMLInputElement>("[data-action='replay-seek']")?.addEventListener("input", (event) => {
    stopReplay();
    const target = event.currentTarget as HTMLInputElement;
    setReplayEventIndex(Number(target.value));
    renderApp(container);
  });

  container.querySelectorAll<HTMLElement>("[data-action='select-event']").forEach((row) => {
    row.addEventListener("click", () => {
      stopReplay();
      setReplayEventIndex(Number(row.dataset.eventIndex ?? "0"));
      renderApp(container);
    });
  });
}

export function mountApp(container: HTMLElement) {
  renderApp(container);
}
