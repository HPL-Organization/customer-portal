"use client";

import { Menu, X, LogOut } from "lucide-react";
import { NAV_ITEMS } from "@/lib/constants/nav";
import NavItem from "@/components/nav/NavItem";
import { useState } from "react";

export default function AppSidebar() {
  const [open, setOpen] = useState(false);

  async function handleLogout() {
    try {
      await fetch("/api/auth/sign-out", { method: "POST" });
    } catch (_) {
    } finally {
      const u = new URL(window.location.href);
      window.location.href = `/login?next=${encodeURIComponent(
        u.pathname + u.search
      )}`;
    }
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen flex-col border-r bg-white p-4 md:flex">
        <div className="flex items-center gap-4 px-2">
          <img
            src="/HPL_logo.png"
            alt="HPL logo"
            className="h-12 w-12 rounded-full object-contain ring-2 ring-slate-200 shadow"
          />
          <h1 className="text-xl font-extrabold leading-tight tracking-tight">
            Customer Portal
          </h1>
        </div>

        <nav className="mt-7 flex-1">
          <ul className="space-y-1">
            {NAV_ITEMS.map((it) => (
              <NavItem
                key={it.href}
                href={it.href}
                label={it.label}
                icon={it.icon}
              />
            ))}
          </ul>
        </nav>

        {/* Support + Logout */}
        <div className="mt-auto space-y-3">
          <div className="rounded-xl border p-3 text-xs text-slate-500">
            Need help?{" "}
            <a
              href={`mailto:${
                process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@example.com"
              }`}
              className="text-sky-600 underline"
            >
              Contact support
            </a>
          </div>

          <button
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium hover:bg-slate-50"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      </aside>

      {/* Mobile top bar + drawer */}
      <div className="md:hidden">
        <div className="sticky top-0 z-40 flex items-center gap-2 border-b bg-white p-3">
          <button
            aria-label="Open navigation"
            className="rounded-lg p-2 hover:bg-slate-100"
            onClick={() => setOpen(true)}
          >
            <Menu className="h-6 w-6" />
          </button>
          <div className="flex items-center gap-3">
            <img
              src="/HPL_logo.png"
              alt="HPL logo"
              className="h-8 w-8 rounded-full object-contain ring-2 ring-slate-200 shadow"
            />
            <span className="font-semibold">Customer Portal</span>
          </div>
        </div>

        <div
          className={`fixed inset-0 z-40 bg-black/30 transition-opacity ${
            open ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          onClick={() => setOpen(false)}
        />

        <aside
          className={`fixed inset-y-0 left-0 z-50 w-72 transform bg-white p-4 shadow-md transition-transform ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
          aria-label="Primary"
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img
                src="/HPL_logo.png"
                alt="HPL logo"
                className="h-8 w-8 rounded-full object-contain ring-2 ring-slate-200 shadow"
              />
              <span className="font-semibold">Navigation</span>
            </div>
            <button
              aria-label="Close navigation"
              className="rounded-lg p-2 hover:bg-slate-100"
              onClick={() => setOpen(false)}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <ul className="space-y-1">
            {NAV_ITEMS.map((it) => (
              <NavItem
                key={it.href}
                href={it.href}
                label={it.label}
                icon={it.icon}
                onClick={() => setOpen(false)}
              />
            ))}
          </ul>

          <div className="mt-6 border-t pt-4">
            <button
              onClick={() => {
                setOpen(false);
                handleLogout();
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium hover:bg-slate-50"
            >
              <LogOut className="h-4 w-4" />
              Log out
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}
