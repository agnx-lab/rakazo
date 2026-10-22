var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// .agnx/src/index.ts
var index_exports = {};
__export(index_exports, {
  RAKAZO_APP_ID: () => RAKAZO_APP_ID,
  RAKAZO_OPEN_COMMAND_ID: () => RAKAZO_OPEN_COMMAND_ID,
  RAKAZO_PANEL_ID: () => RAKAZO_PANEL_ID,
  RakazoPanel: () => RakazoPanel,
  activate: () => activate,
  appId: () => appId,
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);

// .agnx/src/constants.ts
var RAKAZO_APP_ID = "rakazo";
var RAKAZO_PANEL_ID = "rakazo.main";
var RAKAZO_OPEN_COMMAND_ID = "rakazo.open";
var RAKAZO_ENSURE_TOOL_REL = ".agnx/tools/ensure-rakazo.mjs";
var DEFAULT_RAKAZO_PORT = 8121;
var RAKAZO_ENSURE_TIMEOUT_MS = 6e5;
var RAKAZO_SURFACE_READY_TIMEOUT_MS = 18e4;

// .agnx/src/host-bind.ts
var boundHost = null;
function bindRakazoHost(host) {
  boundHost = host;
}
function requireRakazoHost() {
  if (!boundHost) {
    throw new Error("Rakazo Host \u5C1A\u672A\u7ED1\u5B9A");
  }
  return boundHost;
}

// .agnx/src/panel.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var WEB_ROOT_STYLE = {
  flex: "1 1 0%",
  alignSelf: "stretch",
  minHeight: 0,
  minWidth: 0,
  width: "100%",
  height: "100%",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  position: "relative",
  backgroundColor: "transparent"
};
var GUEST_HOST_STYLE = {
  flex: "1 1 auto",
  minHeight: 0,
  minWidth: 0,
  width: "100%",
  height: "100%",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  position: "relative"
};
var BOOT_LAYER_STYLE = {
  position: "absolute",
  inset: 0,
  zIndex: 2,
  display: "flex",
  flexDirection: "column",
  background: "rgb(9, 9, 11)"
};
var ERROR_LAYER_STYLE = {
  position: "absolute",
  inset: 0,
  zIndex: 3,
  display: "flex",
  flexDirection: "column",
  background: "rgba(9, 9, 11, 0.88)"
};
var MESSAGE_FALLBACK_STYLE = {
  alignItems: "center",
  justifyContent: "center",
  color: "#a1a1aa",
  padding: 24,
  textAlign: "center",
  whiteSpace: "pre-wrap"
};
var RETAIN_REASON = "rakazo-open";
function getHost() {
  return requireRakazoHost();
}
function canUseGuestSurface() {
  return typeof document !== "undefined" && getHost().platform.isWeb;
}
function RakazoPanel(_props) {
  const guestHostRef = (0, import_react.useRef)(null);
  const [booting, setBooting] = (0, import_react.useState)(true);
  const [error, setError] = (0, import_react.useState)(null);
  (0, import_react.useEffect)(() => {
    const host = getHost();
    host.background?.requestRetain?.({ appId: RAKAZO_APP_ID, active: true, reason: RETAIN_REASON });
    return () => {
      host.background?.requestRetain?.({
        appId: RAKAZO_APP_ID,
        active: false,
        reason: RETAIN_REASON
      });
    };
  }, []);
  (0, import_react.useEffect)(() => {
    if (!canUseGuestSurface()) {
      setBooting(false);
      setError("\u5F53\u524D\u5E73\u53F0\u6682\u4E0D\u652F\u6301\u5D4C\u5165 Rakazo\uFF0C\u8BF7\u4F7F\u7528 Agnx \u684C\u9762\u7AEF\u3002");
      return;
    }
    let cancelled = false;
    let unmountGuest = null;
    let readyTimer = null;
    const mountGuest = () => {
      const host = getHost();
      if (!guestHostRef.current) {
        return;
      }
      if (!host.guest?.mount) {
        setBooting(false);
        setError("\u5BBF\u4E3B\u672A\u63D0\u4F9B host.guest\uFF08\u9700\u5347\u7EA7 Agnx \u5E76\u91CD\u65B0\u626B\u63CF\u5B50\u5E94\u7528\uFF09");
        return;
      }
      unmountGuest?.();
      unmountGuest = null;
      setBooting(true);
      setError(null);
      try {
        unmountGuest = host.guest.mount({
          container: guestHostRef.current,
          ensureTool: RAKAZO_ENSURE_TOOL_REL,
          ensureArgs: ["--port", String(DEFAULT_RAKAZO_PORT)],
          timeoutMs: RAKAZO_ENSURE_TIMEOUT_MS,
          surfaceReadyTimeoutMs: RAKAZO_SURFACE_READY_TIMEOUT_MS,
          bootOverlay: false,
          onReady: () => {
            if (cancelled) {
              return;
            }
            setError(null);
            readyTimer = window.setTimeout(() => {
              if (!cancelled) {
                setBooting(false);
              }
            }, 900);
          },
          onError: (detail) => {
            if (!cancelled) {
              setBooting(false);
              setError(`${detail.code}: ${detail.message}`);
            }
          }
        });
      } catch (err) {
        setBooting(false);
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    mountGuest();
    return () => {
      cancelled = true;
      if (readyTimer !== null) {
        window.clearTimeout(readyTimer);
      }
      unmountGuest?.();
    };
  }, []);
  if (!canUseGuestSurface()) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...ERROR_LAYER_STYLE, ...MESSAGE_FALLBACK_STYLE }, role: "alert", children: error ?? "\u52A0\u8F7D\u4E2D\u2026" });
  }
  const BrandPanel = getHost().ui?.BrandLogoLoaderPanel;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: WEB_ROOT_STYLE, "data-testid": "workspace-mini-app-rakazo-root", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { ref: guestHostRef, "data-agnx-guest-surface-host": "true", style: GUEST_HOST_STYLE }),
    booting && !error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { "data-agnx-guest-boot-overlay": "true", style: BOOT_LAYER_STYLE, role: "status", children: BrandPanel ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      BrandPanel,
      {
        title: "\u6B63\u5728\u542F\u52A8 Rakazo\u2026",
        description: "\u6B63\u5728\u51C6\u5907 AI \u6570\u5B57\u5458\u5DE5\u56E2\u961F\uFF08\u9996\u6B21\u542F\u52A8\u9700\u9884\u6784\u5EFA\uFF0C\u53EF\u80FD\u8981\u51E0\u5206\u949F\uFF09",
        testID: "rakazo-boot-overlay"
      }
    ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...BOOT_LAYER_STYLE, ...MESSAGE_FALLBACK_STYLE }, children: "\u6B63\u5728\u542F\u52A8 Rakazo\u2026" }) }) : null,
    error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...ERROR_LAYER_STYLE, ...MESSAGE_FALLBACK_STYLE }, role: "alert", children: error }) : null
  ] });
}

// .agnx/src/index.ts
var appId = RAKAZO_APP_ID;
function openRakazoTab(host, context) {
  host.openSubAppTab({
    appId: RAKAZO_APP_ID,
    panelId: RAKAZO_PANEL_ID,
    serverId: context?.serverId,
    workspaceId: context?.workspaceId,
    currentPathname: context?.currentPathname
  });
}
function activate(host) {
  bindRakazoHost(host);
  const disposers = [];
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
        note: "Tab iframe \u52A0\u8F7D\u4E0A\u6E38 Vite \u9884\u89C8\uFF08127.0.0.1:8121\uFF09\uFF0C/api \u4E0E /rpc \u540C\u6E90\u53CD\u4EE3\u5230\u4E0A\u6E38 api"
      }
    })
  );
  disposers.push(
    host.registerCommand({
      id: RAKAZO_OPEN_COMMAND_ID,
      appId: RAKAZO_APP_ID,
      title: "Rakazo",
      keywords: ["rakazo", "ai teammate", "ai \u5458\u5DE5", "grok bot", "agent", "\u6570\u5B57\u5458\u5DE5", "team"],
      sidebarAction: { defaultVisible: true, label: "Rakazo", order: 60 },
      run: (context) => {
        openRakazoTab(host, context);
      }
    })
  );
  return () => {
    for (const d of disposers.toReversed()) d();
  };
}
var moduleExport = { appId: RAKAZO_APP_ID, activate };
var index_default = moduleExport;
