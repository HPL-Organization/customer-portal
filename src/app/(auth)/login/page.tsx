"use client";

import { Suspense, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";

export const dynamic = "force-dynamic";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Mode = "signin" | "signup";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen grid place-items-center px-4 py-12 bg-neutral-50">
          <div className="text-sm text-neutral-600">Loading…</div>
        </main>
      }
    >
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [confirmBannerEmail, setConfirmBannerEmail] = useState<string | null>(
    null
  );
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);

  async function provisionAndRedirect() {
    await supabase.auth.getSession();
    let nsId: string | null = null;
    try {
      const r = await fetch("/api/auth/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, middleName, lastName }),
      });
      const j = await r.json();
      nsId = j?.nsId ?? null;
    } catch {}
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = new URL(next, origin || "http://localhost");
    if (nsId) {
      url.searchParams.set("nsId", nsId);
      if (typeof window !== "undefined") localStorage.setItem("nsId", nsId);
    }
    router.replace(url.pathname + url.search);
  }

  async function onSignin(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setConfirmBannerEmail(null);
    setLoading(true);

    const emailClean = email.trim().toLowerCase();
    const { error } = await supabase.auth.signInWithPassword({
      email: emailClean,
      password,
    });

    setLoading(false);
    if (error) return setErrorMsg(error.message);
    await provisionAndRedirect();
  }

  async function onSignup(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setResendMsg(null);
    setLoading(true);

    const emailClean = email.trim().toLowerCase();
    const emailRedirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/callback?next=${encodeURIComponent(next)}`
        : undefined;

    const { data, error } = await supabase.auth.signUp({
      email: emailClean,
      password,
      options: {
        emailRedirectTo,
        data: {
          first_name: firstName,
          middle_name: middleName,
          last_name: lastName,
        },
      },
    });

    setLoading(false);
    if (error) return setErrorMsg(error.message);

    if (!data.session) {
      setConfirmBannerEmail(emailClean);
      setInfoMsg(null);
      return;
    }
    await provisionAndRedirect();
  }

  async function sendMagicLink() {
    setErrorMsg(null);
    setInfoMsg(null);
    setConfirmBannerEmail(null);
    setLoading(true);
    const emailClean = email.trim().toLowerCase();
    const emailRedirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/callback?next=${encodeURIComponent(next)}`
        : undefined;

    const { error } = await supabase.auth.signInWithOtp({
      email: emailClean,
      options: { emailRedirectTo },
    });

    setLoading(false);
    if (error) return setErrorMsg(error.message);
    setInfoMsg("Magic link sent. Check your inbox.");
  }

  async function resetPassword() {
    if (!email) return setErrorMsg("Enter your email first.");
    setErrorMsg(null);
    setInfoMsg(null);
    setConfirmBannerEmail(null);
    setLoading(true);

    const origin =
      typeof window !== "undefined" ? window.location.origin : undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: origin ? `${origin}/login` : undefined }
    );

    setLoading(false);
    if (error) return setErrorMsg(error.message);
    setInfoMsg("Password reset email sent.");
  }

  async function continueWithGoogle() {
    try {
      setGoogleLoading(true);
      setErrorMsg(null);
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const prefill =
        mode === "signup"
          ? btoa(JSON.stringify({ firstName, middleName, lastName }))
          : "";
      if (prefill && typeof window !== "undefined") {
        sessionStorage.setItem("name_prefill", prefill);
      }
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${origin}/callback?next=${encodeURIComponent(next)}${
            prefill ? `&prefill=${encodeURIComponent(prefill)}` : ""
          }`,
        },
      });
    } catch (e: any) {
      setErrorMsg(e?.message || "Google sign-in failed");
      setGoogleLoading(false);
    }
  }

  async function resendConfirmation() {
    if (!confirmBannerEmail) return;
    try {
      setResending(true);
      setResendMsg(null);
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: confirmBannerEmail,
      } as any);
      setResending(false);
      if (error) return setResendMsg(error.message);
      setResendMsg("Confirmation email re-sent.");
    } catch (e: any) {
      setResending(false);
      setResendMsg(e?.message || "Could not resend. Try again shortly.");
    }
  }

  function copyEmail() {
    if (!confirmBannerEmail) return;
    try {
      navigator.clipboard.writeText(confirmBannerEmail);
      setResendMsg("Email copied to clipboard.");
    } catch {}
  }

  const googleDisabled =
    googleLoading ||
    (mode === "signup" && (!firstName.trim() || !lastName.trim()));

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-[radial-gradient(1200px_600px_at_10%_-10%,#1e293b_20%,transparent_60%),radial-gradient(1200px_600px_at_110%_10%,#0f766e_10%,transparent_60%),linear-gradient(180deg,#0b0f14,60%,#0b0f14)]">
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_20%_10%,#34d399_0,transparent_25%),radial-gradient(circle_at_80%_20%,#38bdf8_0,transparent_25%),radial-gradient(circle_at_50%_80%,#a78bfa_0,transparent_25%)]" />
      <div className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 lg:grid-cols-2">
        <section className="relative hidden items-center justify-center p-8 lg:flex">
          <div className="absolute inset-0 -z-10 flex items-center justify-center opacity-15">
            <div className="relative h-80 w-80 xl:h-96 xl:w-96">
              <Image
                src="/HPL_logo.png"
                alt="Highland Park Lapidary Co."
                fill
                sizes="384px"
                className="object-contain drop-shadow-[0_0_24px_rgba(0,0,0,0.5)]"
                priority
              />
            </div>
          </div>
          <div className="max-w-lg">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs text-white/70 ring-1 ring-white/10 backdrop-blur">
              <span>Customer Portal</span>
              <span className="h-1 w-1 rounded-full bg-white/40" />
              <span>Lapidary & Rock Supply</span>
            </div>
            <h1 className="text-5xl font-semibold leading-tight text-white">
              Craft your journey in stone.
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-white/70">
              Sign in to manage orders, track fulfillment, view invoices, and
              explore exclusive events. Designed for makers, cutters, and rock
              hounds who shape the extraordinary.
            </p>
            <div className="mt-8 grid grid-cols-3 gap-3 text-center text-xs text-white/70">
              <div className="rounded-xl bg-white/5 p-4 ring-1 ring-white/10 backdrop-blur">
                <div className="text-lg font-semibold text-white">Secure</div>
                <div>Encrypted Auth</div>
              </div>
              <div className="rounded-xl bg-white/5 p-4 ring-1 ring-white/10 backdrop-blur">
                <div className="text-lg font-semibold text-white">Fast</div>
                <div>Realtime data</div>
              </div>
              <div className="rounded-xl bg-white/5 p-4 ring-1 ring-white/10 backdrop-blur">
                <div className="text-lg font-semibold text-white">Synced</div>
                <div>with Oracle</div>
              </div>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-md rounded-3xl bg-white/10 p-6 shadow-2xl ring-1 ring-white/20 backdrop-blur-md sm:p-8">
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
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
                <span className="text-sm font-medium tracking-wide text-white">
                  Portal Access
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/10 p-1 ring-1 ring-white/20">
                <button
                  onClick={() => {
                    setMode("signin");
                    setErrorMsg(null);
                    setInfoMsg(null);
                    setConfirmBannerEmail(null);
                  }}
                  className={`rounded-lg px-3 py-1 text-xs transition ${
                    mode === "signin"
                      ? "bg-white text-neutral-900"
                      : "text-white/70 hover:text-white"
                  }`}
                >
                  Sign in
                </button>
                <button
                  onClick={() => {
                    setMode("signup");
                    setErrorMsg(null);
                    setInfoMsg(null);
                    setConfirmBannerEmail(null);
                  }}
                  className={`rounded-lg px-3 py-1 text-xs transition ${
                    mode === "signup"
                      ? "bg-white text-neutral-900"
                      : "text-white/70 hover:text-white"
                  }`}
                >
                  Sign Up
                </button>
              </div>
            </div>

            {confirmBannerEmail && (
              <div className="mb-6 rounded-2xl border border-amber-300/40 bg-amber-400/15 p-4 ring-1 ring-amber-300/30">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 h-3 w-3 animate-pulse rounded-full bg-amber-300" />
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-amber-100">
                      Confirm your email to finish sign-up
                    </div>
                    <div className="mt-1 text-xs text-amber-50/90">
                      We sent a confirmation link to
                    </div>
                    <div className="mt-2 rounded-lg bg-black/20 px-2 py-1 text-xs font-mono text-amber-50">
                      {confirmBannerEmail}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        onClick={resendConfirmation}
                        disabled={resending}
                        className="rounded-lg bg-amber-200 px-3 py-2 text-xs font-medium text-neutral-900 hover:bg-amber-100 disabled:opacity-60"
                      >
                        {resending ? "Resending…" : "Resend email"}
                      </button>
                      <button
                        onClick={copyEmail}
                        className="rounded-lg border border-amber-300/50 bg-transparent px-3 py-2 text-xs font-medium text-amber-100 hover:bg-amber-300/10"
                      >
                        Copy email
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-amber-100/90">
                      <a
                        className="underline underline-offset-4 hover:text-white"
                        href="https://mail.google.com/"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open Gmail
                      </a>
                      <span>·</span>
                      <a
                        className="underline underline-offset-4 hover:text-white"
                        href="https://outlook.live.com/mail/"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open Outlook
                      </a>
                      <span>·</span>
                      <a
                        className="underline underline-offset-4 hover:text-white"
                        href="https://mail.yahoo.com/"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open Yahoo Mail
                      </a>
                    </div>
                    {resendMsg && (
                      <div className="mt-3 rounded-md border border-amber-300/40 bg-amber-300/10 px-2 py-1 text-[11px] text-amber-50">
                        {resendMsg}
                      </div>
                    )}
                    <button
                      onClick={() => setConfirmBannerEmail(null)}
                      className="mt-4 text-[11px] text-amber-200 underline underline-offset-4 hover:text-white"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            )}

            <form
              onSubmit={mode === "signin" ? onSignin : onSignup}
              className="space-y-4"
            >
              {mode === "signup" && (
                <>
                  <div>
                    <label className="mb-2 block text-xs font-medium tracking-wide text-white/80">
                      First name
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-2.5 text-white/40">
                        <svg viewBox="0 0 24 24" className="h-4 w-4">
                          <path
                            fill="currentColor"
                            d="M12 12a5 5 0 100-10 5 5 0 000 10zm-7 9a7 7 0 0114 0v1H5v-1z"
                          />
                        </svg>
                      </span>
                      <input
                        required
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className="w-full rounded-xl border border-white/20 bg-white/10 px-9 py-2 text-sm text-white placeholder-white/40 outline-none ring-0 transition focus:border-white/30 focus:bg-white/15"
                        placeholder="Jane"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-medium tracking-wide text-white/80">
                      Middle name (optional)
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-2.5 text-white/40">
                        <svg viewBox="0 0 24 24" className="h-4 w-4">
                          <path
                            fill="currentColor"
                            d="M12 12a5 5 0 100-10 5 5 0 000 10zm-7 9a7 7 0 0114 0v1H5v-1z"
                          />
                        </svg>
                      </span>
                      <input
                        value={middleName}
                        onChange={(e) => setMiddleName(e.target.value)}
                        className="w-full rounded-xl border border-white/20 bg-white/10 px-9 py-2 text-sm text-white placeholder-white/40 outline-none ring-0 transition focus:border-white/30 focus:bg-white/15"
                        placeholder="A."
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-medium tracking-wide text-white/80">
                      Last name
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-2.5 text-white/40">
                        <svg viewBox="0 0 24 24" className="h-4 w-4">
                          <path
                            fill="currentColor"
                            d="M12 12a5 5 0 100-10 5 5 0 000 10zm-7 9a7 7 0 0114 0v1H5v-1z"
                          />
                        </svg>
                      </span>
                      <input
                        required
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        className="w-full rounded-xl border border-white/20 bg-white/10 px-9 py-2 text-sm text-white placeholder-white/40 outline-none ring-0 transition focus:border-white/30 focus:bg-white/15"
                        placeholder="Doe"
                      />
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="mb-2 block text-xs font-medium tracking-wide text-white/80">
                  Email
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-2.5 text-white/40">
                    <svg viewBox="0 0 24 24" className="h-4 w-4">
                      <path
                        fill="currentColor"
                        d="M20 4H4a2 2 0 00-2 2v1l10 6 10-6V6a2 2 0 00-2-2zm0 6.5l-8 4.8-8-4.8V18a2 2 0 002 2h12a2 2 0 002-2v-7.5z"
                      />
                    </svg>
                  </span>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-white/20 bg-white/10 px-9 py-2 text-sm text-white placeholder-white/40 outline-none ring-0 transition focus:border-white/30 focus:bg-white/15"
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium tracking-wide text-white/80">
                  Password
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-2.5 text-white/40">
                    <svg viewBox="0 0 24 24" className="h-4 w-4">
                      <path
                        fill="currentColor"
                        d="M12 17a2 2 0 002-2v-2a2 2 0 00-4 0v2a2 2 0 002 2zm6-6h-1V9a5 5 0 00-10 0v2H6a2 2 0 00-2 2v7a2 2 0 002 2h12a2 2 0 002-2v-7a2 2 0 00-2-2z"
                      />
                    </svg>
                  </span>
                  <input
                    type={showPass ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-white/20 bg-white/10 px-9 py-2 pr-10 text-sm text-white placeholder-white/40 outline-none ring-0 transition focus:border-white/30 focus:bg-white/15"
                    placeholder={
                      mode === "signin"
                        ? "Your password"
                        : "Create a strong password"
                    }
                    autoComplete={
                      mode === "signin" ? "current-password" : "new-password"
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((s) => !s)}
                    className="absolute right-3 top-2.5 text-white/60 hover:text-white"
                    aria-label="Toggle password visibility"
                  >
                    {showPass ? (
                      <svg viewBox="0 0 24 24" className="h-4 w-4">
                        <path
                          fill="currentColor"
                          d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 12a5 5 0 115-5 5 5 0 01-5 5z"
                        />
                        <path
                          fill="currentColor"
                          d="M3 3l18 18-1.5 1.5L1.5 4.5 3 3z"
                        />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" className="h-4 w-4">
                        <path
                          fill="currentColor"
                          d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 12a5 5 0 115-5 5 5 0 01-5 5z"
                        />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {errorMsg && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">
                  {errorMsg}
                </div>
              )}
              {infoMsg && (
                <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-200">
                  {infoMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-neutral-900 transition hover:bg-neutral-100 disabled:opacity-60"
              >
                <span>
                  {loading
                    ? mode === "signin"
                      ? "Signing in…"
                      : "Creating…"
                    : mode === "signin"
                    ? "Sign in"
                    : "Create account"}
                </span>
                <span className="transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </button>
            </form>

            <div className="my-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-xs text-white/60">
              <div className="h-px w-full bg-white/10" />
              <span>or</span>
              <div className="h-px w-full bg-white/10" />
            </div>

            <button
              onClick={continueWithGoogle}
              disabled={googleDisabled}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white/90 px-4 py-2.5 text-sm font-medium text-neutral-900 ring-1 ring-white/30 transition hover:bg-white disabled:opacity-60"
            >
              {googleLoading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-400 border-t-neutral-900" />
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4">
                  <path
                    fill="#EA4335"
                    d="M12 11.8v3.9h6.5c-.3 1.9-2.1 5.5-6.5 5.5-3.9 0-7.1-3.2-7.1-7.1S8.1 7 12 7c2.2 0 3.7.9 4.6 1.8l3.1-3.1C18.2 3.8 15.4 2.5 12 2.5 6.8 2.5 2.5 6.8 2.5 12S6.8 21.5 12 21.5c6.9 0 9.5-4.8 9.5-7.3 0-.5 0-.9-.1-1.3H12z"
                  />
                </svg>
              )}
              <span>
                {mode === "signup"
                  ? "Continue with Google"
                  : "Sign in with Google"}
              </span>
            </button>

            <div className="mt-6 space-y-3 text-sm">
              <button
                onClick={sendMagicLink}
                disabled={loading}
                className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-white/90 transition hover:bg-white/10 disabled:opacity-60"
              >
                Email me a magic link
              </button>
              <div className="text-center text-white/70">
                Forgot your password?{" "}
                <button
                  onClick={resetPassword}
                  disabled={loading}
                  className="underline underline-offset-4 hover:text-white"
                >
                  Send reset email
                </button>
              </div>
            </div>

            <p className="mt-8 text-center text-[11px] leading-relaxed text-white/50">
              By continuing you agree to our Terms & Privacy.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
