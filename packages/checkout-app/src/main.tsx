import { StrictMode, Component, useCallback, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { decodeLaunchParams, type LaunchParams } from "@nimbus-goods/sdk/protocol";
import { createBridge, type Bridge } from "./lib/bridge.ts";
import { Checkout } from "./ui/Checkout.tsx";
import { Shell, useCloser } from "./ui/Shell.tsx";
import { FatalState, NotEmbedded } from "./ui/states.tsx";
import "./styles.css";

/**
 * The checkout only runs when the page around it can't reach in. Inside the SDK's sandboxed
 * iframe (or on a different origin) touching parent.document throws. If it doesn't, the host
 * could read these inputs, so we refuse to render them at all.
 */
function checkEmbedding(launch: LaunchParams | null): "ok" | "standalone" | "insecure" {
  if (window.parent === window || !launch) return "standalone";
  try {
    void window.parent.document;
    return "insecure";
  } catch {
    // expected: cross-origin or sandboxed
  }
  // Where supported, the browser tells us who actually embedded us. Refuse if it disagrees.
  const ancestor = window.location.ancestorOrigins?.[0];
  if (ancestor && ancestor !== launch.hostOrigin) return "insecure";
  return "ok";
}

class ErrorBoundary extends Component<{ bridge: Bridge; children: ReactNode }, { crashed: boolean }> {
  override state = { crashed: false };
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  override componentDidCatch(_error: unknown, _info: ErrorInfo) {
    // Report the fact, never the details: error text could contain form state.
    this.props.bridge.send({
      type: "CHECKOUT_ERROR",
      payload: { code: "unexpected_error", message: "Something went wrong in the checkout. Nothing was charged." },
    });
  }
  override render() {
    return this.state.crashed ? <CrashFallback bridge={this.props.bridge} /> : this.props.children;
  }
}

function CrashFallback({ bridge }: { bridge: Bridge }) {
  const onClosed = useCallback(() => bridge.send({ type: "CHECKOUT_CLOSE", payload: {} }), [bridge]);
  const { closing, close } = useCloser(onClosed);
  return (
    <Shell label="Checkout error" closing={closing} canClose dismissOnBackdrop onClose={close}>
      <FatalState code="unexpected_error" onClose={close} />
    </Shell>
  );
}

const launch = decodeLaunchParams(window.location.hash);
const embedding = checkEmbedding(launch);
document.documentElement.dataset.mode = embedding === "ok" ? "embedded" : "standalone";

const root = createRoot(document.getElementById("root")!);
if (embedding === "ok" && launch) {
  const bridge = createBridge(launch);
  root.render(
    <StrictMode>
      <ErrorBoundary bridge={bridge}>
        <Checkout launch={launch} bridge={bridge} />
      </ErrorBoundary>
    </StrictMode>,
  );
} else {
  root.render(<NotEmbedded reason={embedding === "insecure" ? "insecure" : "standalone"} />);
}
