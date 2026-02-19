"use client";

import { RiFileListLine, RiServerLine, RiSettings3Line, RiTeamLine } from "@remixicon/react";
import { SettingsShell, type SettingsNavItem } from "@/components/settings-shell";

const navItems: SettingsNavItem[] = [
  { title: "Users", href: "/admin/users", icon: <RiTeamLine /> },
  { title: "Settings", href: "/admin/settings", icon: <RiSettings3Line /> },
  { title: "Workers", href: "/admin/workers", icon: <RiServerLine /> },
  { title: "Audit Log", href: "/admin/audit", icon: <RiFileListLine /> },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <SettingsShell
      title="Admin"
      subtitle="Workspace administration and system configuration."
      navItems={navItems}
    >
      {children}
    </SettingsShell>
  );
}
