"use client";

import {
  RiBarChartGroupedLine,
  RiCalendarScheduleLine,
  RiDatabase2Line,
  RiDownloadCloud2Line,
  RiHome5Line,
  RiSettings3Line,
  RiShieldUserLine,
  RiTeamLine,
  RiUser3Line,
} from "@remixicon/react";

import DashboardNavigation, { type Route } from "@/components/sidebar/nav-main";
import { NavUser } from "@/components/sidebar/nav-user";
import { Logo } from "@/components/sidebar/logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarSeparator,
} from "@/components/ui/sidebar";

export const workspaceRoutes: Route[] = [
  {
    id: "home",
    title: "Home",
    icon: <RiHome5Line />,
    link: "/",
  },
  {
    id: "workers",
    title: "Worker Fleet",
    icon: <RiTeamLine />,
    link: "/workers",
  },
  {
    id: "repositories",
    title: "Repositories",
    icon: <RiDatabase2Line />,
    link: "/repositories",
  },
  {
    id: "plans",
    title: "Schedules & Retention",
    icon: <RiCalendarScheduleLine />,
    link: "/plans",
  },
  {
    id: "snapshots",
    title: "Recovery Points",
    icon: <RiDownloadCloud2Line />,
    link: "/snapshots",
  },
  {
    id: "observability",
    title: "Observability",
    icon: <RiBarChartGroupedLine />,
    link: "/observability",
  },
  {
    id: "users",
    title: "Users",
    icon: <RiUser3Line />,
    link: "/users",
  },
  {
    id: "settings",
    title: "Settings",
    icon: <RiSettings3Line />,
    link: "/settings",
  },
  {
    id: "admin",
    title: "Admin",
    icon: <RiShieldUserLine />,
    link: "/admin",
  },
];

export function DashboardSidebar() {
  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarHeader className="pb-2">
        <div className="rounded-xl border bg-gradient-to-br from-sidebar-accent/55 via-sidebar to-sidebar p-2.5">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg border bg-background/80 shadow-xs">
              <Logo className="size-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold tracking-wide">Glare</p>
              <p className="truncate text-[11px] text-muted-foreground">Personal Workspace</p>
            </div>
            <span className="rounded-full border bg-background/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              LIVE
            </span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <DashboardNavigation routes={workspaceRoutes} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="mt-auto px-2 pb-3">
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
