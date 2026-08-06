/**
 * Start a battle: two clearly-separated ways to reach a friend.
 *
 * - **Email them** — only offered when the challenger has saved their own
 *   account, because the invite says who is challenging. Guarded by a real round
 *   the challenger must play (and a pointer/timing check), so the game can't be
 *   turned into a spam relay.
 * - **Copy a link** — always available, gives away nobody's address, and the
 *   first friend to open it becomes the opponent. The privacy-friendly option.
 */
import { useEffect, useRef, useState } from "react";
import type { FormEvent, PointerEvent as ReactPointerEvent } from "react";

import {
  ApiError,
  type PvpCaptcha,
  fetchPvpCaptcha as defaultFetchCaptcha,
  startPvpMatch as defaultStartMatch,
} from "../../api/client";
import type { GuessValue } from "../WaveSlider";
import ScaleHeader from "../ScaleHeader";
import ThingCard from "../ThingCard";
import WaveSlider from "../WaveSlider";
import { DEFAULT_GUESS } from "../../game/useGameLoop";

/** Cap on sampled pointer positions — plenty of signal, tiny payload. */
const MAX_POINTER_SAMPLES = 120;

export interface PvpInviteModalProps {
  /** Whether the challenger has saved their own account (gates the email option). */
  isClaimed: boolean;
  /** Called with the join code once a match exists, to jump straight into it. */
  onStarted: (joinCode: string) => void;
  onCancel?: () => void;
  fetchCaptcha?: () => Promise<PvpCaptcha>;
  startMatch?: typeof defaultStartMatch;
  className?: string;
}

export default function PvpInviteModal({
  isClaimed,
  onStarted,
  onCancel,
  fetchCaptcha = defaultFetchCaptcha,
  startMatch = defaultStartMatch,
  className,
}: PvpInviteModalProps) {
  const [email, setEmail] = useState("");
  const [captcha, setCaptcha] = useState<PvpCaptcha | null>(null);
  const [guess, setGuess] = useState<GuessValue>(DEFAULT_GUESS);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<"" | "link" | "email">("");
  const [error, setError] = useState<string | null>(null);
  const pointerPath = useRef<number[][]>([]);
  // Stamped when the captcha round arrives (0 until then), so pointer samples are
  // timed relative to the question actually appearing.
  const startedAt = useRef(0);

  // Deal the captcha round up front, but only when the email path is available.
  useEffect(() => {
    if (!isClaimed) return;
    let cancelled = false;
    fetchCaptcha()
      .then((c) => {
        if (!cancelled) {
          setCaptcha(c);
          startedAt.current = Date.now();
        }
      })
      .catch(() => {
        /* the link option still works; the email form just stays disabled */
      });
    return () => {
      cancelled = true;
    };
  }, [isClaimed, fetchCaptcha]);

  /** Sample the pointer while the captcha slider is being used. */
  function trackPointer(ev: ReactPointerEvent<HTMLDivElement>) {
    if (pointerPath.current.length >= MAX_POINTER_SAMPLES) return;
    pointerPath.current.push([
      Math.round(ev.clientX),
      Math.round(ev.clientY),
      Date.now() - startedAt.current,
    ]);
  }

  async function handleLink() {
    setBusy("link");
    setError(null);
    try {
      const result = await startMatch({ mode: "link" });
      setLink(result.link);
      // Keep the modal open so the player can copy and send it themselves.
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : "Couldn't start a battle.");
    } finally {
      setBusy("");
    }
  }

  async function handleCopy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function handleEmail(ev: FormEvent) {
    ev.preventDefault();
    if (!captcha) return;
    setBusy("email");
    setError(null);
    try {
      const result = await startMatch({
        mode: "email",
        email: email.trim(),
        captcha_token: captcha.captcha_token,
        center: guess.center,
        width_left: guess.widthLeft,
        width_right: guess.widthRight,
        pointer_path: pointerPath.current,
      });
      onStarted(result.join_code);
    } catch (err) {
      setError(
        err instanceof ApiError && err.message ? err.message : "Couldn't send the invite.",
      );
      // A rejected attempt burns the captcha — deal a fresh one to retry with.
      pointerPath.current = [];
      fetchCaptcha()
        .then((c) => {
          setCaptcha(c);
          startedAt.current = Date.now();
        })
        .catch(() => setCaptcha(null));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="bsg-levelup-backdrop" role="dialog" aria-modal="true" aria-labelledby="bsg-pvp-title">
      <div className={`bsg-levelup-card bsg-pvp-invite${className ? ` ${className}` : ""}`}>
        <p className="bsg-levelup-badge">Battle</p>
        <h2 className="bsg-levelup-title" id="bsg-pvp-title">
          Challenge a friend
        </h2>
        <p className="bsg-levelup-line">
          You&apos;ll both answer the same ten questions and be compared round by round.
          Whoever reads the hive mind better wins.
        </p>

        {error ? (
          <p className="bsg-claim-error" role="alert">
            {error}
          </p>
        ) : null}

        {/* --- Option 1: share a link (always available) --- */}
        <section className="bsg-pvp-option">
          <h3 className="bsg-pvp-option-title">Send a link yourself</h3>
          <p className="bsg-pvp-option-hint">
            The private option: nobody&apos;s email address is shared. Copy the link and send it
            however you like — the first friend who opens it becomes your opponent.
          </p>
          {link ? (
            <div className="bsg-pvp-linkrow">
              <input
                className="bsg-pvp-linkfield"
                type="text"
                readOnly
                value={link}
                aria-label="Battle link"
                onFocus={(ev) => ev.currentTarget.select()}
              />
              <button type="button" className="bsg-btn" onClick={handleCopy}>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="bsg-btn bsg-btn-primary"
              onClick={handleLink}
              disabled={busy !== ""}
            >
              {busy === "link" ? "Creating…" : "Create a battle link"}
            </button>
          )}
          {link ? (
            <button type="button" className="bsg-btn" onClick={() => onStarted(linkCode(link))}>
              Go to the battle
            </button>
          ) : null}
        </section>

        {/* --- Option 2: email the invite (needs a saved account) --- */}
        <section className="bsg-pvp-option">
          <h3 className="bsg-pvp-option-title">Email them an invite</h3>
          {isClaimed ? (
            <form onSubmit={handleEmail}>
              <p className="bsg-pvp-option-hint">
                We&apos;ll email your friend a link that also saves their progress to that
                address. They&apos;ll see the challenge came from you.
              </p>
              <label className="bsg-claim-field">
                <span>Friend&apos;s email</span>
                <input
                  type="email"
                  name="friend-email"
                  required
                  value={email}
                  onChange={(ev) => setEmail(ev.target.value)}
                  disabled={busy !== ""}
                />
              </label>

              {captcha ? (
                <div className="bsg-pvp-captcha" onPointerMove={trackPointer}>
                  <p className="bsg-pvp-option-hint">
                    One quick round first, so we know you&apos;re human — it counts like any
                    other round.
                  </p>
                  <ThingCard text={captcha.thing.text} />
                  <ScaleHeader left={captcha.scale.left} right={captcha.scale.right} />
                  <WaveSlider value={guess} onChange={setGuess} />
                </div>
              ) : (
                <p className="bsg-pvp-option-hint">Getting a question ready…</p>
              )}

              <button
                type="submit"
                className="bsg-btn bsg-btn-primary"
                disabled={busy !== "" || !captcha}
              >
                {busy === "email" ? "Sending…" : "Send the challenge"}
              </button>
            </form>
          ) : (
            <p className="bsg-pvp-option-hint">
              Save your own progress with an email first — then your friend can see who
              challenged them. Until then, use the link above.
            </p>
          )}
        </section>

        {onCancel ? (
          <button type="button" className="bsg-btn" onClick={onCancel} disabled={busy !== ""}>
            Not now
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Pull the join code back out of a battle link. */
function linkCode(link: string): string {
  const match = /[?&]pvp=([^&]+)/.exec(link);
  return match ? decodeURIComponent(match[1]) : "";
}
