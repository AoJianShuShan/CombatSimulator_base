import type { BattleInput, BattleSimulationResult } from "../domain/battle.ts";

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
    throw new Error(`后端模拟失败：HTTP ${response.status}`);
  }

  return (await response.json()) as BattleSimulationResult;
}

export async function fetchBackendHealth(baseUrl: string): Promise<{ status: string; service: string }> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/health`);

  if (!response.ok) {
    throw new Error(`后端健康检查失败：HTTP ${response.status}`);
  }

  return (await response.json()) as { status: string; service: string };
}
