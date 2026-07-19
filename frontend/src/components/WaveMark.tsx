/** Animated logo mark: three offset sine waves — the crowd, the player, the AI. */
export interface WaveMarkProps {
  /** Rendered size in px (square). */
  size?: number;
  /** Set false for reduced-motion contexts or static exports. */
  animated?: boolean;
}

const WAVES = [
  { d: "M0 34 Q 15 22, 30 34 T 60 34", stroke: "var(--sw-wave)", delay: "0s" },
  { d: "M0 40 Q 15 30, 30 40 T 60 40", stroke: "var(--sw-wave-deep)", delay: "0.25s" },
  { d: "M0 28 Q 15 18, 30 28 T 60 28", stroke: "var(--sw-accent)", delay: "0.5s" },
];

export default function WaveMark({ size = 64, animated = true }: WaveMarkProps) {
  return (
    <svg
      role="img"
      aria-label="Societal Wavelength logo"
      width={size}
      height={size}
      viewBox="0 0 60 60"
      fill="none"
    >
      {WAVES.map((w) => (
        <path key={w.d} d={w.d} stroke={w.stroke} strokeWidth={4} strokeLinecap="round">
          {animated && (
            <animateTransform
              attributeName="transform"
              type="translate"
              values="0 0; 0 -3; 0 0"
              dur="2.2s"
              begin={w.delay}
              repeatCount="indefinite"
            />
          )}
        </path>
      ))}
    </svg>
  );
}
