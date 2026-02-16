"use client";

import { RiPulseLine } from "@remixicon/react";
import { GlobalCommandPalette } from "@/components/sidebar/global-command-palette";

export function AppTopBar() {
  return (
    <header className="border-b border-border bg-sidebar">
      <div className="flex h-12 items-center gap-3 px-3 md:px-4">
        <div className="ml-auto flex w-full max-w-sm items-center gap-2">
          <GlobalCommandPalette />
        </div>
      </div>
    </header>
  );
}
