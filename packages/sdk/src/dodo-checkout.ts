/**
 * Dodo Checkout SDK
 *
 *   <script src="https://<checkout-host>/sdk/dodo-checkout.js"></script>
 *   DodoCheckout.open({ productId, onSuccess, onError, onClose });
 *
 * Guarantees to the host page:
 *  - At most one checkout is open at a time. `open()` returns false if one already is.
 *  - `onSuccess` fires at most once. `onError` never fires after it.
 *  - `onClose` fires exactly once per successful `open()`, and always last.
 *    By the time it runs, everything is cleaned up, so it's safe to call `open()` again from it.
 *  - Card details and the customer's email never reach this page. The checkout runs in a
 *    sandboxed iframe with an opaque origin, so this page can't read its DOM even when both
 *    are served from the same domain.
 */
import {
  CHANNEL_PATTERN,
  PRODUCT_ID_PATTERN,
  encodeLaunchParams,
  parseEnvelope,
  type CheckoutErrorCode,
  type CloseReason,
} from "./protocol.ts";

export type { CheckoutErrorCode, CloseReason } from "./protocol.ts";

export interface CheckoutSuccess {
  readonly sessionId: string;
}
export interface CheckoutError {
  readonly code: CheckoutErrorCode;
  readonly message: string;
}
export interface CheckoutClose {
  readonly reason: CloseReason;
}

export interface CheckoutOptions {
  /** The product to sell. Price, name and merchant come from Dodo's catalog, never from the page. */
  productId: string;
  /** The customer paid. Confirm the order server-side with `sessionId`. */
  onSuccess: (result: CheckoutSuccess) => void;
  /** Something went wrong. Payment errors are recoverable (the customer can retry); see `code`. */
  onError?: (error: CheckoutError) => void;
  /** The checkout is gone. Always the last callback. */
  onClose?: (result: CheckoutClose) => void;
}

export interface DodoCheckoutApi {
  /** Opens the checkout. Returns false (and does nothing) if a checkout is already open. */
  open(options: CheckoutOptions): boolean;
  /** Closes the open checkout, if any. `onClose` receives `reason: "host"` unless the customer already paid. */
  close(): void;
  readonly version: string;
}

const VERSION = "1.0.0";
/** Hard cap on waiting for the checkout to say it's ready. */
const READY_TIMEOUT_MS = 15_000;
/** Once the iframe document has loaded, the app should be ready almost immediately. */
const AFTER_LOAD_GRACE_MS = 5_000;
const FADE_MS = 160;

// The checkout lives next to this script: <base>/sdk/dodo-checkout.js -> <base>/checkout/.
// Where you load the SDK from *is* the configuration; there is nothing else to set.
const scriptSrc =
  typeof document !== "undefined" ? (document.currentScript as HTMLScriptElement | null)?.src : undefined;

function resolveCheckoutUrl(): URL {
  if (!scriptSrc) {
    throw new Error("[DodoCheckout] Load the SDK with a <script src> tag so it can locate the hosted checkout.");
  }
  return new URL("../checkout/", scriptSrc);
}

type Phase = "loading" | "ready" | "load_failed";

interface Session {
  readonly options: CheckoutOptions;
  readonly channel: string;
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  iframe: HTMLIFrameElement | null;
  phase: Phase;
  sessionId: string | null;
  paid: boolean;
  unusable: boolean;
  timers: number[];
  cleanups: Array<() => void>;
}

let active: Session | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function open(options: CheckoutOptions): boolean {
  assertValidOptions(options);

  if (active) {
    // The host may have wiped our node (e.g. an SPA re-rendering <body>). Don't stay stuck.
    if (!active.host.isConnected) {
      finish(active, "host");
    } else {
      console.warn("[DodoCheckout] A checkout is already open; ignoring this open() call.");
      return false;
    }
  }

  const hostOrigin = window.location.origin;
  if (hostOrigin === "null") {
    throw new Error("[DodoCheckout] The checkout must be opened from an http(s) page.");
  }
  const checkoutUrl = resolveCheckoutUrl();

  // Copy the options so later mutation by the caller can't change an open session.
  const opts: CheckoutOptions = {
    productId: options.productId,
    onSuccess: options.onSuccess,
    ...(options.onError ? { onError: options.onError } : {}),
    ...(options.onClose ? { onClose: options.onClose } : {}),
  };

  const host = document.createElement("div");
  host.setAttribute("data-dodo-checkout", "");
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = OVERLAY_HTML;

  const session: Session = {
    options: opts,
    channel: randomToken(32),
    host,
    root,
    iframe: null,
    phase: "loading",
    sessionId: null,
    paid: false,
    unusable: false,
    timers: [],
    cleanups: [],
  };
  active = session;

  document.body.appendChild(host);
  session.cleanups.push(lockPage(host));

  const onMessage = (event: MessageEvent) => handleMessage(session, event);
  window.addEventListener("message", onMessage);
  session.cleanups.push(() => window.removeEventListener("message", onMessage));

  // Until the checkout takes over, Escape/backdrop/buttons belong to our overlay.
  const onKeydown = (event: KeyboardEvent) => {
    if (session.phase === "ready") return;
    if (event.key === "Escape") {
      event.preventDefault();
      finish(session, "dismissed");
    } else if (event.key === "Tab") {
      trapTab(session, event);
    }
  };
  document.addEventListener("keydown", onKeydown, true);
  session.cleanups.push(() => document.removeEventListener("keydown", onKeydown, true));

  q(root, ".backdrop").addEventListener("click", () => {
    if (session.phase !== "ready") finish(session, "dismissed");
  });
  q(root, "[data-action=retry]").addEventListener("click", () => loadFrame(session, checkoutUrl, hostOrigin));
  q(root, "[data-action=close]").addEventListener("click", () => finish(session, "dismissed"));

  loadFrame(session, checkoutUrl, hostOrigin);
  return true;
}

function close(): void {
  if (active) finish(active, "host");
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function loadFrame(s: Session, checkoutUrl: URL, hostOrigin: string): void {
  clearTimers(s);
  s.iframe?.remove();
  s.phase = "loading";
  s.unusable = false;
  showStatus(s, "loading");

  if (!navigator.onLine) {
    failLoad(s, "You appear to be offline. Check your connection and try again.");
    return;
  }

  const iframe = document.createElement("iframe");
  iframe.title = "Secure checkout";
  // No allow-same-origin: the checkout gets an opaque origin, so this page can never reach into it,
  // even when both are served from one domain. No top-navigation, popups or modals either.
  iframe.setAttribute("sandbox", "allow-scripts allow-forms");
  iframe.referrerPolicy = "strict-origin";
  iframe.src = `${checkoutUrl.href}#${encodeLaunchParams({ productId: s.options.productId, channel: s.channel, hostOrigin })}`;
  iframe.addEventListener("load", () => {
    if (s.phase === "loading" && s.iframe === iframe) {
      s.timers.push(window.setTimeout(() => failLoad(s), AFTER_LOAD_GRACE_MS));
    }
  });
  s.iframe = iframe;
  s.timers.push(window.setTimeout(() => failLoad(s), READY_TIMEOUT_MS));
  q(s.root, ".frame-slot").appendChild(iframe);
}

function failLoad(s: Session, detail?: string): void {
  if (active !== s || s.phase !== "loading") return;
  clearTimers(s);
  s.phase = "load_failed";
  s.unusable = true;
  s.iframe?.remove();
  s.iframe = null;
  showStatus(s, "failed", detail);
  emit(s.options.onError, { code: "checkout_load_failed", message: "The checkout couldn't be loaded." });
}

function handleMessage(s: Session, event: MessageEvent): void {
  if (active !== s || !s.iframe) return;
  // Only our own iframe's window, and only while it's sandboxed (opaque origin serializes to "null").
  if (event.source !== s.iframe.contentWindow || event.origin !== "null") return;
  const msg = parseEnvelope(event.data, s.channel);
  if (!msg) return;

  if (msg.type === "CHECKOUT_READY") {
    if (s.phase !== "loading") return; // duplicate READY
    clearTimers(s);
    s.phase = "ready";
    s.sessionId = msg.payload.sessionId;
    s.iframe.classList.add("ready");
    showStatus(s, "hidden");
    s.iframe.focus();
    return;
  }
  if (s.phase !== "ready") return;

  switch (msg.type) {
    case "PAYMENT_SUCCESS":
      if (s.paid || msg.payload.sessionId !== s.sessionId) return;
      s.paid = true;
      emit(s.options.onSuccess, { sessionId: msg.payload.sessionId });
      return;
    case "PAYMENT_ERROR":
      if (s.paid) return;
      emit(s.options.onError, { code: msg.payload.code, message: msg.payload.message });
      return;
    case "CHECKOUT_ERROR":
      if (s.paid) return;
      s.unusable = true;
      emit(s.options.onError, { code: msg.payload.code, message: msg.payload.message });
      return;
    case "CHECKOUT_CLOSE":
      finish(s, "dismissed");
      return;
  }
}

/** Tears everything down, then reports the truth: paid beats everything, then "unusable". */
function finish(s: Session, requested: "dismissed" | "host"): void {
  if (active !== s) return;
  active = null;
  clearTimers(s);
  for (const cleanup of s.cleanups.splice(0).reverse()) cleanup();

  // Fade the dimmed backdrop out; the node is inert from here on.
  s.host.style.pointerEvents = "none";
  q(s.root, ".overlay").classList.add("closing");
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  window.setTimeout(() => s.host.remove(), reduceMotion ? 0 : FADE_MS);

  const reason: CloseReason = s.paid ? "completed" : s.unusable ? "error" : requested;
  emit(s.options.onClose, { reason });
}

// ---------------------------------------------------------------------------
// Page effects: scroll lock, inert background, focus restore
// ---------------------------------------------------------------------------

function lockPage(host: HTMLElement): () => void {
  const html = document.documentElement;
  const body = document.body;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const prevOverflow = html.style.overflow;
  const prevPadding = body.style.paddingRight;
  const scrollbar = window.innerWidth - html.clientWidth;

  html.style.overflow = "hidden";
  if (scrollbar > 0) {
    body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + scrollbar}px`;
  }

  // Keep keyboard and screen-reader users inside the checkout. Only touch what we changed.
  const madeInert: HTMLElement[] = [];
  for (const el of Array.from(body.children)) {
    if (el === host || !(el instanceof HTMLElement) || el.inert) continue;
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "LINK") continue;
    el.inert = true;
    madeInert.push(el);
  }

  return () => {
    html.style.overflow = prevOverflow;
    body.style.paddingRight = prevPadding;
    for (const el of madeInert) el.inert = false;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
}

function trapTab(s: Session, event: KeyboardEvent): void {
  const buttons = Array.from(s.root.querySelectorAll<HTMLButtonElement>(".status:not([hidden]) button"));
  if (buttons.length === 0) {
    event.preventDefault();
    return;
  }
  const current = buttons.indexOf(s.root.activeElement as HTMLButtonElement);
  const next = event.shiftKey ? current - 1 : current + 1;
  event.preventDefault();
  buttons[(next + buttons.length) % buttons.length]?.focus();
}

// ---------------------------------------------------------------------------
// Overlay (lives in a closed shadow root so host CSS can't touch it)
// ---------------------------------------------------------------------------

function showStatus(s: Session, state: "loading" | "failed" | "hidden", detail?: string): void {
  const loading = q(s.root, "[data-status=loading]");
  const failed = q(s.root, "[data-status=failed]");
  loading.hidden = state !== "loading";
  failed.hidden = state !== "failed";
  if (state === "failed") {
    q(s.root, "[data-detail]").textContent =
      detail ?? "Check your connection and try again. You haven't been charged.";
    q<HTMLButtonElement>(s.root, "[data-action=retry]").focus();
  }
}

const OVERLAY_HTML = `
<style>
  :host { all: initial; }
  .overlay { position: fixed; inset: 0; font: 400 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0f1115; -webkit-font-smoothing: antialiased; }
  .backdrop { position: absolute; inset: 0; background: rgba(12, 14, 20, 0.52); animation: fade-in 160ms ease-out both; }
  .overlay.closing .backdrop { animation: fade-out 160ms ease-in both; }
  .status { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(340px, calc(100vw - 32px)); box-sizing: border-box; background: #fff; border-radius: 14px; box-shadow: 0 24px 60px -12px rgba(0,0,0,.35), 0 0 0 1px rgba(0,0,0,.04); padding: 22px; text-align: center; animation: pop-in 180ms cubic-bezier(.2,.9,.3,1) both; }
  .status[hidden] { display: none; }
  .status[data-status=loading] { width: auto; padding: 14px 18px; display: flex; align-items: center; gap: 10px; color: #4a4f5c; }
  .status[data-status=loading][hidden] { display: none; }
  .spinner { width: 16px; height: 16px; border-radius: 50%; border: 2px solid #d9dce3; border-top-color: #0f1115; animation: spin 700ms linear infinite; }
  h2 { margin: 0 0 6px; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
  p { margin: 0 0 18px; color: #5b606d; }
  .actions { display: flex; gap: 8px; }
  button { flex: 1; font: inherit; font-weight: 550; border-radius: 9px; padding: 10px 12px; cursor: pointer; border: 1px solid #d9dce3; background: #fff; color: #0f1115; }
  button.primary { background: #0f1115; border-color: #0f1115; color: #fff; }
  button:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
  iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: transparent; color-scheme: normal; opacity: 0; pointer-events: none; }
  iframe.ready { opacity: 1; pointer-events: auto; }
  .overlay.closing iframe, .overlay.closing .status { opacity: 0; transition: opacity 120ms ease-in; }
  @keyframes fade-in { from { opacity: 0; } }
  @keyframes fade-out { to { opacity: 0; } }
  @keyframes pop-in { from { opacity: 0; transform: translate(-50%, calc(-50% + 6px)); } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { * { animation-duration: 1ms !important; } .spinner { animation-duration: 1.5s !important; } }
</style>
<div class="overlay">
  <div class="backdrop"></div>
  <div class="status" data-status="loading" role="status" aria-live="polite">
    <span class="spinner" aria-hidden="true"></span><span>Opening secure checkout…</span>
  </div>
  <div class="status" data-status="failed" role="alertdialog" aria-modal="true" aria-labelledby="dodo-failed-title" aria-describedby="dodo-failed-detail" hidden>
    <h2 id="dodo-failed-title">Checkout didn't load</h2>
    <p id="dodo-failed-detail" data-detail></p>
    <div class="actions">
      <button type="button" data-action="close">Close</button>
      <button type="button" class="primary" data-action="retry">Try again</button>
    </div>
  </div>
  <div class="frame-slot"></div>
</div>`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertValidOptions(options: CheckoutOptions): void {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("[DodoCheckout] open() expects an options object.");
  }
  if (typeof options.productId !== "string" || !PRODUCT_ID_PATTERN.test(options.productId)) {
    throw new TypeError(`[DodoCheckout] "productId" must look like "prod_123"; got ${JSON.stringify(options.productId)}.`);
  }
  if (typeof options.onSuccess !== "function") {
    throw new TypeError('[DodoCheckout] "onSuccess" is required: it is how you learn the customer paid.');
  }
  for (const key of ["onError", "onClose"] as const) {
    if (options[key] !== undefined && typeof options[key] !== "function") {
      throw new TypeError(`[DodoCheckout] "${key}" must be a function if provided.`);
    }
  }
}

/** Calls a host callback without letting a throwing callback break our state machine. */
function emit<T extends object>(fn: ((arg: T) => void) | undefined, arg: T): void {
  if (!fn) return;
  try {
    fn(Object.freeze(arg));
  } catch (err) {
    window.setTimeout(() => {
      throw err;
    });
  }
}

function clearTimers(s: Session): void {
  for (const t of s.timers.splice(0)) window.clearTimeout(t);
}

function q<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`[DodoCheckout] internal: missing ${selector}`);
  return el;
}

function randomToken(length: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  if (!CHANNEL_PATTERN.test(out)) throw new Error("[DodoCheckout] internal: bad channel");
  return out;
}

// ---------------------------------------------------------------------------
// Global
// ---------------------------------------------------------------------------

export const DodoCheckout: DodoCheckoutApi = Object.freeze({ open, close, version: VERSION });

declare global {
  interface Window {
    DodoCheckout?: DodoCheckoutApi;
  }
}

if (typeof window !== "undefined") {
  if (window.DodoCheckout) {
    // Included twice: keep the first copy so there is still exactly one checkout state.
    console.warn("[DodoCheckout] SDK loaded more than once; using the first copy.");
  } else {
    window.DodoCheckout = DodoCheckout;
  }
}
