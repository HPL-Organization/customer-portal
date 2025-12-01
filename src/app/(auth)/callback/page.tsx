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

type Phase =
  | "checking"
  | "found"
  | "welcome"
  | "redirecting"
  | "verified_no_session"
  | "error";

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/";
  const prefillParam = sp.get("prefill") || "";
  const encodedEmailParam = sp.get("e") || "";
  const forceSessionFail = "1";
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
      case "verified_no_session":
        return "You're all set!";
      case "error":
        return "Something went wrong";
    }
  }, [phase]);

  useEffect(() => {
    (async () => {
      try {
        let error: string | null = null;
        let errorCode: string | null = null;
        let errorDescription: string | null = null;

        try {
          const searchParams = new URLSearchParams(window.location.search);
          const hash = window.location.hash.startsWith("#")
            ? window.location.hash.slice(1)
            : window.location.hash;
          const hashParams = new URLSearchParams(hash);

          error = searchParams.get("error") || hashParams.get("error");
          errorCode =
            searchParams.get("error_code") || hashParams.get("error_code");
          errorDescription =
            searchParams.get("error_description") ||
            hashParams.get("error_description");
        } catch (ex: any) {
          console.error("[CALLBACK_URL_PARSE_ERROR]", {
            message: ex?.message,
            name: ex?.name,
            stack: ex?.stack,
            href: typeof window !== "undefined" ? window.location.href : null,
            raw: ex,
          });
        }

        if (error || errorCode) {
          console.error("[CALLBACK_LINK_ERROR]", {
            error,
            errorCode,
            errorDescription,
            href: typeof window !== "undefined" ? window.location.href : null,
          });

          setPhase("error");
          setDetail(
            errorDescription ||
              "This verification link is invalid or has expired. Please request a new verification email and try again."
          );
          return;
        }

        try {
          const { data, error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(window.location.href);

          if (exchangeError) {
            console.error("[CALLBACK_EXCHANGE_ERROR]", {
              message: exchangeError.message,
              name: exchangeError.name,
              status: (exchangeError as any)?.status,
              stack: (exchangeError as any)?.stack,
              href: window.location.href,
              raw: exchangeError,
            });
          } else {
            console.log("[CALLBACK_EXCHANGE_SUCCESS]", {
              hasSession: !!data?.session,
              userId: data?.session?.user?.id,
            });
          }
        } catch (ex: any) {
          console.error("[CALLBACK_EXCHANGE_THROW]", {
            message: ex?.message,
            name: ex?.name,
            stack: ex?.stack,
            href: window.location.href,
            raw: ex,
          });
        }

        {
          const deadline = Date.now() + 25000;
          let ok = false;
          let lastSessionDebug: any = null;

          while (Date.now() < deadline) {
            const { data, error } = await supabase.auth.getSession();

            if (error) {
              console.error("[CALLBACK_GET_SESSION_ERROR]", {
                message: error.message,
                name: error.name,
                status: (error as any)?.status,
                stack: (error as any)?.stack,
                href: window.location.href,
                raw: error,
              });
              lastSessionDebug = { errorMessage: error.message };
            } else {
              lastSessionDebug = {
                hasSession: !!data?.session,
                userId: data?.session?.user?.id,
              };
            }

            if (data?.session) {
              ok = true;
              break;
            }
            await new Promise((r) => setTimeout(r, 120));
          }

          if (!ok) {
            console.error("[CALLBACK_SESSION_ERROR]", {
              reason: "no-session-established",
              ok,
              href: window.location.href,
              lastSessionDebug,
            });

            let verificationStatus: "verified" | "unverified" | "unknown" =
              "unknown";

            try {
              if (encodedEmailParam) {
                console.log("[CALLBACK_EMAIL_PARAM_RECEIVED]", {
                  encodedEmail: encodedEmailParam,
                });

                let decodedEmail: string | null = null;

                try {
                  decodedEmail = atob(encodedEmailParam);
                  console.log("[CALLBACK_EMAIL_DECODED]", {
                    encodedEmail: encodedEmailParam,
                    decodedEmail,
                  });
                } catch (ex: any) {
                  console.error("[CALLBACK_EMAIL_DECODE_ERROR]", {
                    message: ex?.message,
                    name: ex?.name,
                    stack: ex?.stack,
                    raw: ex,
                  });
                }

                if (decodedEmail) {
                  console.log("[CALLBACK_VERIFY_REQUEST]", {
                    email: decodedEmail,
                  });

                  const res = await fetch(
                    "/api/auth/check-email-verification",
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ email: decodedEmail }),
                    }
                  );

                  const j = await res.json().catch(() => ({}));

                  console.log("[CALLBACK_VERIFY_RESPONSE]", {
                    status: res.status,
                    body: j,
                  });

                  if (res.ok && j && typeof j === "object") {
                    if (j.emailVerified === true) {
                      verificationStatus = "verified";
                    } else if (j.exists === true && j.emailVerified === false) {
                      verificationStatus = "unverified";
                    } else {
                      verificationStatus = "unknown";
                    }
                  }
                }
              } else {
                console.log("[CALLBACK_EMAIL_PARAM_MISSING]", {
                  note: "No 'e' query param, skipping verification check route.",
                });
              }
            } catch (ex: any) {
              console.error("[CALLBACK_VERIFY_CHECK_ERROR]", {
                message: ex?.message,
                name: ex?.name,
                stack: ex?.stack,
                raw: ex,
              });
            }

            if (verificationStatus === "verified") {
              setPhase("verified_no_session");
              setDetail(
                "Email verification was successful, Please log in to the portal using your new account (email and password)."
              );
            } else if (verificationStatus === "unverified") {
              setPhase("error");
              setDetail(
                "We couldn't verify your email address yet. Please request a new verification email from the portal and try again. If the problem continues, contact HPL support."
              );
            } else {
              setPhase("error");
              setDetail(
                "We couldn't finish signing you in. Please try logging in with your email and password. If that doesn't work, request a new verification email or contact HPL support."
              );
            }

            return;
          }
        }

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
          } catch (ex: any) {
            console.error("[CALLBACK_NAME_PREFILL_ERROR]", {
              message: ex?.message,
              name: ex?.name,
              stack: ex?.stack,
              raw,
            });
          }
        }

        setPhase("checking");
        setDetail("Searching to see if you exist in our records…");
        await sleep(450);

        const r = await fetch("/api/auth/provision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(names),
        });
        const j: any = await r.json().catch(() => ({}));

        if (typeof window !== "undefined") {
          sessionStorage.removeItem("name_prefill");
        }

        if (j?.error) {
          console.error("[CALLBACK_PROVISION_ERROR]", {
            error: j.error,
            step: j.step,
            details: j.details,
            raw: j,
          });

          setPhase("error");
          setDetail(
            "Your email was verified, but we couldn't finish setting up your customer record. Please try logging in again. If that still doesn't work, contact HPL support."
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
          if (typeof window !== "undefined") {
            localStorage.setItem("nsId", nsId);
          }
        }

        try {
          localStorage.setItem("hpl:lastActive", String(Date.now()));
        } catch (ex: any) {
          console.error("[CALLBACK_LAST_ACTIVE_ERROR]", {
            message: ex?.message,
            name: ex?.name,
            stack: ex?.stack,
          });
        }

        setPhase("redirecting");
        setDetail("Taking you to your portal…");
        await sleep(400);

        router.replace(url.pathname + url.search);
      } catch (e: any) {
        console.error("[CALLBACK_UNEXPECTED_ERROR]", {
          message: e?.message,
          name: e?.name,
          stack: e?.stack,
          href: typeof window !== "undefined" ? window.location.href : null,
          raw: e,
        });

        setPhase("error");
        setDetail(
          "We couldn't finish signing you in. Please try logging in with your email and password. If that doesn't work, contact HPL support."
        );
      }
    })();
  }, [router, next, prefillParam, encodedEmailParam]);

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
              phase === "redirecting" ||
              phase === "verified_no_session"
            }
            label="Check records"
          />
          <StepCard
            active={
              phase === "found" ||
              phase === "welcome" ||
              phase === "redirecting" ||
              phase === "verified_no_session"
            }
            label="Link your account"
          />
          <StepCard
            active={phase === "redirecting" || phase === "verified_no_session"}
            label="Redirect"
          />
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
  if (
    phase === "found" ||
    phase === "welcome" ||
    phase === "redirecting" ||
    phase === "verified_no_session"
  ) {
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
      : phase === "redirecting" || phase === "verified_no_session"
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
