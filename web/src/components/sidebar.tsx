"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import {
  LayoutDashboard,
  FolderKanban,
  BookOpen,
  Sparkles,
  Settings,
  Leaf,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useSidebar } from "./sidebar-context";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/projects", label: "Proyectos", icon: FolderKanban },
  { href: "/dashboard/knowledge-base", label: "Base de Conocimiento", icon: BookOpen },
  { href: "/dashboard/advisor", label: "Asesor IA", icon: Sparkles },
  { href: "/dashboard/settings", label: "Ajustes", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const { collapsed, toggle } = useSidebar();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
    });
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const displayName =
    user?.user_metadata?.nombre || user?.email?.split("@")[0] || "Consultor";
  const displayEmail = user?.email || "";
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex flex-col border-r bg-card transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Header */}
      <div className="flex h-16 items-center border-b bg-gradient-brand overflow-hidden">
        {collapsed ? (
          <div className="flex w-full items-center justify-center">
            <Leaf className="h-6 w-6 text-white" />
          </div>
        ) : (
          <div className="flex items-center gap-3 px-6">
            <Leaf className="h-6 w-6 text-white shrink-0" />
            <div className="flex flex-col">
              <span className="text-sm font-bold tracking-wide text-white">
                vandarum
              </span>
              <span className="text-[10px] font-medium text-white/70 tracking-wider uppercase">
                ResidusIA Pro
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Toggle button */}
      <div className={cn("flex border-b", collapsed ? "justify-center p-2" : "justify-end px-4 py-2")}>
        <button
          onClick={toggle}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title={collapsed ? "Expandir menu" : "Colapsar menu"}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center rounded-md text-sm font-medium transition-colors",
                collapsed
                  ? "justify-center p-2.5"
                  : "gap-3 px-3 py-2",
                isActive
                  ? "bg-vandarum-teal/10 text-vandarum-teal border-l-2 border-vandarum-teal"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>

      {/* User profile */}
      <div className="border-t p-2">
        <div
          className={cn(
            "flex items-center rounded-md",
            collapsed ? "justify-center p-2" : "gap-3 px-3 py-2"
          )}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-brand text-xs font-bold text-white shrink-0">
            {initials}
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 truncate">
                <p className="text-sm font-medium truncate">{displayName}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {displayEmail}
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title="Cerrar sesion"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
        {collapsed && (
          <button
            onClick={handleLogout}
            className="mt-1 w-full flex justify-center rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Cerrar sesion"
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>
    </aside>
  );
}
