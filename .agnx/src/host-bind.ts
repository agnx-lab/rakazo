// 场景：Rakazo Host 绑定单例 — 入口 activate 写、面板读。
import type { WorkspaceAppHostApi } from "@agnx-lab/app-sdk";

let boundHost: WorkspaceAppHostApi | null = null;

export function bindRakazoHost(host: WorkspaceAppHostApi): void {
  boundHost = host;
}

export function requireRakazoHost(): WorkspaceAppHostApi {
  if (!boundHost) {
    throw new Error("Rakazo Host 尚未绑定");
  }
  return boundHost;
}
