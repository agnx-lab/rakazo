#!/usr/bin/env node
/**
 * 场景：Rakazo 组合启动器 — 上游上游是「web(Vite 预览) + api(Hono) + Postgres」的三段形态，
 * 而 Agnx 一个 sidecar 只托管一个进程。这里在**同一个进程组**里同时拉起 api 与 web：
 *   - api：apps/api/src/index.ts（tsx 直跑 TS，上游 node 侧无编译产物）
 *   - web：apps/web 的 vite preview（127.0.0.1:${WEB_PORT}，/api 与 /rpc 同源反代到 api）
 * 任一子进程退出 → 整组退出，宿主据此判失败；SIGTERM/SIGINT → 整组优雅退出。
 *
 * 上游改动：无。端口/密钥全部来自 ensure-rakazo.mjs 生成的 env。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const apiDir = path.join(repoRoot, "apps", "api");
const webDir = path.join(repoRoot, "apps", "web");
const webPort = process.env.WEB_PORT || "8121";
const apiUrl = process.env.API_PROXY_TARGET || "http://127.0.0.1:3100";

function log(phase, detail) {
  process.stderr.write(`[rakazo-stack] ${JSON.stringify({ phase, ...detail })}\n`);
}

function resolveTsxCli() {
  const candidates = [
    path.join(apiDir, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  // pnpm 严格布局：只留了 .bin 符号链接，回溯真实包位置
  const bin = path.join(repoRoot, "node_modules", ".bin", "tsx");
  if (existsSync(bin)) {
    const real = path.resolve(path.dirname(bin), "..", "tsx", "dist", "cli.mjs");
    if (existsSync(real)) return real;
  }
  return null;
}

function resolveViteCli() {
  const candidates = [
    path.join(webDir, "node_modules", "vite", "bin", "vite.js"),
    path.join(repoRoot, "node_modules", "vite", "bin", "vite.js"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const tsxCli = resolveTsxCli();
const viteCli = resolveViteCli();
if (!tsxCli || !viteCli) {
  log("missing-cli", { tsxCli, viteCli });
  process.exit(1);
}

const children = [];

function start(name, args, cwd) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  children.push({ name, child });
  child.on("exit", (code, signal) => {
    log("child-exit", { name, code, signal });
    shutdown(code ?? 1);
  });
  child.on("error", (error) => {
    log("child-error", { name, message: String(error).slice(0, 300) });
    shutdown(1);
  });
  log("child-start", { name, pid: child.pid });
  return child;
}

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const { child } of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => {
    for (const { child } of children) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
    process.exit(code);
  }, 4000).unref();
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
process.on("exit", () => {
  for (const { child } of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
});

// api 先起（web 的同源反代需要它），再起 web。
start("api", [tsxCli, "src/index.ts"], apiDir);
start("web", [viteCli, "preview", "--host", "127.0.0.1", "--port", webPort, "--strictPort"], webDir);
log("stack-started", { apiUrl, webPort });
