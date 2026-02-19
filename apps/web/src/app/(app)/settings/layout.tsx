"use client";

import { RiNotification3Line, RiShieldCheckLine, RiUserLine } from "@remixicon/react";
import { SettingsShell, type SettingsNavItem } from "@/components/settings-shell";

const navItems: SettingsNavItem[] = [
  { title: "General", href: "/settings", icon: <RiUserLine /> },
  { title: "Security", href: "/settings/security", icon: <RiShieldCheckLine /> },
  { title: "Notifications", href: "/settings/notifications", icon: <RiNotification3Line /> },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <SettingsShell
      title="Settings"
      subtitle="Update account preferences and manage integrations."
      navItems={navItems}
    >
      {children}
    </SettingsShell>
  );
}
