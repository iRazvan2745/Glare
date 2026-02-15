"use client";

import type { ReactNode } from "react";

import { AppTopBar } from "@/components/sidebar/app-topbar";
import { DashboardSidebar } from "@/components/sidebar/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export default function Sidebar02({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="relative flex h-dvh w-full bg-background">
        <DashboardSidebar />
        <SidebarInset className="flex flex-col">
          <AppTopBar />
          <main className="flex-1 overflow-auto p-4 md:p-5">{children}</main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
