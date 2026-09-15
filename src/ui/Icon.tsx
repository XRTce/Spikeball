import type { SVGProps } from 'react';

/**
 * One stroke-based icon set on a 24x24 grid, drawn with a uniform 1.75 stroke
 * and round caps. Everything in the app pulls from here so weight and optical
 * size stay consistent; no icon font, no runtime fetch.
 */
const paths = {
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  chevronLeft: <path d="m15 5-7 7 7 7" />,
  chevronRight: <path d="m9 5 7 7-7 7" />,
  chevronDown: <path d="m5 9 7 7 7-7" />,
  chevronUp: <path d="m5 15 7-7 7 7" />,
  arrowLeft: <path d="M19 12H5m6-6-6 6 6 6" />,
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  arrowDown: <path d="M12 5v14M6 13l6 6 6-6" />,
  arrowRight: <path d="M5 12h14m-6-6 6 6-6 6" />,
  trophy: (
    <>
      <path d="M7 4h10v6a5 5 0 0 1-10 0V4Z" />
      <path d="M7 6H4v1.6A4.4 4.4 0 0 0 7.6 12M17 6h3v1.6A4.4 4.4 0 0 1 16.4 12" />
      <path d="M12 15v3M8 21h8l-.9-3H8.9L8 21Z" />
    </>
  ),
  medal: (
    <>
      <circle cx="12" cy="15" r="5.5" />
      <path d="M8.3 10.4 6.5 3.5h4l1.4 3.3M15.7 10.4l1.8-6.9h-4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.3" />
      <path d="M2.8 20a6.2 6.2 0 0 1 12.4 0" />
      <path d="M16.2 5.1a3.3 3.3 0 0 1 0 5.8M17.6 14.4A6.2 6.2 0 0 1 21.2 20" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  userPlus: (
    <>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.6 20a6.4 6.4 0 0 1 12.8 0" />
      <path d="M19 8.4v5.2M16.4 11h5.2" />
    </>
  ),
  play: <path d="M8 5.4v13.2L19 12 8 5.4Z" />,
  bracket: (
    <path d="M3 5h4M3 11h4M7 5v6M7 8h4M3 13h4M3 19h4M7 13v6M7 16h4M11 8v8M11 12h6" />
  ),
  list: <path d="M4 7h16M4 12h16M4 17h10" />,
  shuffle: (
    <>
      <path d="M4 7h2.6c4 0 5.6 10 9.6 10H20M4 17h2.6c1.7 0 3-1.7 4.1-3.8M13.4 10.1c1.1-2 2.4-3.1 4-3.1H20" />
      <path d="m17.4 4 3 3-3 3M17.4 14l3 3-3 3" />
    </>
  ),
  chart: (
    <>
      <path d="M4 4v16h16" />
      <path d="m7.5 15 3.6-4.4 3 2.6L19 7.5" />
    </>
  ),
  activity: <path d="M3 12h4l3-7.5 4 15 3-7.5h4" />,
  flag: <path d="M6 21V4m0 1h11l-2.2 3.6L17 12H6" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  bolt: <path d="M13.2 3 5.6 13.8h5.6l-.4 7.2 7.6-10.8h-5.6l.4-7.2Z" />,
  download: <path d="M12 4v11m-4.5-3.5L12 16l4.5-4.5M5 19.5h14" />,
  upload: <path d="M12 20V9m-4.5 3.5L12 8l4.5 4.5M5 4.5h14" />,
  share: (
    <path d="M12 3.5v11m-4-7 4-4 4 4M5.5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-6.5" />
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.4" />
      <circle cx="9" cy="9.8" r="1.6" />
      <path d="m4.5 17.5 4.6-4.6 3.4 3.4 2.6-2.4 4.4 4" />
    </>
  ),
  pencil: <path d="M4 20h4L20 8a2.83 2.83 0 0 0-4-4L4 16v4Zm10.5-15.5 4 4" />,
  trash: (
    <path d="M4 7h16M9.5 7V4.8h5V7M6.6 7l.9 12.2A1.9 1.9 0 0 0 9.4 21h5.2a1.9 1.9 0 0 0 1.9-1.8L17.4 7M10.4 11v6M13.6 11v6" />
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2.4" />
      <path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h9M17.5 7H20M4 17h3.5M12 17h8" />
      <circle cx="15" cy="7" r="2.5" />
      <circle cx="9.5" cy="17" r="2.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.6" />
      <path d="m15.9 15.9 4.6 4.6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.8" />
      <path d="M12 11.2V16" />
      <circle cx="12" cy="8.2" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.6 21.4 20H2.6L12 3.6Z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.8" />
      <path d="M12 7v5.2l3.2 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.4" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  home: (
    <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19v-8.5ZM9.5 20.5V14h5v6.5" />
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6 17 17M7 7 5.4 5.4" />
    </>
  ),
  moon: <path d="M20.2 14.6A8.6 8.6 0 0 1 9.4 3.8a8.6 8.6 0 1 0 10.8 10.8Z" />,
  more: (
    <>
      <circle cx="12" cy="5.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18.5" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  undo: <path d="M4 9h11.5a5 5 0 0 1 0 10H9M8 5 4 9l4 4" />,
  refresh: <path d="M19.6 12a7.6 7.6 0 1 1-2.3-5.4M18 2.8v4.2h-4.2" />,
  shield: (
    <path d="M12 3.2 19.4 6v6c0 4.6-3.1 8.4-7.4 9.7C7.7 20.4 4.6 16.6 4.6 12V6L12 3.2Z" />
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3" />
    </>
  ),
  star: (
    <path d="m12 3.6 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.8l5.9-.8L12 3.6Z" />
  ),
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="8.8" />
      <path d="m8 12.3 2.7 2.7 5.3-5.8" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="8.8" />
      <path d="m6 18 12-12" />
    </>
  ),
  swap: <path d="M7 4v14m0 0-3-3m3 3 3-3M17 20V6m0 0-3 3m3-3 3 3" />,
  whistle: (
    <>
      <circle cx="8.5" cy="14" r="5.5" />
      <path d="M13.4 11.5 21 8.8V5.6l-9.5 3.2" />
    </>
  ),
} as const;

export type IconName = keyof typeof paths;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** Rendered size in px. Defaults to 22 which matches the body line-box. */
  size?: number;
  /** Adds an accessible name; without it the icon is hidden from AT. */
  label?: string;
}

export function Icon({ name, size = 22, label, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
