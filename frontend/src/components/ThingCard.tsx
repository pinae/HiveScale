/**
 * The concept being placed on the scale (WP-08). A calm card so the Thing is
 * the focal point of the round.
 */
export interface ThingCardProps {
  text: string;
  /** Optional flavour line under the Thing. */
  hint?: string;
}

export default function ThingCard({ text, hint }: ThingCardProps) {
  return (
    <article className="bsg-thing-card">
      <h2 className="bsg-thing-text">{text}</h2>
      {hint ? <p className="bsg-thing-hint">{hint}</p> : null}
    </article>
  );
}
