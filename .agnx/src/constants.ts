// 场景：Rakazo Sub App 常量（appId / 面板 / 命令 / ensure / 端口 / 数据根）。
export const RAKAZO_APP_ID = "rakazo";
export const RAKAZO_PANEL_ID = "rakazo.main";
export const RAKAZO_OPEN_COMMAND_ID = "rakazo.open";

/** 受管 sidecar：复用或拉起上游 web(Vite 5173→8121) + api(3100) 双进程。 */
export const RAKAZO_ENSURE_TOOL_REL = ".agnx/tools/ensure-rakazo.mjs";

/** 独占端口（批次台账分配 8121；上游 UI+API 同源反代在此端口）。 */
export const DEFAULT_RAKAZO_PORT = 8121;

/** 上游 api 进程的 loopback 端口（上游默认 3100，本机空闲，仅 127.0.0.1 可达）。 */
export const DEFAULT_RAKAZO_API_PORT = 3100;

/** 首次预构建（pnpm install + prisma generate + vite build）可能较久。 */
export const RAKAZO_ENSURE_TIMEOUT_MS = 600_000;
export const RAKAZO_SURFACE_READY_TIMEOUT_MS = 180_000;
