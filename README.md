# Nimbus Goods: a tiny embeddable checkout

A store adds one script tag, calls `DodoCheckout.open()`, and a checkout opens on top of the page. The customer never leaves the store, and the store never sees the card.

**Live demo:** `<add the Vercel URL here after deploying>`

The demo is a pretend store (Nimbus Goods, selling one lamp) with an **integration console** beside it. The console shows every callback the store's code receives, the test cards, and one-click buttons for the weird states.

---

## Contents

- [The three pieces](#the-three-pieces)
- [Run it](#run-it)
- [SDK API](#sdk-api)
- [How the pieces talk](#how-the-pieces-talk)
- [Security boundary](#security-boundary)
- [Choices I made](#choices-i-made)
- [Two decisions I went back and forth on](#two-decisions-i-went-back-and-forth-on)
- [What I'd explore next](#what-id-explore-next)
- [Deploying](#deploying)

## The three pieces

```
packages/
├── sdk/            DodoCheckout: one TypeScript file, bundled to one IIFE (4.2 kB gzipped)
│   └── src/
│       ├── dodo-checkout.ts   public API, iframe lifecycle, overlay, callbacks
│       └── protocol.ts        the message contract (shared with the checkout)
├── checkout-app/   the hosted checkout (React + Vite), runs inside the SDK's iframe
│   └── src/lib/    catalog, validation, fake processor, bridge (the only postMessage call)
└── demo-site/      the store (plain TypeScript + Vite): loads the SDK with a <script> tag
e2e/                Playwright tests for every flow and weird state
scripts/            assemble.mjs (one deployable dist/), serve.mjs (local prod preview)
```

| Piece | Built to | Served at |
| --- | --- | --- |
| Demo site | `packages/demo-site/dist` | `/` |
| Checkout app | `packages/checkout-app/dist` | `/checkout/` |
| SDK | `packages/sdk/dist/dodo-checkout.js` | `/sdk/dodo-checkout.js` |

`pnpm build` builds all three and assembles them into one `dist/`: one repo, one Vercel project, one domain.

The demo site never imports checkout code. It uses the SDK exactly as a merchant would: through the `<script>` tag. It borrows only the SDK's TypeScript types, via a `paths` alias. The checkout app imports only `protocol.ts` from the SDK, so the contract has a single source of truth.

## Run it

Requirements: Node ≥ 22.12, pnpm 12.

```bash
pnpm install
pnpm dev          # store on http://localhost:5173, checkout (+ SDK) on http://localhost:5174
```

In dev the store and checkout run on different ports, which makes them truly cross-origin. The store loads the SDK from the checkout's server, just as it would in production.

| Command | What it does |
| --- | --- |
| `pnpm build` | Builds sdk, checkout-app and demo-site, then assembles `dist/`. Fails if any file references `localhost`. |
| `pnpm preview` | Serves `dist/` on http://localhost:4173 with the exact headers from `vercel.json` (CORS, CSP) |
| `pnpm typecheck` | `tsc` for every package and the e2e suite |
| `pnpm lint` | ESLint (typescript-eslint, React hooks). `no-console` is an error: payment code must not log. |
| `pnpm test` | Playwright end-to-end suite against the production build (run `pnpm build` first) |
| `pnpm check` | typecheck + lint + build |

`E2E_BASE_URL=http://localhost:5173 pnpm test` runs the suite against `pnpm dev` instead.

> The workspace uses pnpm's `nodeLinker: hoisted`, and the packages reach each other through TS/Vite aliases rather than `workspace:` links. That keeps installs working on drives without symlink support (it was built on an exFAT disk). It doesn't change how anything resolves.

## SDK API

```html
<script src="https://<your-deployment>/sdk/dodo-checkout.js"></script>
<script>
  DodoCheckout.open({
    productId: "prod_123",
    onSuccess: ({ sessionId }) => {},  // required
    onError: ({ code, message }) => {},
    onClose: ({ reason }) => {},
  });
</script>
```

| | |
| --- | --- |
| `open(options): boolean` | Opens the checkout. Returns `false` and does nothing if one is already open. |
| `close(): void` | Closes it from the host (e.g. an SPA route change). |
| `version: string` | |

The SDK guarantees:

- **`onClose` fires exactly once per successful `open()`, and always last.** By then everything is torn down, so calling `open()` again from inside it works.
- **`onSuccess` fires at most once, and `onError` never fires after it.**
- **`onError` can fire more than once.** A declined card is reported, but the checkout stays open so the customer can try another card. Use `code` to tell recoverable errors from fatal ones, and treat `onClose` as the end.
- **Misuse fails loudly and early.** A missing `onSuccess`, a malformed `productId`, or a non-function callback throws a `TypeError` naming the problem. A second `open()` warns instead of stacking modals.
- **A throwing callback can't break the SDK.** It's rethrown asynchronously, so it still reaches your console, and teardown still happens.

`onError` codes:

| code | when | checkout state |
| --- | --- | --- |
| `card_declined` | issuer declined | open; customer can use another card |
| `processing_error` | bank didn't answer; nothing charged | open; customer can retry |
| `product_unavailable` | unknown `productId` | shows "not available"; closes with `reason: "error"` |
| `checkout_load_failed` | checkout didn't become ready (offline, blocked, down) | SDK shows *Try again / Close* |
| `unexpected_error` | the checkout crashed; nothing charged | shows an apology; closes with `reason: "error"` |

`onClose` reasons: `completed` (paid; wins over everything else), `dismissed` (customer closed without paying), `error` (checkout couldn't be used), `host` (you called `close()` before payment).

There is deliberately **no configuration**. Where you load the SDK from *is* the configuration: `…/sdk/dodo-checkout.js` opens `…/checkout/` next to it.

## How the pieces talk

```
 Store page                          SDK (in store page)                     Checkout (sandboxed iframe)
 ──────────                          ───────────────────                     ───────────────────────────
 DodoCheckout.open({productId}) ──▶  validate options, lock scroll,
                                     make page inert, show backdrop
                                     + "Opening secure checkout…"
                                     <iframe sandbox="allow-scripts allow-forms"
                                       src="/checkout/#product=…&channel=…&origin=…">  ──▶  checks it's framed and the
                                                                                            parent can't reach in
                                     ◀── CHECKOUT_READY {sessionId} ─────────────────────  (postMessage to host origin only)
                                     reveal iframe, focus it
                                                                                            customer pays (fake processor)
 onError({code,message})       ◀──   ◀── PAYMENT_ERROR {code,message} ────────────────────  declined / bank timeout
 onSuccess({sessionId})        ◀──   ◀── PAYMENT_SUCCESS {sessionId} ─────────────────────  receipt shown
 onClose({reason})             ◀──   ◀── CHECKOUT_CLOSE {} ───────────────────────────────  Done / ✕ / Esc
                                     tear down: remove listener, timers,
                                     iframe; restore scroll, inert, focus
```

Launch parameters travel **in the URL fragment**, which is never sent to a server. Messages flow **one way only** (checkout → SDK), so the host has nothing to push into a running checkout.

### Message contract (`packages/sdk/src/protocol.ts`)

Every message has the same envelope:

```ts
{ source: "dodo-checkout", v: 1, channel: string, type, payload }
```

| type | payload | meaning |
| --- | --- | --- |
| `CHECKOUT_READY` | `{ sessionId }` | Checkout rendered. Must come first; duplicates are ignored. |
| `PAYMENT_SUCCESS` | `{ sessionId }` | Paid. Must match the READY `sessionId`. |
| `PAYMENT_ERROR` | `{ code: "card_declined" \| "processing_error", message }` | Attempt failed; checkout still usable. |
| `CHECKOUT_ERROR` | `{ code: "product_unavailable" \| "unexpected_error", message }` | Checkout can't continue. |
| `CHECKOUT_CLOSE` | `{}` | Customer asked to close. The SDK decides the `reason`. |

The SDK accepts a message only if **all** of these hold:

1. `event.source` is its own iframe's window. This is the unforgeable check.
2. `event.origin === "null"`, meaning the iframe is still sandboxed.
3. The `channel` matches the random 32-character nonce made for this `open()`.
4. The type is known and the payload passes strict shape checks. Unknown fields are dropped, and strings have length limits.
5. It fits the lifecycle: nothing before READY, no error after success, nothing after teardown.

The checkout only ever posts to the exact host origin the SDK gave it, never `"*"`. It cross-checks that origin against `location.ancestorOrigins` where the browser supports it.

## Security boundary

```
 HOST PAGE (store)                  can see: sessionId, error code + generic message, close reason
     │  safe callbacks only
 SDK (runs in host page)            closed shadow root; validates every message
     │  postMessage, one way, strict schema
 CHECKOUT (sandboxed, opaque origin)  owns: card number, expiry, CVC, email
```

**What crosses the boundary:** into the checkout go `productId`, a channel nonce, and the host origin. Out come `sessionId`, error `code`/`message`, and close `reason`. That's all.

**What never crosses:** card number, expiry, CVC, last-4, brand, or the customer's email. None of it goes into callbacks, messages, URLs, storage, or logs. The checkout uses no storage at all, and the e2e suite asserts this: it records every `message` event the host receives and checks for card digits and the email.

What the host **can't** do:

- **Read the form.** The iframe has no `allow-same-origin`, so the checkout runs in an opaque origin. Even on the same domain, `iframe.contentDocument` is `null` and the DOM is unreachable.
- **Set the price or the merchant name.** Both come from the (stand-in) catalog, keyed by `productId`, so a page can't make the checkout charge $1 or claim to be a different store.
- **Forge a payment result.** Messages must come from the iframe's own window. The demo's "Forge a success" button tries it; nothing happens.
- **Restyle the checkout.** The overlay is in a closed shadow root and the checkout is a separate document, so host CSS can't reach either.

The checkout also defends itself. If it's framed in a way where `window.parent.document` is reachable (same-origin, not sandboxed), it **refuses to render the card form**.

`vercel.json` gives `/checkout/` a strict CSP: `script-src 'self'`, `connect-src 'none'`, `form-action 'none'`, `base-uri 'none'`. So even an XSS bug in the checkout couldn't send card data anywhere.

## Choices I made

Things I think most checkouts get wrong, and what this one does instead:

- **Every failure says whether money moved.** "Your card was declined. You haven't been charged." "We couldn't reach your bank. Nothing was charged. It's safe to try again." Ambiguity after a failure is what makes people retry into double charges or abandon.
- **Retry is actually safe.** Each set of payment details gets an idempotency key, and a retry reuses it (`processor.ts`). If a "failed" attempt had really gone through, the retry returns that result instead of charging again. That's what earns the "safe to try again" copy.
- **You can't close it mid-charge.** While a payment is in flight, the ✕ is disabled and Escape and backdrop clicks are ignored. Closing then would leave the customer unsure whether they paid.
- **It doesn't nag.** No errors while typing or on leaving an empty field. Errors appear after you've typed something and moved on, or when you press Pay, and they say what to do. Pay moves focus to the first problem.
- **Only four fields.** Email, card number, expiry, CVC: no name, no address. The card number formats as you type, keeps your cursor where it was, and moves on when complete. Backspace in an empty field steps back. Common email-domain typos (`gmial.com`) get a one-tap fix, because a receipt sent to the wrong address becomes a support ticket.
- **Backdrop clicks don't throw away work.** Clicking outside closes a *pristine* form only, and only if the press also started outside, so drag-selecting text can't close it.
- **The receipt stays until you dismiss it.** Auto-closing success screens leave people unsure they paid. The host hears via `onSuccess` immediately either way.
- **Weird states have owners.** Before the checkout is ready, the SDK owns the UI: an instant backdrop, "Opening secure checkout…", and after a timeout *Try again / Close*. It fails immediately when offline, and after 5 s if the page loaded but never said ready. Once ready, the checkout owns everything, including focus trap, Escape, and the offline banner.
- **Motion has a job.** The dialog rises in (a bottom sheet on phones), notices slide in, and the success check draws itself. `prefers-reduced-motion` turns all of it off.

## Two decisions I went back and forth on

### 1. A sandboxed, opaque-origin iframe rather than relying on a separate origin

The brief says card details must never touch the host page. The deployment requirement was one domain: `/` for the store, `/checkout` for the checkout. Those conflict. A plain same-origin iframe gives the host page full access to `iframe.contentDocument`, card inputs included.

Options:

- **(a) Separate origin for the checkout.** This is how Stripe does it (`js.stripe.com`), and the browser's same-origin policy isolates it no matter what the host does. It's the right production answer, but it needs a second domain.
- **(b) Same-origin iframe, "trust the host".** Rejected: it breaks the brief's core promise.
- **(c) `sandbox="allow-scripts allow-forms"` without `allow-same-origin`.** The checkout gets an opaque origin, so it's isolated even on the same domain.

I shipped **(c), with (a) one setting away**: point `VITE_DODO_SDK_URL` at another domain and the checkout moves with the SDK.

What (c) costs:

- **Assets need CORS.** The checkout's module scripts are fetched from an opaque origin, so `/checkout/*` sends `Access-Control-Allow-Origin: *`. They're public static files, so this is harmless.
- **Origin checks become weak.** Every message arrives with `origin "null"`, so authentication rests on `event.source` plus the channel nonce instead.
- **No storage or cookies inside the checkout.** Browser card autofill may also be less eager. A real checkout would want cookies for fraud signals and saved cards.
- **It doesn't stop a hostile merchant.** The sandbox attribute is set by SDK code running *in the host page*, so a malicious merchant could strip it. That's why the checkout also checks for itself and refuses to render if it can be reached. Even so, only (a) truly protects against a hostile host.

I'd take (a) in production, and I say so rather than overclaim.

### 2. `onError` for every failed attempt, with `onClose` as the single terminal event

The brief's shape has three callbacks, and I went back and forth on what "error" means.

- **Terminal-only errors:** a decline wouldn't fire `onError` if the customer then fixed their card. That's cleaner, but the host never learns that attempts failed, and the demo's callback log would show nothing interesting for 0002 or 0341.
- **A single `onComplete({ status })`:** unambiguous, but it isn't the API shape the brief asked for, and it merges "paid" with "left" into one callback people must switch on.

I chose: **`onError` reports every failure as it happens (`code` says whether it's recoverable). `onSuccess` at most once and never followed by an error. `onClose` exactly once, always last, with a `reason` that summarises the outcome.** A merchant who only wants the final truth listens to `onClose`. One who wants analytics gets every attempt.

The accepted risk is a host tearing down its UI on the first `onError`. The docs, the codes, and the fact that the checkout stays open all push against that.

## What I'd explore next

- **A real session backend.** Create the session server-side (the price is locked there), return the `sessionId` from that, and make webhooks the source of truth. `onSuccess` would then be a UI signal only.
- **A dedicated checkout origin with per-merchant `frame-ancestors`.** Drop the sandbox for real origin isolation, so cookies, saved cards, 3-D Secure and Apple/Google Pay become possible. Wallets need `allow="payment"` and a non-opaque origin.
- **3-D Secure / step-up auth.** This is the "fails halfway" case that really matters: the customer is sent to their bank and may never come back.
- **Prewarm on intent.** Preload the checkout when the pointer approaches Buy, so the loading state is almost never seen.
- **Versioned SDK URLs** (`/sdk/v1/`) with long caching, plus a tiny loader that can roll out fixes.
- **Cross-browser e2e** (Firefox, WebKit), a screen-reader pass (VoiceOver, NVDA) on the focus handoff between the SDK overlay and the iframe, and localized copy and currency formatting.
- **Limited theming** (accent colour, light/dark). I left it out on purpose: a checkout that looks the same on every site is part of what makes it trustworthy.

## Deploying

The whole repo is one Vercel project. `vercel.json` sets the install, build and output directory, plus the headers the sandbox needs.

1. Import the GitHub repo into Vercel. Leave the root directory as the repo root and the framework preset as "Other"; `vercel.json` supplies the rest.
2. Deploy. `/` is the store, `/checkout/` the checkout, `/sdk/dodo-checkout.js` the SDK.
3. Optional: to serve the checkout from its own origin, add a second domain to the same project and set `VITE_DODO_SDK_URL=https://<that-domain>/sdk/dodo-checkout.js`.

There are no URLs to edit in source. The SDK derives the checkout URL from its own `<script src>`, and the store's SDK URL defaults to the same deployment (`packages/demo-site/.env`). Production builds fail if anything references `localhost`.

Check a deployment with `E2E_BASE_URL=https://<deployment> pnpm test`.

## Test cards

Any future expiry and any CVC. The checkout has a **Test cards** shortcut that fills them in.

| Card | Result |
| --- | --- |
| `4242 4242 4242 4242` | Succeeds |
| `4000 0000 0000 0002` | Declined |
| `4000 0000 0000 0341` | Fails once (bank didn't respond), succeeds on retry |

To see a load failure, switch DevTools to **Offline** and click Buy.
