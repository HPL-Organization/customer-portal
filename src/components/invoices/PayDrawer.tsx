"use client";

import * as React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Button as MUIButton,
  CircularProgress,
  FormHelperText,
  Backdrop,
  LinearProgress,
  Box,
} from "@mui/material";
import type { Invoice } from "@/lib/types/billing";

function fmt(n: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(n);
}

type Instrument = {
  id: string;
  paymentMethod: string | null;
  brand: string | null;
  last4: string | null;
  expiry: string | null;
  tokenFamily: string | null;
  payerEmail?: string | null;
  netsuite_writes_status?: string | null;
};

export default function PayDrawer({
  open,
  invoice,
  customerId,
  onClose,
  onSubmit,
}: {
  open: boolean;
  invoice: Invoice | null;
  customerId?: string | number | null;
  onClose: () => void;
  onSubmit: (
    invoice: Invoice,
    amount: number,
    methodId: string
  ) => Promise<void>;
}) {
  const [amount, setAmount] = React.useState<number>(0);
  const [method, setMethod] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState(false);

  // instruments state
  const [loadingPM, setLoadingPM] = React.useState(false);
  const [pmError, setPmError] = React.useState<string | null>(null);
  const [instruments, setInstruments] = React.useState<Instrument[]>([]);
  const abortRef = React.useRef<AbortController | null>(null);
  const reqSerialRef = React.useRef(0);

  const [saving, setSaving] = React.useState(false);
  const [loaderIdx, setLoaderIdx] = React.useState(0);
  const [loaderMsgs, setLoaderMsgs] = React.useState<string[]>([
    "Processing payment…",
    "Confirming with NetSuite…",
    "Applying to invoice…",
  ]);
  const timerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!saving) return;
    setLoaderIdx(0);

    const step = (i: number) => {
      if (i >= loaderMsgs.length - 1) return;
      timerRef.current = window.setTimeout(() => {
        setLoaderIdx(i + 1);
        step(i + 1);
      }, 1200);
    };

    step(0);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [saving, loaderMsgs]);

  React.useEffect(() => {
    if (!invoice) return;
    setAmount(Number(Number(invoice.amountRemaining || 0).toFixed(2)));
  }, [invoice]);

  const loadPaymentMethods = React.useCallback(async () => {
    if (!open || !customerId) return;

    const serial = ++reqSerialRef.current;

    if (abortRef.current) {
      try {
        abortRef.current.abort();
      } catch {}
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoadingPM(true);
    setPmError(null);

    try {
      const res = await fetch("/api/netsuite/get-payment-method", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerInternalId: customerId }),
        signal: ctrl.signal,
      });
      const json = await res.json();
      if (!res.ok || json?.success === false) {
        throw new Error(json?.message || "Failed to fetch payment methods");
      }

      if (serial !== reqSerialRef.current) return;

      const list: Instrument[] = Array.isArray(json.instruments)
        ? json.instruments
        : [];

      const usable = list.filter((m) => !isProcessingInst(m));
      setInstruments(usable);

      setMethod((prev) => {
        if (prev && usable.some((pm) => String(pm.id) === String(prev)))
          return prev;
        return usable[0]?.id ? String(usable[0].id) : "";
      });
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setInstruments([]);
      setMethod("");
      setPmError(e?.message || "Failed to fetch payment methods");
    } finally {
      if (serial === reqSerialRef.current) setLoadingPM(false);
    }
  }, [open, customerId]);

  React.useEffect(() => {
    void loadPaymentMethods();
    return () => {
      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch {}
      }
    };
  }, [loadPaymentMethods]);

  const disabled = !invoice || submitting || saving;

  const submit = async () => {
    if (!invoice || !method) return;

    setSubmitting(true);
    setSaving(true);
    setLoaderMsgs([
      "Processing payment…",
      "Confirming with NetSuite…",
      "Applying to invoice…",
    ]);
    setLoaderIdx(0);

    try {
      await onSubmit(invoice, Math.max(0, Number(amount) || 0), method);
    } finally {
      setSaving(false);
      setSubmitting(false);
    }
  };

  function isProcessingInst(m: Instrument) {
    const a = String(m.netsuite_writes_status ?? "").toLowerCase();
    const b = String(m.id ?? "").toLowerCase();
    return a === "processing" || b === "processing" || a === "failed";
  }

  const methodLabel = (pm: Instrument) => {
    const email =
      pm.payerEmail && String(pm.payerEmail).trim()
        ? String(pm.payerEmail).trim()
        : null;

    const bits = [
      pm.brand || pm.tokenFamily || "Payment Method",
      pm.last4 ? `•••• ${pm.last4}` : null,
      pm.expiry ? `Exp: ${pm.expiry}` : null,
      email ? `Email: ${email}` : null,
    ].filter(Boolean);

    return bits.join(" · ");
  };

  return (
    <Dialog
      open={open}
      onClose={disabled ? undefined : onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Pay Invoice</DialogTitle>
      <DialogContent dividers>
        {!invoice ? (
          <div className="py-2 text-sm text-slate-500">
            No invoice selected.
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-4 py-3">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-sm text-slate-500">Invoice</div>
                  <div className="text-lg font-semibold text-slate-900">
                    {invoice.tranId}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-slate-500">Remaining</div>
                  <div className="text-lg font-semibold text-rose-600">
                    {fmt(invoice.amountRemaining)}
                  </div>
                </div>
              </div>
            </div>

            <TextField
              label="Amount"
              type="number"
              inputProps={{ step: "0.01", min: 0 }}
              value={Number.isFinite(amount) ? amount : 0}
              onChange={(e) => setAmount(parseFloat(e.target.value))}
              fullWidth
              disabled={disabled}
              sx={{ mb: 2 }}
            />

            <div>
              <TextField
                label="Payment Method"
                select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                fullWidth
                disabled={
                  disabled || loadingPM || !!pmError || !instruments.length
                }
              >
                {instruments.map((m) => (
                  <MenuItem key={m.id} value={String(m.id)}>
                    {methodLabel(m)}
                  </MenuItem>
                ))}
              </TextField>

              <div className="mt-1 flex items-center gap-2">
                {loadingPM && (
                  <>
                    <CircularProgress size={16} />
                    <FormHelperText>Loading payment methods…</FormHelperText>
                  </>
                )}
                {pmError && <FormHelperText error>{pmError}</FormHelperText>}
                {!loadingPM && !pmError && !instruments.length && (
                  <FormHelperText>
                    No saved payment methods for this customer.
                  </FormHelperText>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>

      <DialogActions>
        <MUIButton onClick={onClose} disabled={disabled}>
          Cancel
        </MUIButton>
        <MUIButton
          variant="contained"
          onClick={submit}
          disabled={
            disabled ||
            loadingPM ||
            !!pmError ||
            !instruments.length ||
            !method ||
            !(Number(amount) > 0)
          }
        >
          Pay {invoice ? fmt(Math.max(0, Number(amount) || 0)) : ""}
        </MUIButton>
      </DialogActions>

      {/* Full-screen loader Backdrop  */}
      <Backdrop
        open={saving}
        sx={{
          color: "#fff",
          zIndex: (t) => t.zIndex.modal + 1,
          flexDirection: "column",
          gap: 2,
        }}
      >
        <CircularProgress />
        <div className="text-lg font-medium text-white">
          {loaderMsgs[loaderIdx] ?? "Working…"}
        </div>
        <Box sx={{ width: 320 }}>
          <LinearProgress />
        </Box>
      </Backdrop>
    </Dialog>
  );
}
