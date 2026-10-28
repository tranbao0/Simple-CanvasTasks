/** Inline SVG icons. They draw with `currentColor` and are hidden from screen readers. */
import type { ComponentChildren } from 'preact';

function Icon({ children, size = 16 }: { children: ComponentChildren; size?: number }) {
  return (
    <svg
      class="wr-icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const ChevronLeftIcon = () => (
  <Icon>
    <path d="M10 3.5 5.5 8l4.5 4.5" />
  </Icon>
);

export const ChevronRightIcon = () => (
  <Icon>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </Icon>
);

export const ChevronDownIcon = () => (
  <Icon size={14}>
    <path d="M4 6l4 4 4-4" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);

export const GearIcon = () => (
  <Icon>
    <path d="M13.1 6.23 14.84 6.5 14.84 9.5 13.1 9.77 12.86 10.36 13.9 11.77 11.77 13.9 10.36 12.86 9.77 13.1 9.5 14.84 6.5 14.84 6.23 13.1 5.64 12.86 4.23 13.9 2.1 11.77 3.14 10.36 2.9 9.77 1.16 9.5 1.16 6.5 2.9 6.23 3.14 5.64 2.1 4.23 4.23 2.1 5.64 3.14 6.23 2.9 6.5 1.16 9.5 1.16 9.77 2.9 10.36 3.14 11.77 2.1 13.9 4.23 12.86 5.64Z" />
    <circle cx="8" cy="8" r="2.1" />
  </Icon>
);

export const TodayIcon = () => (
  <Icon>
    <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
    <path d="M2.5 6.5h11M5.5 2v2.5M10.5 2v2.5" />
    <circle cx="8" cy="10" r="1.2" fill="currentColor" stroke="none" />
  </Icon>
);

export const CheckIcon = ({ size = 16 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke-width="2" />
  </Icon>
);

export const LockIcon = () => (
  <Icon size={12}>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </Icon>
);

export const ClockIcon = () => (
  <Icon size={12}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M8 5v3.25l2 1.25" />
  </Icon>
);

export const InfoIcon = ({ size = 14 }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.25V11" />
    <circle cx="8" cy="5" r=".6" fill="currentColor" />
  </Icon>
);

export const AlertIcon = () => (
  <Icon size={12}>
    <path d="M8 2.5 14 13H2Z" />
    <path d="M8 6.5v3" />
    <circle cx="8" cy="11.2" r=".5" fill="currentColor" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
);

/**
 * The app mark: a progress ring over a row of seven days, with today in white.
 * Below 28 px the day row cannot resolve, so the mark shows the ring alone.
 */
export function AppMark({ size = 32 }: { size?: number }) {
  if (size < 28) {
    return (
      <svg
        class="wr-mark"
        width={size}
        height={size}
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <rect width="16" height="16" rx="4" fill="#2948c9" />
        <circle
          cx="8"
          cy="8"
          r="4.25"
          fill="none"
          stroke="#fff"
          stroke-opacity=".35"
          stroke-width="2.25"
        />
        <path
          d="M8 3.75a4.25 4.25 0 1 1-4.04 2.94"
          fill="none"
          stroke="#fff"
          stroke-width="2.25"
          stroke-linecap="round"
        />
      </svg>
    );
  }
  return (
    <svg
      class="wr-mark"
      width={size}
      height={size}
      viewBox="8 8 112 112"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="8" y="8" width="112" height="112" rx="26" fill="#2948c9" />
      <circle
        cx="64"
        cy="55"
        r="24"
        fill="none"
        stroke="#fff"
        stroke-opacity=".3"
        stroke-width="11"
      />
      <path
        d="M64 31a24 24 0 1 1-22.83 16.58"
        fill="none"
        stroke="#fff"
        stroke-width="11"
        stroke-linecap="round"
      />
      <g fill="#fff">
        {[28, 40, 52, 64, 76, 88, 100].map((x) => (
          <circle
            key={x}
            cx={x}
            cy="98"
            r={x === 64 ? 5.75 : 4.25}
            fill-opacity={x < 64 ? 0.8 : x > 64 ? 0.4 : 1}
          />
        ))}
      </g>
    </svg>
  );
}
