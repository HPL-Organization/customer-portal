import {
  Home,
  UserCircle,
  CreditCard,
  ReceiptText,
  CalendarDays,
  Truck,
  Mail,
} from "lucide-react";

export const NAV_ITEMS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/profile", label: "My Information", icon: UserCircle },
  { href: "/payment", label: "Payment Methods", icon: CreditCard },
  { href: "/invoices", label: "View & Pay Invoices", icon: ReceiptText },
  { href: "/orderTracking", label: "Order Tracking", icon: Truck },
  // { href: "/events", label: "Subscribed Events", icon: CalendarDays },
  // { href: "/communication", label: "Communication Preferences", icon: Mail },
] as const;
