import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const EXIT_MS = 170;
const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Plays the exit animation once, then reports the close. Repeat calls are ignored. */
export function useCloser(onClosed: () => void) {
  const [closing, setClosing] = useState(false);
  const started = useRef(false);
  const close = useCallback(() => {
    if (started.current) return;
    started.current = true;
    setClosing(true);
    window.setTimeout(onClosed, prefersReducedMotion() ? 0 : EXIT_MS);
  }, [onClosed]);
  return { closing, close };
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ShellProps {
  label: string;
  closing: boolean;
  /** False while a payment is in flight: closing then would leave the customer unsure if they paid. */
  canClose: boolean;
  /** Backdrop clicks only dismiss when there's nothing to lose. */
  dismissOnBackdrop: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Dialog chrome. The iframe covers the whole viewport; the SDK paints the dim backdrop
 * behind it, and everything outside `.dialog` here acts as that backdrop.
 */
export function Shell({ label, closing, canClose, dismissOnBackdrop, onClose, children }: ShellProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const pressStartedOnBackdrop = useRef(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (canClose) onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.getClientRects().length > 0,
      );
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [canClose, onClose]);

  useEffect(() => {
    // Desktop: put the cursor in the first field. Touch: don't throw a keyboard in the
    // customer's face before they've read what they're buying; focus the dialog instead.
    const focusStart = () => {
      const dialog = dialogRef.current;
      if (!dialog || dialog.contains(document.activeElement)) return;
      const preferred = window.matchMedia("(pointer: fine)").matches
        ? dialog.querySelector<HTMLElement>("[data-autofocus]")
        : null;
      (preferred ?? dialog).focus({ preventScroll: true });
    };
    focusStart();
    // The SDK focuses the iframe once it's revealed; land somewhere sensible when it does.
    window.addEventListener("focus", focusStart);
    return () => window.removeEventListener("focus", focusStart);
  }, []);

  return (
    <div
      className={`overlay${closing ? " closing" : ""}`}
      onPointerDown={(e) => {
        pressStartedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // Require press *and* release on the backdrop, so a text selection that ends outside
        // the dialog doesn't throw away a half-filled form.
        if (e.target === e.currentTarget && pressStartedOnBackdrop.current && dismissOnBackdrop && canClose) {
          onClose();
        }
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={label} ref={dialogRef} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
