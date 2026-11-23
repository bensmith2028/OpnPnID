import type { ReactNode } from 'react';
import { type ToolName, useSketchStore } from '../canvas/store/useSketchStore';

const ICON = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const TOOLS: { tool: ToolName; label: string; key: string; title: string; icon: ReactNode }[] = [
  {
    tool: 'select',
    label: 'Select',
    key: 'V',
    title: 'Select and move things (V)',
    icon: <path d="M5 3l14 7-6 2-2 6z" />,
  },
  {
    tool: 'line',
    label: 'Line',
    key: 'L',
    title: 'Draw pipes and lines (L)',
    icon: (
      <>
        <path d="M5 19L19 5" />
        <circle cx="5" cy="19" r="1.6" />
        <circle cx="19" cy="5" r="1.6" />
      </>
    ),
  },
  {
    tool: 'arc',
    label: 'Arc',
    key: 'A',
    title: 'Draw a curved pipe (A) — hold Shift on a click to snap tangent to a connected line/arc',
    icon: <path d="M5 19C5 11 11 5 19 5" />,
  },
  {
    tool: 'point',
    label: 'Point',
    key: 'P',
    title: 'Place a point (P)',
    icon: <circle cx="12" cy="12" r="3" fill="currentColor" />,
  },
  {
    tool: 'circle',
    label: 'Circle',
    key: 'C',
    title: 'Draw a circle (C)',
    icon: <circle cx="12" cy="12" r="7" />,
  },
  {
    tool: 'text',
    label: 'Text',
    key: 'T',
    title: 'Add a text note (T) — click where it goes and type; click an existing note to re-edit it',
    icon: <path d="M6 6h12M12 6v13M9 19h6" />,
  },
];

/** The drawing tools, down the left edge of the canvas. Each shows its icon and name, with the
 * keyboard shortcut in the tooltip. */
export function ToolRail() {
  const activeTool = useSketchStore((s) => s.activeTool);
  const setTool = useSketchStore((s) => s.setTool);
  return (
    <div className="tool-rail" role="toolbar" aria-label="Drawing tools">
      {TOOLS.map(({ tool, label, key, title, icon }) => (
        <button key={tool} className={`tool-button${activeTool === tool ? ' active' : ''}`} onClick={() => setTool(tool)} title={title} aria-pressed={activeTool === tool}>
          <svg {...ICON} aria-hidden="true">
            {icon}
          </svg>
          <span className="tool-label">{label}</span>
          <span className="tool-key">{key}</span>
        </button>
      ))}
    </div>
  );
}
