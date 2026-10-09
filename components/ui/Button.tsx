import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";

type Variant = "lime" | "ink" | "outline" | "ghost" | "onDark";

const base =
  "group inline-flex items-center justify-center gap-2.5 rounded-[7px] text-[15px] font-medium " +
  "transition-colors duration-200 select-none whitespace-nowrap";

const variants: Record<Variant, string> = {
  lime: "bg-lime text-ink hover:bg-lime-deep",
  ink: "bg-ink text-bone hover:bg-ink-soft",
  outline: "border border-line bg-surface text-ink hover:border-ink hover:bg-elevated",
  ghost: "border border-transparent text-ink hover:border-line",
  onDark: "bg-elevated text-ink hover:bg-bone",
};

const sizes = {
  md: "h-[58px] px-6",
  sm: "h-[52px] px-[32px] text-[15px]",
  lg: "h-[62px] px-7 text-[16px]",
} as const;

export function ActionLink({
  href,
  children,
  variant = "ink",
  size = "md",
  arrow = false,
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: Variant;
  size?: keyof typeof sizes;
  arrow?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {children}
      {arrow ? (
        <ArrowRight
          aria-hidden="true"
          strokeWidth={1.75}
          className="size-[18px] transition-transform duration-200 group-hover:translate-x-0.5"
        />
      ) : null}
    </Link>
  );
}

export function ActionButton({
  children,
  variant = "ink",
  size = "md",
  arrow = false,
  className = "",
}: {
  children: ReactNode;
  variant?: Variant;
  size?: keyof typeof sizes;
  arrow?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {children}
      {arrow ? (
        <ArrowRight
          aria-hidden="true"
          strokeWidth={1.75}
          className="size-[18px] transition-transform duration-200 group-hover:translate-x-0.5"
        />
      ) : null}
    </button>
  );
}