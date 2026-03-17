"use client";
import { useEffect, useRef, useState } from "react";
import dropin, { DropinInstance } from "braintree-web-drop-in";

type Props = {
  nsCustomerId: string | number;
  mode: "vault" | "checkout";
  amount?: number;
  invoiceId?: number;
  vault?: boolean;
  onNonce?: (p: {
    nonce: string;
    payerEmail: string | null;
    raw: any;
  }) => void | Promise<void>;
  onSuccess?: (r: any) => void;
  onError?: (m: string) => void;
  checkoutEndpoint?: string;
};

export default function BraintreeDropIn({
  nsCustomerId,
  mode,
  amount,
  invoiceId,
  vault,
  onNonce,
  onSuccess,
  onError,
  checkoutEndpoint,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<DropinInstance | null>(null);
  const autoTriggeredRef = useRef(false);
  const [ready, setReady] = useState(false);
  const requestingRef = useRef(false);
  const runIdRef = useRef(0);
  const log = (...a: any[]) => console.log("[BT]", ...a);

  const fmt2 = (n?: number | null) => Number(n ?? 1).toFixed(2);

  async function waitForVisible(el: HTMLElement, timeoutMs = 2000) {
    const start = Date.now();
    return new Promise<boolean>((resolve) => {
      function tick() {
        const rect = el.getBoundingClientRect();
        const visible =
          rect.width > 0 && rect.height > 0 && el.offsetParent !== null;
        if (visible) return resolve(true);
        if (Date.now() - start > timeoutMs) return resolve(false);
        requestAnimationFrame(tick);
      }
      tick();
    });
  }

  async function teardown() {
    try {
      await instanceRef.current?.teardown();
    } catch {}
    instanceRef.current = null;
    autoTriggeredRef.current = false;
    if (containerRef.current) containerRef.current.innerHTML = "";
    setReady(false);
  }

  useEffect(() => {
    const runId = ++runIdRef.current;

    (async () => {
      await teardown();

      const host = document.createElement("div");
      containerRef.current?.appendChild(host);
      log("mount start", { nsCustomerId, mode, amount });

      try {
        const r = await fetch("/api/braintree/client-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nsCustomerId }),
        });
        const text = await r.text();
        let j: any = {};
        try {
          j = text ? JSON.parse(text) : {};
        } catch {}
        log("token status", r.status);
        if (!r.ok || !j?.clientToken) {
          const msg = j?.error || text || `client-token HTTP ${r.status}`;
          throw new Error(msg);
        }

        if (runId !== runIdRef.current) return;

        await waitForVisible(host, 2500);

        if (runId !== runIdRef.current) return;

        const cfg: any = {
          authorization: j.clientToken,
          container: host,
          card: false,
          // Vault manager UI is only relevant for vault flows; enabling it in
          // checkout has caused flaky popup behavior in some environments.
          vaultManager: mode === "vault",
          paypal:
            mode === "vault"
              ? { flow: "vault" }
              : { flow: "checkout", amount: fmt2(amount), currency: "USD" },
        };

        log("dropin.create", {
          hasToken: Boolean(j.clientToken),
          childrenBefore: host.childNodes.length,
          paypalFlow: cfg.paypal.flow,
        });

        const inst = (await dropin.create(cfg)) as DropinInstance;
        log("dropin instance created", {
          hasOn: typeof inst.on === "function",
          isReq: !!inst.isPaymentMethodRequestable,
        });

        if (runId !== runIdRef.current) {
          try {
            await inst.teardown();
          } catch {}
          return;
        }

        instanceRef.current = inst;

        const maybeAutoTrigger = async () => {
          if (mode === "vault" && !autoTriggeredRef.current) {
            autoTriggeredRef.current = true;
            try {
              const pm = await inst.requestPaymentMethod();
              await handlePaymentMethod(pm);
            } catch (e: any) {
              // user closed popup or error; keep UI ready for manual click
              log("auto trigger abort", e?.message || e);
            }
          }
        };

        inst.on?.("paymentMethodRequestable", () => {
          setReady(true);
          maybeAutoTrigger();
        });
        inst.on?.("noPaymentMethodRequestable", () => {
          setReady(true);
        });

        setReady(true);

        if (inst.isPaymentMethodRequestable) {
          await maybeAutoTrigger();
        }

        log("ready");
      } catch (e: any) {
        const dbg = {
          name: e?.name,
          message: e?.message,
          bwType: e?._braintreeWebError?.type,
          bwCode: e?._braintreeWebError?.code,
        };
        log("init error", dbg);
        await teardown();
        if (runId === runIdRef.current) {
          onError?.(e?.message || "All payment options failed to load.");
        }
      }
    })();

    return () => {
      // Invalidate this run so any in-flight async work bails out.
      runIdRef.current = runId + 1;
      teardown();
    };
  }, [nsCustomerId, mode, amount]);

  async function handlePaymentMethod(payload: any) {
    const nonce = typeof payload?.nonce === "string" ? payload.nonce : null;
    if (!nonce) throw new Error("Missing payment method nonce");

    const emailRaw =
      payload?.details?.email ||
      payload?.details?.payerEmail ||
      payload?.details?.payerEmailAddress ||
      null;
    const payerEmailFromDetails =
      typeof emailRaw === "string" && emailRaw.trim() ? emailRaw.trim() : null;

    if (onNonce) {
      await onNonce({ nonce, payerEmail: payerEmailFromDetails, raw: payload });
      return;
    }

    const body: any = { nsCustomerId, vault: Boolean(vault), nonce };
    if (mode === "checkout") {
      body.amount = fmt2(amount);
      body.invoiceId = invoiceId ?? null;
    }
    const res = await fetch(checkoutEndpoint || "/api/braintree/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "payment error");
    onSuccess?.(data);
  }

  async function submit() {
    if (requestingRef.current) return;
    try {
      requestingRef.current = true;
      const inst = instanceRef.current as DropinInstance;
      log("submit click", { mode, amount: fmt2(amount) });

      const timeoutMs = 20000;
      const pm = await Promise.race([
        inst.requestPaymentMethod(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("PayPal timed out or was closed.")),
            timeoutMs
          )
        ),
      ]);
      await handlePaymentMethod(pm);
    } catch (e: any) {
      console.log("[BT] submit error", e?.message);
      onError?.(e?.message || "Payment failed");
    } finally {
      requestingRef.current = false;
    }
  }

  return (
    <div>
      <div ref={containerRef} style={{ minHeight: 96 }} />
      <button
        type="button"
        onClick={(e) => {
          // Prevent any parent form submits from tearing down the drop-in
          // (which would close the PayPal popup immediately).
          e.preventDefault();
          e.stopPropagation();
          void submit();
        }}
        className="mt-3 px-4 py-2 rounded bg-black text-white disabled:opacity-50"
        disabled={!instanceRef.current || !ready}
      >
        {mode === "vault" ? "Link PayPal" : "Pay with PayPal"}
      </button>
    </div>
  );
}
