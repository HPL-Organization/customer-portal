// components/TermsModal.tsx
"use client";

import React, { useMemo, useState } from "react";

type Props = {
  open: boolean;
  loading?: boolean;
  text: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function TermsModal({
  open,
  loading,
  text,
  onCancel,
  onConfirm,
}: Props) {
  const [checked, setChecked] = useState(false);
  const [showDoc, setShowDoc] = useState(false);

  const parts = useMemo(() => {
    const needle = "Terms & Conditions";
    const i = text.indexOf(needle);
    if (i === -1) return { pre: text, needle, post: "" };
    return {
      pre: text.slice(0, i),
      needle,
      post: text.slice(i + needle.length),
    };
  }, [text]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
        <div className="w-full max-w-[560px] rounded-2xl bg-white shadow-2xl">
          <div className="flex items-center gap-3 border-b px-5 py-4">
            <div className="h-9 w-9 rounded-full bg-rose-100 grid place-items-center">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-600 inline-block" />
            </div>
            <h3 className="text-[18px] font-semibold text-[#17152A]">
              Event Terms Confirmation
            </h3>
          </div>

          <div className="px-5 py-4 text-[14px] text-[#17152A]">
            <label className="flex items-start gap-3 select-none">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300 text-[#8C0F0F] focus:ring-[#8C0F0F]"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              <span>
                {parts.pre}
                <button
                  type="button"
                  className="underline decoration-[#8C0F0F]/40 underline-offset-2 text-[#8C0F0F] hover:text-[#E01C24]"
                  onClick={() => setShowDoc(true)}
                >
                  {parts.needle}
                </button>
                {parts.post}
              </span>
            </label>

            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              Checking the box indicates your agreement to the full Terms &
              Conditions. You can review them by tapping the link above.
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
            <button
              onClick={onCancel}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#17152A] hover:bg-slate-50"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={!checked || !!loading}
              className={`rounded-lg px-3 py-2 text-sm text-white ${
                !checked || loading
                  ? "bg-gray-400"
                  : "bg-[#8C0F0F] hover:bg-[#E01C24]"
              }`}
            >
              {loading ? "Saving…" : "I Agree"}
            </button>
          </div>
        </div>
      </div>

      {showDoc && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4">
          <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h3 className="text-[18px] font-semibold text-[#17152A]">
                Live Event Participation Agreement
              </h3>
              <button
                onClick={() => setShowDoc(false)}
                className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-6 py-5 text-[14px] leading-6 text-[#17152A]">
              <h4 className="mb-2 text-[16px] font-semibold">
                1. Acknowledgment of Terms
              </h4>
              <p>
                By signing this Agreement, the undersigned (“Buyer”)
                acknowledges that they have read, understand, and agree to be
                bound by the terms and conditions of sale set forth by the
                Highland Park Lapidary Co (“HPL”) for this event. These terms
                govern all bidding activity, purchases, and payments related to
                this event.
              </p>

              <h4 className="mt-4 mb-2 text-[16px] font-semibold">
                2. Registration and Qualification
              </h4>
              <p>
                Buyer affirms that all information provided during registration
                is accurate and complete. HPL reserves the right to deny or
                revoke bidding privileges at any time for failure to comply with
                these terms or for any conduct deemed improper.
              </p>

              <h4 className="mt-4 mb-2 text-[16px] font-semibold">
                3. Binding Nature of Bids
              </h4>
              <p className="font-semibold">
                ALL BIDS SUBMITTED BY THE BUYER ARE BINDING OFFERS TO PURCHASE
                THE ITEM(S) AT THE BID AMOUNT, PLUS ANY TAXES (IF APPLICABLE)
                AND SHIPPING COSTS ON PURCHASES OF LESS THAN $50 OR FOR ORDERS
                NOT IN THE LOWER 48 STATES.
              </p>
              <p className="mt-1">
                Orders over $50 in the USA (including orders in Hawaii and
                Alaska that can ship in USPS flat rate boxes) will be shipped
                for free. ONCE THE ITEM HAS BEEN DECLARED “SOLD,” THE HIGHEST
                BID BECOMES A LEGALLY BINDING CONTRACT OF SALE BETWEEN THE BUYER
                AND THE HPL. NO BID MAY BE WITHDRAWN OR CANCELED AFTERWARDS.
              </p>

              <h4 className="mt-4 mb-2 text-[16px] font-semibold">
                4. Payment Terms
              </h4>
              <p>
                Buyer agrees to remit full payment in accordance with the
                payment terms announced by the HPL (including deadlines,
                deposits and acceptable payment methods). Failure to make
                payment as required may result in forfeiture of any deposits,
                cancellation of sale, and/or legal action.
              </p>

              <h4 className="mt-4 mb-2 text-[16px] font-semibold">
                5. Buyer’s Taxes
              </h4>
              <p>
                Buyer acknowledges that any required sales taxes will be added
                to the final invoice.
              </p>

              <h4 className="mt-4 mb-2 text-[16px] font-semibold">
                6. Default
              </h4>
              <p>
                In the event of default, HPL may resell the item(s) without
                notice.
              </p>

              <h4 className="mt-4 mb-2 text-[16px] font-semibold">
                7. Dispute Resolution
              </h4>
              <p>
                Any dispute arising out of this sale shall be resolved under the
                laws of the state in which the sale is conducted. The exclusive
                venue for all disputes shall be the courts of that state.
              </p>

              <h4 className="mt-4 mb-2 text-[16px] font-semibold">
                8. Entire Agreement
              </h4>
              <p>
                This Agreement constitutes the entire understanding between the
                Buyer and HPL regarding participation in the event and
                supersedes all prior oral or written statements.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
              <button
                onClick={() => setShowDoc(false)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
