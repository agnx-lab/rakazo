// 场景：Rakazo 子应用面板 — host.guest.mount 把上游 web(Vite 预览) 主界面嵌进 Tab。
// 首帧即品牌遮罩（消灭空 host 黑屏）；mount 时 bootOverlay:false，由面板独自持有遮罩。
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type ReactElement,
} from "react";
import type {
  WorkspaceAppBrandLogoLoaderPanelProps,
  WorkspaceAppHostApi,
} from "@agnx-lab/app-sdk";
import {
  DEFAULT_RAKAZO_PORT,
  RAKAZO_APP_ID,
  RAKAZO_ENSURE_TOOL_REL,
  RAKAZO_ENSURE_TIMEOUT_MS,
  RAKAZO_SURFACE_READY_TIMEOUT_MS,
} from "./constants";
import { requireRakazoHost } from "./host-bind";

// 满铺：根 + guest host 都不许有 padding / margin（assert-guest-panel-edge-to-edge 门闩）。
const WEB_ROOT_STYLE: CSSProperties = {
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
  backgroundColor: "transparent",
};

const GUEST_HOST_STYLE: CSSProperties = {
  flex: "1 1 auto",
  minHeight: 0,
  minWidth: 0,
  width: "100%",
  height: "100%",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  position: "relative",
};

const BOOT_LAYER_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 2,
  display: "flex",
  flexDirection: "column",
  background: "rgb(9, 9, 11)",
};

const ERROR_LAYER_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 3,
  display: "flex",
  flexDirection: "column",
  background: "rgba(9, 9, 11, 0.88)",
};

const MESSAGE_FALLBACK_STYLE: CSSProperties = {
  alignItems: "center",
  justifyContent: "center",
  color: "#a1a1aa",
  padding: 24,
  textAlign: "center",
  whiteSpace: "pre-wrap",
};

const RETAIN_REASON = "rakazo-open";

function getHost(): WorkspaceAppHostApi {
  return requireRakazoHost();
}

function canUseGuestSurface(): boolean {
  return typeof document !== "undefined" && getHost().platform.isWeb;
}

export function RakazoPanel(_props: {
  appId: string;
  panelId: string;
  entityId: string;
}): ReactElement {
  const guestHostRef = useRef<HTMLDivElement | null>(null);
  /** 首帧即 true：在 await mount 之前盖住空 host，避免黑屏。 */
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = getHost();
    host.background?.requestRetain?.({ appId: RAKAZO_APP_ID, active: true, reason: RETAIN_REASON });
    return () => {
      host.background?.requestRetain?.({
        appId: RAKAZO_APP_ID,
        active: false,
        reason: RETAIN_REASON,
      });
    };
  }, []);

  useEffect(() => {
    if (!canUseGuestSurface()) {
      setBooting(false);
      setError("当前平台暂不支持嵌入 Rakazo，请使用 Agnx 桌面端。");
      return;
    }

    let cancelled = false;
    let unmountGuest: (() => void) | null = null;
    let readyTimer: number | null = null;

    const mountGuest = () => {
      const host = getHost();
      if (!guestHostRef.current) {
        return;
      }
      if (!host.guest?.mount) {
        setBooting(false);
        setError("宿主未提供 host.guest（需升级 Agnx 并重新扫描子应用）");
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
            // 稍留几帧给上游首屏（React 挂载 + better-auth 会话探测 + 路由重定向），再撤面板遮罩。
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
          },
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
    return (
      <div style={{ ...ERROR_LAYER_STYLE, ...MESSAGE_FALLBACK_STYLE }} role="alert">
        {error ?? "加载中…"}
      </div>
    );
  }

  const BrandPanel = getHost().ui?.BrandLogoLoaderPanel as
    | ComponentType<WorkspaceAppBrandLogoLoaderPanelProps>
    | undefined;

  return (
    <div style={WEB_ROOT_STYLE} data-testid="workspace-mini-app-rakazo-root">
      <div ref={guestHostRef} data-agnx-guest-surface-host="true" style={GUEST_HOST_STYLE} />
      {booting && !error ? (
        <div data-agnx-guest-boot-overlay="true" style={BOOT_LAYER_STYLE} role="status">
          {BrandPanel ? (
            <BrandPanel
              title="正在启动 Rakazo…"
              description="正在准备 AI 数字员工团队（首次启动需预构建，可能要几分钟）"
              testID="rakazo-boot-overlay"
            />
          ) : (
            <div style={{ ...BOOT_LAYER_STYLE, ...MESSAGE_FALLBACK_STYLE }}>正在启动 Rakazo…</div>
          )}
        </div>
      ) : null}
      {error ? (
        <div style={{ ...ERROR_LAYER_STYLE, ...MESSAGE_FALLBACK_STYLE }} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
