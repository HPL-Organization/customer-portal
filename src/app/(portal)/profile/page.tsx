"use client";

import React, { useState, useEffect, useRef } from "react";
import { toast } from "react-toastify";
import {
  Checkbox,
  FormControlLabel,
  Backdrop,
  CircularProgress,
  LinearProgress,
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  Button as MUIButton,
} from "@mui/material";
import { Save } from "lucide-react";

import InputField from "@/components/UI/inputField";
import Button from "@/components/UI/button";
import GoogleMapsLoader from "@/components/google/GoogleMapsLoader";
import AddressAutocomplete from "@/components/google/AddressAutocomplete";
import { useCustomerBootstrap } from "@/components/providers/CustomerBootstrap";
import ProfileSkeleton from "@/components/skeletons/ProfileSkeleton";

const InfoTab = () => {
  const {
    nsId,
    hsId: contactId,
    initialized,
    loading,
    setHsId,
  } = useCustomerBootstrap();

  const [contactLoading, setContactLoading] = useState(false);
  const [hasHubSpot, setHasHubSpot] = useState<boolean | null>(null);

  const [shippingVerified, setShippingVerified] = useState(false);
  const [billingVerified, setBillingVerified] = useState(false);

  const [hasPortalInfo, setHasPortalInfo] = useState<boolean | null>(null);

  const HUBSPOT_FLAG_PROPS = {
    shipping: "hpl_shipping_check",
    billing: "hpl_billing_check",
  };
  const toHSText = (v: boolean) => (v ? "true" : "false");
  const fromHSText = (v: unknown) => {
    const s = String(v ?? "")
      .trim()
      .toLowerCase();
    return s === "true" || s === "yes" || s === "1";
  };

  const [formData, setFormData] = useState({
    firstName: "",
    middleName: "",
    lastName: "",
    email: "",
    phone: "",
    mobile: "",
    shipping: {
      address1: "",
      address2: "",
      city: "",
      state: "",
      zip: "",
      country: "",
    },
    billing: {
      address1: "",
      address2: "",
      city: "",
      state: "",
      zip: "",
      country: "",
    },
    sameAsShipping: false,
  });

  const [saving, setSaving] = useState(false);
  const [loaderIdx, setLoaderIdx] = useState(0);
  const [loaderMsgs, setLoaderMsgs] = useState<string[]>([
    "Saving your information…",
    "Finishing up…",
  ]);
  const timeoutRef = useRef<number | null>(null);

  const [dirty, setDirty] = useState(false);
  const allowNextNavRef = useRef(false);
  const [navOpen, setNavOpen] = useState(false);
  const navHrefRef = useRef<string | null>(null);
  const navKindRef = useRef<"href" | "back" | null>(null);

  const markDirty = () => setDirty(true);

  useEffect(() => {
    if (!saving) return;
    setLoaderIdx(0);
    const step = (i: number) => {
      if (i >= loaderMsgs.length - 1) return;
      timeoutRef.current = window.setTimeout(() => {
        setLoaderIdx(i + 1);
        step(i + 1);
      }, 1200);
    };
    step(0);
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [saving, loaderMsgs]);

  // useEffect(() => {
  //   if (!initialized || loading) return;

  //   if (!contactId) {
  //     setHasHubSpot(false);
  //     setContactLoading(false);
  //     return;
  //   }

  //   (async () => {
  //     setContactLoading(true);
  //     try {
  //       const res = await fetch(`/api/hubspot/contact?contactId=${contactId}`, {
  //         cache: "no-store",
  //       });

  //       if (res.status === 404) {
  //         setHasHubSpot(false);
  //         return;
  //       }

  //       const data = await res.json();
  //       if (!data?.properties) {
  //         setHasHubSpot(false);
  //         return;
  //       }

  //       setHasHubSpot(true);

  //       setFormData((prev) => ({
  //         ...prev,
  //         firstName: data.properties.firstname || "",
  //         middleName: data.properties.middle_name || "",
  //         lastName: data.properties.lastname || "",
  //         email: data.properties.email || "",
  //         phone: data.properties.phone || "",
  //         mobile: data.properties.mobilephone || "",
  //         shipping: {
  //           ...prev.shipping,
  //           address1: data.properties.shipping_address || "",
  //           address2: data.properties.shipping_address_line_2 || "",
  //           city: data.properties.shipping_city || "",
  //           state: data.properties.shipping_state_region || "",
  //           zip: data.properties.shipping_postalcode || "",
  //           country: data.properties.shipping_country_region || "",
  //         },
  //         billing: {
  //           ...prev.billing,
  //           address1: data.properties.address || "",
  //           address2: data.properties.address_line_2 || "",
  //           city: data.properties.city || "",
  //           state: data.properties.state || "",
  //           zip: data.properties.zip || "",
  //           country: data.properties.country || "",
  //         },
  //       }));

  //       setShippingVerified(
  //         fromHSText(data.properties?.[HUBSPOT_FLAG_PROPS.shipping])
  //       );
  //       setBillingVerified(
  //         fromHSText(data.properties?.[HUBSPOT_FLAG_PROPS.billing])
  //       );
  //     } catch (err) {
  //       toast.error("Failed to fetch contact.");
  //       console.error("Failed to fetch contact", err);
  //       setHasHubSpot(false);
  //     } finally {
  //       setContactLoading(false);
  //     }
  //   })();
  // }, [initialized, loading, contactId]);
  useEffect(() => {
    if (!initialized || loading) return;

    if (!nsId) {
      setHasPortalInfo(false);
      setContactLoading(false);
      return;
    }

    (async () => {
      setContactLoading(true);
      try {
        const res = await fetch(
          `/api/supabase/get-customer-info?nsId=${encodeURIComponent(nsId)}`,
          { cache: "no-store" }
        );

        if (!res.ok) {
          setHasPortalInfo(false);
          return;
        }

        const { data } = await res.json();
        if (!data) {
          setHasPortalInfo(false);
          return;
        }

        setHasPortalInfo(true);

        setFormData((prev) => ({
          ...prev,
          firstName: data.first_name || "",
          middleName: data.middle_name || "",
          lastName: data.last_name || "",
          email: data.email || "",
          phone: data.phone || "",
          mobile: data.mobile || "",
          shipping: {
            ...prev.shipping,
            address1: data.shipping_address1 || "",
            address2: data.shipping_address2 || "",
            city: data.shipping_city || "",
            state: data.shipping_state || "",
            zip: data.shipping_zip || "",
            country: data.shipping_country || "",
          },
          billing: {
            ...prev.billing,
            address1: data.billing_address1 || "",
            address2: data.billing_address2 || "",
            city: data.billing_city || "",
            state: data.billing_state || "",
            zip: data.billing_zip || "",
            country: data.billing_country || "",
          },
        }));

        setShippingVerified(!!data.shipping_verified);
        setBillingVerified(!!data.billing_verified);
      } catch (err) {
        toast.error("Failed to fetch customer info.");
        console.error("Failed to fetch customer info", err);
        setHasPortalInfo(false);
      } finally {
        setContactLoading(false);
      }
    })();
  }, [initialized, loading, nsId]);

  useEffect(() => {
    const isSameOrigin = (href: string) => {
      try {
        const u = new URL(href, window.location.href);
        return u.origin === window.location.origin;
      } catch {
        return false;
      }
    };
    const isInternalPath = (href: string) => {
      try {
        const u = new URL(href, window.location.href);
        return isSameOrigin(href) && u.pathname !== window.location.pathname;
      } catch {
        return false;
      }
    };
    const openPrompt = (kind: "href" | "back", href: string | null) => {
      navKindRef.current = kind;
      navHrefRef.current = href;
      setNavOpen(true);
    };
    const handleClick = (e: MouseEvent) => {
      if (!dirty || allowNextNavRef.current) return;
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      let el = e.target as HTMLElement | null;
      while (el && el !== document.body) {
        if (el instanceof HTMLAnchorElement && el.href) {
          if (
            !el.target &&
            isInternalPath(el.href) &&
            !el.href.startsWith("mailto:") &&
            !el.href.startsWith("tel:")
          ) {
            e.preventDefault();
            openPrompt("href", el.href);
            return;
          }
          break;
        }
        el = el.parentElement;
      }
    };
    const handlePopState = () => {
      if (!dirty || allowNextNavRef.current) return;
      history.pushState(null, "", window.location.href);
      openPrompt("back", null);
    };
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    document.addEventListener("click", handleClick, true);
    window.addEventListener("popstate", handlePopState);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [dirty]);

  const proceedNavigation = () => {
    allowNextNavRef.current = true;
    setNavOpen(false);
    if (navKindRef.current === "href" && navHrefRef.current) {
      window.location.href = navHrefRef.current;
    } else if (navKindRef.current === "back") {
      history.back();
    }
  };

  const cancelNavigation = () => {
    setNavOpen(false);
    navKindRef.current = null;
    navHrefRef.current = null;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    markDirty();
  };

  const handleAddressChange = (
    type: "shipping" | "billing",
    field: string,
    value: string
  ) => {
    setFormData((prev) => ({
      ...prev,
      [type]: { ...prev[type], [field]: value },
    }));
    markDirty();
  };

  const saveHubSpot = async (): Promise<{ ok: boolean; hsId?: string }> => {
    const properties = {
      firstname: formData.firstName,
      middle_name: formData.middleName,
      lastname: formData.lastName,
      email: formData.email,
      phone: formData.phone,
      mobilephone: formData.mobile,
      shipping_address: formData.shipping.address1,
      shipping_address_line_2: formData.shipping.address2,
      shipping_city: formData.shipping.city,
      shipping_state_region: formData.shipping.state,
      shipping_postalcode: formData.shipping.zip,
      shipping_country_region: formData.shipping.country,
      address: formData.billing.address1,
      address_line_2: formData.billing.address2,
      city: formData.billing.city,
      state: formData.billing.state,
      zip: formData.billing.zip,
      country: formData.billing.country,
      [HUBSPOT_FLAG_PROPS.shipping]: toHSText(shippingVerified),
      [HUBSPOT_FLAG_PROPS.billing]: toHSText(billingVerified),
    };

    try {
      if (hasHubSpot && contactId) {
        const res = await fetch("/api/hubspot/contact", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactId, update: properties }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast.error(err.error || "Failed to update contact.");
          return { ok: false };
        }
        toast.success("Contact updated successfully!");
        return { ok: true, hsId: contactId };
      } else {
        const res = await fetch("/api/hubspot/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ create: properties }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast.error(err.error || "Failed to create HubSpot contact.");
          return { ok: false };
        }
        const created = await res.json();
        const newId = String(
          created?.id || created?.vid || created?.contactId || ""
        ).trim();
        if (!newId) {
          toast.error("HubSpot returned no ID.");
          return { ok: false };
        }
        setHsId(newId);
        setHasHubSpot(true);
        toast.success("Created HubSpot contact");
        return { ok: true, hsId: newId };
      }
    } catch (error) {
      toast.error("Something went wrong while saving to HubSpot.");
      console.error("HubSpot Save Error:", error);
      return { ok: false };
    }
  };

  const saveNetSuite = async (
    controlBackdrop: boolean = true,
    hsIdOverride?: string
  ) => {
    if (controlBackdrop) {
      setLoaderMsgs(["Saving your information…", "Finishing up…"]);
      setSaving(true);
    }

    const netsuitePayload: any = {
      firstName: formData.firstName,
      middleName: formData.middleName,
      lastName: formData.lastName,
      email: formData.email,
      phone: formData.phone,
      mobile: formData.mobile,
      billingAddress1: formData.billing.address1,
      billingAddress2: formData.billing.address2,
      billingCity: formData.billing.city,
      billingState: formData.billing.state,
      billingZip: formData.billing.zip,
      billingCountry: formData.billing.country,
      shippingAddress1: formData.shipping.address1,
      shippingAddress2: formData.shipping.address2,
      shippingCity: formData.shipping.city,
      shippingState: formData.shipping.state,
      shippingZip: formData.shipping.zip,
      shippingCountry: formData.shipping.country,
    };

    const hsToSend = hsIdOverride || contactId || null;
    if (hsToSend) netsuitePayload.hsContactId = hsToSend;

    try {
      const res = await fetch("/api/netsuite/create-customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(netsuitePayload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(`NetSuite failed: ${err.error || res.statusText}`);
        return { ok: false };
      }

      toast.success("Contact sent to NetSuite!");
      return { ok: true };
    } catch (error) {
      console.error("NetSuite Save Error:", error);
      toast.error("Something went wrong while saving to NetSuite.");
      return { ok: false };
    } finally {
      if (controlBackdrop) setSaving(false);
    }
  };

  const saveSupabase = async () => {
    try {
      const res = await fetch("/api/supabase/save-customer-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          shippingVerified,
          billingVerified,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to save to portal.");
        return { ok: false };
      }
      toast.success("Saved to portal!");
      return { ok: true };
    } catch (e) {
      console.error("Supabase Save Error:", e);
      toast.error("Something went wrong while saving to the portal.");
      return { ok: false };
    }
  };

  const handleSaveAll = async () => {
    setLoaderMsgs(["Saving your information…", "Finishing up…"]);
    setSaving(true);

    const result = await saveHubSpot();
    if (!result.ok) {
      setSaving(false);
      return;
    }
    await saveSupabase();
    setLoaderMsgs(["Saving your information…", "Finishing up…"]);
    setLoaderIdx(0);

    const ns = await saveNetSuite(false, result.hsId);
    setSaving(false);
    if (ns?.ok) {
      setDirty(false);
      allowNextNavRef.current = false;
      navKindRef.current = null;
      navHrefRef.current = null;
    }
  };

  return (
    <>
      {!initialized || loading ? (
        <ProfileSkeleton />
      ) : (
        <div className="mx-auto max-w-5xl p-6 md:p-8">
          {contactLoading && (
            <Box sx={{ mb: 2 }}>
              <LinearProgress />
            </Box>
          )}

          {hasHubSpot === false && (
            <div className="mb-3 rounded-xl border border-[#BFBFBF]/60 bg-white px-3 py-2 text-sm text-[#17152A] shadow-sm">
              New to HPL? You can enter all your billing and shipping
              information here
            </div>
          )}

          <div className="mb-5 flex items-center justify-between">
            <div>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-[#17152A]">
                My Info
              </h1>
              <div className="mt-3 h-[3px] w-24 rounded-full bg-gradient-to-r from-[#8C0F0F] to-[#E01C24]" />
            </div>
            <Button
              onClick={handleSaveAll}
              className="px-4 py-2 text-sm rounded-xl bg-[#8C0F0F] text-white hover:bg-[#E01C24] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8C0F0F]/30"
            >
              Save
            </Button>
          </div>

          <section className="mb-8 rounded-2xl border border-[#BFBFBF]/60 bg-white p-4 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-[#17152A]">
              Contact Details
            </h2>
            <div className="grid grid-cols-1 gap-4 text-black md:grid-cols-3">
              <InputField
                label="First Name"
                name="firstName"
                value={formData.firstName}
                onChange={handleChange}
              />
              <InputField
                label="Middle Name"
                name="middleName"
                value={formData.middleName}
                onChange={handleChange}
              />
              <InputField
                label="Last Name"
                name="lastName"
                value={formData.lastName}
                onChange={handleChange}
              />
              <InputField
                label="Email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                disabled
              />
              <InputField
                label="Phone"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
              />
              <InputField
                label="Mobile"
                name="mobile"
                value={formData.mobile}
                onChange={handleChange}
              />
            </div>
          </section>

          <section className="mb-8 rounded-2xl border border-[#BFBFBF]/60 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-2 rounded-full border border-[#8C0F0F]/30 bg-[#8C0F0F]/10 px-3 py-1 text-[11px] font-medium text-[#8C0F0F]">
                Google Shipping Address Lookup
              </span>
              <FormControlLabel
                control={<Checkbox checked={shippingVerified} disabled />}
                label="Verified via Google"
              />
            </div>
            <div className="mb-4">
              <GoogleMapsLoader>
                <AddressAutocomplete
                  onAddressSelect={(p: any) => {
                    handleAddressChange("shipping", "address1", p.address1);
                    handleAddressChange("shipping", "city", p.city);
                    handleAddressChange("shipping", "state", p.state);
                    handleAddressChange("shipping", "zip", p.zip);
                    handleAddressChange("shipping", "country", p.country);
                    setShippingVerified(true);
                    markDirty();
                  }}
                />
              </GoogleMapsLoader>
            </div>
            <div className="my-4 h-px w-full bg-[#BFBFBF]/60" />

            <h2 className="mb-2 text-lg font-semibold text-[#17152A]">
              Shipping Address
            </h2>
            <div className="grid grid-cols-1 gap-4 text-black md:grid-cols-2">
              {["address1", "city", "address2", "state", "zip", "country"].map(
                (field) => (
                  <InputField
                    key={field}
                    label={field.charAt(0).toUpperCase() + field.slice(1)}
                    value={(formData.shipping as any)[field]}
                    onChange={(e: any) =>
                      handleAddressChange("shipping", field, e.target.value)
                    }
                  />
                )
              )}
            </div>
          </section>

          <section className="mb-8 rounded-2xl border border-[#BFBFBF]/60 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-2 rounded-full border border-[#8C0F0F]/30 bg-[#8C0F0F]/10 px-3 py-1 text-[11px] font-medium text-[#8C0F0F]">
                Google Billing Address Lookup
              </span>
              <FormControlLabel
                control={<Checkbox checked={billingVerified} disabled />}
                label="Verified via Google"
              />
            </div>
            <div className="mb-4">
              <GoogleMapsLoader>
                <AddressAutocomplete
                  onAddressSelect={(p: any) => {
                    handleAddressChange("billing", "address1", p.address1);
                    handleAddressChange("billing", "city", p.city);
                    handleAddressChange("billing", "state", p.state);
                    handleAddressChange("billing", "zip", p.zip);
                    handleAddressChange("billing", "country", p.country);
                    setBillingVerified(true);
                    markDirty();
                  }}
                />
              </GoogleMapsLoader>
            </div>
            <div className="my-4 h-px w-full bg-[#BFBFBF]/60" />

            <h2 className="mb-2 text-lg font-semibold text-[#17152A]">
              Billing Address
            </h2>
            <div className="grid grid-cols-1 gap-4 text-black md:grid-cols-2">
              {["address1", "city", "address2", "state", "zip", "country"].map(
                (field) => (
                  <InputField
                    key={field}
                    label={field.charAt(0).toUpperCase() + field.slice(1)}
                    value={(formData.billing as any)[field]}
                    onChange={(e: any) =>
                      handleAddressChange("billing", field, e.target.value)
                    }
                  />
                )
              )}
            </div>
          </section>

          <div className="flex justify-end">
            <Button
              onClick={handleSaveAll}
              className="px-4 py-2 text-sm rounded-xl bg-[#8C0F0F] text-white hover:bg-[#E01C24] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8C0F0F]/30"
            >
              Save
            </Button>
          </div>

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

          <Dialog
            open={navOpen}
            onClose={() => {
              cancelNavigation();
            }}
            aria-labelledby="unsaved-dialog-title"
            PaperProps={{
              sx: {
                borderRadius: 3,
                width: 520,
                maxWidth: "90vw",
                boxShadow:
                  "0 10px 30px rgba(2,6,23,0.25), 0 1px 0 rgba(2,6,23,0.05)",
              },
            }}
          >
            <DialogTitle id="unsaved-dialog-title" sx={{ pb: 1 }}>
              <Box className="flex items-center gap-3">
                <Box
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: "9999px",
                    backgroundColor: "#fee2e2",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <Save className="h-4 w-4" color="#b91c1c" />
                </Box>
                <Box>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>
                    Leave without saving?
                  </div>
                  <div style={{ fontSize: 12, color: "rgba(0,0,0,0.6)" }}>
                    You have unsaved changes on this page.
                  </div>
                </Box>
              </Box>
            </DialogTitle>
            <DialogContent sx={{ pt: 1 }}>
              <Box className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div style={{ fontSize: 13, color: "rgba(0,0,0,0.6)" }}>
                  If you leave now, your changes will be discarded. To keep
                  them, click Save first.
                </div>
              </Box>
            </DialogContent>
            <Divider />
            <DialogActions sx={{ px: 3, py: 2, gap: 1.5 }}>
              <MUIButton
                onClick={cancelNavigation}
                variant="outlined"
                sx={{
                  textTransform: "none",
                  borderRadius: 2,
                  borderColor: "rgba(100,116,139,0.4)",
                }}
              >
                Stay on this page
              </MUIButton>
              <MUIButton
                onClick={proceedNavigation}
                variant="contained"
                sx={{
                  textTransform: "none",
                  borderRadius: 2,
                  backgroundColor: "#dc2626",
                  "&:hover": { backgroundColor: "#b91c1c" },
                }}
              >
                Discard & leave
              </MUIButton>
            </DialogActions>
          </Dialog>
        </div>
      )}
    </>
  );
};

export default InfoTab;
