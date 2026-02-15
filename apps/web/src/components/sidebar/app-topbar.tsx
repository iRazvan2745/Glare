"use client";

import { Search } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";

export function AppTopBar() {
  return (
    <header className="border-b border-border bg-sidebar">
      <div className="flex h-12 items-center gap-3 px-3 md:px-4">


        <div className="ml-auto flex w-full max-w-sm items-center gap-2">
          <InputGroup>
            <InputGroupInput
              placeholder="Search"
              className="h-8 border-border/60"
              aria-label="Global search"
            />
            <InputGroupAddon>
              <Search className="ml-auto flex w-full max-w-sm items-center gap-2" />
            </InputGroupAddon>
          </InputGroup>
        </div>

      </div>
    </header>
  );
}
