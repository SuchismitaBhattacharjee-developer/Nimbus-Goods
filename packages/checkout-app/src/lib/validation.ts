export type CardBrand = "visa" | "mastercard" | "amex" | "discover" | "unknown";

export const TEST_CARDS = [
  { number: "4242424242424242", label: "Succeeds" },
  { number: "4000000000000002", label: "Declines" },
  { number: "4000000000000341", label: "Fails once, then succeeds" },
] as const;

export const digitsOnly = (value: string) => value.replace(/\D/g, "");

export function cardBrand(digits: string): CardBrand {
  if (/^4/.test(digits)) return "visa";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(digits)) return "mastercard";
  if (/^3[47]/.test(digits)) return "amex";
  if (/^(6011|65)/.test(digits)) return "discover";
  return "unknown";
}

const cardLength = (brand: CardBrand) => (brand === "amex" ? 15 : 16);
export const cvcLength = (brand: CardBrand) => (brand === "amex" ? 4 : 3);

export function formatCardNumber(raw: string): string {
  const digits = digitsOnly(raw);
  const brand = cardBrand(digits);
  const trimmed = digits.slice(0, cardLength(brand));
  const groups = brand === "amex" ? [4, 6, 5] : [4, 4, 4, 4];
  const parts: string[] = [];
  let i = 0;
  for (const size of groups) {
    if (i >= trimmed.length) break;
    parts.push(trimmed.slice(i, i + size));
    i += size;
  }
  return parts.join(" ");
}

/** "MM / YY". While deleting we don't re-add the separator, so backspace never gets stuck. */
export function formatExpiry(raw: string, deleting: boolean): string {
  let digits = digitsOnly(raw).slice(0, 4);
  if (digits.length === 1 && Number(digits) > 1) digits = `0${digits}`;
  if (digits.length < 2) return digits;
  if (digits.length === 2) return deleting ? digits : `${digits} / `;
  return `${digits.slice(0, 2)} / ${digits.slice(2)}`;
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// Messages are written for the customer: say what's wrong and what to do, never "invalid input".

export function validateEmail(value: string): string | null {
  const v = value.trim();
  if (!v) return "Enter your email so we can send your receipt.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return "That email doesn't look quite right.";
  return null;
}

const DOMAIN_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmail.co": "hotmail.com",
  "yahooo.com": "yahoo.com",
  "yaho.com": "yahoo.com",
  "outlok.com": "outlook.com",
  "icloud.co": "icloud.com",
};

/** A receipt sent to the wrong address is a support ticket. Catch the common typos. */
export function suggestEmail(value: string): string | null {
  const v = value.trim();
  const at = v.lastIndexOf("@");
  if (at < 1) return null;
  const fix = DOMAIN_TYPOS[v.slice(at + 1).toLowerCase()];
  return fix ? `${v.slice(0, at)}@${fix}` : null;
}

export function validateCardNumber(value: string): string | null {
  const digits = digitsOnly(value);
  if (!digits) return "Enter your card number.";
  if (digits.length < cardLength(cardBrand(digits))) return "Your card number is incomplete.";
  if (!luhn(digits)) return "That card number isn't valid. Check for a typo.";
  if (!TEST_CARDS.some((c) => c.number === digits)) return "This is test mode. Use one of the test cards below.";
  return null;
}

export function validateExpiry(value: string, now = new Date()): string | null {
  const digits = digitsOnly(value);
  if (!digits) return "Enter the expiry date.";
  if (digits.length < 4) return "The expiry date is incomplete.";
  const month = Number(digits.slice(0, 2));
  const year = 2000 + Number(digits.slice(2, 4));
  if (month < 1 || month > 12) return "The expiry month should be 01 to 12.";
  const endOfMonth = new Date(year, month, 1);
  if (endOfMonth <= now) return "This card has expired.";
  if (year > now.getFullYear() + 20) return "The expiry year looks too far away.";
  return null;
}

export function validateCvc(value: string, brand: CardBrand): string | null {
  const digits = digitsOnly(value);
  if (!digits) return "Enter the security code.";
  if (digits.length < cvcLength(brand)) return "The security code is incomplete.";
  return null;
}
