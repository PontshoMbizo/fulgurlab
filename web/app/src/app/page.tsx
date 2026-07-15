"use client";

import { useState } from "react";
import CircuitCanvas from "@/canvas/CircuitCanvas";
import FloatingToolbar from "@/chrome/FloatingToolbar";
import StatusCluster from "@/chrome/StatusCluster";
import SpeedSlider from "@/chrome/SpeedSlider";
import Inspector from "@/inspector/Inspector";
import type { PaletteItem } from "@/palette/palette";

// Full-bleed canvas with glass chrome floating over it -- matches Pontsho's
// reference mockup ("Simulator Premium") exactly: no bordered panels or a
// fixed top bar, just the circuit surface with a few absolutely-positioned
// pill/card controls at the corners. See docs/react-rewrite-plan.md's
// 2026-07-15 session note for the full rationale and what was deliberately
// left out (the mockup's grading-specific Submit/Reset-to-template/Res·F
// controls).
export default function Home() {
  const [activeTool, setActiveTool] = useState<PaletteItem | null>(null);

  return (
    <div className="h-screen w-screen relative overflow-hidden">
      <CircuitCanvas activeTool={activeTool} onPlaced={() => setActiveTool(null)} />
      <FloatingToolbar activeTool={activeTool} onSelect={setActiveTool} />
      <StatusCluster />
      <SpeedSlider />
      <Inspector />
    </div>
  );
}
