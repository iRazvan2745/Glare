import { RiMoreFill } from "@remixicon/react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ActionMenuItem = {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
};

export function ActionMenu({ items }: { items: ActionMenuItem[] }) {
  const firstDestructiveIndex = items.findIndex((entry) => entry.destructive);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
        <RiMoreFill className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {items.map((item, index) => (
          <div key={item.label}>
            {firstDestructiveIndex > 0 && index === firstDestructiveIndex ? (
              <DropdownMenuSeparator />
            ) : null}
            <DropdownMenuItem
              variant={item.destructive ? "destructive" : "default"}
              onClick={item.onSelect}
            >
              {item.label}
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
