/**
 * The wire contract between the checkout iframe and the SDK.
 *
 * Messages only ever flow one way: checkout -> SDK. The SDK hands the
 * checkout everything it needs up front (in the iframe URL fragment), so
 * there is nothing the host page can push into a running checkout.
 *
 * Nothing in here may ever carry card data or the customer's email.
 */

export const PROTOCOL_SOURCE = "dodo-checkout";
export const PROTOCOL_VERSION = 1;

/** Error codes the host can receive through `onError`. */
export type CheckoutErrorCode =
  /** The issuer declined the card. Checkout stays open so the customer can try another card. */
  | "card_declined"
  /** The payment couldn't be completed (e.g. the bank didn't respond). Nothing was charged; the customer can retry. */
  | "processing_error"
  /** The productId doesn't exist or can't be sold. The checkout can't be used. */
  | "product_unavailable"
  /** The checkout never became ready (network, blocked, or down). */
  | "checkout_load_failed"
  /** Something broke inside the checkout. Nothing was charged. */
  | "unexpected_error";

/** Why the checkout closed. `onClose` fires exactly once per `open()`, always last. */
export type CloseReason =
  /** The customer paid. (Fires even if the host closed it from inside `onSuccess`.) */
  | "completed"
  /** The customer closed it without paying. */
  | "dismissed"
  /** The checkout couldn't be used: failed to load, unknown product, or crashed. */
  | "error"
  /** The host page called `DodoCheckout.close()` before the customer paid. */
  | "host";

export type CheckoutMessage =
  | { type: "CHECKOUT_READY"; payload: { sessionId: string } }
  | { type: "PAYMENT_SUCCESS"; payload: { sessionId: string } }
  /** A payment attempt failed but the customer can keep going. */
  | { type: "PAYMENT_ERROR"; payload: { code: "card_declined" | "processing_error"; message: string } }
  /** The checkout can't continue. The customer only sees a way out. */
  | { type: "CHECKOUT_ERROR"; payload: { code: "product_unavailable" | "unexpected_error"; message: string } }
  /** The customer asked to close (close button, Escape, backdrop, or "Done"). */
  | { type: "CHECKOUT_CLOSE"; payload: Record<string, never> };

export type CheckoutMessageType = CheckoutMessage["type"];

export interface Envelope<M extends CheckoutMessage = CheckoutMessage> {
  source: typeof PROTOCOL_SOURCE;
  v: typeof PROTOCOL_VERSION;
  /** Random per-open() nonce. Lets the SDK drop anything not addressed to the current checkout. */
  channel: string;
  type: M["type"];
  payload: M["payload"];
}

/** What the SDK passes to the checkout, in the iframe URL fragment (never sent to a server). */
export interface LaunchParams {
  productId: string;
  channel: string;
  /** The host page's origin; the checkout only ever posts to exactly this origin. */
  hostOrigin: string;
}

export const PRODUCT_ID_PATTERN = /^prod_[A-Za-z0-9_]{1,64}$/;
export const CHANNEL_PATTERN = /^[A-Za-z0-9]{24,64}$/;
export const SESSION_ID_PATTERN = /^cs_test_[A-Za-z0-9]{8,64}$/;

export function encodeLaunchParams(p: LaunchParams): string {
  return new URLSearchParams({ product: p.productId, channel: p.channel, origin: p.hostOrigin }).toString();
}

export function decodeLaunchParams(fragment: string): LaunchParams | null {
  const q = new URLSearchParams(fragment.replace(/^#/, ""));
  const productId = q.get("product") ?? "";
  const channel = q.get("channel") ?? "";
  const hostOrigin = q.get("origin") ?? "";
  if (!PRODUCT_ID_PATTERN.test(productId) || !CHANNEL_PATTERN.test(channel)) return null;
  let parsed: URL;
  try {
    parsed = new URL(hostOrigin);
  } catch {
    return null;
  }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.origin !== hostOrigin) return null;
  return { productId, channel, hostOrigin };
}

const MAX_MESSAGE_LENGTH = 200;

function isShortString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_MESSAGE_LENGTH;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Strictly validates an incoming message. Returns null for anything that
 * isn't exactly a well-formed message for `channel`. Unknown fields in the
 * payload are dropped rather than passed through.
 */
export function parseEnvelope(data: unknown, channel: string): CheckoutMessage | null {
  if (!isPlainObject(data)) return null;
  if (data.source !== PROTOCOL_SOURCE || data.v !== PROTOCOL_VERSION || data.channel !== channel) return null;
  const payload = data.payload;
  if (!isPlainObject(payload)) return null;

  switch (data.type) {
    case "CHECKOUT_READY":
    case "PAYMENT_SUCCESS": {
      const { sessionId } = payload;
      if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) return null;
      return { type: data.type, payload: { sessionId } };
    }
    case "PAYMENT_ERROR": {
      const { code, message } = payload;
      if ((code !== "card_declined" && code !== "processing_error") || !isShortString(message)) return null;
      return { type: "PAYMENT_ERROR", payload: { code, message } };
    }
    case "CHECKOUT_ERROR": {
      const { code, message } = payload;
      if ((code !== "product_unavailable" && code !== "unexpected_error") || !isShortString(message)) return null;
      return { type: "CHECKOUT_ERROR", payload: { code, message } };
    }
    case "CHECKOUT_CLOSE":
      return { type: "CHECKOUT_CLOSE", payload: {} };
    default:
      return null;
  }
}
