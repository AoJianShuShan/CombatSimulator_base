import {
  createDefaultBattleInput,
  createDefaultUnit,
  type BattleInput,
  type BattleSimulationResult,
  type TeamId,
} from "../domain/battle.ts";
import { simulateBattle } from "../simulator/simulateBattle.ts";

interface AppState {
  draft: BattleInput;
  result: BattleSimulationResult | null;
}

const state: AppState = {
  draft: createDefaultBattleInput(),
  result: null,
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
  state.result = null;
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

    return {
      ...unit,
      stats: {
        ...unit.stats,
        [field]: Math.max(0, value),
      },
    };
  });
}

function updateBattleField(field: "maxRounds" | "minimumDamage", rawValue: string) {
  const value = Number(rawValue);
  if (Number.isNaN(value)) {
    return;
  }

  invalidateResult();
  state.draft.battle = {
    ...state.draft.battle,
    [field]: Math.max(1, value),
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
  state.draft = createDefaultBattleInput();
  state.result = null;
}

function runSimulation() {
  state.result = simulateBattle(state.draft);
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
            <div class="field">
              <label>最大生命</label>
              <input type="number" min="1" data-action="update-unit" data-unit-id="${unit.id}" data-field="maxHp" value="${unit.stats.maxHp}" />
            </div>
            <div class="field">
              <label>攻击</label>
              <input type="number" min="0" data-action="update-unit" data-unit-id="${unit.id}" data-field="attack" value="${unit.stats.attack}" />
            </div>
            <div class="field">
              <label>防御</label>
              <input type="number" min="0" data-action="update-unit" data-unit-id="${unit.id}" data-field="defense" value="${unit.stats.defense}" />
            </div>
            <div class="field">
              <label>速度</label>
              <input type="number" min="0" data-action="update-unit" data-unit-id="${unit.id}" data-field="speed" value="${unit.stats.speed}" />
            </div>
            <div class="field">
              <label>扩展参数占位</label>
              <input value="后续补充" disabled />
            </div>
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
        <tr>
          <td>${event.sequence}</td>
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
                <button class="button button-primary" data-action="simulate">运行模拟</button>
              </div>
            </div>
            <div class="grid-3">
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
                <label>目标策略</label>
                <input value="固定攻击首个存活敌人" disabled />
              </div>
              <div class="field">
                <label>行动顺序</label>
                <input value="按速度降序" disabled />
              </div>
            </div>
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
            </div>
            ${renderSummary()}
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

  container.querySelectorAll<HTMLInputElement>("[data-action='update-battle']").forEach((input) => {
    input.addEventListener("input", (event) => {
      const target = event.currentTarget as HTMLInputElement;
      updateBattleField((target.dataset.field as "maxRounds" | "minimumDamage") ?? "maxRounds", target.value);
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

  container.querySelector("[data-action='simulate']")?.addEventListener("click", () => {
    runSimulation();
    renderApp(container);
  });

  container.querySelector("[data-action='reset']")?.addEventListener("click", () => {
    resetDraft();
    renderApp(container);
  });
}

export function mountApp(container: HTMLElement) {
  renderApp(container);
}
