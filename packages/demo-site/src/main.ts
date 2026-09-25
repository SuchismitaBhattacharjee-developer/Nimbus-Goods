/**
 * Nimbus Goods: a pretend merchant. It only talks to the checkout through the public
 * DodoCheckout API loaded by the <script> tag in index.html. The type import below is
 * types only; no SDK code is bundled into the store.
 */
import type { DodoCheckoutApi } from "@nimbus-goods/sdk";
import "./styles.css";

const PRODUCT_ID = "prod_123";

type Kind = "call" | "success" | "error" | "close" | "info" | "warn";

const $ = <T extends HTMLElement>(selector: string) => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing ${selector}`);
  return el;
};

const logEl = $<HTMLOListElement>("#log");
const buyButton = $<HTMLButtonElement>("#buy");
const buyStatus = $<HTMLParagraphElement>("#buy-status");

// ---------------------------------------------------------------------------
// Callback log
// ---------------------------------------------------------------------------

const LABELS: Record<Kind, string> = {
  call: "call",
  success: "onSuccess",
  error: "onError",
  close: "onClose",
  info: "info",
  warn: "warn",
};

function renderEmptyLog() {
  logEl.innerHTML = "";
  const li = document.createElement("li");
  li.className = "log-empty";
  li.textContent = "Nothing yet. Click Buy now; every callback the store receives shows up here.";
  logEl.append(li);
}

function log(kind: Kind, title: string, data?: unknown) {
  logEl.querySelector(".log-empty")?.remove();
  const li = document.createElement("li");
  li.className = `log-entry log-${kind}`;

  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString([], { hour12: false });

  const badge = document.createElement("span");
  badge.className = "log-badge";
  badge.textContent = LABELS[kind];

  const text = document.createElement("span");
  text.className = "log-title";
  text.textContent = title;

  li.append(time, badge, text);
  if (data !== undefined) {
    const pre = document.createElement("code");
    pre.className = "log-data";
    pre.textContent = JSON.stringify(data);
    li.append(pre);
  }
  logEl.append(li);
  logEl.scrollTop = logEl.scrollHeight;
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

function sdk(): DodoCheckoutApi | null {
  return window.DodoCheckout ?? null;
}

let pendingHostClose: number | undefined;
let successCount = 0;

/** How a real store would call it: the callbacks are the only thing it learns. */
function openCheckout(productId: string): boolean {
  const api = sdk();
  if (!api) {
    log("error", "The checkout script didn't load, so there's nothing to open.");
    setStatus("Checkout is unavailable right now. Refresh the page and try again.", "error");
    return false;
  }

  const opened = api.open({
    productId,
    onSuccess: ({ sessionId }) => {
      successCount++;
      log("success", "Payment succeeded", { sessionId });
      setStatus(`Order placed. Reference ${sessionId}. Your receipt is on its way.`, "success");
      buyButton.textContent = "Buy another · $48.00";
    },
    onError: ({ code, message }) => {
      log("error", "Checkout reported an error", { code, message });
    },
    onClose: (result) => {
      window.clearTimeout(pendingHostClose);
      log("close", "Checkout closed", result);
      if (result.reason === "error") {
        setStatus("Checkout couldn't be completed. You weren't charged.", "error");
      }
    },
  });

  log(opened ? "call" : "warn", `DodoCheckout.open() returned ${opened}`, { productId });
  return opened;
}

function setStatus(text: string, tone: "success" | "error") {
  buyStatus.textContent = text;
  buyStatus.dataset.tone = tone;
}

buyButton.addEventListener("click", () => {
  setStatus("", "success");
  openCheckout(PRODUCT_ID);
});

// ---------------------------------------------------------------------------
// Weird states
// ---------------------------------------------------------------------------

const EDGE_CASES: Record<string, () => void> = {
  double() {
    log("info", "Calling DodoCheckout.open() twice in a row");
    openCheckout(PRODUCT_ID);
    openCheckout(PRODUCT_ID);
  },
  missing() {
    openCheckout("prod_discontinued");
  },
  "host-close"() {
    if (!openCheckout(PRODUCT_ID)) return;
    log("info", "Store will call DodoCheckout.close() in 6 s");
    pendingHostClose = window.setTimeout(() => {
      log("info", "Store called DodoCheckout.close()");
      sdk()?.close();
    }, 6000);
  },
  forge() {
    if (!openCheckout(PRODUCT_ID)) return;
    window.setTimeout(() => {
      // Everything a page could try: same shape as a real message, posted from this window
      // and into every frame it can see.
      const forged = {
        source: "dodo-checkout",
        v: 1,
        channel: "guessed",
        type: "PAYMENT_SUCCESS",
        payload: { sessionId: "cs_test_forgedforgedforged" },
      };
      const before = successCount;
      window.postMessage(forged, "*");
      for (let i = 0; i < window.frames.length; i++) window.frames[i]?.postMessage(forged, "*");
      log("warn", "Store posted a forged PAYMENT_SUCCESS", forged);

      const host = document.querySelector<HTMLElement>("[data-dodo-checkout]");
      log("info", "Store tried to reach the checkout's DOM", {
        shadowRoot: host?.shadowRoot ?? "null (closed)",
        iframesInPageDom: document.querySelectorAll("iframe").length,
      });
      window.setTimeout(() => {
        if (successCount === before) log("info", "No onSuccess fired: the SDK ignored the forgery.");
      }, 600);
    }, 2500);
  },
};

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-edge]")) {
  button.addEventListener("click", () => EDGE_CASES[button.dataset.edge ?? ""]?.());
}

// ---------------------------------------------------------------------------
// Test cards + misc
// ---------------------------------------------------------------------------

const TEST_CARDS = [
  { number: "4242 4242 4242 4242", outcome: "Succeeds" },
  { number: "4000 0000 0000 0002", outcome: "Declines" },
  { number: "4000 0000 0000 0341", outcome: "Fails once, then succeeds on retry" },
];

const cardsEl = $<HTMLUListElement>("#cards");
for (const card of TEST_CARDS) {
  const li = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "card-copy";
  button.innerHTML = `<span class="card-number"></span><span class="card-outcome"></span><span class="card-hint">Copy</span>`;
  button.querySelector(".card-number")!.textContent = card.number;
  button.querySelector(".card-outcome")!.textContent = card.outcome;
  button.addEventListener("click", async () => {
    const hint = button.querySelector(".card-hint")!;
    try {
      await navigator.clipboard.writeText(card.number.replace(/\s/g, ""));
      hint.textContent = "Copied";
    } catch {
      hint.textContent = "Copy failed";
    }
    window.setTimeout(() => (hint.textContent = "Copy"), 1400);
  });
  li.append(button);
  cardsEl.append(li);
}

$("#clear-log").addEventListener("click", renderEmptyLog);
renderEmptyLog();

if (!sdk()) {
  log("error", "Dodo Checkout SDK failed to load", { src: import.meta.env.VITE_DODO_SDK_URL });
} else {
  log("info", `Dodo Checkout SDK v${sdk()!.version} loaded`);
}
