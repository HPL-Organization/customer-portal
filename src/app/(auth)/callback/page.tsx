"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

export const dynamic = "force-dynamic";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function CallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen grid place-items-center bg-gradient-to-br from-sky-50 via-white to-emerald-50">
          <div className="flex items-center gap-3 text-sm text-neutral-600">
            <Spinner />
            Finishing sign-in…
          </div>
        </div>
      }
    >
      <Inner />
    </Suspense>
  );
}

type Phase = "checking" | "found" | "welcome" | "redirecting" | "error";

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/";
  const prefillParam = sp.get("prefill") || "";
  const [phase, setPhase] = useState<Phase>("checking");
  const [detail, setDetail] = useState<string>(
    "Searching to see if you exist in our records…"
  );

  const headline = useMemo(() => {
    switch (phase) {
      case "checking":
        return "Hang tight…";
      case "found":
        return "Found you!";
      case "welcome":
        return "Welcome to the HPL community!";
      case "redirecting":
        return "All set";
      case "error":
        return "Something went wrong";
    }
  }, [phase]);

  useEffect(() => {
    (async () => {
      try {
        await supabase.auth.getSession();

        let names = { firstName: "", middleName: "", lastName: "" };
        const raw =
          prefillParam ||
          (typeof window !== "undefined"
            ? sessionStorage.getItem("name_prefill") || ""
            : "");
        if (raw) {
          try {
            const d = JSON.parse(atob(raw));
            names = {
              firstName: (d.firstName || "").toString(),
              middleName: (d.middleName || "").toString(),
              lastName: (d.lastName || "").toString(),
            };
          } catch {}
        }

        setPhase("checking");
        setDetail("Searching to see if you exist in our records…");
        await sleep(450);

        const r = await fetch("/api/auth/provision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(names),
        });
        const j: any = await r.json().catch(() => ({}));

        if (typeof window !== "undefined")
          sessionStorage.removeItem("name_prefill");

        if (j?.error) {
          setPhase("error");
          setDetail(
            j?.step === "netsuite"
              ? "We couldn't create your NetSuite record. Please try again or contact support."
              : "We couldn't finish linking your account. Please try again."
          );
          return;
        }

        const nsId: string | null = j?.nsId ?? null;
        const mode: string | null = j?.mode ?? null;

        if (mode === "existing" || mode === "claimed") {
          setPhase("found");
          setDetail("Found! Welcome back.");
        } else if (mode === "created") {
          setPhase("welcome");
          setDetail("Glad you joined. Setting things up…");
        } else {
          if (nsId) {
            setPhase("found");
            setDetail("Found! Welcome back.");
          } else {
            setPhase("welcome");
            setDetail("Glad you joined. Creating your account…");
          }
        }

        await sleep(600);

        const url = new URL(next, window.location.origin);
        if (nsId) {
          url.searchParams.set("nsId", nsId);
          if (typeof window !== "undefined") localStorage.setItem("nsId", nsId);
        }

        setPhase("redirecting");
        setDetail("Taking you to your portal…");
        await sleep(400);

        router.replace(url.pathname + url.search);
      } catch (e: any) {
        setPhase("error");
        setDetail(e?.message || "Please try signing in again.");
      }
    })();
  }, [router, next, prefillParam]);

  return (
    <main className="min-h-screen grid place-items-center bg-gradient-to-br from-sky-50 via-white to-emerald-50 px-6 py-16">
      <div className="w-full max-w-lg rounded-3xl border bg-white/80 backdrop-blur p-8 shadow-xl ring-1 ring-black/5">
        <div className="flex items-center gap-4">
          <StatusIcon phase={phase} />
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-black">
              {headline}
            </h1>
            <p className="mt-1 text-sm text-neutral-600">{detail}</p>
          </div>
        </div>

        <div className="mt-6">
          <Progress phase={phase} />
        </div>

        <div className="mt-8 grid grid-cols-3 gap-3 text-xs text-neutral-600">
          <StepCard
            active={
              phase === "checking" ||
              phase === "found" ||
              phase === "welcome" ||
              phase === "redirecting"
            }
            label="Check records"
          />
          <StepCard
            active={
              phase === "found" ||
              phase === "welcome" ||
              phase === "redirecting"
            }
            label="Link your account"
          />
          <StepCard active={phase === "redirecting"} label="Redirect" />
        </div>
      </div>
    </main>
  );
}

function Spinner() {
  return (
    <div className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600" />
  );
}

function StatusIcon({ phase }: { phase: Phase }) {
  if (phase === "error") {
    return (
      <div className="grid h-10 w-10 place-items-center rounded-full bg-red-50 ring-1 ring-red-200">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          className="fill-red-600"
        >
          <path d="M11 7h2v6h-2zM11 15h2v2h-2z" />
          <path d="M12 2 1 21h22L12 2z" />
        </svg>
      </div>
    );
  }
  if (phase === "found" || phase === "welcome" || phase === "redirecting") {
    return (
      <div className="grid h-10 w-10 place-items-center rounded-full bg-emerald-50 ring-1 ring-emerald-200">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          className="fill-emerald-600"
        >
          <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
        </svg>
      </div>
    );
  }
  return (
    <div className="grid h-10 w-10 place-items-center rounded-full bg-sky-50 ring-1 ring-sky-200">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-sky-300 border-t-sky-600" />
    </div>
  );
}

function Progress({ phase }: { phase: Phase }) {
  const pct =
    phase === "checking"
      ? 20
      : phase === "found" || phase === "welcome"
      ? 70
      : phase === "redirecting"
      ? 100
      : 0;

  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100 ring-1 ring-black/5">
      <div
        className="h-full animate-[progress_1.2s_ease-in-out] rounded-full bg-gradient-to-r from-sky-500 to-emerald-500"
        style={{ width: `${pct}%` }}
      />
      <style jsx>{`
        @keyframes progress {
          from {
            width: 8%;
          }
          to {
            width: ${pct}%;
          }
        }
      `}</style>
    </div>
  );
}

function StepCard({ active, label }: { active: boolean; label: string }) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        active ? "bg-white shadow-sm" : "bg-neutral-50 opacity-70"
      }`}
    >
      <div className="flex items-center gap-2">
        <div
          className={`h-2 w-2 rounded-full ${
            active ? "bg-emerald-500" : "bg-neutral-300"
          }`}
        />
        <span>{label}</span>
      </div>
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
