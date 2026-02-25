"use client";

import { Sidebar } from "@/components/sidebar";
import { SidebarProvider, useSidebar } from "@/components/sidebar-context";
import { cn } from "@/lib/utils";

function DashboardContent({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();

  return (
    <div className="min-h-screen">
      <Sidebar />
      <main
        className={cn(
          "transition-all duration-300",
          collapsed ? "pl-16" : "pl-64"
        )}
      >
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <DashboardContent>{children}</DashboardContent>
    </SidebarProvider>
  );
}
