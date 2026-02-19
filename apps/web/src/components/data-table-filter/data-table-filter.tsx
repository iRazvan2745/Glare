"use client";

import { RiCloseLine, RiFilterLine } from "@remixicon/react";
import { useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "@/components/ui/menu";
import type { ColumnConfig, DataTableFilterActions, FilterStrategy, FiltersState } from "./types";

interface DataTableFilterProps<TData = any> {
  columns: readonly ColumnConfig<TData>[];
  filters: FiltersState;
  actions: DataTableFilterActions;
  strategy: FilterStrategy;
}

export function DataTableFilter<TData>({ columns, filters, actions }: DataTableFilterProps<TData>) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Menu>
        <MenuTrigger render={<Button variant="outline" size="sm" className="gap-1.5" />}>
          <RiFilterLine className="size-3.5" />
          Filter
        </MenuTrigger>

        <MenuPopup align="start" sideOffset={6}>
          {columns.map((col) => (
            <MenuSub key={col.id}>
              <MenuSubTrigger>
                <col.icon className="size-4 text-muted-foreground" />
                {col.displayName}
              </MenuSubTrigger>
              <MenuSubPopup alignOffset={-5}>
                {col.type === "option" && col.options ? (
                  <OptionFilterItems
                    columnId={col.id}
                    options={col.options}
                    filters={filters}
                    actions={actions}
                  />
                ) : (
                  <TextFilterInput columnId={col.id} filters={filters} actions={actions} />
                )}
              </MenuSubPopup>
            </MenuSub>
          ))}
        </MenuPopup>
      </Menu>

      {filters.map((filter) => {
        const col = columns.find((c) => c.id === filter.columnId);
        if (!col) return null;

        return (
          <Badge key={filter.columnId} variant="secondary" className="gap-1">
            <span className="text-muted-foreground">{col.displayName}:</span>{" "}
            {formatFilterLabel(filter, col)}
            <button
              type="button"
              className="-mr-0.5 ml-0.5 rounded-full p-0.5 transition-colors hover:bg-muted-foreground/20"
              onClick={() => actions.removeFilter(filter.columnId)}
            >
              <RiCloseLine className="size-3" />
            </button>
          </Badge>
        );
      })}

      {filters.length > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={() => actions.removeAllFilters()}
        >
          Clear
        </Button>
      ) : null}
    </div>
  );
}

function OptionFilterItems({
  columnId,
  options,
  filters,
  actions,
}: {
  columnId: string;
  options: ColumnConfig["options"] & {};
  filters: FiltersState;
  actions: DataTableFilterActions;
}) {
  const existing = filters.find((f) => f.columnId === columnId);
  const selectedValues = existing?.values ?? [];

  function toggle(optionValue: string) {
    const has = selectedValues.includes(optionValue);
    const next = has
      ? selectedValues.filter((v) => v !== optionValue)
      : [...selectedValues, optionValue];

    if (next.length === 0) {
      actions.removeFilter(columnId);
    } else {
      actions.setFilter(columnId, "option", next.length > 1 ? "is any of" : "is", next);
    }
  }

  return (
    <MenuGroup>
      <MenuGroupLabel>Select values</MenuGroupLabel>
      {options.map((opt) => (
        <MenuCheckboxItem
          key={opt.value}
          checked={selectedValues.includes(opt.value)}
          onCheckedChange={() => toggle(opt.value)}
        >
          {opt.label}
        </MenuCheckboxItem>
      ))}
    </MenuGroup>
  );
}

function TextFilterInput({
  columnId,
  filters,
  actions,
}: {
  columnId: string;
  filters: FiltersState;
  actions: DataTableFilterActions;
}) {
  const existing = filters.find((f) => f.columnId === columnId);
  const [value, setValue] = useState(existing?.values[0] ?? "");
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  function handleChange(next: string) {
    setValue(next);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (next.trim()) {
        actions.setFilter(columnId, "text", "contains", [next]);
      } else {
        actions.removeFilter(columnId);
      }
    }, 250);
  }

  return (
    <div className="p-2" onKeyDown={(e) => e.stopPropagation()}>
      <Input
        placeholder="Type to filter..."
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        className="h-7 text-xs"
        autoFocus
      />
    </div>
  );
}

function formatFilterLabel(filter: FiltersState[number], col: ColumnConfig): string {
  if (filter.type === "option") {
    return filter.values.map((v) => col.options?.find((o) => o.value === v)?.label ?? v).join(", ");
  }
  return filter.values[0] ?? "";
}
