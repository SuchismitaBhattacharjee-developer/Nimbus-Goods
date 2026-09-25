import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import type { LaunchParams } from "@nimbus-goods/sdk/protocol";
import { randomId, type Bridge } from "../lib/bridge.ts";
import { findProduct, formatMoney, type Product } from "../lib/catalog.ts";
import { charge } from "../lib/processor.ts";
import {
  TEST_CARDS,
  cardBrand,
  digitsOnly,
  formatCardNumber,
  suggestEmail,
  validateCardNumber,
  validateCvc,
  validateEmail,
  validateExpiry,
} from "../lib/validation.ts";
import { CardFields, type CardField } from "./CardFields.tsx";
import { AlertIcon, BRAND_NAMES, CloseIcon, CloudMark, LampThumb, LockIcon, OfflineIcon } from "./icons.tsx";
import { Shell, useCloser } from "./Shell.tsx";
import { FatalState, Receipt, type ReceiptData } from "./states.tsx";

type Field = "email" | CardField;
const FIELDS: readonly Field[] = ["email", "number", "expiry", "cvc"];

type Status =
  | { kind: "editing"; notice: "declined" | "failed" | null }
  | { kind: "processing" }
  | { kind: "succeeded"; receipt: ReceiptData }
  | { kind: "fatal"; code: "product_unavailable" | "unexpected_error" };

const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};
const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine);

export function Checkout({ launch, bridge }: { launch: LaunchParams; bridge: Bridge }) {
  const product = useMemo(() => findProduct(launch.productId), [launch.productId]);
  const [sessionId] = useState(() => `cs_test_${randomId(24)}`);
  const [status, setStatus] = useState<Status>(() =>
    product ? { kind: "editing", notice: null } : { kind: "fatal", code: "product_unavailable" },
  );

  // Tell the SDK we're up (exactly once, even under StrictMode's double effects).
  const announced = useRef(false);
  useEffect(() => {
    if (announced.current) return;
    announced.current = true;
    bridge.send({ type: "CHECKOUT_READY", payload: { sessionId } });
    if (!product) {
      bridge.send({
        type: "CHECKOUT_ERROR",
        payload: { code: "product_unavailable", message: "This product isn't available for purchase." },
      });
    }
  }, [bridge, product, sessionId]);

  const onClosed = useCallback(() => bridge.send({ type: "CHECKOUT_CLOSE", payload: {} }), [bridge]);
  const { closing, close } = useCloser(onClosed);

  if (!product || status.kind === "fatal") {
    const code = status.kind === "fatal" ? status.code : "product_unavailable";
    return (
      <Shell label="Checkout unavailable" closing={closing} canClose dismissOnBackdrop onClose={close}>
        <Header merchant={product?.merchant ?? "Checkout"} canClose onClose={close} />
        <FatalState code={code} onClose={close} />
      </Shell>
    );
  }

  return (
    <PaymentForm
      product={product}
      sessionId={sessionId}
      bridge={bridge}
      status={status}
      setStatus={setStatus}
      closing={closing}
      close={close}
    />
  );
}

interface PaymentFormProps {
  product: Product;
  sessionId: string;
  bridge: Bridge;
  status: Exclude<Status, { kind: "fatal" }>;
  setStatus: (s: Status) => void;
  closing: boolean;
  close: () => void;
}

function PaymentForm({ product, sessionId, bridge, status, setStatus, closing, close }: PaymentFormProps) {
  const online = useOnline();
  const price = formatMoney(product.amount, product.currency);

  const [values, setValues] = useState<Record<Field, string>>({ email: "", number: "", expiry: "", cvc: "" });
  const [touched, setTouched] = useState<Record<Field, boolean>>({ email: false, number: false, expiry: false, cvc: false });
  const [submitted, setSubmitted] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const numberRef = useRef<HTMLInputElement>(null);
  const expiryRef = useRef<HTMLInputElement>(null);
  const cvcRef = useRef<HTMLInputElement>(null);
  const payRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);

  const brand = cardBrand(digitsOnly(values.number));
  const errors: Record<Field, string | null> = {
    email: validateEmail(values.email),
    number: validateCardNumber(values.number),
    expiry: validateExpiry(values.expiry),
    cvc: validateCvc(values.cvc, brand),
  };
  // Don't scold on blur of an empty field; after a submit attempt, show everything.
  const visible = Object.fromEntries(
    FIELDS.map((f) => [f, submitted || (touched[f] && values[f] !== "")]),
  ) as Record<Field, boolean>;
  const emailSuggestion = errors.email === null ? suggestEmail(values.email) : null;

  const processing = status.kind === "processing";
  const succeeded = status.kind === "succeeded";
  const notice = status.kind === "editing" ? status.notice : null;
  const pristine = FIELDS.every((f) => values[f] === "");

  // One idempotency key per set of payment details; a retry of the same details reuses it.
  const intent = useRef<{ fingerprint: string; key: string } | null>(null);
  const inFlight = useRef(false);

  const update = (field: Field, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    // Editing after a failure means the customer has moved on; clear the banner.
    if (status.kind === "editing" && status.notice) setStatus({ kind: "editing", notice: null });
  };

  const fillTestCard = (number: string) => {
    setValues((v) => ({
      ...v,
      number: formatCardNumber(number),
      expiry: v.expiry || "12 / 34",
      cvc: v.cvc || "123",
    }));
    if (status.kind === "editing" && status.notice) setStatus({ kind: "editing", notice: null });
  };

  const pay = async (event: FormEvent) => {
    event.preventDefault();
    // A ref, not state: a double click fires twice before React re-renders.
    if (inFlight.current || status.kind !== "editing" || !online) return;
    setSubmitted(true);

    const firstInvalid = FIELDS.find((f) => errors[f] !== null);
    if (firstInvalid) {
      const inputs = { email: emailRef, number: numberRef, expiry: expiryRef, cvc: cvcRef };
      inputs[firstInvalid].current?.focus();
      return;
    }

    const cardNumber = digitsOnly(values.number);
    const fingerprint = [values.email.trim(), cardNumber, values.expiry, values.cvc].join("|");
    if (intent.current?.fingerprint !== fingerprint) intent.current = { fingerprint, key: randomId(24) };

    inFlight.current = true;
    setStatus({ kind: "processing" });
    payRef.current?.focus();
    try {
      const outcome = await charge({ cardNumber, idempotencyKey: intent.current.key });
      if (outcome === "succeeded") {
        setStatus({
          kind: "succeeded",
          receipt: {
            amount: price,
            productName: product.name,
            merchant: product.merchant,
            email: values.email.trim(),
            card: `${BRAND_NAMES[brand]} •••• ${cardNumber.slice(-4)}`,
            sessionId,
          },
        });
        bridge.send({ type: "PAYMENT_SUCCESS", payload: { sessionId } });
      } else if (outcome === "declined") {
        setStatus({ kind: "editing", notice: "declined" });
        bridge.send({ type: "PAYMENT_ERROR", payload: { code: "card_declined", message: "The card was declined." } });
        requestAnimationFrame(() => {
          numberRef.current?.focus();
          numberRef.current?.select();
        });
      } else {
        setStatus({ kind: "editing", notice: "failed" });
        bridge.send({
          type: "PAYMENT_ERROR",
          payload: { code: "processing_error", message: "The payment couldn't be completed. Nothing was charged." },
        });
        requestAnimationFrame(() => payRef.current?.focus());
      }
    } catch {
      setStatus({ kind: "fatal", code: "unexpected_error" });
      bridge.send({
        type: "CHECKOUT_ERROR",
        payload: { code: "unexpected_error", message: "Something went wrong in the checkout. Nothing was charged." },
      });
    } finally {
      inFlight.current = false;
    }
  };

  useEffect(() => {
    if (succeeded) doneRef.current?.focus();
  }, [succeeded]);

  const label = `Checkout: ${product.name} from ${product.merchant}, ${price}`;

  return (
    <Shell
      label={label}
      closing={closing}
      canClose={!processing}
      dismissOnBackdrop={pristine || succeeded}
      onClose={close}
    >
      <Header merchant={product.merchant} canClose={!processing} onClose={close} />

      {status.kind === "succeeded" ? (
        <Receipt data={status.receipt} doneRef={doneRef} onDone={close} />
      ) : (
        <>
          <section className="summary" aria-label="Order summary">
            <LampThumb />
            <div className="summary-text">
              <p className="product-name">{product.name}</p>
              <p className="product-meta">{product.summary}</p>
            </div>
            <p className="product-price">{price}</p>
          </section>
          <dl className="totals">
            <div>
              <dt>Shipping</dt>
              <dd>Free</dd>
            </div>
            <div className="total">
              <dt>Total due today</dt>
              <dd>{price}</dd>
            </div>
          </dl>

          <form className="form" noValidate onSubmit={pay} aria-busy={processing}>
            <div className="field">
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                ref={emailRef}
                data-autofocus
                className={`input standalone${visible.email && errors.email ? " invalid" : ""}`}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="you@example.com"
                value={values.email}
                readOnly={processing}
                aria-invalid={visible.email && errors.email !== null}
                aria-describedby="email-hint"
                onChange={(e) => update("email", e.currentTarget.value)}
                onBlur={() => setTouched((t) => ({ ...t, email: true }))}
              />
              <p id="email-hint" className={visible.email && errors.email ? "error" : "hint"} aria-live="polite">
                {visible.email && errors.email ? (
                  errors.email
                ) : emailSuggestion ? (
                  <>
                    Did you mean{" "}
                    <button type="button" className="link" onClick={() => update("email", emailSuggestion)}>
                      {emailSuggestion}
                    </button>
                    ?
                  </>
                ) : (
                  "We'll send your receipt here."
                )}
              </p>
            </div>

            <CardFields
              values={values}
              errors={errors}
              visible={visible}
              readOnly={processing}
              numberRef={numberRef}
              expiryRef={expiryRef}
              cvcRef={cvcRef}
              onChange={update}
              onBlur={(f) => setTouched((t) => ({ ...t, [f]: true }))}
            />

            <details className="test-cards">
              <summary>Test cards</summary>
              <ul>
                {TEST_CARDS.map((card) => (
                  <li key={card.number}>
                    <button type="button" disabled={processing} onClick={() => fillTestCard(card.number)}>
                      <span className="mono">•••• {card.number.slice(-4)}</span>
                      <span>{card.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>

            <div className="notices" role="alert">
              {!online && (
                <div className="notice notice-muted">
                  <OfflineIcon />
                  <div>
                    <strong>You're offline.</strong> Reconnect to pay. Nothing has been charged.
                  </div>
                </div>
              )}
              {online && notice === "declined" && (
                <div className="notice notice-error">
                  <AlertIcon />
                  <div>
                    <strong>Your card was declined.</strong> You haven't been charged. Try a different card, or
                    contact your bank.
                  </div>
                </div>
              )}
              {online && notice === "failed" && (
                <div className="notice notice-warn">
                  <AlertIcon />
                  <div>
                    <strong>We couldn't reach your bank.</strong> Nothing was charged. It's safe to try again: this
                    order can only be charged once.
                  </div>
                </div>
              )}
            </div>

            <button
              ref={payRef}
              type="submit"
              className={`pay${processing ? " is-processing" : ""}`}
              aria-disabled={processing || !online}
            >
              {processing ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Processing…
                </>
              ) : notice === "failed" ? (
                `Try again · ${price}`
              ) : (
                `Pay ${price}`
              )}
            </button>
            <p className="processing-note" aria-live="polite">
              {processing ? "Confirming with your bank. This takes a few seconds." : ""}
            </p>
          </form>
        </>
      )}

      <footer className="foot">
        <p className="foot-lead">
          <LockIcon /> Secured by Dodo Payments
        </p>
        <p>{product.merchant} never sees your card details.</p>
      </footer>
    </Shell>
  );
}

function Header({ merchant, canClose, onClose }: { merchant: string; canClose: boolean; onClose: () => void }) {
  return (
    <header className="head">
      <div className="merchant">
        <span className="merchant-mark">
          <CloudMark />
        </span>
        <span className="merchant-name">{merchant}</span>
        <span className="pill" title="No real money moves in test mode">
          Test mode
        </span>
      </div>
      <button
        type="button"
        className="icon-btn"
        aria-label="Close checkout"
        title={canClose ? "Close" : "Payment in progress"}
        disabled={!canClose}
        onClick={onClose}
      >
        <CloseIcon />
      </button>
    </header>
  );
}
