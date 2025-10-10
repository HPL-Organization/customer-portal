// src/components/skeletons/ProfileSkeleton.tsx
"use client";
import * as React from "react";
import { Skeleton, Box } from "@mui/material";

const CONTROL_H = 36; // matches input (px-2 py-1) ~ 36px

export default function ProfileSkeleton() {
  return (
    <div className="mx-auto max-w-6xl p-6 md:p-8">
      {/* Header: title + greeting */}
      <div className="mb-4 flex items-center justify-between">
        <Skeleton variant="text" width={160} height={28} sx={{ my: 0 }} />
        <Skeleton variant="text" width={170} height={22} sx={{ my: 0 }} />
      </div>

      {/* NetSuite badge */}
      <div className="mb-3">
        <Box
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 1,
            px: 1.25,
            py: 0.75,
            border: "1px solid #e5e7eb",
            borderRadius: "10px",
            bgcolor: "#fbfcfe",
          }}
        >
          <Skeleton variant="circular" width={12} height={12} />
          <Skeleton variant="text" width={190} height={18} sx={{ my: 0 }} />
        </Box>
      </div>

      {/* Actions (one save button only) */}
      <div className="mb-2 flex justify-end">
        <Skeleton variant="rounded" width={150} height={36} />
      </div>

      {/* Top 3-col grid: First/Middle/Last, Email/Phone/Mobile */}
      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton variant="text" width={110} height={14} sx={{ my: 0 }} />
            <Skeleton variant="rounded" height={CONTROL_H} />
          </div>
        ))}
      </div>

      {/* Shipping lookup row */}
      <div className="mb-2 flex items-center justify-between">
        <Skeleton variant="text" width={280} height={18} sx={{ my: 0 }} />
        <Skeleton variant="rounded" width={160} height={24} />
      </div>

      {/* Shipping autocomplete input */}
      <Skeleton variant="rounded" height={CONTROL_H} sx={{ mb: 4 }} />

      {/* Shipping section title */}
      <Skeleton variant="text" width={160} height={20} sx={{ my: 0, mb: 2 }} />

      {/* Shipping 2-col grid: 6 fields */}
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton variant="text" width={110} height={14} sx={{ my: 0 }} />
            <Skeleton variant="rounded" height={CONTROL_H} />
          </div>
        ))}
      </div>

      {/* Billing lookup row */}
      <div className="mb-2 flex items-center justify-between">
        <Skeleton variant="text" width={250} height={18} sx={{ my: 0 }} />
        <Skeleton variant="rounded" width={160} height={24} />
      </div>

      {/* Billing autocomplete input */}
      <Skeleton variant="rounded" height={CONTROL_H} sx={{ mb: 4 }} />

      {/* Billing section title */}
      <Skeleton variant="text" width={150} height={20} sx={{ my: 0, mb: 2 }} />

      {/* Billing 2-col grid: 6 fields */}
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton variant="text" width={110} height={14} sx={{ my: 0 }} />
            <Skeleton variant="rounded" height={CONTROL_H} />
          </div>
        ))}
      </div>

      {/* Bottom actions*/}
      <div className="flex justify-end">
        <Skeleton variant="rounded" width={150} height={36} />
      </div>
    </div>
  );
}
