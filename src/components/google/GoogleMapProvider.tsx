"use client";
import * as React from "react";
import { useJsApiLoader } from "@react-google-maps/api";

type Ctx = { isLoaded: boolean; loadError?: Error };
const GoogleCtx = React.createContext<Ctx | null>(null);

export function GoogleMapsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: "google-maps-script",
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY as string,
    libraries: ["places"],
  });

  const value = React.useMemo(
    () => ({ isLoaded, loadError }),
    [isLoaded, loadError]
  );
  return <GoogleCtx.Provider value={value}>{children}</GoogleCtx.Provider>;
}

export function useGoogleMaps() {
  const ctx = React.useContext(GoogleCtx);
  if (!ctx)
    throw new Error("useGoogleMaps must be used within GoogleMapsProvider");
  return ctx;
}
