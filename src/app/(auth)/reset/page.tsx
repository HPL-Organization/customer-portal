"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createBrowserClient } from "@supabase/ssr";

export const dynamic = "force-dynamic";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function ResetPasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const sub = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setHasSession(true);
        setChecking(false);
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
      setChecking(false);
    });
    return () => {
      sub.data.subscription.unsubscribe();
    };
  }, []);

  const disabled = useMemo(() => {
    if (loading) return true;
    if (password.length < 6) return true;
    if (!/[^A-Za-z0-9]/.test(password)) return true;
    if (password !== confirm) return true;
    return false;
  }, [loading, password, confirm]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (password.length < 6)
      return setErrorMsg("Password must be at least 6 characters.");
    if (!/[^A-Za-z0-9]/.test(password))
      return setErrorMsg("Include at least one special character.");
    if (password !== confirm) return setErrorMsg("Passwords do not match.");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    router.replace("/login?reset=success");
  }

  if (checking) {
    return (
      <main className="min-h-screen grid place-items-center px-4 py-12 bg-neutral-50">
        <div className="text-sm text-neutral-600">
          Preparing your reset session…
        </div>
      </main>
    );
  }

  if (!hasSession) {
    return (
      <main className="min-h-screen grid place-items-center px-4 py-12 bg-[#FFFEF4]">
        <div className="w-full max-w-md rounded-3xl bg-white/98 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.18)] ring-1 ring-slate-200">
          <div className="mb-4 flex items-center gap-3">
            <div className="relative h-8 w-8">
              <Image
                src="/HPL_logo.png"
                alt="HPL Logo"
                fill
                sizes="32px"
                className="object-contain"
                priority
              />
            </div>
            <span className="text-sm font-medium tracking-wide text-slate-800">
              Reset Password
            </span>
          </div>
          <div className="rounded-2xl border border-amber-300/70 bg-amber-50 p-4 text-sm text-amber-900">
            Your reset link is invalid or has expired. Please request a new
            password reset from the login page.
          </div>
          <button
            onClick={() => router.replace("/login")}
            className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-black"
          >
            Back to login
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-[#FFFEF4]">
      <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:repeating-linear-gradient(0deg,rgba(197,170,107,0.45)_0,rgba(197,170,107,0.45)_1px,transparent_1px,transparent_22px),repeating-linear-gradient(90deg,rgba(197,170,107,0.28)_0,rgba(197,170,107,0.28)_1px,transparent_1px,transparent_22px)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_600px_at_-10%_0%,rgba(224,28,36,0.18),transparent_60%),radial-gradient(780px_520px_at_110%_10%,rgba(140,15,15,0.12),transparent_62%),radial-gradient(700px_540px_at_30%_100%,rgba(224,28,36,0.10),transparent_65%),radial-gradient(620px_420px_at_85%_55%,rgba(191,191,191,0.20),transparent_65%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-[-20%] h-[60%] bg-[radial-gradient(60%_60%_at_50%_100%,rgba(224,28,36,0.10),transparent_70%)]" />
      <div className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 lg:grid-cols-2 gap-8 px-4 sm:px-6">
        <section className="relative hidden items-center p-6 lg:flex">
          <div className="absolute -left-8 top-12 -z-10 h-44 w-44 rounded-full bg-[#E01C24]/20 blur-2xl" />
          <div className="max-w-xl">
            <h1 className="text-4xl sm:text-5xl font-semibold leading-tight text-slate-900">
              Reset your password
            </h1>
            <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-slate-800">
              <p>
                Enter a new password for your account. For security, choose at
                least 6 characters and include one special character.
              </p>
            </div>
          </div>
        </section>
        <section className="relative flex items-center justify-center py-10">
          <div className="pointer-events-none absolute -z-10 inset-0 bg-[radial-gradient(650px_380px_at_60%_40%,rgba(191,191,191,0.35),transparent_60%)]" />
          <form
            onSubmit={onSubmit}
            className="w-full max-w-md rounded-3xl bg-white/98 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.18)] ring-1 ring-slate-200 sm:p-8 space-y-4"
          >
            <div className="mb-2 flex items-center gap-3">
              <div className="relative h-8 w-8">
                <Image
                  src="/HPL_logo.png"
                  alt="HPL Logo"
                  fill
                  sizes="32px"
                  className="object-contain"
                  priority
                />
              </div>
              <span className="text-sm font-medium tracking-wide text-slate-800">
                Set new password
              </span>
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium tracking-wide text-slate-700">
                New password
              </label>
              <input
                type="password"
                required
                minLength={6}
                pattern=".*[^A-Za-z0-9].*"
                title="Must include at least one special character"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-slate-400"
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium tracking-wide text-slate-700">
                Confirm password
              </label>
              <input
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-slate-400"
                autoComplete="new-password"
              />
            </div>
            {errorMsg && (
              <div className="rounded-xl border border-red-500/30 bg-red-50 px-4 py-2 text-sm text-red-700">
                {errorMsg}
              </div>
            )}
            <button
              type="submit"
              disabled={disabled}
              className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-black disabled:opacity-60"
            >
              {loading ? "Updating…" : "Update password"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
