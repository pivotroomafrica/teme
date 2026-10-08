import type { SVGProps } from "react";
import type { StampIcon as Icon } from "@/lib/api/contract";

/** The five stamp symbols a program can choose. Simple outlines, drawn here so no icon files are needed. */
const PATHS: Record<Icon, React.ReactNode> = {
  coffee: (
    <>
      <path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9Z" />
      <path d="M16 11h2a2 2 0 0 1 0 4h-2" />
      <path d="M8 4v2M12 4v2" />
    </>
  ),
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" />,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  gift: (
    <>
      <path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13" />
      <path d="M12 7c-2-3-5-3-5-1s3 1 5 1c2 0 5 1 5-1s-3-2-5 1Z" />
    </>
  ),
};

export function StampIcon({
  icon,
  size = 22,
  ...props
}: { icon: string; size?: number } & Omit<SVGProps<SVGSVGElement>, "children">) {
  const known = (icon in PATHS ? icon : "check") as Icon;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {PATHS[known]}
    </svg>
  );
}
