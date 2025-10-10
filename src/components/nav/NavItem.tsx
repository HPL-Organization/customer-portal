// NavItem.tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clsx } from "clsx";
import { startTransition } from "react";
import type { ComponentType } from "react";

export default function NavItem({
  href,
  label,
  icon: Icon,
  onClick,
  prefetch = true,
}: {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  onClick?: () => void;
  prefetch?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const active = pathname === href || pathname.startsWith(href + "/");

  return (
    <li>
      <Link
        href={href}
        prefetch={prefetch}
        onMouseEnter={() => router.prefetch(href)}
        onClick={() => {
          if (onClick) startTransition(() => onClick());
        }}
        aria-current={active ? "page" : undefined}
        className={clsx(
          "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition",
          active
            ? "bg-sky-50 text-sky-700 ring-1 ring-sky-200"
            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
        )}
      >
        <Icon
          className={clsx(
            "h-5 w-5 flex-none",
            active
              ? "text-sky-600"
              : "text-slate-400 group-hover:text-slate-600"
          )}
        />
        <span className="truncate">{label}</span>
      </Link>
    </li>
  );
}
