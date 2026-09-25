import type { CardBrand } from "../lib/validation.ts";

const base = { "aria-hidden": true, focusable: false } as const;

export function CloseIcon() {
  return (
    <svg {...base} width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg {...base} width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="2" y="5.25" width="8" height="5.5" rx="1.3" fill="currentColor" />
      <path d="M4 5.25V3.8a2 2 0 014 0v1.45" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function AlertIcon() {
  return (
    <svg {...base} width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="M8 4.5v4.2" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.2" r=".95" fill="#fff" />
    </svg>
  );
}

export function OfflineIcon() {
  return (
    <svg {...base} width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M1.8 5.9a9 9 0 0112.4 0M4 8.3a5.8 5.8 0 018 0M6.2 10.7a2.6 2.6 0 013.6 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M2.5 2.5l11 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function SuccessMark() {
  return (
    <svg {...base} className="success-mark" width="56" height="56" viewBox="0 0 56 56" fill="none">
      <circle className="success-ring" cx="28" cy="28" r="26" stroke="currentColor" strokeWidth="2.5" />
      <path className="success-tick" d="M17.5 28.5l7 7 14-15" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CloudMark() {
  return (
    <svg {...base} width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M7 18.5a4.5 4.5 0 01-.6-8.96A6 6 0 0117.8 8.2 4.9 4.9 0 0117.5 18.5z" fill="currentColor" />
    </svg>
  );
}

/** The product thumbnail: the same lamp the store shows, drawn small. */
export function LampThumb() {
  return (
    <svg {...base} viewBox="0 0 64 64" width="56" height="56">
      <defs>
        <radialGradient id="thumb-glow" cx="50%" cy="45%" r="60%">
          <stop offset="0" stopColor="#fff6d8" />
          <stop offset="1" stopColor="#f3dca0" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="12" fill="#1c2233" />
      <path d="M18 38a8 8 0 01-.5-16 11 11 0 0121-3.5A9 9 0 0147 38z" fill="url(#thumb-glow)" />
      <rect x="30.5" y="38" width="3" height="11" rx="1.5" fill="#8a93a8" />
      <rect x="23" y="49" width="18" height="3.5" rx="1.75" fill="#8a93a8" />
    </svg>
  );
}

export function BrandIcon({ brand }: { brand: CardBrand }) {
  if (brand === "unknown") {
    return (
      <svg {...base} width="28" height="20" viewBox="0 0 28 20" fill="none">
        <rect x=".5" y=".5" width="27" height="19" rx="3.5" stroke="#c9ccd4" fill="#fff" />
        <rect x="1" y="5" width="26" height="3.2" fill="#c9ccd4" />
        <rect x="4" y="12.5" width="8" height="2.2" rx="1" fill="#c9ccd4" />
      </svg>
    );
  }
  const styles: Record<Exclude<CardBrand, "unknown">, { bg: string; fg: string; text: string }> = {
    visa: { bg: "#1a1f71", fg: "#fff", text: "VISA" },
    mastercard: { bg: "#222", fg: "#fff", text: "MC" },
    amex: { bg: "#2e77bb", fg: "#fff", text: "AMEX" },
    discover: { bg: "#fff", fg: "#e0701a", text: "DISC" },
  };
  const s = styles[brand];
  return (
    <svg {...base} width="28" height="20" viewBox="0 0 28 20">
      <rect x=".5" y=".5" width="27" height="19" rx="3.5" fill={s.bg} stroke="rgba(0,0,0,.12)" />
      <text x="14" y="13.4" textAnchor="middle" fontSize="7.4" fontWeight="800" fontStyle="italic" fill={s.fg} fontFamily="system-ui, sans-serif">
        {s.text}
      </text>
    </svg>
  );
}

export const BRAND_NAMES: Record<CardBrand, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  unknown: "Card",
};
