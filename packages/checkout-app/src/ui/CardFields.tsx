import type { ChangeEvent, KeyboardEvent, RefObject } from "react";
import {
  cardBrand,
  cvcLength,
  digitsOnly,
  formatCardNumber,
  formatExpiry,
  validateCardNumber,
  validateExpiry,
} from "../lib/validation.ts";
import { BrandIcon } from "./icons.tsx";

export type CardField = "number" | "expiry" | "cvc";

interface CardFieldsProps {
  values: Record<CardField, string>;
  errors: Record<CardField, string | null>;
  visible: Record<CardField, boolean>;
  readOnly: boolean;
  numberRef: RefObject<HTMLInputElement | null>;
  expiryRef: RefObject<HTMLInputElement | null>;
  cvcRef: RefObject<HTMLInputElement | null>;
  onChange: (field: CardField, value: string) => void;
  onBlur: (field: CardField) => void;
}

/**
 * Reformats in place while keeping the caret where the customer expects it: after the
 * same number of digits, not flung to the end of the field.
 */
function applyFormatted(el: HTMLInputElement, next: string): string {
  const caret = el.selectionStart ?? el.value.length;
  const atEnd = caret === el.value.length;
  const digitsBefore = digitsOnly(el.value.slice(0, caret)).length;
  let pos = next.length;
  if (!atEnd) {
    pos = 0;
    for (let seen = 0; pos < next.length && seen < digitsBefore; pos++) {
      if (/\d/.test(next[pos]!)) seen++;
    }
  }
  el.value = next;
  el.setSelectionRange(pos, pos);
  return next;
}

export function CardFields(props: CardFieldsProps) {
  const { values, errors, visible, readOnly, numberRef, expiryRef, cvcRef, onChange, onBlur } = props;
  const brand = cardBrand(digitsOnly(values.number));
  const shown = (["number", "expiry", "cvc"] as const).find((f) => visible[f] && errors[f]);
  const invalid = (f: CardField) => visible[f] && errors[f] !== null;

  const onNumber = (e: ChangeEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const wasAtEnd = el.selectionStart === el.value.length;
    const next = applyFormatted(el, formatCardNumber(el.value));
    onChange("number", next);
    if (wasAtEnd && validateCardNumber(next) === null && !values.expiry) expiryRef.current?.focus();
  };

  const onExpiry = (e: ChangeEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const deleting = (e.nativeEvent as InputEvent).inputType?.startsWith("delete") ?? false;
    const wasAtEnd = el.selectionStart === el.value.length;
    const next = applyFormatted(el, formatExpiry(el.value, deleting));
    onChange("expiry", next);
    if (wasAtEnd && !deleting && validateExpiry(next) === null && !values.cvc) cvcRef.current?.focus();
  };

  const onCvc = (e: ChangeEvent<HTMLInputElement>) => {
    onChange("cvc", digitsOnly(e.currentTarget.value).slice(0, cvcLength(brand)));
  };

  // Backspace in an empty field steps back to the previous one.
  const stepBack = (e: KeyboardEvent<HTMLInputElement>, prev: HTMLInputElement | null) => {
    if (e.key === "Backspace" && e.currentTarget.value === "" && prev) {
      e.preventDefault();
      prev.focus();
      prev.setSelectionRange(prev.value.length, prev.value.length);
    }
  };

  return (
    <fieldset className="field">
      <legend className="label">Card information</legend>
      <div className={`card-group${shown ? " has-error" : ""}`}>
        <div className="card-row">
          <label className="sr-only" htmlFor="cc-number">
            Card number
          </label>
          <input
            id="cc-number"
            ref={numberRef}
            className={`input input-number${invalid("number") ? " invalid" : ""}`}
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="1234 1234 1234 1234"
            value={values.number}
            readOnly={readOnly}
            aria-invalid={invalid("number")}
            aria-describedby={invalid("number") ? "card-error" : undefined}
            onChange={onNumber}
            onBlur={() => onBlur("number")}
          />
          <span className="brand" aria-hidden="true">
            <BrandIcon brand={brand} />
          </span>
        </div>
        <div className="card-row split">
          <label className="sr-only" htmlFor="cc-exp">
            Expiry date, month and year
          </label>
          <input
            id="cc-exp"
            ref={expiryRef}
            className={`input${invalid("expiry") ? " invalid" : ""}`}
            inputMode="numeric"
            autoComplete="cc-exp"
            placeholder="MM / YY"
            value={values.expiry}
            readOnly={readOnly}
            aria-invalid={invalid("expiry")}
            aria-describedby={invalid("expiry") ? "card-error" : undefined}
            onChange={onExpiry}
            onKeyDown={(e) => stepBack(e, numberRef.current)}
            onBlur={() => onBlur("expiry")}
          />
          <label className="sr-only" htmlFor="cc-csc">
            Security code
          </label>
          <input
            id="cc-csc"
            ref={cvcRef}
            className={`input${invalid("cvc") ? " invalid" : ""}`}
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder={brand === "amex" ? "CVC (4 digits)" : "CVC"}
            value={values.cvc}
            readOnly={readOnly}
            aria-invalid={invalid("cvc")}
            aria-describedby={invalid("cvc") ? "card-error" : undefined}
            onChange={onCvc}
            onKeyDown={(e) => stepBack(e, expiryRef.current)}
            onBlur={() => onBlur("cvc")}
          />
        </div>
      </div>
      <p id="card-error" className="error" aria-live="polite">
        {shown ? errors[shown] : ""}
      </p>
    </fieldset>
  );
}
