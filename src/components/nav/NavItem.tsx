// NavItem.tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clsx } from "clsx";
import { startTransition, type ComponentType } from "react";
import { motion } from "framer-motion";

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
      <motion.div
        whileHover={{ x: 2 }}
        whileTap={{ scale: 0.98 }}
        className="relative"
      >
        <Link
          href={href}
          prefetch={prefetch}
          onMouseEnter={() => router.prefetch(href)}
          onClick={() => {
            if (onClick) startTransition(() => onClick());
          }}
          aria-current={active ? "page" : undefined}
          className={clsx(
            "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-semibold outline-none transition",
            active
              ? "text-neutral-900"
              : "text-[#17152A]/80 hover:text-neutral-900 focus-visible:text-neutral-900"
          )}
        >
          <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-white/15" />
          <span
            className={clsx(
              "pointer-events-none absolute inset-0 rounded-xl transition-opacity duration-200",
              active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            )}
            style={{
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.08) 100%)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.45), 0 6px 16px -8px rgba(0,0,0,0.45)",
            }}
          />
          <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
            <span className="absolute -left-10 top-0 h-full w-10 -skew-x-[12deg] bg-white/18 opacity-0 transition-all duration-600 group-hover:left-[110%] group-hover:opacity-100" />
          </span>

          <span
            className={clsx(
              "absolute left-0 top-1/2 -translate-y-1/2 rounded-full transition-all",
              active
                ? "h-7 w-[3px] bg-[#8C0F0F] opacity-100"
                : "h-0 w-[3px] bg-[#8C0F0F] opacity-0 group-hover:h-5 group-hover:opacity-80"
            )}
            aria-hidden="true"
          />

          <span
            className={clsx(
              "relative z-[1] flex h-8 w-8 flex-none items-center justify-center rounded-lg transition-all ring-1",
              active
                ? "bg-white/60 ring-black/10 shadow-sm"
                : "bg-white/30 ring-white/20 shadow-sm group-hover:bg-white/50 group-hover:ring-black/10"
            )}
          >
            <Icon
              className={clsx(
                "h-[18px] w-[18px] transition-transform",
                active
                  ? "text-neutral-900"
                  : "text-[#17152A]/70 group-hover:text-neutral-900",
                "group-hover:translate-x-[1px]"
              )}
            />
          </span>

          <span
            className={clsx(
              "relative z-[1] truncate",
              active ? "font-extrabold" : "font-semibold"
            )}
          >
            {label}
          </span>

          <span
            className={clsx(
              "relative z-[1] ml-auto h-2 w-2 rounded-full transition-opacity",
              active
                ? "opacity-90 bg-[#8C0F0F]"
                : "opacity-0 group-hover:opacity-60 bg-[#8C0F0F]"
            )}
            aria-hidden="true"
          />
        </Link>
      </motion.div>
    </li>
  );
}
