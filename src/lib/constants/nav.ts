import {
  BarChart3,
  CreditCard,
  Home,
  ReceiptText,
  UserCircle,
  Users
} from "lucide-react";

export const NAV_ITEMS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/profile", label: "My Information", icon: UserCircle },
  { href: "/payment", label: "Payment Methods", icon: CreditCard },
  { href: "/invoices", label: "View & Pay Invoices", icon: ReceiptText },
  // { href: "/events", label: "Subscribed Events", icon: CalendarDays },
  // { href: "/communication", label: "Communication Preferences", icon: Mail },
] as const;

export const ADMIN_NAV_ITEMS = [
  { href: "/admin/manage-users", label: "Manage Users", icon: Users },
  { href: "/admin/user-statistics", label: "User Statistics", icon: BarChart3 },
] as const;
