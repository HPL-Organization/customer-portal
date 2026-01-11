"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  Button as MUIButton,
} from "@mui/material";
import { ShieldCheck, WalletCards } from "lucide-react";
import { toast } from "react-toastify";

type Props = {
  open: boolean;
  onClose: () => void;
  nsCustomerId: number;
  onCreated?: (pm: any) => void;
};

export function AddPaypalMethodDialog({
  open,
  onClose,
  nsCustomerId,
  onCreated,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<any>(null);

  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setReady(false);

        const tokRes = await fetch("/api/braintree/client-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nsCustomerId }),
        });

        const tokText = await tokRes.text();
        let tokData: any = {};
        try {
          tokData = tokText ? JSON.parse(tokText) : {};
        } catch {
          tokData = { raw: tokText };
        }

        if (!tokRes.ok || !tokData?.clientToken) {
          throw new Error(
            tokData?.error || "Failed to get Braintree client token"
          );
        }

        const dropin = (await import("braintree-web-drop-in")).default;

        if (!containerRef.current) throw new Error("Missing PayPal container");

        const instance = await dropin.create({
          authorization: tokData.clientToken,
          container: containerRef.current,
          card: false,
          paypal: { flow: "vault" },
        });

        if (cancelled) {
          try {
            await instance.teardown();
          } catch {}
          return;
        }

        instanceRef.current = instance;
        setReady(true);
      } catch (e: any) {
        toast.error(e?.message || "Could not start PayPal");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      (async () => {
        try {
          if (instanceRef.current) await instanceRef.current.teardown();
        } catch {}
        instanceRef.current = null;
        setReady(false);
        setLoading(false);
      })();
    };
  }, [open, nsCustomerId]);

  async function handleSave() {
    if (!instanceRef.current) return;

    setSaving(true);
    try {
      const payload = await instanceRef.current.requestPaymentMethod();
      const payerEmail = payload?.details?.email || null;
      const nonce = payload?.nonce;
      if (!nonce) throw new Error("Missing PayPal nonce");

      const res = await fetch("/api/braintree/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nsCustomerId,
          nonce,
          vault: true,
          payerEmail,
        }),
      });

      const text = await res.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${res.status}: ${text}`);
      }

      const instrumentId = String(data?.instrumentId || "");
      if (!instrumentId)
        throw new Error("Save succeeded but instrumentId missing");

      toast.success("PayPal saved (processing)");

      onCreated?.({
        id: instrumentId,
        type: "other",
        brand: "paypal",
        last4: undefined,
        exp: undefined,
        name: payerEmail ? `PayPal (${payerEmail})` : "PayPal",
        tokenFamilyLabel: "Braintree",
        isDefault: true,
        instrument_id: instrumentId,
        payer_email: payerEmail,
        netsuite_writes_status: "processing",
      });

      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Failed to save PayPal");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle className="flex items-center gap-2 text-[#17152A]">
        <WalletCards className="w-5 h-5 text-[#8C0F0F]" /> Add PayPal
      </DialogTitle>

      <DialogContent>
        <Alert
          severity="info"
          icon={<ShieldCheck className="w-5 h-5" />}
          sx={{
            borderRadius: 2,
            bgcolor: "rgba(140,15,15,0.06)",
            color: "#17152A",
            "& .MuiAlert-icon": { color: "#8C0F0F" },
          }}
        >
          You’ll approve PayPal once. We store a Braintree token (not your
          PayPal login).
        </Alert>

        <div className="mt-4 rounded-xl border border-[#BFBFBF]/60 bg-white p-4 shadow-sm">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-[#17152A]/70">
              <CircularProgress size={18} /> Loading PayPal…
            </div>
          ) : null}
          <div ref={containerRef} />
        </div>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <MUIButton
          onClick={onClose}
          disabled={saving}
          sx={{ textTransform: "none" }}
        >
          Cancel
        </MUIButton>
        <MUIButton
          onClick={handleSave}
          disabled={!ready || saving}
          variant="contained"
          sx={{
            textTransform: "none",
            backgroundColor: "#8C0F0F",
            "&:hover": { backgroundColor: "#E01C24" },
            borderRadius: "0.75rem",
            boxShadow: "none",
          }}
        >
          {saving ? "Saving…" : "Save PayPal"}
        </MUIButton>
      </DialogActions>
    </Dialog>
  );
}
