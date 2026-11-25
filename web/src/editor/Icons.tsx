// Toolbar and panel glyphs: Lucide icons (https://lucide.dev, ISC licence, v1.8.0),
// inlined so the editor needs no icon dependency. 24-unit grid, stroked in currentColor.
// Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
// All other copyright (c) for Lucide are held by Lucide Contributors 2022.

import { createElement } from 'react';

type Node = [string, Record<string, string>][];
export interface IconProps { size?: number; className?: string }

function L({ n, size = 15, className }: IconProps & { n: Node }) {
  return (
    <svg className={className ? `lucide ${className}` : 'lucide'} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {n.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}

const nNew: Node = [["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M9 15h6"}],["path",{"d":"M12 18v-6"}]];
export const IconNew = (p: IconProps) => <L n={nNew} {...p} />;
const nOpen: Node = [["path",{"d":"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"}]];
export const IconOpen = (p: IconProps) => <L n={nOpen} {...p} />;
const nSave: Node = [["path",{"d":"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"}],["path",{"d":"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"}],["path",{"d":"M7 3v4a1 1 0 0 0 1 1h7"}]];
export const IconSave = (p: IconProps) => <L n={nSave} {...p} />;
const nUndo: Node = [["path",{"d":"M9 14 4 9l5-5"}],["path",{"d":"M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"}]];
export const IconUndo = (p: IconProps) => <L n={nUndo} {...p} />;
const nRedo: Node = [["path",{"d":"m15 14 5-5-5-5"}],["path",{"d":"M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"}]];
export const IconRedo = (p: IconProps) => <L n={nRedo} {...p} />;
const nLibrary: Node = [["path",{"d":"m16 6 4 14"}],["path",{"d":"M12 6v14"}],["path",{"d":"M8 8v12"}],["path",{"d":"M4 4v16"}]];
export const IconLibrary = (p: IconProps) => <L n={nLibrary} {...p} />;
const nPanelLeft: Node = [["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M9 3v18"}]];
export const IconPanelLeft = (p: IconProps) => <L n={nPanelLeft} {...p} />;
const nPanelRight: Node = [["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M15 3v18"}]];
export const IconPanelRight = (p: IconProps) => <L n={nPanelRight} {...p} />;
const nSettings: Node = [["path",{"d":"M14 17H5"}],["path",{"d":"M19 7h-9"}],["circle",{"cx":"17","cy":"17","r":"3"}],["circle",{"cx":"7","cy":"7","r":"3"}]];
export const IconSettings = (p: IconProps) => <L n={nSettings} {...p} />;
const nRun: Node = [["path",{"d":"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"}]];
export const IconRun = (p: IconProps) => <L n={nRun} {...p} />;
const nStop: Node = [["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}]];
export const IconStop = (p: IconProps) => <L n={nStop} {...p} />;
const nScope: Node = [["path",{"d":"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"}]];
export const IconScope = (p: IconProps) => <L n={nScope} {...p} />;
const nDownload: Node = [["path",{"d":"M12 15V3"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["path",{"d":"m7 10 5 5 5-5"}]];
export const IconDownload = (p: IconProps) => <L n={nDownload} {...p} />;
const nZoomIn: Node = [["circle",{"cx":"11","cy":"11","r":"8"}],["line",{"x1":"21","x2":"16.65","y1":"21","y2":"16.65"}],["line",{"x1":"11","x2":"11","y1":"8","y2":"14"}],["line",{"x1":"8","x2":"14","y1":"11","y2":"11"}]];
export const IconZoomIn = (p: IconProps) => <L n={nZoomIn} {...p} />;
const nZoomOut: Node = [["circle",{"cx":"11","cy":"11","r":"8"}],["line",{"x1":"21","x2":"16.65","y1":"21","y2":"16.65"}],["line",{"x1":"8","x2":"14","y1":"11","y2":"11"}]];
export const IconZoomOut = (p: IconProps) => <L n={nZoomOut} {...p} />;
const nFit: Node = [["path",{"d":"M3 7V5a2 2 0 0 1 2-2h2"}],["path",{"d":"M17 3h2a2 2 0 0 1 2 2v2"}],["path",{"d":"M21 17v2a2 2 0 0 1-2 2h-2"}],["path",{"d":"M7 21H5a2 2 0 0 1-2-2v-2"}]];
export const IconFit = (p: IconProps) => <L n={nFit} {...p} />;
const nChevronLeft: Node = [["path",{"d":"m15 18-6-6 6-6"}]];
export const IconChevronLeft = (p: IconProps) => <L n={nChevronLeft} {...p} />;
const nWorkflow: Node = [["rect",{"width":"8","height":"8","x":"3","y":"3","rx":"2"}],["path",{"d":"M7 11v4a2 2 0 0 0 2 2h4"}],["rect",{"width":"8","height":"8","x":"13","y":"13","rx":"2"}]];
export const IconWorkflow = (p: IconProps) => <L n={nWorkflow} {...p} />;
const nMinus: Node = [["path",{"d":"M5 12h14"}]];
export const IconMinus = (p: IconProps) => <L n={nMinus} {...p} />;
const nPlus: Node = [["path",{"d":"M5 12h14"}],["path",{"d":"M12 5v14"}]];
export const IconPlus = (p: IconProps) => <L n={nPlus} {...p} />;
const nSlidersHorizontal: Node = [["path",{"d":"M10 5H3"}],["path",{"d":"M12 19H3"}],["path",{"d":"M14 3v4"}],["path",{"d":"M16 17v4"}],["path",{"d":"M21 12h-9"}],["path",{"d":"M21 19h-5"}],["path",{"d":"M21 5h-7"}],["path",{"d":"M8 10v4"}],["path",{"d":"M8 12H3"}]];
export const IconSlidersHorizontal = (p: IconProps) => <L n={nSlidersHorizontal} {...p} />;
const nCircleCheck: Node = [["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m9 12 2 2 4-4"}]];
export const IconCircleCheck = (p: IconProps) => <L n={nCircleCheck} {...p} />;
const nCircleAlert: Node = [["circle",{"cx":"12","cy":"12","r":"10"}],["line",{"x1":"12","x2":"12","y1":"8","y2":"12"}],["line",{"x1":"12","x2":"12.01","y1":"16","y2":"16"}]];
export const IconCircleAlert = (p: IconProps) => <L n={nCircleAlert} {...p} />;
const nAutoscale: Node = [["path",{"d":"m15 15 6 6"}],["path",{"d":"m15 9 6-6"}],["path",{"d":"M21 16v5h-5"}],["path",{"d":"M21 8V3h-5"}],["path",{"d":"M3 16v5h5"}],["path",{"d":"m3 21 6-6"}],["path",{"d":"M3 8V3h5"}],["path",{"d":"M9 9 3 3"}]];
export const IconAutoscale = (p: IconProps) => <L n={nAutoscale} {...p} />;
const nCursor: Node = [["circle",{"cx":"12","cy":"12","r":"10"}],["line",{"x1":"22","x2":"18","y1":"12","y2":"12"}],["line",{"x1":"6","x2":"2","y1":"12","y2":"12"}],["line",{"x1":"12","x2":"12","y1":"6","y2":"2"}],["line",{"x1":"12","x2":"12","y1":"22","y2":"18"}]];
export const IconCursor = (p: IconProps) => <L n={nCursor} {...p} />;
const nPop: Node = [["path",{"d":"M15 3h6v6"}],["path",{"d":"M10 14 21 3"}],["path",{"d":"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"}]];
export const IconPop = (p: IconProps) => <L n={nPop} {...p} />;
const nDock: Node = [["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M3 15h18"}]];
export const IconDock = (p: IconProps) => <L n={nDock} {...p} />;
const nX: Node = [["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]];
export const IconX = (p: IconProps) => <L n={nX} {...p} />;
const nTerminal: Node = [["path",{"d":"M12 19h8"}],["path",{"d":"m4 17 6-6-6-6"}]];
export const IconTerminal = (p: IconProps) => <L n={nTerminal} {...p} />;

/** The product mark: the Lucide workflow glyph, drawn in the accent colour by its container. */
export const BrandMark = IconWorkflow;
