// Toolbar and menu icons, drawn after docs/design/classic-ui/Main.dc.html.
type P = { size?: number };
const base = (size: number) => ({ width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true as const, focusable: false as const });
const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const };

export const IconNew = ({ size = 18 }: P) => (
  <svg {...base(size)} {...line}><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /><path d="M12 11v6M9 14h6" stroke="#1E8F3A" /></svg>
);
export const IconOpen = ({ size = 18 }: P) => (
  <svg {...base(size)} fill="#F2C94C" stroke="#8A6D1F" strokeWidth={1.4}><path d="M3 6h6l2 2h10v11H3z" /></svg>
);
export const IconSave = ({ size = 18 }: P) => (
  <svg {...base(size)} {...line}><path d="M4 4h13l3 3v13H4z" /><path d="M8 4v5h8V4M7 20v-6h10v6" /></svg>
);
export const IconUndo = ({ size = 18 }: P) => (
  <svg {...base(size)} {...line}><path d="M9 7L4 12l5 5" /><path d="M4 12h11a5 5 0 0 1 0 10h-2" /></svg>
);
export const IconRedo = ({ size = 18 }: P) => (
  <svg {...base(size)} {...line}><path d="M15 7l5 5-5 5" /><path d="M20 12H9a5 5 0 0 0 0 10h2" /></svg>
);
export const IconLibrary = ({ size = 18 }: P) => (
  <svg {...base(size)} fill="none" stroke="currentColor" strokeWidth={1.5}>
    <rect x="3" y="3" width="7" height="7" fill="#D6E8FA" /><rect x="14" y="3" width="7" height="7" fill="#FBE3C8" />
    <rect x="3" y="14" width="7" height="7" fill="#DDF2DF" /><rect x="14" y="14" width="7" height="7" fill="#F3DDF2" />
  </svg>
);
export const IconSettings = ({ size = 18 }: P) => (
  <svg {...base(size)} fill="none" stroke="currentColor" strokeWidth={1.5}>
    <circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
  </svg>
);
export const IconRun = ({ size = 14 }: P) => (
  <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden focusable="false"><path d="M3 1.5l9 5.5-9 5.5z" fill="#FFFFFF" /></svg>
);
export const IconStop = ({ size = 18 }: P) => (
  <svg {...base(size)}><rect x="6" y="6" width="12" height="12" fill="currentColor" /></svg>
);
export const IconScope = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <rect x="2.5" y="4.5" width="19" height="15" fill="#FFFFFF" stroke="#333" strokeWidth={1.3} />
    <rect x="5" y="7" width="14" height="10" fill="#000000" />
    <path d="M5.5 14c2-5 4-5 6 0s4 5 7-2" fill="none" stroke="#FFE600" strokeWidth={1.3} />
  </svg>
);
export const IconDownload = ({ size = 18 }: P) => (
  <svg {...base(size)} fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M12 3v12M7 10l5 5 5-5M4 20h16" /></svg>
);
export const IconZoomIn = ({ size = 16 }: P) => (
  <svg {...base(size)} fill="none" stroke="currentColor" strokeWidth={1.8}><circle cx="10" cy="10" r="6" /><path d="M15 15l5 5M10 7v6M7 10h6" /></svg>
);
export const IconZoomOut = ({ size = 16 }: P) => (
  <svg {...base(size)} fill="none" stroke="currentColor" strokeWidth={1.8}><circle cx="10" cy="10" r="6" /><path d="M15 15l5 5M7 10h6" /></svg>
);
export const IconFit = ({ size = 16 }: P) => (
  <svg {...base(size)} fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /><rect x="8" y="8" width="8" height="8" /></svg>
);
export const IconChevronLeft = ({ size = 14 }: P) => (
  <svg {...base(size)} fill="none" stroke="currentColor" strokeWidth={2}><path d="M15 6l-6 6 6 6" /></svg>
);
export const BrandMark = ({ size = 16 }: P) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
    <rect width="32" height="32" rx="4" fill="#0A58B8" />
    <path d="M5 22h6l3-12 4 14 3-8h6" fill="none" stroke="#FFFFFF" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
