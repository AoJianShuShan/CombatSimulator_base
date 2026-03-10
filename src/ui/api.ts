import type {
  BattleBatchRequest,
  BattleBatchSummaryResult,
  BattleInput,
  BattleSimulationResult,
} from "../domain/battle.ts";

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "");
}

export async function simulateBattleByApi(baseUrl: string, input: BattleInput): Promise<BattleSimulationResult> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/simulate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    let message = `后端模拟失败：HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload.message) {
        message = payload.message;
      }
    } catch {
      return Promise.reject(new Error(message));
    }

    throw new Error(message);
  }

  try {
    return (await response.json()) as BattleSimulationResult;
  } catch {
    throw new Error("后端返回了无法解析的 JSON 响应");
  }
}

export async function simulateBattleBatchByApi(
  baseUrl: string,
  request: BattleBatchRequest,
): Promise<BattleBatchSummaryResult> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/simulate-batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    let message = `后端批量模拟失败：HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload.message) {
        message = payload.message;
      }
    } catch {
      return Promise.reject(new Error(message));
    }

    throw new Error(message);
  }

  try {
    return (await response.json()) as BattleBatchSummaryResult;
  } catch {
    throw new Error("后端批量模拟返回了无法解析的 JSON 响应");
  }
}

export async function fetchBackendHealth(baseUrl: string): Promise<{ status: string; service: string }> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/health`);

  if (!response.ok) {
    let message = `后端健康检查失败：HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload.message) {
        message = payload.message;
      }
    } catch {
      return Promise.reject(new Error(message));
    }

    throw new Error(message);
  }

  try {
    return (await response.json()) as { status: string; service: string };
  } catch {
    throw new Error("后端健康检查返回了无法解析的 JSON 响应");
  }
}
