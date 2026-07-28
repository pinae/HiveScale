/**
 * Magic-link claim on load (WP-11/§2.6). If the page was opened from a claim
 * link (`?claim=<token>`), confirm it once on mount, hand the (possibly merged)
 * profile to `onConfirmed`, and strip the token from the URL so a refresh can't
 * replay an already-spent link. Returns a human notice to surface, or null.
 */
import { useEffect, useRef, useState } from "react";

import { type ClaimConfirmResult, confirmClaim } from "../api/client";

export function useMagicLinkClaim(
  onConfirmed: (result: ClaimConfirmResult) => void,
): string | null {
  const [notice, setNotice] = useState<string | null>(null);
  const onConfirmedRef = useRef(onConfirmed);
  useEffect(() => {
    onConfirmedRef.current = onConfirmed;
  });

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
