import type { SVGProps } from "react";

/**
 * A tiny icon set (decorative: always paired with text). Status icons differ in SHAPE, not only colour,
 * so meaning never depends on colour alone.
 */
type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function Base({ size = 20, ...props }: IconProps & { children?: never }, path: React.ReactNode) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {path}
    </svg>
  );
}

export const CheckCircleIcon = (p: IconProps) =>
  Base(
    p,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 2.7 2.7L16 9.5" />
    </>,
  );
export const WarningIcon = (p: IconProps) =>
  Base(
    p,
    <>
      <path d="M12 3.5 2.5 20h19L12 3.5Z" />
      <path d="M12 10v4.5M12 17.5h.01" />
    </>,
  );
export const XCircleIcon = (p: IconProps) =>
  Base(
    p,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </>,
  );
export const InfoIcon = (p: IconProps) =>
  Base(
    p,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.5h.01" />
    </>,
  );
export const DotIcon = (p: IconProps) =>
  Base(p, <circle cx="12" cy="12" r="4" fill="currentColor" />);
export const CloseIcon = (p: IconProps) => Base(p, <path d="m6 6 12 12M18 6 6 18" />);
export const ChevronDownIcon = (p: IconProps) => Base(p, <path d="m6 9 6 6 6-6" />);
export const SearchIcon = (p: IconProps) =>
  Base(
    p,
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>,
  );
export const ExternalIcon = (p: IconProps) =>
  Base(p, <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />);
export const StarIcon = (p: IconProps) =>
  Base(
    p,
    <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8L3.5 9.7l5.9-.9L12 3.5Z" />,
  );
export const CheckIcon = (p: IconProps) => Base(p, <path d="m5 12.5 4.5 4.5L19 7.5" />);
