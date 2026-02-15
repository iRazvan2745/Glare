"use client";

import {
  CalendarClock,
  Database,
  HardDriveDownload,
  Home,
  Settings,
  Shield,
  UserCircle2,
  Users,
} from "lucide-react";

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

export function DashboardSidebar() {
  const routes: Route[] = [
    {
      id: "home",
      title: "Home",
      icon: <Home />,
      link: "/",
    },
    {
      id: "workers",
      title: "Workers",
      icon: <Users />,
      link: "/workers",
    },
    {
      id: "repositories",
      title: "Repositories",
      icon: <Database />,
      link: "/repositories",
    },
    {
      id: "plans",
      title: "Backup Plans",
      icon: <CalendarClock />,
      link: "/plans",
    },
    {
      id: "snapshots",
      title: "Snapshots",
      icon: <HardDriveDownload />,
      link: "/snapshots",
    },
    {
      id: "users",
      title: "Users",
      icon: <UserCircle2 />,
      link: "/users",
    },
    {
      id: "settings",
      title: "Settings",
      icon: <Settings />,
      link: "/settings",
    },
    {
      id: "admin",
      title: "Admin",
      icon: <Shield />,
      link: "/admin",
    },
  ];

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarHeader className="pb-2">
        <div className="flex items-center gap-2 rounded-md border bg-sidebar px-2 py-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-background">
            <Logo className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">Glare</p>
            <p className="truncate text-[11px] text-muted-foreground">Personal Workspace</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <DashboardNavigation routes={routes} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="mt-auto px-2 pb-3">
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
