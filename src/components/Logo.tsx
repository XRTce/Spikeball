import { useId } from 'react';

export interface LogoProps {
  size?: number;
  className?: string;
  /** Renders the mark plus the wordmark. */
  withWordmark?: boolean;
  title?: string;
}

/**
 * The Rally mark: a roundnet net seen from above with the ball coming off it.
 * Drawn from tokens so it inherits the theme, and simple enough to stay
 * readable at favicon size.
 */
export function Logo({ size = 32, className, withWordmark, title }: LogoProps) {
  const uid = useId().replace(/:/g, '');
  const knockout = `rally-knockout-${uid}`;
  const clip = `rally-clip-${uid}`;

  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        <mask id={knockout}>
          <rect width="32" height="32" fill="#fff" />
          {/* Keeps the net clear of the ball so both read at small sizes. */}
          <circle cx="23.5" cy="8.5" r="7.8" fill="#000" />
        </mask>
        <clipPath id={clip}>
          <circle cx="13" cy="19" r="9" />
        </clipPath>
      </defs>

      <g mask={`url(#${knockout})`}>
        <g clipPath={`url(#${clip})`} stroke="var(--brand-500, #ff6b2c)" opacity="0.5">
          <path d="M2 14.5h22M2 23.5h22" strokeWidth="1.5" />
          <path d="M8.5 8v22M17.5 8v22" strokeWidth="1.5" />
        </g>
        <circle
          cx="13"
          cy="19"
          r="9"
          fill="none"
          stroke="var(--brand-500, #ff6b2c)"
          strokeWidth="3"
        />
      </g>

      <circle cx="23.5" cy="8.5" r="5.4" fill="var(--accent-500, #14b8a6)" />
    </svg>
  );

  if (!withWordmark) return mark;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size * 0.25,
      }}
    >
      {mark}
      <span
        style={{
          fontSize: size * 0.72,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        Rally
      </span>
    </span>
  );
}
