"use client";

import { Suspense, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter, useSearchParams } from "next/navigation";
import PrivacyTermsModal from "@/components/UI/PrivacyTermsModal";
import Image from "next/image";

export const dynamic = "force-dynamic";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Mode = "signin" | "signup" | "admin";

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
  const maintParam = sp.get("maintenance") === "1";
  const maintOn =
    maintParam ||
    (process.env.NEXT_PUBLIC_MAINTENANCE_ON || "").toLowerCase() === "true";

  const [mode, setMode] = useState<Mode>("signin");
  const [showAdminForMaint, setShowAdminForMaint] = useState(false);

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

  const [adminTargetNsId, setAdminTargetNsId] = useState("");

  const [nameWarned, setNameWarned] = useState(false);
  const [nameLookupKey, setNameLookupKey] = useState<string | null>(null);
  const [nameLookupInFlight, setNameLookupInFlight] = useState(false);

  const [showPolicies, setShowPolicies] = useState(false);
  const [policiesTab, setPoliciesTab] = useState<
    "summary" | "privacy" | "terms" | "accessibility"
  >("summary");

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

  async function checkNameOnce() {
    if (mode !== "signup") return;
    const fn = firstName.trim();
    const ln = lastName.trim();
    if (!fn || !ln) return;
    const key = `${fn}|${ln}`;
    if (nameLookupKey === key || nameLookupInFlight) return;
    setNameLookupInFlight(true);
    try {
      const r = await fetch("/api/auth/lookup-by-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: fn, lastName: ln }),
      });
      const j = await r.json().catch(() => null);
      setNameLookupKey(key);
      if (j?.ok && j.exists) {
        setInfoMsg(
          `You might already have an account. You can log in using ${j.masked}. If this isn’t you, you can continue to create a new account.`
        );
        setNameWarned(true);
      } else {
        if (nameWarned) setNameWarned(false);
      }
    } catch {
      // ignore soft failures
    } finally {
      setNameLookupInFlight(false);
    }
  }

  async function onSignup(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setResendMsg(null);
    setLoading(true);

    if (password.length < 6) {
      setLoading(false);
      setErrorMsg("Password must be at least 6 characters.");
      return;
    }
    if (!hasSpecialChar(password)) {
      setLoading(false);
      setErrorMsg("Password must include at least one special character.");
      return;
    }

    try {
      const fn = firstName.trim();
      const ln = lastName.trim();
      if (fn && ln && !nameWarned) {
        const r = await fetch("/api/admin/lookup-by-name", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ firstName: fn, lastName: ln }),
        });
        const j = await r.json().catch(() => null);
        if (j?.ok && j.exists) {
          setLoading(false);
          setInfoMsg(
            `You seem to already have an account. You can log in using ${j.masked}. If this isn’t you, submit again to continue creating a new account.`
          );
          setNameWarned(true);
          return;
        }
      }
    } catch {}

    const emailClean = email.trim().toLowerCase();

    try {
      const r = await fetch("/api/auth/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailClean }),
      });
      const j = await r.json().catch(() => null);

      if (j?.ok && j.exists) {
        setLoading(false);

        if (j.confirmed) {
          setMode("signin");
          setEmail(emailClean);
          setErrorMsg(
            `That email is already in use. Please sign in, or use "Send reset email" if you forgot your password.`
          );
        } else {
          setConfirmBannerEmail(emailClean);
          setInfoMsg(
            "You started signing up earlier. Please confirm your email to finish. You can resend the confirmation below."
          );
        }
        return;
      }
    } catch {}

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

    if (error) {
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("already registered")) {
        setMode("signin");
        setEmail(emailClean);
        setLoading(false);
        setErrorMsg(
          `That email (${emailClean}) is already in use. Please sign in below, or use "Send reset email" if you forgot your password.`
        );
        return;
      }
      setLoading(false);
      setErrorMsg(error.message);
      return;
    }

    setLoading(false);

    if (!data.session) {
      setConfirmBannerEmail(emailClean);
      setInfoMsg(null);
      setNameWarned(false);
      return;
    }

    setNameWarned(false);
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
      { redirectTo: origin ? `${origin}/reset` : undefined }
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
  function hasSpecialChar(s: string) {
    return /[^A-Za-z0-9]/.test(s);
  }

  async function onAdminLogin(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    if (!adminTargetNsId.trim()) {
      setErrorMsg("Enter a NetSuite Customer ID.");
      return;
    }
    setLoading(true);
    try {
      const r = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          nsId: adminTargetNsId.trim(),
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || "Unauthorized");
      }
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const url = new URL(next, origin || "http://localhost");
      url.searchParams.set("nsId", adminTargetNsId.trim());
      if (typeof window !== "undefined")
        localStorage.setItem("nsId", adminTargetNsId.trim());
      window.location.replace(url.pathname + url.search);
    } catch (err: any) {
      setErrorMsg(err?.message || "Admin sign-in failed");
    } finally {
      setLoading(false);
    }
  }

  const googleDisabled =
    googleLoading ||
    (mode === "signup" && (!firstName.trim() || !lastName.trim()));

  const showOnlyMaintenance = maintOn && !showAdminForMaint;

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
              Welcome to the Highland Park Customer Portal!
            </h1>

            <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-slate-800">
              <p>
                Your Portal Account only takes a moment and once you're signed
                up, you'll be able to securely view orders, handle payments, and
                track shipments, all in one place.
              </p>
              <p>
                Once you have created your Portal Account, everything you've
                ordered will automatically appear in your Portal — no need to
                re-enter any details.
              </p>
              <p>
                Your Customer Portal gives you 24/7 access to your order
                history, shipping status, and the ability to select which Live
                Events you wish to attend. Access to the Live Events will be
                through the Portal making it easy to get into the Events.
              </p>
            </div>
          </div>
        </section>

        <section className="relative flex items-center justify-center py-10">
          <div className="pointer-events-none absolute -z-10 inset-0 bg-[radial-gradient(650px_380px_at_60%_40%,rgba(191,191,191,0.35),transparent_60%)]" />
          <div className="w-full max-w-md rounded-3xl bg-white/98 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.18)] ring-1 ring-slate-200 sm:p-8">
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
                <span className="text-sm font-medium tracking-wide text-slate-800">
                  Portal Access
                </span>
              </div>

              {!maintOn && (
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200">
                  <button
                    onClick={() => {
                      setMode("signin");
                      setErrorMsg(null);
                      setInfoMsg(null);
                      setConfirmBannerEmail(null);
                      setNameWarned(false);
                    }}
                    className={`rounded-lg px-3 py-1 text-xs transition ${
                      mode === "signin"
                        ? "bg-slate-900 text-white"
                        : "text-slate-700 hover:text-slate-900"
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
                      setNameWarned(false);
                    }}
                    className={`rounded-lg px-3 py-1 text-xs transition ${
                      mode === "signup"
                        ? "bg-slate-900 text-white"
                        : "text-slate-700 hover:text-slate-900"
                    }`}
                  >
                    Sign Up
                  </button>
                  <button
                    onClick={() => {
                      setMode("admin");
                      setErrorMsg(null);
                      setInfoMsg(null);
                      setConfirmBannerEmail(null);
                      setNameWarned(false);
                    }}
                    className={`rounded-lg px-3 py-1 text-xs transition ${
                      mode === "admin"
                        ? "bg-slate-900 text-white"
                        : "text-slate-700 hover:text-slate-900"
                    }`}
                  >
                    Admin
                  </button>
                </div>
              )}
            </div>

            {maintOn && !showAdminForMaint && (
              <div className="space-y-6">
                <div className="rounded-2xl border border-amber-300/70 bg-amber-50 p-4">
                  <div className="text-sm font-semibold text-amber-900">
                    Portal is getting updated!
                  </div>
                  <div className="mt-1 text-xs text-amber-800">
                    Please check back later
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowAdminForMaint(true);
                    setMode("admin");
                    setErrorMsg(null);
                    setInfoMsg(null);
                    setConfirmBannerEmail(null);
                  }}
                  className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-black"
                >
                  Staff sign-in
                </button>
              </div>
            )}

            {!maintOn && confirmBannerEmail && (
              <div className="mb-6 rounded-2xl border border-amber-300/70 bg-amber-50 p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 h-3 w-3 animate-pulse rounded-full bg-amber-500" />
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-amber-900">
                      Confirm your email to finish sign-up
                    </div>
                    <div className="mt-1 text-xs text-amber-800">
                      We sent a confirmation link to
                    </div>
                    <div className="mt-2 rounded-lg bg-amber-100 px-2 py-1 text-xs font-mono text-amber-900">
                      {confirmBannerEmail}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        onClick={resendConfirmation}
                        disabled={resending}
                        className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60"
                      >
                        {resending ? "Resending…" : "Resend email"}
                      </button>
                      <button
                        onClick={copyEmail}
                        className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-50"
                      >
                        Copy email
                      </button>
                    </div>
                    {resendMsg && (
                      <div className="mt-3 rounded-md border border-amber-200 bg-amber-100 px-2 py-1 text-[11px] text-amber-900">
                        {resendMsg}
                      </div>
                    )}
                    <button
                      onClick={() => setConfirmBannerEmail(null)}
                      className="mt-4 text-[11px] text-amber-800 underline underline-offset-4"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            )}

            {mode === "admin" || (maintOn && showAdminForMaint) ? (
              <form onSubmit={onAdminLogin} className="space-y-4">
                <div>
                  <label className="mb-2 block text-xs font-medium tracking-wide text-slate-700">
                    Admin email
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-2.5 text-slate-400">
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
                      className="w-full rounded-xl border border-slate-300 bg-white px-9 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none ring-0 transition focus:border-slate-400"
                      placeholder="admin@example.com"
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-medium tracking-wide text-slate-700">
                    Admin password
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-2.5 text-slate-400">
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
                      className="w-full rounded-xl border border-slate-300 bg-white px-9 py-2 pr-10 text-sm text-slate-900 placeholder-slate-400 outline-none ring-0 transition focus:border-slate-400"
                      placeholder="Admin password"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((s) => !s)}
                      className="absolute right-3 top-2.5 text-slate-600 hover:text-slate-900"
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

                <div>
                  <label className="mb-2 block text-xs font-medium tracking-wide text-slate-700">
                    NetSuite Customer ID
                  </label>
                  <input
                    required
                    value={adminTargetNsId}
                    onChange={(e) => setAdminTargetNsId(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none ring-0 transition focus:border-slate-400"
                    placeholder="e.g. 12345"
                  />
                </div>

                {errorMsg && (
                  <div className="rounded-xl border border-red-500/30 bg-red-50 px-4 py-2 text-sm text-red-700">
                    {errorMsg}
                  </div>
                )}
                {infoMsg && (
                  <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
                    {infoMsg}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-black disabled:opacity-60"
                >
                  <span>{loading ? "Signing in…" : "Admin sign in"}</span>
                  <span className="transition-transform group-hover:translate-x-0.5">
                    →
                  </span>
                </button>
              </form>
            ) : !maintOn ? (
              <AuthForm
                mode={mode}
                setMode={setMode}
                email={email}
                setEmail={setEmail}
                password={password}
                setPassword={setPassword}
                showPass={showPass}
                setShowPass={setShowPass}
                firstName={firstName}
                middleName={middleName}
                lastName={lastName}
                setFirstName={setFirstName}
                setMiddleName={setMiddleName}
                setLastName={setLastName}
                loading={loading}
                onSignin={onSignin}
                onSignup={onSignup}
                errorMsg={errorMsg}
                infoMsg={infoMsg}
                googleDisabled={googleLoading}
                googleLoading={googleLoading}
                continueWithGoogle={continueWithGoogle}
                sendMagicLink={sendMagicLink}
                resetPassword={resetPassword}
                onFirstLastBlur={checkNameOnce}
                nameLookupInFlight={nameLookupInFlight}
              />
            ) : null}

            <div className="mt-8 text-center text-[11px] leading-relaxed text-slate-600">
              By continuing you agree to our Terms and Conditions . Read the{" "}
              <button
                type="button"
                onClick={() => {
                  setPoliciesTab("summary");
                  setShowPolicies(true);
                }}
                className="font-medium text-slate-900 underline underline-offset-4 hover:opacity-80"
              >
                Privacy Summary
              </button>{" "}
              and{" "}
              <button
                type="button"
                onClick={() => {
                  setPoliciesTab("accessibility");
                  setShowPolicies(true);
                }}
                className="font-medium text-slate-900 underline underline-offset-4 hover:opacity-80"
              >
                Accessibility
              </button>
              .
            </div>

            <PrivacyTermsModal
              open={showPolicies}
              onClose={() => setShowPolicies(false)}
              initialTab={policiesTab}
              sources={{
                summary: "/policies/summary.md",
                privacy: "/policies/privacy.md",
                terms: "/policies/terms.md",
                accessibility: "/policies/accessibility.md",
              }}
            />
          </div>
        </section>
      </div>
    </main>
  );
}

function FeaturePill({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="rounded-xl bg-white/90 p-4 ring-1 ring-slate-200">
      <div className="text-lg font-semibold text-slate-900">{title}</div>
      <div className="text-slate-700 text-xs">{subtitle}</div>
    </div>
  );
}

function AuthForm(props: {
  mode: Mode;
  setMode: (m: Mode) => void;
  email: string;
  setEmail: (s: string) => void;
  password: string;
  setPassword: (s: string) => void;
  showPass: boolean;
  setShowPass: (b: boolean) => void;
  firstName: string;
  middleName: string;
  lastName: string;
  setFirstName: (s: string) => void;
  setMiddleName: (s: string) => void;
  setLastName: (s: string) => void;
  loading: boolean;
  onSignin: (e: React.FormEvent) => void;
  onSignup: (e: React.FormEvent) => void;
  errorMsg: string | null;
  infoMsg: string | null;
  googleDisabled: boolean;
  googleLoading: boolean;
  continueWithGoogle: () => void;
  sendMagicLink: () => void;
  resetPassword: () => void;
  // Added:
  onFirstLastBlur?: () => void;
  nameLookupInFlight?: boolean;
}) {
  const {
    mode,
    email,
    setEmail,
    password,
    setPassword,
    showPass,
    setShowPass,
    firstName,
    middleName,
    lastName,
    setFirstName,
    setMiddleName,
    setLastName,
    loading,
    onSignin,
    onSignup,
    errorMsg,
    infoMsg,
    googleDisabled,
    googleLoading,
    continueWithGoogle,
    sendMagicLink,
    resetPassword,
    onFirstLastBlur,
    nameLookupInFlight,
  } = props;

  return (
    <>
      <form
        onSubmit={mode === "signin" ? onSignin : onSignup}
        className="space-y-4"
      >
        {mode === "signup" && (
          <>
            <div>
              <label className="mb-2 block text-xs font-medium tracking-wide text-slate-700">
                First name
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-2.5 text-slate-400">
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
                  onBlur={onFirstLastBlur}
                  className="w-full rounded-xl border border-slate-300 bg-white px-9 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none ring-0 transition focus:border-slate-400"
                  placeholder="Jane"
                />
              </div>
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium tracking-wide text-slate-700">
                Middle name
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-2.5 text-slate-400">
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
                  className="w-full rounded-xl border border-slate-300 bg-white px-9 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none ring-0 transition focus:border-slate-400"
                  placeholder="A."
                />
              </div>
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium tracking-wide text-slate-700">
                Last name
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-2.5 text-slate-400">
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
                  onBlur={onFirstLastBlur}
                  className="w-full rounded-xl border border-slate-300 bg-white px-9 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none ring-0 transition focus:border-slate-400"
                  placeholder="Doe"
                />
              </div>
              {nameLookupInFlight && (
                <div className="mt-2 text-[11px] text-slate-500">
                  Checking for an existing account…
                </div>
              )}
              {mode === "signup" && infoMsg && (
                <div className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white mt-1">
                  {infoMsg}
                </div>
              )}
            </div>
          </>
        )}

        <div>
          <label className="mb-2 block text-xs font-medium tracking-wide text-slate-700">
            Email
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-2.5 text-slate-400">
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
              className="w-full rounded-xl border border-slate-300 bg-white px-9 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none ring-0 transition focus:border-slate-400"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-xs font-medium tracking-wide text-slate-700">
            Password
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-2.5 text-slate-400">
              <svg viewBox="0 0 24 24" className="h-4 w-4">
                <path
                  fill="currentColor"
                  d="M12 17a2 2 0 002-2v-2a2 2 0 00-4 0v2a2 2 0 002 2zm6-6h-1V9a5 5 0 00-10 0v2H6a2 2 0 00-2 2v7a2 2 0 002 2h12a2 2 0 002-2v-7a2 2 0 00-2-2z"
                />
              </svg>
            </span>
            <input
              type={showPass ? "text" : "password"}
              minLength={mode === "signup" ? 6 : undefined}
              pattern={mode === "signup" ? ".*[^A-Za-z0-9].*" : undefined}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-9 py-2 pr-10 text-sm text-slate-900 placeholder-slate-400 outline-none ring-0 transition focus:border-slate-400"
              placeholder={
                mode === "signin" ? "Your password" : "Create a strong password"
              }
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
            />
            <button
              type="button"
              onClick={() => setShowPass((s) => !s)}
              className="absolute right-3 top-2.5 text-slate-600 hover:text-slate-900"
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
          <div className="rounded-xl border border-red-500/30 bg-red-50 px-4 py-2 text-sm text-red-700">
            {errorMsg}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="group inline-flex w-full items-center justify-center gap-2 rounded--xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-black disabled:opacity-60"
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

      <div className="my-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-xs text-slate-500">
        <div className="h-px w-full bg-slate-200" />
        <span>or</span>
        <div className="h-px w-full bg-slate-200" />
      </div>

      {mode === "signin" && (
        <div className="mt-6 space-y-3 text-sm">
          {/* <button
            onClick={continueWithGoogle}
            disabled={googleDisabled}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-slate-900 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-60"
          >
            {googleLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4">
                <path
                  fill="#EA4335"
                  d="M12 11.8v3.9h6.5c-.3 1.9-2.1 5.5-6.5 5.5-3.9 0-7.1-3.2-7.1-7.1S8.1 7 12 7c2.2 0 3.7.9 4.6 1.8l3.1-3.1C18.2 3.8 15.4 2.5 12 2.5 6.8 2.5 2.5 6.8 2.5 12S6.8 21.5 12 21.5c6.9 0 9.5-4.8 9.5-7.3 0-.5 0-.9-.1-1.3H12z"
                />
              </svg>
            )}
            <span>{mode === "signup" ? "Continue with Google" : "Sign in with Google"}</span>
          </button> */}
          <div className="text-center text-slate-700">
            Forgot your password?{" "}
            <button
              onClick={resetPassword}
              disabled={loading}
              className="underline underline-offset-4 hover:text-slate-900"
            >
              Send reset email
            </button>
          </div>
        </div>
      )}
    </>
  );
}
