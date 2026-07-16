"use client";

import { useState } from "react";
import CircuitCanvas from "@/canvas/CircuitCanvas";
import FloatingToolbar from "@/chrome/FloatingToolbar";
import StatusCluster from "@/chrome/StatusCluster";
import SpeedSlider from "@/chrome/SpeedSlider";
import UndoRedoCluster from "@/chrome/UndoRedoCluster";
import ElementEditModal from "@/inspector/ElementEditModal";
import Scope from "@/scope/Scope";
import SymbolLibraryPanel from "@/kicad/SymbolLibraryPanel";
import { PALETTE, type PaletteItem } from "@/palette/palette";

const WIRE_TOOL = PALETTE.find((p) => p.dumpType === "w")!;

// Full-bleed canvas with glass chrome floating over it -- matches Pontsho's
// reference mockup ("Simulator Premium") exactly: no bordered panels or a
// fixed top bar, just the circuit surface with a few absolutely-positioned
// pill/card controls at the corners. See docs/react-rewrite-plan.md's
// 2026-07-15 session note for the full rationale and what was deliberately
// left out (the mockup's grading-specific Submit/Reset-to-template/Res·F
// controls).
//
// The sidebar Inspector panel (requirement #8 of the KiCad-editor rework) is
// gone -- ElementEditModal (opened by double-click, E, or the tool cluster
// below) is now the only place element properties are edited, backed by the
// same schema-driven fields it always used.
export default function Home() {
  const [activeTool, setActiveTool] = useState<PaletteItem | null>(null);
  // Probe mode (Scopes tool) and placement mode are mutually exclusive --
  // picking one turns off the other, same as any single-tool-at-a-time
  // editor. Modal-edit-dialog visibility lives here too since it's driven
  // by a double-click on the canvas, not by anything CircuitCanvas itself
  // needs to track across renders.
  const [probeMode, setProbeMode] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  // KiCad Symbol Library panel (import .kicad_sym files, bind symbols to
  // element types) -- opened from UndoRedoCluster's library button.
  const [symbolsOpen, setSymbolsOpen] = useState(false);
  // Bumped on every "A" keypress (CircuitCanvas's keydown handler) to tell
  // FloatingToolbar's local flyoutOpen state to pop open -- see that
  // component's own openFlyoutSignal doc comment for why this is a counter
  // rather than a boolean.
  const [openFlyoutSignal, setOpenFlyoutSignal] = useState(0);

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
        // Tool persistence (requirement #1): placement itself no longer
        // clears activeTool (CircuitCanvas's finalizePlacement doesn't call
        // this at all anymore) -- onDeactivateTool now only fires from the
        // Esc cascade's "deactivate tool / probe mode" step, which needs to
        // clear BOTH regardless of which one is currently active.
        onDeactivateTool={() => { setActiveTool(null); setProbeMode(false); }}
        onArmWireTool={() => handleSelectTool(WIRE_TOOL)}
        onOpenPalette={() => setOpenFlyoutSignal((v) => v + 1)}
        onToggleProbeMode={handleToggleProbe}
        probeMode={probeMode}
        onElementDoubleClick={() => setEditModalOpen(true)}
      />
      <FloatingToolbar
        activeTool={activeTool}
        onSelect={handleSelectTool}
        probeActive={probeMode}
        onToggleProbe={handleToggleProbe}
        openFlyoutSignal={openFlyoutSignal}
      />
      <UndoRedoCluster onOpenSymbols={() => setSymbolsOpen(true)} />
      <StatusCluster />
      <SpeedSlider />
      <Scope probeActive={probeMode} />
      {editModalOpen && <ElementEditModal onClose={() => setEditModalOpen(false)} />}
      <SymbolLibraryPanel open={symbolsOpen} onClose={() => setSymbolsOpen(false)} />
    </div>
  );
}
