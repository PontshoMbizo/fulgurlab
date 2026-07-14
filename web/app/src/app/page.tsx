"use client";

import { useState } from "react";
import CircuitCanvas from "@/canvas/CircuitCanvas";
import PaletteSidebar from "@/palette/PaletteSidebar";
import Toolbar from "@/toolbar/Toolbar";
import Inspector from "@/inspector/Inspector";
import type { PaletteItem } from "@/palette/palette";

export default function Home() {
  const [activeTool, setActiveTool] = useState<PaletteItem | null>(null);

  return (
    <div className="h-screen w-screen flex flex-col bg-neutral-900">
      <div className="px-3 py-1.5 border-b border-neutral-800 bg-neutral-950 text-neutral-300 text-xs flex items-center gap-3">
        <span className="font-semibold text-neutral-100">fulgurlab</span>
        <span className="text-neutral-600">|</span>
        <span>
          {activeTool
            ? `Placing: ${activeTool.label} (drag to size, click for a default span)`
            : "Select mode — click a component to place it, click an element to select it"}
        </span>
      </div>
      <Toolbar />
      <div className="flex-1 flex min-h-0">
        <PaletteSidebar activeTool={activeTool} onSelect={setActiveTool} />
        <div className="flex-1 min-w-0">
          <CircuitCanvas activeTool={activeTool} onPlaced={() => setActiveTool(null)} />
        </div>
        <Inspector />
      </div>
    </div>
  );
}
