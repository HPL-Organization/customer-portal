"use client";
import { useEffect, useRef, useState } from "react";
import dropin, { DropinInstance } from "braintree-web-drop-in";

type Props = {
  nsCustomerId: string | number;
  mode: "vault" | "checkout";
  amount?: number;
  invoiceId?: number;
  vault?: boolean;
  onSuccess?: (r: any) => void;
  onError?: (m: string) => void;
};

export default function BraintreeDropIn({
  nsCustomerId,
  mode,
  amount,
  invoiceId,
  vault,
  onSuccess,
  onError,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<DropinInstance | null>(null);
  const creatingRef = useRef(false);
  const autoTriggeredRef = useRef(false);
  const [ready, setReady] = useState(false);
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
    let cancelled = false;

    (async () => {
      if (creatingRef.current) return;
      creatingRef.current = true;

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

        await waitForVisible(host, 2500);

        const cfg: any = {
          authorization: j.clientToken,
          container: host,
          card: false,
          vaultManager: true,
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

        if (cancelled) {
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
              await handleNonce(pm.nonce);
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
        onError?.(e?.message || "All payment options failed to load.");
      } finally {
        creatingRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [nsCustomerId, mode, amount]);

  async function handleNonce(nonce: string) {
    const body: any = { nsCustomerId, vault: Boolean(vault), nonce };
    if (mode === "checkout") {
      body.amount = fmt2(amount);
      body.invoiceId = invoiceId ?? null;
    }
    const res = await fetch("/api/braintree/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "payment error");
    onSuccess?.(data);
  }

  async function submit() {
    try {
      const inst = instanceRef.current as DropinInstance;
      const pm = await inst.requestPaymentMethod();
      await handleNonce(pm.nonce);
    } catch (e: any) {
      console.log("[BT] submit error", e?.message);
      onError?.(e?.message || "Payment failed");
    }
  }

  return (
    <div>
      <div ref={containerRef} style={{ minHeight: 96 }} />
      <button
        onClick={submit}
        className="mt-3 px-4 py-2 rounded bg-black text-white disabled:opacity-50"
        disabled={!instanceRef.current || !ready}
      >
        {mode === "vault" ? "Link PayPal" : "Pay with PayPal"}
      </button>
    </div>
  );
}
