import { Suspense } from "react";
import AppShell from "@/components/layout/AppShell";
import CustomerBootstrap from "@/components/providers/CustomerBootstrap";
import BillingProvider from "@/components/providers/BillingProvider";
import PaymentMethodsProvider from "@/components/providers/PaymentMethodsProvider";
import OrderTrackingProvider from "@/components/providers/OrderTrackingProvider";
import PortalClientShell from "@/components/layout/PortalClientShell";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={null}>
      <CustomerBootstrap>
        <PaymentMethodsProvider>
          <BillingProvider>
            <OrderTrackingProvider>
              <PortalClientShell>
                <Suspense fallback={null}>
                  <AppShell>{children}</AppShell>
                </Suspense>
              </PortalClientShell>
            </OrderTrackingProvider>
          </BillingProvider>
        </PaymentMethodsProvider>
      </CustomerBootstrap>
    </Suspense>
  );
}
