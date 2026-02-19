"use client";

import { RiArrowRightUpLine, RiCommandLine, RiSearch2Line } from "@remixicon/react";
import { CornerDownLeftIcon, ArrowUpIcon, ArrowDownIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { parseAsBoolean, useQueryState } from "nuqs";
import { Fragment, useEffect, useMemo } from "react";

import { workspaceRoutes } from "@/components/sidebar/app-sidebar";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

interface CommandActionItem {
  value: string;
  label: string;
  shortcut?: string;
}

interface CommandActionGroup {
  value: string;
  items: CommandActionItem[];
}

export function GlobalCommandPalette() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useQueryState(
    "cmd",
    parseAsBoolean.withDefault(false).withOptions({ history: "replace", clearOnDefault: true }),
  );

  const groupedActions = useMemo<CommandActionGroup[]>(
    () => [
      {
        value: "Navigate",
        items: workspaceRoutes.map((route) => ({
          value: `nav-${route.id}`,
          label: route.title,
        })),
      },
      {
        value: "Operations",
        items: [
          { value: "trigger-snapshot", label: "Trigger Snapshot", shortcut: "T" },
          { value: "investigate-incidents", label: "Investigate incidents", shortcut: "I" },
        ],
      },
    ],
    [],
  );

  function handleItemClick(item: CommandActionItem) {
    const navRoute = workspaceRoutes.find((r) => `nav-${r.id}` === item.value);
    if (navRoute) {
      router.push(navRoute.link as never);
    } else if (item.value === "trigger-snapshot") {
      router.push("/snapshots" as never);
    } else if (item.value === "investigate-incidents") {
      router.push("/observability?severity=error&status=open" as never);
    }
    void setIsOpen(false);
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const isOpenShortcut =
        (isMac ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === "k";

      if (isOpenShortcut) {
        event.preventDefault();
        void setIsOpen((current) => !current);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setIsOpen]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-8 w-full justify-between border-border/60 text-muted-foreground"
        onClick={() => void setIsOpen(true)}
      >
        <span className="inline-flex items-center gap-2 text-xs">
          <RiSearch2Line className="size-3.5" />
          Command palette
        </span>
        <KbdGroup>
          <Kbd>
            <RiCommandLine className="size-3" />
          </Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </Button>

      <CommandDialog open={!!isOpen} onOpenChange={(open) => void setIsOpen(open)}>
        <CommandDialogPopup>
          <Command items={groupedActions}>
            <CommandInput placeholder="Search routes and operational actions" />
            <CommandPanel>
              <CommandEmpty>No matching actions.</CommandEmpty>
              <CommandList>
                {(group: CommandActionGroup, _index: number) => (
                  <Fragment key={group.value}>
                    <CommandGroup items={group.items}>
                      <CommandGroupLabel>{group.value}</CommandGroupLabel>
                      <CommandCollection>
                        {(item: CommandActionItem) => (
                          <CommandItem
                            key={item.value}
                            onClick={() => handleItemClick(item)}
                            value={item.value}
                          >
                            <span className="flex-1">{item.label}</span>
                            {group.value === "Navigate" ? (
                              <RiArrowRightUpLine className="size-3.5 text-muted-foreground" />
                            ) : item.shortcut ? (
                              <CommandShortcut>{item.shortcut}</CommandShortcut>
                            ) : null}
                          </CommandItem>
                        )}
                      </CommandCollection>
                    </CommandGroup>
                    <CommandSeparator />
                  </Fragment>
                )}
              </CommandList>
            </CommandPanel>
            <CommandFooter>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <KbdGroup>
                    <Kbd>
                      <ArrowUpIcon />
                    </Kbd>
                    <Kbd>
                      <ArrowDownIcon />
                    </Kbd>
                  </KbdGroup>
                  <span>Navigate</span>
                </div>
                <div className="flex items-center gap-2">
                  <Kbd>
                    <CornerDownLeftIcon />
                  </Kbd>
                  <span>Open</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>Esc</Kbd>
                <span>Close</span>
              </div>
            </CommandFooter>
          </Command>
        </CommandDialogPopup>
      </CommandDialog>
    </>
  );
}
