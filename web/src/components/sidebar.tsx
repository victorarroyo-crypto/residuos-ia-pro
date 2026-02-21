"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  FileText,
  AlertTriangle,
  TrendingDown,
  Settings,
  Recycle,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/clients", label: "Clientes", icon: Users },
  { href: "/dashboard/documents", label: "Documentos", icon: FileText },
  { href: "/dashboard/alerts", label: "Alertas", icon: AlertTriangle },
  { href: "/dashboard/savings", label: "Ahorros", icon: TrendingDown },
  { href: "/dashboard/settings", label: "Ajustes", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-card">
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <Recycle className="h-6 w-6 text-primary" />
        <span className="text-lg font-bold">ResidusIA Pro</span>
      </div>

      <nav className="flex-1 space-y-1 p-4">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-4">
        <div className="flex items-center gap-3 rounded-md px-3 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            C
          </div>
          <div className="flex-1 truncate">
            <p className="text-sm font-medium">Consultor</p>
            <p className="text-xs text-muted-foreground">consultor@empresa.com</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
