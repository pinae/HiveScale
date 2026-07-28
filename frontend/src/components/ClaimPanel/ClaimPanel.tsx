/**
 * Account claim (WP-11/§2.6): turn an anonymous session into a saved account by
 * email, without ever forcing a login to play. The player asks for a magic link;
 * clicking it (or, in dev "echo" delivery, the inline confirm) ties their XP,
 * streaks, and history to the address — merging any prior account for it.
 *
 * The API calls are injectable so stories and unit tests run without a network.
 */
import { useState } from "react";
import type { FormEvent } from "react";

import {
  ApiError,
  type ClaimConfirmResult,
  type ClaimRequestResult,
  confirmClaim as defaultConfirmClaim,
  requestClaim as defaultRequestClaim,
} from "../../api/client";

export interface ClaimPanelProps {
  /** Called with the (possibly merged) profile once the claim is confirmed. */
  onClaimed: (result: ClaimConfirmResult) => void;
  /** Dismiss the panel (e.g. back to the game). */
  onCancel?: () => void;
  requestClaim?: (email: string) => Promise<ClaimRequestResult>;
  confirmClaim?: (token: string) => Promise<ClaimConfirmResult>;
  className?: string;
}

type Phase = "form" | "requesting" | "sent" | "confirming" | "done";

function messageFor(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

export default function ClaimPanel({
  onClaimed,
  onCancel,
  requestClaim = defaultRequestClaim,
  confirmClaim = defaultConfirmClaim,
  className,
}: ClaimPanelProps) {
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<string | null>(null);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [merged, setMerged] = useState(false);

  const busy = phase === "requesting" || phase === "confirming";

  async function handleRequest(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    setPhase("requesting");
    try {
      const res = await requestClaim(email.trim());
      setDevToken(res.claim_token ?? null);
      setPhase("sent");
    } catch (err) {
      setError(messageFor(err, "Couldn't send the link. Try again."));
      setPhase("form");
    }
  }

  async function handleConfirm(token: string) {
    setError(null);
    setPhase("confirming");
    try {
      const res = await confirmClaim(token);
      setMerged(res.merged);
      setPhase("done");
      onClaimed(res);
    } catch (err) {
      setError(messageFor(err, "Couldn't confirm the link. Request a new one."));
      setPhase("sent");
    }
  }

  const cls = `bsg-claim${className ? ` ${className}` : ""}`;

  if (phase === "done") {
    return (
      <section className={cls} aria-label="Save your progress">
        <p className="bsg-claim-done" role="status">
          {merged
            ? "Welcome back — your accounts are merged and your progress is saved."
            : "Saved! Your progress is now tied to your email."}
        </p>
        {onCancel ? (
          <button type="button" className="bsg-btn bsg-btn-primary" onClick={onCancel}>
            Back to the game
          </button>
        ) : null}
      </section>
    );
  }

  if (phase === "sent" || phase === "confirming") {
    return (
      <section className={cls} aria-label="Save your progress">
        <p className="bsg-claim-sent" role="status">
          Check your email for a link to finish saving your progress.
        </p>
        {error ? (
          <p className="bsg-claim-error" role="alert">
            {error}
          </p>
        ) : null}
        {devToken ? (
          <div className="bsg-claim-dev">
            <p className="bsg-claim-devnote">Dev delivery is on — confirm here without email:</p>
            <button
              type="button"
              className="bsg-btn bsg-btn-primary"
              onClick={() => handleConfirm(devToken)}
              disabled={busy}
            >
              {phase === "confirming" ? "Saving…" : "Confirm now"}
            </button>
          </div>
        ) : null}
        {onCancel ? (
          <button type="button" className="bsg-btn" onClick={onCancel} disabled={busy}>
            Not now
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <form className={cls} aria-label="Save your progress" onSubmit={handleRequest}>
      <h2 className="bsg-claim-title">Save your progress</h2>
      <p className="bsg-claim-blurb">
        Play stays login-free. Add an email and we&apos;ll keep your XP, streaks, and history
        safe across devices.
      </p>
      <label className="bsg-claim-field">
        <span>Email address</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(ev) => setEmail(ev.target.value)}
          disabled={busy}
        />
      </label>
      {error ? (
        <p className="bsg-claim-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="bsg-claim-actions">
        <button type="submit" className="bsg-btn bsg-btn-primary" disabled={busy}>
          {phase === "requesting" ? "Sending…" : "Email me a magic link"}
        </button>
        {onCancel ? (
          <button type="button" className="bsg-btn" onClick={onCancel} disabled={busy}>
            Not now
          </button>
        ) : null}
      </div>
    </form>
  );
}
