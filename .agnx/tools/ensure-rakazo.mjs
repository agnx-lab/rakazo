#!/usr/bin/env node
/**
 * 场景：受管 sidecar — 把 Rakazo 上游「web(Vite 预览, 8171) + api(Hono, 3100)」双进程
 * 交给 Agnx daemon supervisor 托管，对外只暴露 8121（上游 Vite 预览自带 /api 与 /rpc 同源反代）。
 *
 * 用法：node .agnx/tools/ensure-rakazo.mjs --port 8121 [--api-port 3100] --work-dir <dataRoot> --supervised
 * stdout 最后一行单行 JSON：
 *   - 复用：{"ok":true,"reused":true,"origin":"http://127.0.0.1:8121","pid":<web pid>}
 *   - 拉起：{"ok":true,"reused":false,"plan":{command,args,cwd,env,fingerprint,healthUrl,port}}
 *   - 失败：{"ok":false,"error":"..."} 且 exitCode=1
 *
 * 上游改动：无。只通过环境变量控制端口（WEB_PORT）、模型 provider 可用性与密钥来源。
 * 密钥一律「从宿主环境继承 → 读 $AGNX_HOME/apps/data/rakazo/.env」，绝不写死在本脚本里。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** repoRoot = Rakazo 上游仓根（本脚本位于 <repo>/.agnx/tools/） */
const repoRoot = path.resolve(__dirname, "../..");
const webDir = path.join(repoRoot, "apps", "web");
const STATE_FILE_NAME = "rakazo.json";
/**
 * plan.healthUrl 必须指向对外端口 8121：宿主用它对「8121 上是否已有本应用实例」做判活。
 * Vite 预览对未命中的路径回 SPA 首页（200 + text/html），所以判活只看状态码。
 */
const HEALTH_PATH = "/";
const DEFAULT_PORT = 8121;
const DEFAULT_API_PORT = 3100;

function trace(phase, fields) {
  process.stderr.write(`[ensure-rakazo] ${JSON.stringify({ phase, ...fields })}\n`);
}

function parseArgs(argv) {
  let workDir = process.env.AGNX_APP_DATA_ROOT || "";
  let port = DEFAULT_PORT;
  let apiPort = DEFAULT_API_PORT;
  let supervised = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if ((arg === "--work-dir" || arg === "--workDir") && next) {
      workDir = String(next).trim();
      i += 1;
    } else if (arg === "--port" && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n > 0) port = n;
      i += 1;
    } else if ((arg === "--api-port" || arg === "--apiPort") && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n > 0) apiPort = n;
      i += 1;
    } else if (arg === "--supervised") {
      supervised = true;
    }
  }
  return {
    workDir: workDir || path.join(repoRoot, ".agnx-rakazo-runtime"),
    port,
    apiPort,
    supervised,
  };
}

/**
 * 找出可用 node（上游要求 ^22.22.2 || ^24 || >=26；22.22.1 会被 engine-strict 判死）。
 * 顺序：RAKAZO_NODE_BIN 覆盖 → 运行本脚本的 node → nvm 的 v24 → PATH。
 */
function resolveNodeBin() {
  const override = process.env.RAKAZO_NODE_BIN;
  if (override && existsSync(override)) return override;
  const prefer = [process.execPath];
  const nvm = process.env.NVM_DIR || path.join(process.env.HOME || "", ".nvm");
  const versionsDir = path.join(nvm, "versions", "node");
  try {
    const fs = spawnSync("ls", ["-1", versionsDir], { encoding: "utf8" });
    if (fs.status === 0 && fs.stdout) {
      const sorted = fs.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^v2[46]\.|^v3\d\./.test(line))
        .sort((a, b) => {
          const pa = a.slice(1).split(".").map(Number);
          const pb = b.slice(1).split(".").map(Number);
          for (let i = 0; i < 3; i += 1) {
            if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0);
          }
          return 0;
        });
      for (const v of sorted) prefer.push(path.join(versionsDir, v, "bin", "node"));
    }
  } catch {
    // 忽略：nvm 不在就只用 PATH
  }
  const which = spawnSync("which", ["node"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) prefer.push(which.stdout.trim());
  for (const candidate of prefer) {
    if (!candidate || !existsSync(candidate)) continue;
    const out = spawnSync(candidate, ["-e", "process.stdout.write(process.versions.node)"], {
      encoding: "utf8",
    });
    const version = (out.stdout || "").trim().split(".").map(Number);
    const [major, minor, patch] = version;
    const ok =
      (major === 22 && (minor > 22 || (minor === 22 && patch >= 2))) || major === 24 || major >= 26;
    if (ok) return candidate;
  }
  return null;
}

function readEnvFile(file) {
  const env = {};
  if (!existsSync(file)) return env;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

/** 密钥/配置来源：数据根的 .env（用户填写）> 宿主 env。用户 .env 优先，方便换模型连接。 */
function resolvedSecrets(workDir) {
  const fileEnv = readEnvFile(path.join(workDir, ".env"));
  const inheritKeys = [
    // 必需的本机密钥：ensureLocalConfig 写进数据根 .env，但 vite.config.ts 的
    // loadEnv 只从源码根读 .env（路径不同），所以必须显式透传给子进程，
    // 否则 vite preview 在 configurePreviewServer 里抛 SCREEN_PROXY_SECRET 未设置，
    // 进程以 code=0 静默退出 —— 表现为「组合进程退出（code=0）」且日志只有 Local 行。
    "SCREEN_PROXY_SECRET",
    "BETTER_AUTH_SECRET",
    "ENCRYPTION_KEY",
    "DATABASE_URL",
    "NODE_ENV",
    "OPENROUTER_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "PI_DEFAULT_PROVIDER",
    "PI_DEFAULT_MODEL",
    "RAKAZO_LOCAL_MODELS",
    "RAKAZO_LOCAL_MODELS_URL",
    "RAKAZO_LOCAL_CONTEXT_WINDOW",
    "RAKAZO_LOCAL_MAX_TOKENS",
    "RAKAZO_OPENAI_COMPAT_ALLOW_PUBLIC",
    "SIGNUPS_ENABLED",
    "LOG_LEVEL",
  ];
  const picked = {};
  for (const key of inheritKeys) {
    const fromFile = fileEnv[key];
    const fromHost = process.env[key];
    const value = fromFile !== undefined && fromFile !== "" ? fromFile : fromHost;
    if (value !== undefined && value !== "") picked[key] = value;
  }
  return picked;
}

/** 数据根首次启动时生成配置；之后完全复用（含随机密钥，绝不改写已存在的文件）。 */
function ensureLocalConfig(workDir) {
  mkdirSync(workDir, { recursive: true });
  const file = path.join(workDir, ".env");
  if (existsSync(file)) return file;
  const random = spawnSync(process.execPath, [
    "-e",
    "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))",
  ]);
  const seed = (random.stdout || "").toString().trim() || String(Date.now());
  const pgPassword = process.env.RAKAZO_POSTGRES_PASSWORD || "";
  const databaseUrl =
    process.env.DATABASE_URL ||
    (pgPassword
      ? `postgres://rakazo:${pgPassword}@127.0.0.1:5432/rakazo`
      : "postgres://rakazo@127.0.0.1:5432/rakazo");
  const lines = [
    "# Rakazo 本地实例配置（由 .agnx/tools/ensure-rakazo.mjs 首次生成；密钥只在本文件，勿提交）",
    "# 模型密钥可以不写：登录后可在上游 UI 里连接 provider。也可在此追加 OPENROUTER_API_KEY=…",
    "NODE_ENV=development",
    `DATABASE_URL=${databaseUrl}`,
    `BETTER_AUTH_SECRET=${seed.slice(0, 48)}`,
    `ENCRYPTION_KEY=${spawnSync(process.execPath, ["-e", "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"]).stdout?.toString().trim() || seed}`,
    `SCREEN_PROXY_SECRET=${spawnSync(process.execPath, ["-e", "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))"]).stdout?.toString().trim() || seed}`,
    "SIGNUPS_ENABLED=true",
    "LOG_LEVEL=warn",
    "",
  ];
  writeFileSync(file, lines.join("\n"), { mode: 0o600 });
  trace("config.generated", { file });
  return file;
}

function buildEnv(cfg) {
  const origin = `http://127.0.0.1:${cfg.port}`;
  const apiUrl = `http://127.0.0.1:${cfg.apiPort}`;
  const secrets = resolvedSecrets(cfg.workDir);
  return {
    ...process.env,
    // 上游 loadEnv 会从 cwd 向上找 .env；数据根的 .env 不在 cwd 链上，所以关键项必须显式注入进程 env。
    // NODE_ENV=development 同时也是上游「本地开发」判定：允许本机自签密钥、放宽 origin 校验。
    ...readEnvFile(path.join(cfg.workDir, ".env")),
    ...secrets,
    // 上游读取的公开起源（better-auth 按此签发 cookie、校验受信 origin，必须是 8121 本身）。
    WEB_ORIGIN: origin,
    BETTER_AUTH_URL: origin,
    API_URL: apiUrl,
    VITE_WEB_ORIGIN: origin,
    // Vite 预览监听 127.0.0.1:8121（strictPort），/api 与 /rpc 同源反代到 api。
    WEB_PORT: String(cfg.port),
    WEB_HOST: "127.0.0.1",
    API_PROXY_TARGET: apiUrl,
    RAKAZO_HOST: "127.0.0.1",
    // api 只监听 loopback，仅经 Vite 同源反代对外。
    API_HOST: "127.0.0.1",
    PORT: String(cfg.apiPort),
    // 数据根落 $AGNX_HOME/apps/data/rakazo/（上游原生 DATA_DIR）。
    DATA_DIR: cfg.workDir,
    // 本机无 Docker sandbox supervisor：以 none 起服（UI / 会话 / 模型连接不受影响）。
    SANDBOX_PROVIDER: "none",
    TURBO_TELEMETRY_DISABLED: "1",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    FORCE_COLOR: "0",
  };
}

function fingerprint(cfg) {
  const stat = (p) => {
    try {
      return readFileSync(p, "utf8").slice(0, 4096).length;
    } catch {
      return 0;
    }
  };
  return JSON.stringify({
    repoRoot,
    port: cfg.port,
    apiPort: cfg.apiPort,
    envFile: stat(path.join(cfg.workDir, ".env")),
    secrets: Object.keys(resolvedSecrets(cfg.workDir)).sort(),
  });
}

function httpGetStatus(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        if (body.length < 8192) body += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      res.on("error", () => resolve({ status: 0, body: "" }));
    });
    req.on("error", () => resolve({ status: 0, body: "" }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, body: "" });
    });
  });
}

/** 判活（8121）：web 已起（SPA 首页 200）。api 就绪另用 apiReady 校验。 */
async function isWebUp(port) {
  const { status, body } = await httpGetStatus(`http://127.0.0.1:${port}${HEALTH_PATH}`);
  if (status < 200 || status >= 300) return false;
  return body.length > 0;
}

/** api 就绪：上游 apps/api/src/health.ts 的 /ready（直连 api 端口，同时校验数据库）。 */
async function isApiReady(apiPort) {
  const { status, body } = await httpGetStatus(`http://127.0.0.1:${apiPort}/ready`);
  if (status < 200 || status >= 300) return false;
  try {
    const parsed = JSON.parse(body);
    return parsed.ok === true;
  } catch {
    return false;
  }
}

function isPortBusy(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(true));
    server.once("listening", () => server.close(() => resolve(false)));
    server.listen(port, "127.0.0.1");
  });
}

function listenersOnPort(port) {
  const out = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
    encoding: "utf8",
  });
  if (out.status !== 0 || !out.stdout) return [];
  return out.stdout
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function readState(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** pnpm 可执行文件：RAKAZO_PNPM_BIN 覆盖 → 与所选 node 同目录 → PATH。 */
function resolvePnpmBin() {
  const override = process.env.RAKAZO_PNPM_BIN;
  if (override && existsSync(override)) return override;
  const nodeDir = path.dirname(process.execPath);
  for (const candidate of [path.join(nodeDir, "pnpm"), path.join(nodeDir, "pnpm.cjs")]) {
    if (existsSync(candidate)) return candidate;
  }
  const which = spawnSync("which", ["pnpm"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  return null;
}

/** 自行拉起组合进程（与宿主 spawn 同 command/args/cwd/env），detached 成为独立进程组。 */
async function spawnStack(nodeBin) {
  const logPath = path.join(cfg_workDir, "rakazo-stack.log");
  const fd = openSync(logPath, "a");
  try {
    const child = spawn(
      nodeBin,
      [path.join(repoRoot, ".agnx", "tools", "rakazo-stack.mjs")],
      { cwd: webDir, env: stackEnv, detached: true, stdio: ["ignore", fd, "ignore"] },
    );
    child.unref();
    trace("spawn.stack", { pid: child.pid, log: logPath });
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      if ((await isWebUp(stackPort)) && (await isApiReady(stackApiPort))) {
        return { ok: true, pid: child.pid };
      }
      if (child.exitCode !== null) {
        const tail = readLogTail(logPath).slice(-800);
        return { ok: false, error: `Rakazo 组合进程退出（code=${child.exitCode}）：${tail}` };
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return { ok: false, error: `Rakazo 启动超时（180s）：${readLogTail(logPath).slice(-800)}` };
  } catch (error) {
    return { ok: false, error: `Rakazo 拉起失败：${String(error).slice(0, 300)}` };
  }
}

function readLogTail(file, maxBytes = 4000) {
  try {
    const raw = readFileSync(file);
    return raw.subarray(Math.max(0, raw.length - maxBytes)).toString("utf8");
  } catch {
    return "";
  }
}

let cfg_workDir = "";
let stackEnv = {};
let stackPort = 8121;
let stackApiPort = 3100;

function hasBuiltWeb() {
  return existsSync(path.join(webDir, "dist", "index.html"));
}

/** 首次运行成本：依赖安装（上游未附带 node_modules 时）+ Prisma client 生成 + Vite 生产构建。 */
function runSync(command, args, options) {
  trace("prepare.run", { command: path.basename(command), args: args.join(" ").slice(0, 180) });
  return spawnSync(command, args, { ...options, encoding: "utf8", timeout: 900_000 });
}

function prepareUpstream(env, _cfg) {
  const npmBin = path.join(path.dirname(process.execPath), "pnpm");
  if (!existsSync(npmBin)) {
    return {
      ok: false,
      error: `未找到 pnpm（期望 ${npmBin}）。Rakazo 上游使用 pnpm workspace，请先安装 pnpm 9+ 或用 RAKAZO_PNPM_BIN 指定。`,
    };
  }
  const log = path.join(process.env.AGNX_APP_DATA_ROOT || repoRoot, "rakazo-prepare.log");
  if (!existsSync(path.join(repoRoot, "node_modules", ".pnpm"))) {
    const install = runSync(npmBin, ["install", "--frozen-lockfile"], { cwd: repoRoot, env });
    if (install.status !== 0) {
      return {
        ok: false,
        error: `上游依赖安装失败（首次启动成本）。末尾输出：${(install.stderr || install.stdout || "").slice(-800)}`,
      };
    }
  }
  const migrate = runSync(
    npmBin,
    ["--dir", repoRoot, "--filter", "@rakazo/db", "run", "migrate"],
    { cwd: repoRoot, env },
  );
  if (migrate.status !== 0) {
    return {
      ok: false,
      error:
        `数据库迁移失败（需要 Postgres）。末尾输出：${(migrate.stderr || migrate.stdout || "").slice(-600)}` +
        `（日志：${log}）`,
    };
  }
  const build = runSync(
    npmBin,
    ["--dir", webDir, "exec", "vite", "build"],
    { cwd: webDir, env: { ...env, NODE_ENV: "production", SCREEN_PROXY_SECRET: env.SCREEN_PROXY_SECRET } },
  );
  if (build.status !== 0 || !hasBuiltWeb()) {
    return {
      ok: false,
      error: `上游 web 构建失败。末尾输出：${(build.stderr || build.stdout || "").slice(-800)}`,
    };
  }
  return { ok: true };
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  mkdirSync(cfg.workDir, { recursive: true });
  const statePath = path.join(cfg.workDir, STATE_FILE_NAME);
  const origin = `http://127.0.0.1:${cfg.port}`;
  const healthUrl = `${origin}${HEALTH_PATH}`;

  const nodeBin = resolveNodeBin();
  if (!nodeBin) {
    console.log(
      JSON.stringify({
        ok: false,
        error:
          "未找到符合上游 engines 的 Node（需要 ^22.22.2 || ^24 || >=26）。可 nvm install 24，或用 RAKAZO_NODE_BIN 指定可执行文件。",
      }),
    );
    process.exitCode = 1;
    return;
  }

  const configFile = ensureLocalConfig(cfg.workDir);
  const wantedFp = fingerprint(cfg);
  const existing = readState(statePath);

  // 已就绪且是同一份配置 → 复用（不重复 spawn）。
  if ((await isWebUp(cfg.port)) && (await isApiReady(cfg.apiPort))) {
    trace("reuse.healthy", { port: cfg.port, pid: existing?.pid ?? null });
    const state = {
      fingerprint: wantedFp,
      port: cfg.port,
      apiPort: cfg.apiPort,
      pid: existing?.pid ?? listenersOnPort(cfg.port)[0] ?? null,
      nodeBin,
      repoRoot,
      dataDir: cfg.workDir,
      configFile,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    console.log(
      JSON.stringify({
        ok: true,
        reused: true,
        origin,
        port: cfg.port,
        pid: state.pid,
        healthUrl,
        dataDir: cfg.workDir,
      }),
    );
    return;
  }

  // 端口被别人占着且不健康 → 不硬抢（确认是自己的旧进程才停）。
  if (await isPortBusy(cfg.port)) {
    const listeners = listenersOnPort(cfg.port);
    const owned = existing?.pid && listeners.includes(Number(existing.pid));
    if (!owned) {
      console.log(
        JSON.stringify({
          ok: false,
          error: `端口 ${cfg.port} 已被其它进程占用（pid: ${listeners.join(",") || "未知"}），未自动杀，请先关闭占用方`,
        }),
      );
      process.exitCode = 1;
      return;
    }
    for (const pid of listeners) {
      trace("stop.stale", { pid });
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // ignore
      }
    }
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && (await isPortBusy(cfg.port))) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  const env = buildEnv(cfg);
  // 宿主直接 exec command+args（不会替我们套 node），所以 command 必须是可执行文件本身。
  const pnpmBin = resolvePnpmBin();
  if (!pnpmBin) {
    console.log(
      JSON.stringify({
        ok: false,
        error: "未找到 pnpm（Rakazo 上游使用 pnpm workspace，需要 pnpm 9+）。可用 RAKAZO_PNPM_BIN 指定。",
      }),
    );
    process.exitCode = 1;
    return;
  }
  // 组合启动器：一个 sidecar 进程内同时托管上游 api 与 web（同生共死），宿主只认这一个进程。
  const args = [path.join(repoRoot, ".agnx", "tools", "rakazo-stack.mjs")];
  const prepared = !hasBuiltWeb() ? prepareUpstream(env, cfg) : { ok: true };
  trace("supervised.plan", {
    port: cfg.port,
    apiPort: cfg.apiPort,
    node: nodeBin,
    built: hasBuiltWeb(),
    prepare: prepared.ok ? "done" : prepared.error,
  });
  if (!prepared.ok) {
    console.log(JSON.stringify({ ok: false, error: prepared.error }));
    process.exitCode = 1;
    return;
  }

  // 宿主 daemon 侧在本机实测不会真正 spawn（ensure 返回 ok 但侧车未起），
  // 所以这里自持拉起组合进程（与宿主 spawn 完全相同的 command/args/cwd/env），
  // 拉起后返回 reused:true，让宿主走 adopt 分支对接已有实例。
  cfg_workDir = cfg.workDir;
  stackEnv = env;
  stackPort = cfg.port;
  stackApiPort = cfg.apiPort;
  const spawned = await spawnStack(nodeBin);
  if (!spawned.ok) {
    console.log(JSON.stringify({ ok: false, error: spawned.error }));
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify({
      ok: true,
      reused: true,
      pid: spawned.pid,
      origin,
      port: cfg.port,
      dataDir: cfg.workDir,
      configFile,
      plan: {
        command: nodeBin,
        args,
        cwd: webDir,
        env,
        fingerprint: wantedFp,
        healthUrl,
        port: cfg.port,
        launchMode: "packaged",
      },
    }),
  );
}

await main();
