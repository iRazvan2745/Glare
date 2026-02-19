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

import DashboardNavigation, { type RouteGroup } from "@/components/sidebar/nav-main";
import { NavUser } from "@/components/sidebar/nav-user";
import { Logo } from "@/components/sidebar/logo";
import { GlobalCommandPalette } from "@/components/sidebar/global-command-palette";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";

const baseRouteGroups: RouteGroup[] = [
  {
    label: "Overview",
    routes: [
      {
        id: "home",
        title: "Home",
        icon: <RiHome5Line />,
        link: "/",
      },
      {
        id: "observability",
        title: "Observability",
        icon: <RiBarChartGroupedLine />,
        link: "/observability",
      },
      {
        id: "snapshots",
        title: "Recovery Points",
        icon: <RiDownloadCloud2Line />,
        link: "/snapshots",
      },
    ],
  },
  {
    label: "Infrastructure",
    routes: [
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
    ],
  },
  {
    label: "Management",
    routes: [
      {
        id: "plans",
        title: "Schedules & Retention",
        icon: <RiCalendarScheduleLine />,
        link: "/plans",
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
    ],
  },
];

const adminRouteGroup: RouteGroup = {
  label: "Administration",
  routes: [
    {
      id: "admin",
      title: "Admin",
      icon: <RiShieldUserLine />,
      link: "/admin",
    },
  ],
};

const ADMIN_ROLES = new Set(["admin", "owner"]);

// Flat export for command palette compatibility
export const workspaceRoutes = [...baseRouteGroups, adminRouteGroup].flatMap((g) => g.routes);
export const workspaceRouteGroups = [...baseRouteGroups, adminRouteGroup];

function SidebarCommandPalette() {
  const { state } = useSidebar();
  if (state === "collapsed") return null;

  return (
    <div className="px-3 pt-1 pb-2">
      <GlobalCommandPalette />
    </div>
  );
}

export function DashboardSidebar() {
  const { data: session } = authClient.useSession();
  const userRole = (session?.user?.role ?? "").trim().toLowerCase();
  const isAdmin = ADMIN_ROLES.has(userRole);

  const groups = isAdmin ? [...baseRouteGroups, adminRouteGroup] : baseRouteGroups;

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarHeader className="pb-0">
        <div className="flex items-center gap-2.5 px-1 py-1">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Logo className="size-4" />
          </div>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-semibold leading-tight">Glare</p>
            <p className="truncate text-xs text-muted-foreground">Personal Workspace</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarCommandPalette />
      <SidebarContent>
        <DashboardNavigation groups={groups} />
      </SidebarContent>
      <SidebarFooter className="mt-auto px-2 pb-3">
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
