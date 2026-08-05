/**
 * "Why did I lose my streak/multiplier?" copy for the reveal.
 *
 * When a counted human round breaks the run (neither the means nor the belief
 * match cleared `GOOD_MATCH_THRESHOLD`), we tell the player *in their own
 * numbers* what fell short — and vary the wording so it doesn't get stale. One
 * of {@link MISS_TEMPLATES} is filled from these facts:
 *
 *   {loss}     — what was lost, e.g. "your multiplier" / "your streak and multiplier"
 *   {Loss}     — the same, capitalised for the start of a sentence
 *   {best}     — the stronger side, "means match" or "belief match"
 *   {worst}    — the weaker side
 *   {bestPct}  {worstPct} — those two as whole percentages
 *   {means}    {belief}    — the raw two, whole percentages
 *   {threshold} — the bar to clear, a whole percentage
 */

export interface MissFacts {
  /** Means-match overlap, 0-1. */
  meansMatch: number;
  /** Belief-match overlap, 0-1. */
  beliefMatch: number;
  /** The good-match threshold, 0-1. */
  threshold: number;
  streakLost: boolean;
  multiplierLost: boolean;
}

/** 50 templates, kept deliberately varied. Each names the numbers and the bar. */
export const MISS_TEMPLATES: readonly string[] = [
  "{Loss} reset — your best was {best} at {bestPct}%, under the {threshold}% you need.",
  "{Loss} gone. {best} led at {bestPct}%, but the hive wanted {threshold}%.",
  "The swarm drifted off: {best} {bestPct}%, {worst} {worstPct}% — both below {threshold}%. {Loss} lost.",
  "So close! {best} hit {bestPct}%, just shy of {threshold}%. {Loss} back to square one.",
  "{Loss} broke — neither {means}% (means) nor {belief}% (belief) cleared the {threshold}% bar.",
  "Reset {loss}: your strongest read, {best}, landed at {bestPct}% against a {threshold}% target.",
  "There goes {loss}. {best} {bestPct}% was your peak, and {threshold}% was the wall.",
  "Cold read — {best} topped out at {bestPct}%, below {threshold}%. {Loss} slips away.",
  "{Loss} cooled off. {means}% on means, {belief}% on belief; you needed {threshold}% on one.",
  "Off the wave: {best} at {bestPct}% couldn't reach {threshold}%. {Loss} reset.",
  "{Loss} snapped. {best} was closest at {bestPct}%, still {threshold}% was the mark.",
  "Not this time — {best} {bestPct}%, {worst} {worstPct}%, and the bar sat at {threshold}%. {Loss} lost.",
  "{Loss} fizzled. Your better guess ({best}) came in at {bestPct}%, under {threshold}%.",
  "The hive shrugged: {best} {bestPct}% fell short of {threshold}%. {Loss} back to the start.",
  "{Loss} dropped away — best of the two was {best} at {bestPct}%, needing {threshold}%.",
  "Missed the mark. {best} reached {bestPct}%, {worst} only {worstPct}%; {threshold}% clears it. {Loss} gone.",
  "{Loss} went quiet. {best} {bestPct}% was as warm as it got, and {threshold}% was the line.",
  "Whiff! Neither {means}% nor {belief}% touched {threshold}%. {Loss} reset.",
  "{Loss} lost — {best} at {bestPct}% was your best shot, {threshold}% the goal.",
  "The crowd slipped past you: {best} {bestPct}%, below the {threshold}% you needed. {Loss} broke.",
  "{Loss} back to zero. {best} peaked at {bestPct}%; the bar was {threshold}%.",
  "Just missed — {best} {bestPct}% vs a {threshold}% target. {Loss} resets.",
  "{Loss} cooled: {means}% means, {belief}% belief, both under {threshold}%.",
  "No streak fuel here — {best} {bestPct}% under {threshold}%. {Loss} lost.",
  "{Loss} slipped. Even your stronger side, {best}, sat at {bestPct}% (needs {threshold}%).",
  "The wave rolled on without you: {best} {bestPct}%, short of {threshold}%. {Loss} reset.",
  "{Loss} gone cold — {best} {bestPct}%, {worst} {worstPct}%, bar at {threshold}%.",
  "Close but no honey: {best} at {bestPct}% missed {threshold}%. {Loss} lost.",
  "{Loss} reset. You needed {threshold}%; the best you managed was {best} at {bestPct}%.",
  "Swarm said no: {best} {bestPct}% didn't reach {threshold}%. {Loss} broke.",
  "{Loss} lost its heat — {means}% and {belief}% both fell under {threshold}%.",
  "A miss: your peak was {best} ({bestPct}%), the target {threshold}%. {Loss} resets.",
  "{Loss} unravelled. {best} {bestPct}% led the pair but stayed below {threshold}%.",
  "Not calibrated enough — {best} {bestPct}% under {threshold}%. {Loss} back to start.",
  "{Loss} fizzed out. {best} {bestPct}%, {worst} {worstPct}%; either had to top {threshold}%.",
  "The hive mind wandered: {best} at {bestPct}% missed the {threshold}% cut. {Loss} lost.",
  "{Loss} reset — {best} {bestPct}% was warm, but {threshold}% is the threshold.",
  "Short by a bit: {best} {bestPct}% against {threshold}%. {Loss} gone.",
  "{Loss} broke — best read {best} at {bestPct}%, well under the {threshold}% bar.",
  "Off-beat this round: {means}% means, {belief}% belief, none over {threshold}%. {Loss} resets.",
  "{Loss} lost. Your closer call, {best}, reached {bestPct}% (goal {threshold}%).",
  "The consensus dodged you: {best} {bestPct}% below {threshold}%. {Loss} cooled off.",
  "{Loss} back to one. {best} {bestPct}% was the high mark; {threshold}% was needed.",
  "Missed the swarm — {best} at {bestPct}%, {worst} at {worstPct}%, bar {threshold}%. {Loss} reset.",
  "{Loss} slipped away: neither {means}% nor {belief}% cleared {threshold}%.",
  "Chilly one — {best} {bestPct}% couldn't crack {threshold}%. {Loss} lost.",
  "{Loss} reset. Best of {best} {bestPct}% and {worst} {worstPct}% still under {threshold}%.",
  "The wave crested elsewhere: {best} {bestPct}%, short of {threshold}%. {Loss} broke.",
  "{Loss} gone — you were {threshold}% away's worth off; {best} only made {bestPct}%.",
  "Run's over: {best} {bestPct}% missed the {threshold}% line. {Loss} resets.",
];

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in vars ? String(vars[key]) : `{${key}}`,
  );
}

/** Pick a template and fill it with the round's actual numbers. `rng` is injectable for tests. */
export function composeMissReason(facts: MissFacts, rng: () => number = Math.random): string {
  const means = Math.round(facts.meansMatch * 100);
  const belief = Math.round(facts.beliefMatch * 100);
  const threshold = Math.round(facts.threshold * 100);
  const meansIsBest = facts.meansMatch >= facts.beliefMatch;
  const loss =
    facts.multiplierLost && facts.streakLost
      ? "your streak and multiplier"
      : facts.multiplierLost
        ? "your multiplier"
        : "your streak";
  const vars = {
    means,
    belief,
    threshold,
    best: meansIsBest ? "means match" : "belief match",
    worst: meansIsBest ? "belief match" : "means match",
    bestPct: meansIsBest ? means : belief,
    worstPct: meansIsBest ? belief : means,
    loss,
    Loss: loss.charAt(0).toUpperCase() + loss.slice(1),
  };
  const template = MISS_TEMPLATES[Math.floor(rng() * MISS_TEMPLATES.length)] ?? MISS_TEMPLATES[0];
  return fill(template, vars);
}
