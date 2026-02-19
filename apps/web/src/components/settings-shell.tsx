"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type React from "react";

export type SettingsNavItem = {
  title: string;
  href: string;
  icon: React.ReactNode;
};

export function SettingsShell({
  title,
  subtitle,
  navItems,
  children,
}: {
  title: string;
  subtitle: string;
  navItems: SettingsNavItem[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>

      <div className="flex flex-col gap-6 md:flex-row">
        <nav className="flex shrink-0 flex-row gap-1 md:w-48 md:flex-col">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== navItems[0]?.href && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href as never}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <span className="size-4 shrink-0 [&>svg]:size-4">{item.icon}</span>
                {item.title}
              </Link>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
