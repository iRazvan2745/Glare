"use client";

import { useMemo, useState } from "react";
import type {
  ColumnConfig,
  DataTableFilterActions,
  FilterStrategy,
  FiltersState,
} from "./types";

export interface UseDataTableFiltersOptions<TData> {
  strategy: FilterStrategy;
  data: TData[];
  columnsConfig: readonly ColumnConfig<TData>[];
  defaultFilters?: FiltersState;
  filters?: FiltersState;
  onFiltersChange?: React.Dispatch<React.SetStateAction<FiltersState>>;
}

export function useDataTableFilters<TData>({
  strategy,
  columnsConfig,
  defaultFilters,
  filters: controlledFilters,
  onFiltersChange,
}: UseDataTableFiltersOptions<TData>) {
  const [internalFilters, setInternalFilters] = useState<FiltersState>(defaultFilters ?? []);

  const isControlled = controlledFilters !== undefined;
  const filters = isControlled ? controlledFilters : internalFilters;
  const setFilters = isControlled && onFiltersChange ? onFiltersChange : setInternalFilters;

  const columns = useMemo(() => [...columnsConfig], [columnsConfig]);

  const actions = useMemo<DataTableFilterActions>(
    () => ({
      setFilter(columnId, type, operator, values) {
        setFilters((prev) => {
          if (values.length === 0) {
            return prev.filter((f) => f.columnId !== columnId);
          }
          const idx = prev.findIndex((f) => f.columnId === columnId);
          const next: FiltersState[number] = { columnId, type, operator, values };
          if (idx >= 0) {
            return prev.map((f, i) => (i === idx ? next : f));
          }
          return [...prev, next];
        });
      },
      removeFilter(columnId) {
        setFilters((prev) => prev.filter((f) => f.columnId !== columnId));
      },
      removeAllFilters() {
        setFilters([]);
      },
    }),
    [setFilters],
  );

  return { columns, filters, actions, strategy };
}
