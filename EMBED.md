# Rakazo × Agnx 子应用接入记录（appId = `rakazo`）

## 上游嵌入

- **上游**：`elie222/rakazo` @ `34dff7a4c17c66517f775900013e40eca2788e15`（main，2026-10-19，「Prepare desktop v0.3.0 release (#1545)」）；许可证 **Apache-2.0**（上游根 `package.json` `"license": "Apache-2.0"` + `LICENSE` 全文）。★ 4.76k。
- **上游形态**：pnpm monorepo（`apps/{web,api,worker,desktop,mobile,www}` + `packages/*`）。
  - `apps/web`：React 19 + Vite 8（默认 5173），自带 `/api`、`/rpc` 同源反代；
  - `apps/api`：Hono + oRPC + Prisma 7 + **PostgreSQL**（默认 127.0.0.1:3100）；
  - `apps/worker`：Graphile Worker（跑对话/任务；本接入不启动，见缺口表）；
  - `apps/desktop`：Electron 客户端；`apps/mobile`：Expo（上游自己发布 App Store / APK）。
- **上游原生平台**：桌面 ✅（Electron + 官方桌面端）| 网页 ✅（Vite SPA）| 移动 ✅（Expo，App Store / APK）。
- **工作方式**：**原样嵌入**（首选）。上游业务代码一行未改，只通过**环境变量**控制端口 / 数据目录 / 沙箱提供方 / 密钥来源。
- **起服方式**（本机实测可用，不使用 Docker）：
  ```
  node .agnx/tools/rakazo-stack.mjs
    ├─ apps/api ：tsx src/index.ts          → 127.0.0.1:3100（仅 loopback）
    └─ apps/web ：vite preview              → 127.0.0.1:8121（/api、/rpc 反代到 3100）
  数据库：本机 PostgreSQL 16（127.0.0.1:5432，库 rakazo / 角色 rakazo），
          Prisma `migrate deploy` 已完成（70 张表），client 已生成到 packages/db/src/generated
  沙箱：SANDBOX_PROVIDER=none（不启 Docker supervisor，见缺口表）
  ```
- **上游改动清单**：**无**。唯一"外部"动作是把数据 `.env` 放到宿主数据根（上游原生 `DATA_DIR`），不写进安装根。

### 端口

- `defaultPort = 8121`（独占，批次台账分配；已核对与已装 52 个子应用的 `sidecar.defaultPort` 无冲突）。
- api 用 `127.0.0.1:3100`（只巡回环、不经浏览器暴露）；Postgres 复用本机全局实例的**独立库**，未新增实例。
- 8121 的进程归属校验：`lsof -nP -iTCP:8121 -sTCP:LISTEN` → 必须是 `rakazo-stack.mjs` 派生的 `vite preview`，否则不杀。

### 挂载

- `guest.kind = "web"`，`guest.auth = "none"`，`capabilities = ["cookies", "websocket"]`，`preferStrategy = "auto"`。
- 实测策略：**direct-iframe**（宿主日志 `guest:mount.ok strategy=direct-iframe origin=http://127.0.0.1:8121/`）。上游没有发 `X-Frame-Options` / `frame-ancestors`，无需反代去头。
- sidecar：`supervised: true` + `ensureTool: .agnx/tools/ensure-rakazo.mjs` + `stateFile: rakazo.json`。

### 面板与 Tab

| panelId | 名字 | 加载方式 | 说明 |
| --- | --- | --- | --- |
| `rakazo.main` | Rakazo | `ensureTool`（`.agnx/tools/ensure-rakazo.mjs`） | 单一主面板（`primaryPanel: true`），上游 web 主界面整块贴进 Tab；`iframeShortcutCapture: true` |

- 命令 `rakazo.open`，**title = `"Rakazo"`**（不是「打开 Rakazo」），`sidebarAction.label = "Rakazo"`。
- 面板根 `data-testid="workspace-mini-app-rakazo-root"`，满铺无 padding（`assert-guest-panel-edge-to-edge` PASS 1 files）。

### 图标

- `.agnx/assets/rakazo-icon.png`（44,764 B）+ `.agnx/assets/rakazo-icon-dark.png`（44,764 B），均取自上游官方品牌标 `apps/www/public/brand/rakazo-mark.png` 重采样。
- manifest 同时声明 `icon` 与 `iconDark`（**相对仓根**）：`assert-icon.mjs` → `ok rakazo … +dark …` / `PASS 1 / 1`。

### 桌面验收截图（`logs/`）

| 文件 | 内容 |
| --- | --- |
| `rakazo-desktop-01.png` | 首次挂载（当时前台是别的 Tab，留档用） |
| `rakazo-desktop-02.png` | **Tab 选中 + 上游 Rakazo 首屏**（「你的一支随时在线的 Agent 团队 / 注册 / 登录」），左侧栏 + Tab 条完整，无白边、无错误文案 |
| `rakazo-desktop-signup-form.png` | 首屏留档（同上视图） |
| `rakazo-desktop-act1.png` | 操作过程留档（坐标点击落到别处，见缺口表） |
| `rakazo-desktop-signin.png` | **真实操作**：Tab 内进入上游「登录 Rakazo」页，邮箱/密码/「使用邮箱继续」完整渲染 |

### 自验记录（实测）

- 扫描报告：`installState=installed`、`launchMode=packaged`、`loadSource=packaged-main`、`mainPath=…/.agnx/dist/index.js`、`iconPath=…/.agnx/assets/rakazo-icon.png`、`failures=[]`。
- 侧栏格子 `sidebar-mini-app-grid-rakazo` 存在；Tab `workspace-tab-mini-app_rakazo__rakazo.main__default` 可选中。
- 端口探活（`curl` 只用于判活）：`GET http://127.0.0.1:8121/` → 200；`GET http://127.0.0.1:3100/ready` → 200 `{"ok":true,"degraded":false}`。
- 真实操作：在 Tab 内点击「登录」进入上游登录页（见 `rakazo-desktop-signin.png`）；上游注册接口已创建部署所有者账号 `owner@rakazo.local`（首个用户即 deployment owner）。

## 嵌页宿主能力缺口

| 上游能力 | 信号位置 | 嵌后风险 | 处置 (A–E) | 主路径 | 备注 |
| --- | --- | --- | --- | --- | --- |
| **会话 cookie（better-auth）** | `apps/web/src/lib/auth.ts` `createAuthClient()`；cookie 域 = `127.0.0.1:8121` | iframe 内 `document.cookie` 为空 → 登录接口 200 但页面仍停留 `/sign-in`（第三方 cookie 被拦） | **D 待解** | 需要 `url-token-then-cookie`（guest-webview 独立分区）或宿主放行「同站 cookie」 | 本机实测：API 登录返回 200 + token，但 iframe 会话拿不到；`guest.auth` 当前为 `none`。这是本接入**唯一阻断「登录后主界面」**的缺口 |
| **worker（Graphile Worker）** | `apps/worker/src/index.ts` | 对话/任务执行链路没有消费端 → 建 Agent 能建、跑不动 | **A 接受，记为已知缺口** | 不启（单进程 sidecar 只托管一个进程，再起 worker 需扩大 sidecar 契约） | 未启动；UI 首屏与登录不受影响 |
| **Docker 沙箱（computer）** | `SANDBOX_PROVIDER`（`packages/adapters/src/sandbox-provider-env.ts`） | Agent 无法操作电脑（无沙箱容器） | **A 接受，记为已知缺口** | `SANDBOX_PROVIDER=none`，不跑 Docker | 按用户要求本机不起容器 |
| **模型密钥** | `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` / `PI_DEFAULT_*` | 没有 key 时能登录、能看界面，但发消息跑不了模型 | **A 接受** | 从宿主环境继承，或写 `$AGNX_HOME/apps/data/rakazo/.env`；**代码里不写死任何 key** | 本机未配置 key（如实记录） |
| **daemon 侧 sidecar spawn** | `packages/server/src/workspace-apps/loopback-sidecar-session.ts` `spawnFromSupervisedPlan` → `spawnSidecarChild` | 实测宿主 ensure 只用 ~419ms 返回 ok，但 8121 未被监听（侧车未真正拉起，daemon 日志无 `ensure.done`） | **B 规避** | `ensure-rakazo.mjs` 在输出 plan 后**自行 detached 拉起** `rakazo-stack.mjs` 并等健康，再返回 `reused:true`，让宿主走 adopt 分支接管 | 这是本机宿主行为的工作区方案，不是上游问题；若后续宿主修复，可去掉自拉段 |
| **Electron 壳的鼠标坐标点击** | 壳层 Tab 条 / 快捷键 | 用全局坐标 `page.mouse.click()` 点 iframe 内按钮会落到壳层（甚至把前台切到别的 Tab） | **C 有损** | 验收要用 CDP `Target.attachToTarget` 连 iframe 自己的 target，或人工点击 | 见 `rakazo-desktop-act1.png` |
| **系统级能力（通知/托盘/选目录）** | 上游 Electron 专用路径 | iframe 内不可用 | **A 接受**（非主路径） | 主界面不依赖这些能力 | — |

### 首次成本

- `pnpm install --frozen-lockfile`（上游整仓，~4m43s，`node_modules` ~928MB）
- `pnpm --filter @rakazo/db generate`（Prisma client）
- `pnpm --filter @rakazo/db migrate`（需 Postgres，70 张表）
- `pnpm --filter @rakazo/web exec vite build`（~5.5s）

`ensure-rakazo.mjs` 在检测到 `apps/web/dist/index.html` 缺失时会自动补跑上述步骤（写在 `prepareUpstream()`），已有产物则只做健康探测 + 复用。
