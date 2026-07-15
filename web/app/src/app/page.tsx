"use client";

import { useState } from "react";
import CircuitCanvas from "@/canvas/CircuitCanvas";
import FloatingToolbar from "@/chrome/FloatingToolbar";
import StatusCluster from "@/chrome/StatusCluster";
import SpeedSlider from "@/chrome/SpeedSlider";
import UndoRedoCluster from "@/chrome/UndoRedoCluster";
import Inspector from "@/inspector/Inspector";
import ElementEditModal from "@/inspector/ElementEditModal";
import Scope from "@/scope/Scope";
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
  // Probe mode (Scopes tool) and placement mode are mutually exclusive --
  // picking one turns off the other, same as any single-tool-at-a-time
  // editor. Modal-edit-dialog visibility lives here too since it's driven
  // by a double-click on the canvas, not by anything CircuitCanvas itself
  // needs to track across renders.
  const [probeMode, setProbeMode] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);

  function handleSelectTool(item: PaletteItem | null) {
    setActiveTool(item);
    if (item !== null) setProbeMode(false);
  }

  function handleToggleProbe() {
    setProbeMode((v) => {
      const next = !v;
      if (next) setActiveTool(null);
      return next;
    });
  }

  return (
    <div className="h-screen w-screen relative overflow-hidden">
      <CircuitCanvas
        activeTool={activeTool}
        onPlaced={() => setActiveTool(null)}
        probeMode={probeMode}
        onElementDoubleClick={() => setEditModalOpen(true)}
      />
      <FloatingToolbar activeTool={activeTool} onSelect={handleSelectTool} probeActive={probeMode} onToggleProbe={handleToggleProbe} />
      <UndoRedoCluster />
      <StatusCluster />
      <SpeedSlider />
      <Inspector />
      <Scope probeActive={probeMode} />
      {editModalOpen && <ElementEditModal onClose={() => setEditModalOpen(false)} />}
    </div>
  );
}
