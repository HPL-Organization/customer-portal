"use client";

import * as React from "react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import {
  usePaymentMethods,
  type PaymentMethod,
} from "@/components/providers/PaymentMethodsProvider";
import {
  Backdrop,
  Box,
  Button as MUIButton,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
  FormHelperText,
  LinearProgress,
  MenuItem,
  Portal,
  Select,
  Tooltip,
  Typography,
} from "@mui/material";
import { CreditCard, RefreshCw, Settings2, Zap } from "lucide-react";

function pmLabel(pm: PaymentMethod) {
  const brand = pm.brand || (pm.type === "ach" ? "Bank" : "Card");
  const last4 = pm.last4 ? `•••• ${pm.last4}` : "";
  const exp = pm.exp ? ` · exp ${pm.exp}` : "";
  return `${brand} ${last4}${exp}`.trim();
}

function isProcessing(pm: PaymentMethod) {
  const a = String(pm?.instrument_id ?? "").toLowerCase();
  const b = String(pm?.netsuite_writes_status ?? "").toLowerCase();
  return a.startsWith("processing") || b === "processing";
}

function isFailed(pm: PaymentMethod) {
  const b = String(pm?.netsuite_writes_status ?? "").toLowerCase();
  return b === "failed";
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function ExpressPayPage() {
  const router = useRouter();
  const { customerId, loading, methods, refresh, setMethods } =
    usePaymentMethods();
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState("");

  const hasCustomerId = Boolean(customerId);
  const usableAutopayMethods = useMemo(
    () =>
      methods.filter(
        (pm) => !isFailed(pm) && !isProcessing(pm) && pm.instrument_id,
      ),
    [methods],
  );
  const selectedAutopayInstrumentId = useMemo(() => {
    const preferred = usableAutopayMethods.find(
      (pm) => pm.preferredAutopayMethod,
    );
    return preferred?.instrument_id ? String(preferred.instrument_id) : "";
  }, [usableAutopayMethods]);

  async function handleAutopayPreferenceChange(instrumentId: string) {
    if (!customerId) return;

    setBusyText("Updating Express Pay");
    setBusy(true);

    try {
      const res = await fetch("/api/netsuite/set-preferred-autopay-method", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: Number(customerId),
          instrumentId: instrumentId || null,
        }),
      });

      const text = await res.text();
      let data: Record<string, unknown> = {};
      try {
        data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        data = { raw: text };
      }

      if (!res.ok || data?.success === false) {
        throw new Error(
          typeof data?.message === "string"
            ? data.message
            : "Failed to update Express Pay",
        );
      }

      setMethods((prev) =>
        prev.map((pm) => ({
          ...pm,
          preferredAutopayMethod:
            instrumentId !== "" &&
            String(pm.instrument_id ?? pm.id) === String(instrumentId),
        })),
      );

      toast.success(
        instrumentId ? "Express Pay updated" : "Express Pay turned off",
      );
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to update Express Pay"));
    } finally {
      setBusy(false);
      setBusyText("");
    }
  }

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[#F7F7F9]">
      <div className="mx-auto max-w-4xl px-4 py-6 md:py-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-[#17152A]">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#8C0F0F]/10 text-[#8C0F0F]">
                <Zap className="h-5 w-5" />
              </span>
              Express Pay
            </h1>
            <div className="mt-2 h-[3px] w-24 rounded-full bg-gradient-to-r from-[#8C0F0F] to-[#E01C24]" />
          </div>

          <div className="flex items-center gap-2">
            <Tooltip title="Refresh payment methods">
              <span>
                <MUIButton
                  onClick={async () => {
                    if (!hasCustomerId) return;
                    await refresh();
                  }}
                  variant="outlined"
                  startIcon={<RefreshCw className="h-4 w-4" />}
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
                  Refresh
                </MUIButton>
              </span>
            </Tooltip>

            <MUIButton
              variant="contained"
              startIcon={<Settings2 className="h-4 w-4" />}
              onClick={() => router.push("/payment")}
              sx={{
                textTransform: "none",
                backgroundColor: "#8C0F0F",
                "&:hover": { backgroundColor: "#E01C24" },
                borderRadius: "0.75rem",
                boxShadow: "none",
              }}
            >
              Manage payment methods
            </MUIButton>
          </div>
        </div>

        <Card className="mb-5 overflow-hidden rounded-2xl border border-[#F2C66D] bg-gradient-to-r from-[#FFF8DD] via-[#FFFCEB] to-[#FFF3D1] shadow-sm">
          <CardContent className="space-y-4 p-5 sm:p-6">
            <div className="space-y-2">
              <p className="text-sm leading-6 text-[#17152A]/80 sm:text-[15px]">
                Turn on{" "}
                <Tooltip
                  arrow
                  enterTouchDelay={0}
                  leaveTouchDelay={5000}
                  placement="bottom-start"
                  title={
                    <div className="space-y-3">
                      <p>
                        Enabling <strong>Express Pay</strong> allows us to
                        process your order and{" "}
                        <strong>ship it to you quickly</strong>.
                      </p>
                      <p>
                        It eliminates verification calls for balance payments
                        and helps get your order
                        <strong> shipped immediately</strong>.
                      </p>
                      <p>
                        You can <strong>update or remove</strong> your payment
                        method at any time.
                      </p>
                      <p>
                        You will be <strong>notified in advance</strong> of
                        upcoming charges before processing.
                      </p>
                    </div>
                  }
                  slotProps={{
                    tooltip: {
                      sx: {
                        backgroundColor: "#FFFFFF",
                        color: "#17152A",
                        border: "1px solid #E7D9D9",
                        borderRadius: "16px",
                        boxShadow: "0 18px 50px rgba(23,21,42,0.16)",
                        fontSize: { xs: "0.8125rem", sm: "0.875rem" },
                        lineHeight: 1.7,
                        fontWeight: 400,
                        maxWidth: {
                          xs: "min(320px, calc(100vw - 24px))",
                          sm: 360,
                        },
                        mx: { xs: 1, sm: 0 },
                        p: { xs: 1.5, sm: 2 },
                        "& strong": {
                          color: "#8C0F0F",
                          fontWeight: 700,
                        },
                      },
                    },
                    arrow: {
                      sx: {
                        color: "#FFFFFF",
                        "&:before": {
                          border: "1px solid #E7D9D9",
                        },
                      },
                    },
                  }}
                >
                  <span className="inline-flex cursor-help font-semibold text-[#8C0F0F] underline decoration-[#E01C24]/60 underline-offset-4 transition-colors duration-200 hover:text-[#E01C24]">
                    Express Pay
                  </span>
                </Tooltip>{" "}
                to make checkout faster and easier. We’ll securely use your
                saved payment method to handle deposits and any remaining
                balance as your items become available.
              </p>
              <p className="text-sm leading-6 text-[#17152A]/80 sm:text-[15px]">
                For items that aren’t currently in stock, only a 10% deposit is
                required at the time of order. The remaining balance will only
                be processed when your items are ready to ship.
              </p>
              <p className="text-sm leading-6 text-[#17152A]/80 sm:text-[15px]">
                We’ll always send you an email in advance before any payment is
                processed, so you have time to review or make changes if needed.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-[#BFBFBF]/60 shadow-sm">
          <CardContent className="space-y-4 p-5 sm:p-6">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-[#17152A]">
                Choose your preferred payment method to enable Express Pay
              </h2>
            </div>

            {loading ? (
              <div className="space-y-3 rounded-2xl border border-[#BFBFBF]/50 bg-[#FAFAFB] p-4">
                <div className="text-sm text-[#17152A]/70">
                  Loading saved payment methods...
                </div>
                <LinearProgress />
              </div>
            ) : (
              <>
                <FormControl
                  fullWidth
                  disabled={!hasCustomerId || !usableAutopayMethods.length}
                >
                  <Select
                    value={selectedAutopayInstrumentId}
                    onChange={(e) =>
                      void handleAutopayPreferenceChange(String(e.target.value))
                    }
                    displayEmpty
                  >
                    <MenuItem value="">Don&apos;t use Express Pay</MenuItem>
                    {usableAutopayMethods.map((pm) => (
                      <MenuItem
                        key={String(pm.instrument_id ?? pm.id)}
                        value={String(pm.instrument_id ?? pm.id)}
                      >
                        {pmLabel(pm)}
                      </MenuItem>
                    ))}
                  </Select>
                  <FormHelperText>
                    {!hasCustomerId
                      ? "Payment methods are unavailable for this account."
                      : usableAutopayMethods.length === 0
                        ? "No saved payment methods are currently eligible for Express Pay. Add or update a payment method to enable it."
                        : 'You can turn Express Pay off at any time by selecting "Don\'t use Express Pay".'}
                  </FormHelperText>
                </FormControl>

                {!usableAutopayMethods.length ? (
                  <div className="rounded-2xl border border-dashed border-[#D7D0C5] bg-[#FFFCF1] p-4 text-sm leading-6 text-[#17152A]/80">
                    <div className="mb-2 flex items-center gap-2 font-semibold text-[#17152A]">
                      <CreditCard className="h-4 w-4 text-[#8C0F0F]" />
                      Add a saved payment method first
                    </div>
                    Manage your saved cards or bank accounts on the payment
                    methods page, then come back here to enable Express Pay.
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>

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
            {busyText || "Working..."}
          </Typography>
          <Box sx={{ width: 320, mt: 1 }}>
            <LinearProgress color="inherit" />
          </Box>
        </Backdrop>
      </Portal>
    </div>
  );
}
