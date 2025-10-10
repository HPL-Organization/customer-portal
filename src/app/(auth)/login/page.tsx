"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Mode = "signin" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  async function provisionAndRedirect() {
    await supabase.auth.getSession();

    let nsId: string | null = null;
    try {
      const r = await fetch("/api/auth/provision", { method: "POST" });
      const j = await r.json();
      nsId = j?.nsId ?? null;
    } catch {}

    const url = new URL(next, window.location.origin);
    if (nsId) {
      url.searchParams.set("nsId", nsId);
      localStorage.setItem("nsId", nsId);
    }
    router.replace(url.pathname + url.search);
  }

  async function onSignin(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
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
    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      // If email confirmations are enabled, user confirms then returns here
      options: { emailRedirectTo: `${window.location.origin}${next}` },
    });

    setLoading(false);

    if (error) return setErrorMsg(error.message);

    if (!data.session) {
      // Email confirmations ON: wait for user to confirm
      setInfoMsg("Check your email to confirm your account, then sign in.");
      return;
    }

    // Auto-confirm ON: map & redirect right away
    await provisionAndRedirect();
  }

  async function sendMagicLink() {
    setErrorMsg(null);
    setInfoMsg(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}${next}` },
    });

    setLoading(false);

    if (error) return setErrorMsg(error.message);
    setInfoMsg("Magic link sent. Check your inbox.");
  }

  async function resetPassword() {
    if (!email) return setErrorMsg("Enter your email first.");
    setErrorMsg(null);
    setInfoMsg(null);
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });

    setLoading(false);

    if (error) return setErrorMsg(error.message);
    setInfoMsg("Password reset email sent.");
  }

  return (
    <main className="min-h-screen grid place-items-center px-4 py-12 bg-neutral-50">
      <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center justify-between">
          <h1 className="text-xl font-semibold">
            {mode === "signin" ? "Sign in" : "Create account"}
          </h1>
          <button
            className="text-sm underline"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setErrorMsg(null);
              setInfoMsg(null);
            }}
          >
            {mode === "signin" ? "Need an account?" : "Have an account?"}
          </button>
        </div>

        <form
          onSubmit={mode === "signin" ? onSignin : onSignup}
          className="space-y-3"
        >
          <label className="block">
            <span className="mb-1 block text-sm text-neutral-700">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10"
              placeholder="you@example.com"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-neutral-700">
              Password
            </span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10"
              placeholder={
                mode === "signin" ? "Your password" : "Create a strong password"
              }
            />
          </label>

          {errorMsg && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMsg}
            </div>
          )}
          {infoMsg && (
            <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {infoMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {loading
              ? mode === "signin"
                ? "Signing in..."
                : "Creating..."
              : mode === "signin"
              ? "Sign in"
              : "Create account"}
          </button>
        </form>

        <div className="mt-4 space-y-2 text-sm">
          <button onClick={sendMagicLink} className="underline">
            Email me a magic link
          </button>
          <div>
            Forgot your password?{" "}
            <button onClick={resetPassword} className="underline">
              Send reset email
            </button>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-neutral-500">
          By continuing you agree to our Terms & Privacy.
        </p>
      </div>
    </main>
  );
}
