import type { ElementType, ReactElement } from "react";

export type ColumnDataType = "text" | "option";

export type ColumnOption = {
  label: string;
  value: string;
  icon?: ReactElement | ElementType;
};

export type ColumnConfig<TData = any> = {
  id: string;
  accessor: (data: TData) => any;
  displayName: string;
  icon: ElementType;
  type: ColumnDataType;
  options?: ColumnOption[];
};

export type FilterModel = {
  columnId: string;
  type: ColumnDataType;
  operator: string;
  values: string[];
};

export type FiltersState = FilterModel[];

export type FilterStrategy = "client" | "server";

export type DataTableFilterActions = {
  setFilter(columnId: string, type: ColumnDataType, operator: string, values: string[]): void;
  removeFilter(columnId: string): void;
  removeAllFilters(): void;
};
