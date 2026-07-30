"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CircuitCanvas from "@/canvas/CircuitCanvas";
import FloatingToolbar from "@/chrome/FloatingToolbar";
import StatusCluster from "@/chrome/StatusCluster";
import SpeedSlider from "@/chrome/SpeedSlider";
import UndoRedoCluster from "@/chrome/UndoRedoCluster";
import ElementEditModal from "@/inspector/ElementEditModal";
import Scope from "@/scope/Scope";
import FirmwareEditorPane from "@/editor/FirmwareEditorPane";
import {
    clampEditorHeight, defaultEditorHeight, loadEditorUiState, saveEditorUiState,
} from "@/editor/editorUi";
import { engineStore } from "@/engine/store";
import type { CircuitElm } from "@fulgurlab/engine";
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
//
// SPLIT SHELL. The root is now a flex column: an optional firmware editor
// pane on top, a drag handle, then the circuit sandbox. Two consequences
// worth knowing before editing this file:
//
//  1. ALL the floating chrome lives INSIDE the sandbox pane, which is
//     `relative`. That is what re-anchors it -- FloatingToolbar,
//     UndoRedoCluster, StatusCluster and SpeedSlider are all `absolute` and
//     needed no changes at all to follow the split.
//  2. The sandbox's height is published as --fl-sandbox-h so Scope can clamp
//     its dock against the PANE rather than the viewport (it used `fixed` and
//     60vh, which overflows once the editor takes the top half). Same
//     mechanism Scope already uses to publish --fl-scope-dock upward.
export default function Home() {
  const [activeTool, setActiveTool] = useState<PaletteItem | null>(null);
  // Probe mode (Scopes tool) and placement mode are mutually exclusive --
  // picking one turns off the other, same as any single-tool-at-a-time
  // editor. Modal-edit-dialog visibility lives here too since it's driven
  // by a double-click on the canvas, not by anything CircuitCanvas itself
  // needs to track across renders.
  const [probeMode, setProbeMode] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  // Bumped on every "A" keypress (CircuitCanvas's keydown handler) to tell
  // FloatingToolbar's local flyoutOpen state to pop open -- see that
  // component's own openFlyoutSignal doc comment for why this is a counter
  // rather than a boolean.
  const [openFlyoutSignal, setOpenFlyoutSignal] = useState(0);

  // Firmware editor split. Hydration-safe: localStorage is read in an effect
  // rather than a useState initializer, so the server-rendered markup and the
  // first client render agree (Next would otherwise flag a mismatch for a
  // user who left the editor open).
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorHeight, setEditorHeight] = useState(360);
  const [selectedChip, setSelectedChip] = useState<CircuitElm | null>(null);
  const sandboxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = loadEditorUiState();
    setEditorOpen(saved.open);
    setEditorHeight(clampEditorHeight(saved.height, window.innerHeight));
  }, []);

  useEffect(() => {
    saveEditorUiState({ open: editorOpen, height: editorHeight, targetId: "" });
  }, [editorOpen, editorHeight]);

  // Publish the sandbox height for Scope's dock clamp. Recomputed whenever the
  // split moves or the window resizes -- a ResizeObserver on the pane itself
  // rather than arithmetic on innerHeight, so it stays right regardless of
  // what else ends up in the column.
  useEffect(() => {
    const el = sandboxRef.current;
    if (!el) return;
    const publish = () => {
      document.documentElement.style.setProperty("--fl-sandbox-h", `${el.clientHeight}px`);
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.setProperty("--fl-sandbox-h", "0px");
    };
  }, []);

  // Re-clamp a persisted height that no longer fits (a tall-monitor split
  // restored on a shorter window).
  useEffect(() => {
    const onResize = () => setEditorHeight((h) => clampEditorHeight(h, window.innerHeight));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const toggleEditor = useCallback(() => {
    setEditorOpen((open) => {
      if (!open) {
        // Opening: if the stored height is unusable on this viewport, fall
        // back to a half split rather than a sliver.
        setEditorHeight((h) => {
          const clamped = clampEditorHeight(h, window.innerHeight);
          return clamped >= 120 ? clamped : defaultEditorHeight(window.innerHeight);
        });
      }
      return !open;
    });
  }, []);

  // Same hand-rolled percentage-free resizer fpgasim's HomeClient uses, in
  // pixels (see editorUi.ts for why px and not %). Listeners go on the window
  // so the drag survives the cursor leaving the 8px handle.
  function startSplitResize(e: React.MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = editorHeight;
    const onMove = (ev: MouseEvent) => {
      setEditorHeight(clampEditorHeight(startH + (ev.clientY - startY), window.innerHeight));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "row-resize";
  }

  // Draw tool and probe mode compose (the user can wire AND scope at the
  // same time): arming one no longer disarms the other. With both active,
  // clicks on an element toggle a channel; clicks on empty canvas place.
  function handleSelectTool(item: PaletteItem | null) {
    setActiveTool(item);
  }

  function handleToggleProbe() {
    setProbeMode((v) => !v);
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      {editorOpen && (
        <>
          <div style={{ height: editorHeight }} className="shrink-0 min-h-0">
            <FirmwareEditorPane
              elm={selectedChip}
              onSelectElm={setSelectedChip}
              onClose={() => setEditorOpen(false)}
            />
          </div>
          <div
            className="h-2 w-full shrink-0 cursor-row-resize relative group z-[8]"
            onMouseDown={startSplitResize}
            role="separator"
            aria-orientation="horizontal"
          >
            {/* Larger invisible hit area than the visible grip. */}
            <div className="absolute inset-y-[-4px] inset-x-0" />
            <div className="w-12 h-1 mx-auto rounded-full bg-white/[0.15] group-hover:bg-white/30 transition-colors" />
          </div>
        </>
      )}

      <div ref={sandboxRef} className="relative flex-1 min-h-0 overflow-hidden">
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
          onToggleEditor={toggleEditor}
          probeMode={probeMode}
          onElementDoubleClick={() => {
            const one = engineStore.selectedOne();
            // Co-simulated boards (dump 460) are edited in the firmware pane,
            // not the generic property modal: their real content is a source
            // file, and the pane owns compile/run/logs alongside it.
            if (one && String(one.getDumpType()) === "460") {
              setSelectedChip(one);
              setEditorOpen(true);
            } else {
              setEditModalOpen(true);
            }
          }}
        />
        <FloatingToolbar
          activeTool={activeTool}
          onSelect={handleSelectTool}
          probeActive={probeMode}
          onToggleProbe={handleToggleProbe}
          openFlyoutSignal={openFlyoutSignal}
          editorOpen={editorOpen}
          onToggleEditor={toggleEditor}
        />
        <UndoRedoCluster />
        <StatusCluster />
        <SpeedSlider />
        <Scope probeActive={probeMode} />
        {editModalOpen && <ElementEditModal onClose={() => setEditModalOpen(false)} />}
      </div>
    </div>
  );
}
