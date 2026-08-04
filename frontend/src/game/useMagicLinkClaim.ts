/**
 * Magic-link claim on load (WP-11/§2.6). If the page was opened from a claim
 * link (`?claim=<token>`), confirm it once on mount, hand the (possibly merged)
 * profile to `onConfirmed`, and strip the token from the URL so a refresh can't
 * replay an already-spent link. Returns a human notice to surface, or null; the
 * notice auto-dismisses after a few seconds so it doesn't linger over the game.
 */
import { useEffect, useRef, useState } from "react";

import { type ClaimConfirmResult, confirmClaim } from "../api/client";

/** How long the confirmation toast stays up before it clears itself. */
export const CLAIM_NOTICE_MS = 6000;

export function useMagicLinkClaim(
  onConfirmed: (result: ClaimConfirmResult) => void,
): string | null {
  const [notice, setNotice] = useState<string | null>(null);
  const onConfirmedRef = useRef(onConfirmed);
  useEffect(() => {
    onConfirmedRef.current = onConfirmed;
  });

  // Auto-dismiss the toast so it doesn't sit over the game forever (it never
  // cleared before, so it stayed through every subsequent round).
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), CLAIM_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("claim");
    if (!token) return;

    // Strip the token immediately so a re-render or refresh can't resubmit it.
    params.delete("claim");
    const qs = params.toString();
    const url = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
    window.history.replaceState(null, "", url);

    let cancelled = false;
    confirmClaim(token)
      .then((result) => {
        if (cancelled) return;
        onConfirmedRef.current(result);
        setNotice(
          result.merged
            ? "Welcome back — your progress is saved and your accounts are merged."
            : "Your progress is saved to your account.",
        );
      })
      .catch(() => {
        if (!cancelled) setNotice("That save link was invalid or expired.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return notice;
}
