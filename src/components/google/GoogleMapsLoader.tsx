"use client";
import * as React from "react";
import { useGoogleMaps } from "./GoogleMapProvider";

export default function GoogleMapsLoader({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoaded, loadError } = useGoogleMaps();
  if (loadError)
    return (
      <div className="text-red-600 text-sm">Failed to load Google Maps.</div>
    );
  if (!isLoaded)
    return <div className="text-slate-500 text-sm">Loading Google…</div>;
  return <>{children}</>;
}
