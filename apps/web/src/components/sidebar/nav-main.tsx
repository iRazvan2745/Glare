"use client";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuItem as SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { RiArrowDownSLine, RiArrowUpSLine } from "@remixicon/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type React from "react";
import { useState } from "react";

type Href = string;

export type Route = {
  id: string;
  title: string;
  icon?: React.ReactNode;
  link: Href;
  subs?: {
    title: string;
    link: Href;
    icon?: React.ReactNode;
  }[];
};

function isActiveHref(pathname: string, href: Href) {
  if (typeof href !== "string" || href === "#") return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function DashboardNavigation({ routes }: { routes: Route[] }) {
  const pathname = usePathname();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [openCollapsible, setOpenCollapsible] = useState<string | null>(null);

  return (
    <SidebarMenu>
      {routes.map((route) => {
        const hasSubRoutes = !!route.subs?.length;
        const hasActiveSubRoute =
          route.subs?.some((subRoute) => isActiveHref(pathname, subRoute.link)) ?? false;
        const isRouteActive = isActiveHref(pathname, route.link) || hasActiveSubRoute;
        const isOpen =
          !isCollapsed &&
          (openCollapsible === route.id || (openCollapsible === null && hasActiveSubRoute));

        return (
          <SidebarMenuItem key={route.id}>
            {hasSubRoutes ? (
              <Collapsible
                open={isOpen}
                onOpenChange={(open) => setOpenCollapsible(open ? route.id : null)}
                className="w-full"
              >
                <CollapsibleTrigger
                  render={
                    <SidebarMenuButton
                      className={cn(
                        "flex h-8 w-full items-center rounded-md px-2 transition-colors",
                        isRouteActive
                          ? "bg-sidebar-accent text-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                        isCollapsed && "justify-center",
                      )}
                    />
                  }
                >
                  {route.icon}
                  {!isCollapsed && (
                    <span className="ml-2 flex-1 text-sm font-medium">{route.title}</span>
                  )}
                  {!isCollapsed && hasSubRoutes && (
                    <span className="ml-auto">
                      {isOpen ? (
                        <RiArrowUpSLine className="size-3.5" />
                      ) : (
                        <RiArrowDownSLine className="size-3.5" />
                      )}
                    </span>
                  )}
                </CollapsibleTrigger>

                {!isCollapsed && (
                  <CollapsibleContent>
                    <SidebarMenuSub className="my-1 ml-3.5">
                      {route.subs?.map((subRoute) => {
                        const isSubRouteActive = isActiveHref(pathname, subRoute.link);

                        return (
                          <SidebarMenuSubItem
                            key={`${route.id}-${subRoute.title}`}
                            className="h-auto"
                          >
                            <SidebarMenuSubButton
                              isActive={isSubRouteActive}
                              render={
                                <Link
                                  href={subRoute.link as never}
                                  prefetch={true}
                                  className={cn(
                                    "flex items-center rounded-md px-3 py-1 text-xs font-medium",
                                    isSubRouteActive
                                      ? "text-foreground"
                                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                                  )}
                                />
                              }
                            >
                              {subRoute.title}
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        );
                      })}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                )}
              </Collapsible>
            ) : (
              <SidebarMenuButton
                isActive={isRouteActive}
                className={cn(
                  "h-8 rounded-md px-2 transition-colors",
                  isRouteActive
                    ? "bg-sidebar-accent text-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                  isCollapsed && "justify-center",
                )}
                render={
                  <Link href={route.link as never} prefetch={true} className="flex items-center" />
                }
              >
                {route.icon}
                {!isCollapsed && <span className="ml-2 text-xs font-medium">{route.title}</span>}
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}
