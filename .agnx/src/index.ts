// 场景：Rakazo Sub App 入口 — 薄壳 + ensure + iframe（承接上游 Web 形态，不动上游业务代码）。
import type { WorkspaceAppHostApi, WorkspaceAppModule } from "@agnx-lab/app-sdk";
import {
  RAKAZO_APP_ID,
  RAKAZO_ENSURE_TOOL_REL,
  RAKAZO_OPEN_COMMAND_ID,
  RAKAZO_PANEL_ID,
} from "./constants";
import { bindRakazoHost } from "./host-bind";
import { RakazoPanel } from "./panel";

export const appId = RAKAZO_APP_ID;

function openRakazoTab(
  host: WorkspaceAppHostApi,
  context?: { serverId?: string; workspaceId?: string; currentPathname?: string | null },
): void {
  host.openSubAppTab({
    appId: RAKAZO_APP_ID,
    panelId: RAKAZO_PANEL_ID,
    serverId: context?.serverId,
    workspaceId: context?.workspaceId,
    currentPathname: context?.currentPathname,
  });
}

export function activate(host: WorkspaceAppHostApi): () => void {
  bindRakazoHost(host);

  const disposers: Array<() => void> = [];

  // ① 面板（= 一类 Tab）：上游 web 主界面整块贴进 Tab。
  disposers.push(
    host.registerMiniApp({
      id: RAKAZO_PANEL_ID,
      appId: RAKAZO_APP_ID,
      title: "Rakazo",
      component: RakazoPanel,
      primaryPanel: true,
      iframeShortcutCapture: true,
      isolation: {
        mode: "iframe",
        sidecarTools: [RAKAZO_ENSURE_TOOL_REL],
        note: "Tab iframe 加载上游 Vite 预览（127.0.0.1:8121），/api 与 /rpc 同源反代到上游 api",
      },
    }),
  );

  // ② 命令 → 打开 Tab（命令面板可搜 + 侧栏按钮组入口）。
  disposers.push(
    host.registerCommand({
      id: RAKAZO_OPEN_COMMAND_ID,
      appId: RAKAZO_APP_ID,
      title: "Rakazo",
      keywords: ["rakazo", "ai teammate", "ai 员工", "grok bot", "agent", "数字员工", "team"],
      sidebarAction: { defaultVisible: true, label: "Rakazo", order: 60 },
      run: (context) => {
        openRakazoTab(host, context);
      },
    }),
  );

  return () => {
    for (const d of disposers.toReversed()) d();
  };
}

const moduleExport: WorkspaceAppModule = { appId: RAKAZO_APP_ID, activate };
export default moduleExport;

export { RAKAZO_APP_ID, RAKAZO_OPEN_COMMAND_ID, RAKAZO_PANEL_ID } from "./constants";
export { RakazoPanel } from "./panel";
