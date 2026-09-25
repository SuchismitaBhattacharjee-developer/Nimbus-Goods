import type { RefObject } from "react";
import { AlertIcon, SuccessMark } from "./icons.tsx";

export interface ReceiptData {
  amount: string;
  productName: string;
  merchant: string;
  email: string;
  card: string;
  sessionId: string;
}

/**
 * The receipt stays up until the customer dismisses it. Auto-closing a success screen
 * leaves people unsure whether they paid; the host already heard via onSuccess.
 */
export function Receipt({
  data,
  doneRef,
  onDone,
}: {
  data: ReceiptData;
  doneRef: RefObject<HTMLButtonElement | null>;
  onDone: () => void;
}) {
  return (
    <section className="result" aria-labelledby="result-title">
      <SuccessMark />
      <h2 id="result-title" className="result-title" role="status">
        Payment successful
      </h2>
      <p className="result-sub">
        {data.amount} paid to {data.merchant}
      </p>
      <dl className="receipt">
        <div>
          <dt>Item</dt>
          <dd>{data.productName}</dd>
        </div>
        <div>
          <dt>Paid with</dt>
          <dd>{data.card}</dd>
        </div>
        <div>
          <dt>Receipt sent to</dt>
          <dd>{data.email}</dd>
        </div>
        <div>
          <dt>Reference</dt>
          <dd className="mono">{data.sessionId}</dd>
        </div>
      </dl>
      <button ref={doneRef} type="button" className="pay" onClick={onDone}>
        Done
      </button>
    </section>
  );
}

const FATAL_COPY = {
  product_unavailable: {
    title: "This item isn't available",
    body: "The store may have sold out or removed it. You haven't been charged.",
  },
  unexpected_error: {
    title: "Something went wrong on our side",
    body: "The checkout hit an error. You haven't been charged. Close this and try again in a moment.",
  },
} as const;

export function FatalState({ code, onClose }: { code: keyof typeof FATAL_COPY; onClose: () => void }) {
  const copy = FATAL_COPY[code];
  return (
    <section className="result" aria-labelledby="result-title">
      <span className="result-icon">
        <AlertIcon />
      </span>
      <h2 id="result-title" className="result-title" role="alert">
        {copy.title}
      </h2>
      <p className="result-sub">{copy.body}</p>
      <button type="button" className="pay secondary" data-autofocus onClick={onClose}>
        Close
      </button>
    </section>
  );
}

/** Shown when someone opens /checkout directly, or it's embedded in a way we refuse to run in. */
export function NotEmbedded({ reason }: { reason: "standalone" | "insecure" }) {
  return (
    <main className="not-embedded">
      <div className="not-embedded-card">
        <h1>{reason === "insecure" ? "This checkout can't run here" : "Dodo Checkout"}</h1>
        <p>
          {reason === "insecure"
            ? "It was embedded in a way that would let the surrounding page read card details, so it refused to load. Open it with the Dodo Checkout SDK."
            : "This page opens inside a store, from its Buy button. There's nothing to pay for here."}
        </p>
        {reason === "standalone" && <a href="../">Go to the Nimbus Goods demo store →</a>}
      </div>
    </main>
  );
}
