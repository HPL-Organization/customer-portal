"use client";

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import {
  Card,
  CardContent,
  CardHeader,
  CardActions,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button as MUIButton,
  IconButton,
  Tooltip,
  Chip,
  Divider,
  Backdrop,
  CircularProgress,
  Skeleton,
  Alert,
  Portal,
  Typography,
  Box,
  LinearProgress,
} from "@mui/material";
import {
  CreditCard,
  Landmark,
  Plus,
  ShieldCheck,
  Trash2,
  WalletCards,
  RefreshCw,
} from "lucide-react";
import { useCustomerBootstrap } from "@/components/providers/CustomerBootstrap";
import { usePaymentMethods } from "@/components/providers/PaymentMethodsProvider";
import { AddPaypalMethodDialog } from "@/components/payment/braintree/AddPaypalMethodDialog";

/* ---------- VersaPay globals ---------- */
declare global {
  interface Window {
    versapay?: any;
    __VP_ADD_METHOD_LOCK__?: boolean;
  }
}
const DELETE_DISABLED_MSG =
  "Must keep one payment method on file to remove- +xxxxxxxxxx example@example.com";

/* ---------- Helpers ---------- */
type PaymentMethod = ReturnType<typeof mapShape> extends infer T ? never : any;

function pmLabel(pm: any) {
  const brand = pm.brand || (pm.type === "ach" ? "Bank" : "Card");
  const last4 = pm.last4 ? `•••• ${pm.last4}` : "";
  const exp = pm.exp ? ` · exp ${pm.exp}` : "";
  return `${brand} ${last4}${exp}`.trim();
}
function typeIcon(pm: any, className = "w-5 h-5") {
  if (pm.type === "ach") return <Landmark className={className} />;
  if (pm.type === "card") return <CreditCard className={className} />;
  return <WalletCards className={className} />;
}

let VP_ACTIVE = { key: 0, sid: null as string | null, handled: false };

function mapShape(it: any, idx: number) {
  const id = it.id ?? it.internalId ?? it.paymentCardTokenId ?? idx;
  const pmStr = String(it.paymentMethod ?? it.type ?? "").toLowerCase();
  const type: "card" | "ach" | "other" =
    pmStr.includes("ach") || pmStr.includes("bank")
      ? "ach"
      : pmStr.includes("card") || pmStr.includes("token")
      ? "card"
      : "other";
  const brand = it.brand ?? it.cardBrand ?? undefined;
  const last4 =
    (it.accountNumberLastFour ?? it.last4 ?? it.cardLast4 ?? "").toString() ||
    undefined;
  let exp = it.tokenExpirationDate ?? it.exp ?? it.expiry ?? undefined;
  if (typeof exp === "string") {
    const m = exp.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) exp = `${m[2]}/${m[1].slice(-2)}`;
    const m2 = exp.match(/^(\d{2})\/(\d{4})$/);
    if (m2) exp = `${m2[1]}/${m2[2].slice(-2)}`;
  }
  const name = it.cardNameOnCard ?? it.name ?? it.accountHolder ?? undefined;
  const tokenFamilyLabel =
    it.tokenFamily ?? it.tokenFamilyLabel ?? it.gateway ?? "Versapay";
  const isDefault = Boolean(it.isDefault ?? it.default ?? it.primary ?? false);
  return { id, type, brand, last4, exp, name, isDefault, tokenFamilyLabel };
}

function isProcessing(pm: any) {
  const a = String(pm?.instrument_id ?? "").toLowerCase();
  const b = String(pm?.netsuite_writes_status ?? "").toLowerCase();
  return a.startsWith("processing") || b === "processing";
}
function isFailed(pm: any) {
  const b = String(pm?.netsuite_writes_status ?? "").toLowerCase();
  return b === "failed";
}

/* ---------- API calls ---------- */
async function createPaymentMethod(
  customerInternalId: number,
  payload: {
    token: string;
    cardNameOnCard?: string;
    tokenExpirationDate?: string;
    accountNumberLastFour?: string;
    accountType?: string;
  }
) {
  const res = await fetch("/api/netsuite/save-payment-method", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerInternalId, ...payload }),
  });

  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok || data?.error) {
    const message =
      data?.message ||
      data?.error ||
      data?.details ||
      `HTTP ${res.status}: ${text}`;
    throw new Error(message);
  }
  return data as { success: boolean; paymentCardTokenId?: string | number };
}

async function deletePaymentMethod(
  customerInternalId: number,
  instrumentId: number | string
) {
  const normalizedId =
    typeof instrumentId === "number"
      ? instrumentId
      : /^\d+$/.test(String(instrumentId))
      ? Number(instrumentId)
      : instrumentId;

  const res = await fetch("/api/netsuite/delete-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerId: Number(customerInternalId),
      instrumentId: normalizedId,
    }),
  });

  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok || data?.success === false || data?.error) {
    const message =
      data?.message || data?.error || `HTTP ${res.status}: ${text}`;
    throw new Error(message);
  }

  return data as { success: boolean; action?: string; message?: string };
}

async function makePaymentDefault(
  customerInternalId: number,
  instrumentId: number | string
) {
  const normalizedId =
    typeof instrumentId === "number"
      ? instrumentId
      : /^\d+$/.test(String(instrumentId))
      ? Number(instrumentId)
      : instrumentId;

  const res = await fetch("/api/netsuite/make-payment-default", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerId: Number(customerInternalId),
      instrumentId: normalizedId,
    }),
  });

  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok || data?.success === false || data?.error) {
    const message =
      data?.message || data?.error || `HTTP ${res.status}: ${text}`;
    throw new Error(message);
  }

  return data as { success: boolean; action?: string };
}

/* ---------- UI blocks ---------- */
function PaymentMethodCard({
  pm,
  onDelete,
  onMakeDefault,
  disableDelete,
  deleteTooltip,
}: {
  pm: any;
  onDelete: (pm: any) => void;
  onMakeDefault: (pm: any) => void;
  disableDelete?: boolean;
  deleteTooltip?: string;
}) {
  return (
    <Card className="rounded-2xl border border-[#BFBFBF]/60 shadow-sm transition-shadow hover:shadow-md">
      <CardHeader
        title={
          <div className="flex flex-wrap items-center gap-2 text-base font-medium text-[#17152A] min-w-0">
            <span className="inline-flex items-center justify-center rounded-full bg-[#8C0F0F]/10 w-9 h-9 text-[#8C0F0F]">
              {typeIcon(pm, "w-5 h-5")}
            </span>
            <span className="truncate min-w-0">{pmLabel(pm)}</span>
            {pm.isDefault ? (
              <Chip
                size="small"
                color="success"
                label="Default"
                className="ml-1"
              />
            ) : null}

            {isProcessing(pm) ? (
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                className="ml-1"
                label="processing — will be usable shortly"
                sx={{
                  maxWidth: "100%",
                  "& .MuiChip-label": {
                    display: "block",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  },
                }}
              />
            ) : null}
          </div>
        }
        subheader={
          <span className="text-sm text-[#17152A]/70">
            {pm.name || pm.tokenFamilyLabel || undefined}
          </span>
        }
      />

      <CardContent className="pt-0">
        <div className="flex flex-wrap items-center gap-2 text-sm text-[#17152A]/70">
          {pm.tokenFamilyLabel ? (
            <Chip size="small" variant="outlined" label={pm.tokenFamilyLabel} />
          ) : null}
          {pm.brand ? (
            <Chip size="small" variant="outlined" label={pm.brand} />
          ) : null}
          {pm.type ? (
            <Chip
              size="small"
              variant="outlined"
              label={pm.type.toUpperCase()}
            />
          ) : null}
        </div>
      </CardContent>
      <Divider />
      <CardActions className="flex justify-between">
        <Tooltip
          title={pm.isDefault ? "This is already the default" : "Make Default"}
        >
          <span className="hidden">
            <MUIButton
              size="small"
              variant="outlined"
              onClick={() => onMakeDefault(pm)}
              disabled={pm.isDefault}
              sx={{
                textTransform: "none",
                borderColor: "#BFBFBF",
                color: "#17152A",
                "&:hover": {
                  backgroundColor: "#FFFFEC",
                  borderColor: "#BFBFBF",
                },
                "&.Mui-disabled": { color: "rgba(23,21,42,0.4)" },
              }}
            >
              Make Default
            </MUIButton>
          </span>
        </Tooltip>

        <Tooltip title={disableDelete ? deleteTooltip || "Remove" : "Remove"}>
          <span
            className={disableDelete ? "cursor-not-allowed" : undefined}
            onClick={(e) => {
              if (disableDelete) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            <IconButton
              onClick={() => onDelete(pm)}
              disabled={!!disableDelete}
              aria-label="Remove payment method"
              tabIndex={disableDelete ? -1 : 0}
              sx={{
                color: "#8C0F0F",
                "&:hover": { backgroundColor: "rgba(140,15,15,0.08)" },
                "&.Mui-disabled": { color: "rgba(140,15,15,0.35)" },
              }}
            >
              <Trash2 className="w-5 h-5" />
            </IconButton>
          </span>
        </Tooltip>
      </CardActions>
    </Card>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center border border-[#BFBFBF]/60 rounded-2xl p-10 bg-white shadow-sm">
      <div className="rounded-full bg-[#8C0F0F]/10 text-[#8C0F0F] p-4 mb-4">
        <CreditCard className="w-7 h-7" />
      </div>
      <h3 className="text-lg font-semibold text-[#17152A]">
        No payment methods yet
      </h3>
      <p className="text-[#17152A]/70 mt-1 max-w-md">
        Save your credit card securely to quickly pay invoices on the portal.
      </p>
    </div>
  );
}

/* ---------- Add Method Dialog ---------- */
function AddMethodDialog({
  open,
  onClose,
  onCreated,
  customerId,
  contactId,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (created: any | null) => void;
  customerId: number;
  contactId?: string | null;
}) {
  const IFRAME_HOST_HEIGHT = 520;

  const [frameLoading, setFrameLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [last4, setLast4] = useState("");
  const [brand, setBrand] = useState("");
  const [exp, setExp] = useState("");
  const [pendingSave, setPendingSave] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const clientRef = useRef<any>(null);
  const sessionIdRef = useRef<string>("");
  const pendingSaveRef = useRef(false);
  const setPendingSaveSafe = (v: boolean) => {
    pendingSaveRef.current = v;
    setPendingSave(v);
  };

  useEffect(() => {
    if (!open) {
      window.__VP_ADD_METHOD_LOCK__ = false;
      VP_ACTIVE = { key: 0, sid: null, handled: false };
      return;
    }
    if (window.__VP_ADD_METHOD_LOCK__) return;
    window.__VP_ADD_METHOD_LOCK__ = true;

    let cancelled = false;
    let offApproval: any = null;

    (async () => {
      setFrameLoading(true);
      setProcessing(false);
      setToken("");
      setLast4("");
      setBrand("");
      setExp("");

      try {
        const res = await fetch("/api/versapay/session", {
          method: "POST",
          cache: "no-store",
        });
        const { sessionId: sid, scriptSrc, error } = await res.json();
        if (!res.ok || error)
          throw new Error(error || "Failed to init VersaPay");

        sessionIdRef.current = sid;

        VP_ACTIVE.key += 1;
        VP_ACTIVE.sid = sid;
        VP_ACTIVE.handled = false;
        const myKey = VP_ACTIVE.key;

        if (!window.versapay) {
          await new Promise<void>((resolve, reject) => {
            const s = document.createElement("script");
            s.src = scriptSrc;
            s.async = true;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error("Failed to load VersaPay SDK"));
            document.body.appendChild(s);
          });
        }

        const clientOrPromise = window.versapay!.initClient(sid);
        const client =
          typeof (clientOrPromise as any)?.then === "function"
            ? await (clientOrPromise as any)
            : clientOrPromise;
        clientRef.current = client;

        offApproval = client.onApproval(
          async (result: any) => {
            if (VP_ACTIVE.key !== myKey) return;
            if (VP_ACTIVE.sid !== sid) return;
            if (VP_ACTIVE.handled) return;
            VP_ACTIVE.handled = true;

            const tok = result?.token || "";
            if (!tok) {
              setPendingSave(false);
              setProcessing(false);
              toast.error("Tokenization failed");
              return;
            }

            const l4 = String(
              result?.last4 || result?.accountLast4 || ""
            ).trim();
            const br = String(result?.brand || result?.cardBrand || "").trim();
            const ex =
              result?.expMonth && result?.expYear
                ? `${String(result.expMonth).padStart(2, "0")}/${String(
                    result.expYear
                  ).slice(-2)}`
                : "";

            setToken(tok);
            setLast4(l4);
            setBrand(br);
            setExp(ex);

            const needMeta = !l4 || !br || !ex;
            let meta: {
              last4?: string;
              brand?: string;
              transactionId?: string;
            } = {};
            if (needMeta) {
              setProcessing(true);
              try {
                meta = await enrichFromSale(sid, tok, contactId);
                if (meta.last4) setLast4(meta.last4);
                if (meta.brand) setBrand(meta.brand);
              } catch (e: any) {
                toast.warn(
                  e?.message || "Card metadata unavailable; saving token only."
                );
              } finally {
                if (!pendingSaveRef.current) setProcessing(false);
              }
            }
            await voidSaleIfPresent(meta.transactionId);
            if (pendingSaveRef.current) {
              setProcessing(true);
              await saveToNetSuite(
                tok,
                meta.last4 || last4 || l4 || "",
                exp || ex || "",
                meta.brand || brand || br || ""
              );
            }
          },
          (err: any) => {
            setPendingSaveSafe(false);
            setProcessing(false);
            toast.error(err?.error || "Payment method rejected");
          }
        );

        await client.initFrame(containerRef.current!, "100%", "100%");
        if (!cancelled) setFrameLoading(false);
      } catch (e: any) {
        toast.error(e?.message || "Could not start payment session");
        if (!cancelled) setFrameLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      try {
        if (typeof offApproval === "function") offApproval();
      } catch {}
      try {
        clientRef.current?.destroy?.();
      } catch {}
      try {
        clientRef.current?.removeFrame?.();
      } catch {}
      clientRef.current = null;
      window.__VP_ADD_METHOD_LOCK__ = false;
      VP_ACTIVE = { key: 0, sid: null, handled: false };
      setPendingSaveSafe(false);
    };
  }, [open, contactId]);

  async function voidSaleIfPresent(transactionId?: string) {
    if (!transactionId) return;
    try {
      const res = await fetch("/api/versapay/void-sale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId }),
      });
      if (!res.ok) {
        const t = await res.text();
        console.warn("[VersaPay] void-sale non-200:", res.status, t);
      }
    } catch (e) {
      console.warn("[VersaPay] void-sale threw", e);
    }
  }

  async function enrichFromSale(
    sid: string,
    tok: string,
    contactId?: string | null
  ) {
    const res = await fetch("/api/versapay/process-sale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sid,
        token: tok,
        amount: 0.1,
        capture: false,
        orderNumber: `PM-${Date.now()}`,
        currency: "USD",
        contactId,
      }),
    });

    const data = await res.json();
    if (!res.ok || (data as any)?.error) {
      throw new Error((data as any)?.error || "Sale lookup failed");
    }

    const pay =
      (data as any)?.payment ??
      (Array.isArray((data as any)?.payments)
        ? (data as any).payments[0]
        : data) ??
      {};

    const rawLast4 = pay?.accountNumberLastFour ?? "";
    const last4 = rawLast4;
    const brand = pay?.accountType ?? "";
    const transactionId =
      pay?.transactionId ?? pay?.id ?? (data as any)?.id ?? "";

    return { last4, brand, transactionId };
  }

  async function saveToNetSuite(
    tok: string,
    l4: string,
    ex: string,
    brandOrType: string
  ) {
    try {
      const last4 = l4;
      const resp = await createPaymentMethod(customerId, {
        token: tok,
        cardNameOnCard: name || undefined,
        tokenExpirationDate: ex || undefined,
        accountNumberLastFour: last4 || undefined,
        accountType: brandOrType || undefined,
      });

      toast.success("Payment method saved, will be ready to use shortly");
      onCreated({
        id: resp.paymentCardTokenId || tok,
        type: "card",
        brand: brandOrType || undefined,
        last4: last4 || undefined,
        exp: ex || undefined,
        name: name || undefined,
        tokenFamilyLabel: "Versapay",
        isDefault: false,
        netsuite_writes_status: "processing",
      });
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Failed to save payment method");
    } finally {
      setPendingSaveSafe(false);
      setProcessing(false);
    }
  }

  async function handleSave() {
    if (!clientRef.current) return;
    setProcessing(true);
    if (!token) {
      setPendingSaveSafe(true);
      try {
        await clientRef.current.submitEvents();
      } catch (e: any) {
        setPendingSave(true);
        setProcessing(false);
        toast.error(e?.message || "Tokenization failed");
      }
      return;
    }
    await saveToNetSuite(token, last4, exp, brand);
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle className="flex items-center gap-2 text-[#17152A]">
        <Plus className="w-5 h-5 text-[#8C0F0F]" /> Add payment method
      </DialogTitle>

      <DialogContent className="space-y-4">
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
          Enter card details below. Your card details will be securely
          Encrypted.
        </Alert>

        <div className="relative z-[1402] rounded-xl border border-[#BFBFBF]/60 bg-white p-4 sm:p-5 shadow-sm">
          {processing && (
            <div className="absolute top-3 right-3 pointer-events-none z-[1404]">
              <div className="flex items-center gap-2 bg-white/90 text-[#17152A] text-xs px-2 py-1 rounded-full shadow">
                <CircularProgress size={14} />
                <span>{token ? "Saving…" : "Processing…"}</span>
              </div>
            </div>
          )}
          <div className="relative" style={{ height: IFRAME_HOST_HEIGHT }}>
            {frameLoading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-[#17152A]/70">
                  <CircularProgress />
                  <span className="text-sm">Loading secure payment frame…</span>
                </div>
              </div>
            )}
            <div
              ref={containerRef}
              className={`absolute inset-0 transition-opacity duration-200 ${
                frameLoading ? "opacity-0" : "opacity-100"
              }`}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextField
            label="Status"
            size="small"
            fullWidth
            value={
              token
                ? "Token ready"
                : processing
                ? "Complete verification in the frame…"
                : frameLoading
                ? "Loading frame…"
                : "Iframe inititalized"
            }
            InputProps={{ readOnly: true }}
          />
        </div>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <MUIButton
          onClick={onClose}
          disabled={processing}
          sx={{ textTransform: "none" }}
        >
          Cancel
        </MUIButton>
        <MUIButton
          onClick={handleSave}
          disabled={processing || frameLoading}
          variant="contained"
          sx={{
            textTransform: "none",
            backgroundColor: "#8C0F0F",
            "&:hover": { backgroundColor: "#E01C24" },
            borderRadius: "0.75rem",
            boxShadow: "none",
          }}
        >
          {token ? "Save method" : "Save"}
        </MUIButton>
      </DialogActions>

      <Backdrop open={processing && !!token} sx={{ zIndex: 1400 }}>
        <div className="flex items-center gap-3 bg-white/85 rounded-full px-3 py-2 shadow">
          <CircularProgress size={20} />
          <span className="text-sm text-[#17152A]">
            {token ? "Saving…" : "Processing…"}
          </span>
        </div>
      </Backdrop>

      {processing && (
        <div className="fixed inset-0 z-[1403] pointer-events-none flex items-end justify-center p-4">
          <div className="flex items-center gap-2 bg-[#17152A]/90 text-white text-xs px-3 py-2 rounded-full shadow">
            <CircularProgress size={16} sx={{ color: "white" }} />
            <span>Complete verification in the frame…</span>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/* ---------- Page ---------- */
export default function PaymentMethodsPage() {
  const router = useRouter();
  const bootstrap = useCustomerBootstrap?.();
  const contactId = (bootstrap as any)?.hsId ?? null;

  const { customerId, loading, methods, refresh, setMethods } =
    usePaymentMethods();
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState<string>("");

  const [addPaypalOpen, setAddPaypalOpen] = useState(false);

  const hasCustomerId = Boolean(customerId);

  function handleCreated(pm: any | null) {
    if (!pm) return;
    setMethods((prev) => [pm, ...prev]);
  }

  async function handleDelete(pm: any) {
    if (!customerId) return;
    if (methods.length <= 1) {
      toast.error(DELETE_DISABLED_MSG);
      return;
    }
    const idStr = String(pm.id);
    const idNumeric =
      typeof pm.id === "number"
        ? pm.id
        : /^\d+$/.test(idStr)
        ? Number(idStr)
        : null;
    if (idNumeric == null) {
      toast.error("Can't delete: missing NetSuite token ID.");
      return;
    }
    if (!confirm("Remove this payment method?")) return;
    setBusyText("Deleting token");
    setBusy(true);
    const prev = methods;
    setMethods(prev.filter((x) => x.id !== pm.id));
    try {
      await deletePaymentMethod(Number(customerId), idNumeric);
      toast.success("Removed");
    } catch (e: any) {
      setMethods(prev);
      toast.error(e?.message || "Failed to remove");
    } finally {
      setBusy(false);
      setBusyText("");
    }
  }

  async function handleMakeDefault(pm: any) {
    if (!customerId || pm.isDefault) return;
    const idStr = String(pm.id);
    const idNumeric =
      typeof pm.id === "number"
        ? pm.id
        : /^\d+$/.test(idStr)
        ? Number(idStr)
        : null;
    if (idNumeric == null) {
      toast.error("Can't set default: missing NetSuite token ID.");
      return;
    }
    setBusyText("Updating Default");
    setBusy(true);
    const prev = methods;
    setMethods(prev.map((x) => ({ ...x, isDefault: x.id === pm.id })));
    try {
      await makePaymentDefault(Number(customerId), idNumeric);
      toast.success("Default updated");
      await refresh();
    } catch (e: any) {
      setMethods(prev);
      toast.error(e?.message || "Failed to update default");
    } finally {
      setBusy(false);
      setBusyText("");
    }
  }

  async function handleAddMethodClick() {
    if (!hasCustomerId) return;

    if (!contactId) {
      toast.warn(
        "Please add your billing address before adding a payment method"
      );
      router.push("/profile?missing=billing");
      return;
    }

    try {
      const res = await fetch(
        `/api/hubspot/has-billing?contactId=${encodeURIComponent(contactId)}`,
        { cache: "no-store" }
      );
      const data = await res.json();

      if (!res.ok || data?.hasBilling === false) {
        toast.warn(
          "Please add your billing address before adding a payment method"
        );
        router.push("/profile?missing=billing");
        return;
      }

      setAddOpen(true);
    } catch {
      setAddOpen(true);
    }
  }
  async function handleAddPaypalClick() {
    if (!hasCustomerId) return;

    if (!contactId) {
      toast.warn(
        "Please add your billing address before adding a payment method"
      );
      router.push("/profile?missing=billing");
      return;
    }

    try {
      const res = await fetch(
        `/api/hubspot/has-billing?contactId=${encodeURIComponent(contactId)}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok) {
        //|| data?.hasBilling === false
        toast.warn(
          "Please add your billing address before adding a payment method"
        );
        router.push("/profile?missing=billing");
        return;
      }
    } catch {}

    setAddPaypalOpen(true);
  }

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[#F7F7F9]">
      <div className="mx-auto max-w-5xl px-4 py-6 md:py-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 text-[#17152A]">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#8C0F0F]/10 text-[#8C0F0F]">
                <WalletCards className="w-5 h-5" />
              </span>
              Payment Methods
            </h1>

            <div className="mt-2 h-[3px] w-24 rounded-full bg-gradient-to-r from-[#8C0F0F] to-[#E01C24]" />
          </div>
          <div className="flex items-center gap-2">
            <Tooltip title="Refresh">
              <span>
                <IconButton
                  onClick={async () => {
                    if (!hasCustomerId) return;
                    await refresh();
                  }}
                  sx={{ color: "#17152A" }}
                >
                  <RefreshCw className="w-5 h-5" />
                </IconButton>
              </span>
            </Tooltip>
            <MUIButton
              variant="contained"
              startIcon={<Plus />}
              onClick={handleAddMethodClick}
              disabled={!hasCustomerId}
              sx={{
                textTransform: "none",
                backgroundColor: "#8C0F0F",
                "&:hover": { backgroundColor: "#E01C24" },
                borderRadius: "0.75rem",
                boxShadow: "none",
                "&.Mui-disabled": { backgroundColor: "rgba(140,15,15,0.35)" },
              }}
            >
              Add method
            </MUIButton>
            <MUIButton
              variant="outlined"
              startIcon={<WalletCards />}
              onClick={handleAddPaypalClick}
              disabled={!hasCustomerId}
              sx={{
                textTransform: "none",
                borderRadius: "0.75rem",
                borderColor: "#BFBFBF",
                color: "#17152A",
                "&:hover": {
                  backgroundColor: "#FFFFEC",
                  borderColor: "#BFBFBF",
                },
              }}
            >
              Add PayPal
            </MUIButton>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="rounded-2xl border border-[#BFBFBF]/60">
                <CardHeader
                  title={<Skeleton variant="text" width={160} />}
                  subheader={<Skeleton variant="text" width={120} />}
                />
                <CardContent>
                  <Skeleton variant="rounded" height={28} />
                </CardContent>
                <CardActions>
                  <Skeleton variant="rounded" height={36} width={100} />
                </CardActions>
              </Card>
            ))}
          </div>
        ) : methods.length === 0 ? (
          <EmptyState onAdd={handleAddMethodClick} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {methods
              .filter((pm) => !isFailed(pm))
              .map((pm) => (
                <PaymentMethodCard
                  key={String(pm.id)}
                  pm={pm}
                  onDelete={handleDelete}
                  onMakeDefault={handleMakeDefault}
                  disableDelete={methods.length <= 1 || isProcessing(pm)}
                  deleteTooltip={DELETE_DISABLED_MSG}
                />
              ))}
          </div>
        )}
      </div>

      {hasCustomerId ? (
        <AddMethodDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onCreated={handleCreated}
          customerId={Number(customerId)}
          contactId={contactId}
        />
      ) : null}

      {hasCustomerId ? (
        <AddPaypalMethodDialog
          open={addPaypalOpen}
          onClose={() => setAddPaypalOpen(false)}
          nsCustomerId={Number(customerId)}
          onCreated={handleCreated}
        />
      ) : null}

      <Portal>
        <Backdrop
          open={busy}
          sx={{
            color: "#fff",
            zIndex: 2147483647,
            flexDirection: "column",
            gap: 2,
          }}
        >
          <CircularProgress color="inherit" />
          <Typography sx={{ fontWeight: 600 }}>
            {busyText || "Working…"}
          </Typography>
          <Box sx={{ width: 320, mt: 1 }}>
            <LinearProgress color="inherit" />
          </Box>
        </Backdrop>
      </Portal>
    </div>
  );
}
