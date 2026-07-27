/**
 * The two bipolar poles of a Scale, shown above the slider (WP-08). Purely
 * presentational; grouped and labelled so assistive tech announces the axis.
 */
export interface ScaleHeaderProps {
  left: string;
  right: string;
  dir?: "ltr" | "rtl";
}

export default function ScaleHeader({ left, right, dir = "ltr" }: ScaleHeaderProps) {
  return (
    <div
      className="bsg-scale-header"
      role="group"
      aria-label={`${left} to ${right}`}
      dir={dir}
    >
      <span className="bsg-scale-pole" data-pole="left">
        {left}
      </span>
      <span className="bsg-scale-pole" data-pole="right">
        {right}
      </span>
    </div>
  );
}
