/**
 * Fake payment processor. Stands in for a network call to Dodo's API.
 *
 * The idempotency key is the part worth keeping for real: one key per payment intent,
 * reused on retry. If a "failed" attempt had actually gone through, retrying with the same
 * key returns that original result instead of charging again. That's what lets the UI say
 * "Try again" without risking a double charge.
 */
export type ChargeOutcome = "succeeded" | "declined" | "failed";

const settled = new Map<string, ChargeOutcome>();
const attemptsByCard = new Map<string, number>();

const PROCESSING_MS = 1300;

export async function charge(input: { cardNumber: string; idempotencyKey: string }): Promise<ChargeOutcome> {
  await new Promise((resolve) => setTimeout(resolve, PROCESSING_MS + Math.random() * 500));

  const previous = settled.get(input.idempotencyKey);
  if (previous) return previous;

  const attempt = (attemptsByCard.get(input.cardNumber) ?? 0) + 1;
  attemptsByCard.set(input.cardNumber, attempt);

  let outcome: ChargeOutcome;
  switch (input.cardNumber) {
    case "4242424242424242":
      outcome = "succeeded";
      break;
    case "4000000000000002":
      outcome = "declined";
      break;
    case "4000000000000341":
      outcome = attempt === 1 ? "failed" : "succeeded";
      break;
    default:
      outcome = "declined";
  }

  // "failed" means the bank never answered: nothing settled, so the same key may be retried.
  if (outcome !== "failed") settled.set(input.idempotencyKey, outcome);
  return outcome;
}
