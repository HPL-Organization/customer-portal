import * as React from "react";
import { clsx } from "clsx";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

export default function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center rounded-xl font-medium transition-colors select-none shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8C0F0F]/30 disabled:cursor-not-allowed";
  const sizes = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2 text-sm",
    lg: "px-5 py-3 text-base",
  } as const;
  const variants = {
    primary:
      "bg-[#8C0F0F] text-white hover:bg-[#E01C24] disabled:bg-[#8C0F0F]/40",
    outline:
      "border border-[#BFBFBF] text-[#17152A] hover:bg-[#FFFFEC] disabled:text-[#17152A]/40 disabled:border-[#BFBFBF]/60",
    ghost: "text-[#17152A] hover:bg-black/5 disabled:text-[#17152A]/40",
  } as const;

  return (
    <button
      className={clsx(base, sizes[size], variants[variant], className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && (
        <svg
          className="mr-2 h-4 w-4 animate-spin"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
            fill="none"
          />
          <path
            className="opacity-75"
            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            fill="currentColor"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
