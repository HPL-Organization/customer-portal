"use client";

import dynamic from "next/dynamic";
import RouteFeedback from "@/components/layout/RouteFeedBack";

const GoogleMapsProvider = dynamic(
  () =>
    import("@/components/google/GoogleMapProvider").then(
      (m) => m.GoogleMapsProvider
    ),
  { ssr: false, loading: () => null }
);

const ToastContainer = dynamic(
  () => import("react-toastify").then((m) => m.ToastContainer),
  { ssr: false }
);
import "react-toastify/dist/ReactToastify.css";

export default function PortalClientShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <GoogleMapsProvider>
      {children}
      <RouteFeedback />
      <ToastContainer
        position="top-right"
        autoClose={2000}
        limit={3}
        theme="light"
      />
    </GoogleMapsProvider>
  );
}
