import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "HPL Customer Portal",
  description: "Customer self-service portal",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-50 antialiased">{children}</body>
    </html>
  );
}
