"use client";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuItem as SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { RiArrowDownSLine, RiArrowRightSLine } from "@remixicon/react";
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

export type RouteGroup = {
  label: string;
  routes: Route[];
};

function isActiveHref(pathname: string, href: Href) {
  if (typeof href !== "string" || href === "#") return false;
  const cleanHref = href.split("?")[0];
  return pathname === cleanHref || pathname.startsWith(`${cleanHref}/`);
}

function NavItem({ route }: { route: Route }) {
  const pathname = usePathname();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isOpen, setIsOpen] = useState(false);

  const hasSubRoutes = !!route.subs?.length;
  const hasActiveSubRoute = route.subs?.some((sub) => isActiveHref(pathname, sub.link)) ?? false;
  const isRouteActive = isActiveHref(pathname, route.link) || hasActiveSubRoute;

  if (hasSubRoutes) {
    return (
      <Collapsible
        open={!isCollapsed && (isOpen || hasActiveSubRoute)}
        onOpenChange={setIsOpen}
        className="w-full"
      >
        <SidebarMenuItem>
          <CollapsibleTrigger
            render={
              <SidebarMenuButton
                tooltip={route.title}
                className={cn(
                  "h-8 w-full rounded-md px-2 transition-colors",
                  isRouteActive
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                )}
              />
            }
          >
            {route.icon && <span className="size-4 shrink-0 [&>svg]:size-4">{route.icon}</span>}
            {!isCollapsed && <span className="flex-1 truncate text-sm">{route.title}</span>}
            {!isCollapsed && (
              <span className="ml-auto shrink-0">
                {isOpen || hasActiveSubRoute ? (
                  <RiArrowDownSLine className="size-4 text-sidebar-foreground/50" />
                ) : (
                  <RiArrowRightSLine className="size-4 text-sidebar-foreground/50" />
                )}
              </span>
            )}
          </CollapsibleTrigger>
        </SidebarMenuItem>

        {!isCollapsed && (
          <CollapsibleContent>
            <SidebarMenuSub className="ml-4 border-l border-sidebar-border pl-2">
              {route.subs?.map((sub) => {
                const isSubActive = isActiveHref(pathname, sub.link);
                return (
                  <SidebarMenuSubItem key={sub.title}>
                    <SidebarMenuSubButton
                      isActive={isSubActive}
                      render={
                        <Link
                          href={sub.link as never}
                          prefetch={true}
                          className={cn(
                            "flex h-7 items-center rounded-md px-2 text-sm transition-colors",
                            isSubActive
                              ? "font-medium text-sidebar-accent-foreground"
                              : "text-sidebar-foreground/60 hover:text-sidebar-foreground",
                          )}
                        />
                      }
                    >
                      {sub.title}
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                );
              })}
            </SidebarMenuSub>
          </CollapsibleContent>
        )}
      </Collapsible>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isRouteActive}
        tooltip={route.title}
        className={cn(
          "h-8 rounded-md px-2 transition-colors",
          isRouteActive
            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
        )}
        render={<Link href={route.link as never} prefetch={true} className="flex items-center" />}
      >
        {route.icon && <span className="size-4 shrink-0 [&>svg]:size-4">{route.icon}</span>}
        {!isCollapsed && <span className="truncate text-sm">{route.title}</span>}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export default function DashboardNavigation({ groups }: { groups: RouteGroup[] }) {
  return (
    <>
      {groups.map((group) => (
        <SidebarGroup key={group.label} className="py-1">
          <SidebarGroupLabel className="mb-0.5 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/40">
            {group.label}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.routes.map((route) => (
                <NavItem key={route.id} route={route} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}
