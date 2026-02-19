"use client";

import { SidebarTrigger } from "../ui/sidebar";

export function AppTopBar() {
  return (
    <header className="border-b border-border bg-sidebar">
      <div className="flex h-12 items-center px-3 md:px-4">
        <SidebarTrigger />
      </div>
    </header>
  );
}
