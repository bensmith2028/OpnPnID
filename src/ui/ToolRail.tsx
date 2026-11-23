import type { ReactNode } from 'react';
import { useSketchStore } from '../canvas/store/useSketchStore';

const ICON = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export interface ToolDef<T extends string = string> {
  tool: T;
  label: string;
  /** Keyboard shortcut, shown on the button. */
  key: string;
  title: string;
  icon: ReactNode;
}

/** Keeps each tool's name as its literal type (so the main window and the editor can each
 * check theirs against their own tool-name union). */
function def<T extends string>(d: ToolDef<T>): ToolDef<T> {
  return d;
}

/** The drawing tools shared by the main window and the symbol edit window, so both rails look
 * and read the same. */
export const SHARED_TOOLS = {
  select: def({ tool: 'select', label: 'Select', key: 'V', title: 'Select and move things (V)', icon: <path d="M5 3l14 7-6 2-2 6z" /> }),
  line: def({
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
  }),
  arc: def({
    tool: 'arc',
    label: 'Arc',
    key: 'A',
    title: 'Draw a curved pipe (A) — hold Shift on a click to snap tangent to a connected line/arc',
    icon: <path d="M5 19C5 11 11 5 19 5" />,
  }),
  point: def({ tool: 'point', label: 'Point', key: 'P', title: 'Place a point (P)', icon: <circle cx="12" cy="12" r="3" fill="currentColor" /> }),
  circle: def({ tool: 'circle', label: 'Circle', key: 'C', title: 'Draw a circle (C)', icon: <circle cx="12" cy="12" r="7" /> }),
  text: def({
    tool: 'text',
    label: 'Text',
    key: 'T',
    title: 'Add a text note (T) — click where it goes and type; click an existing note to re-edit it',
    icon: <path d="M6 6h12M12 6v13M9 19h6" />,
  }),
};

/** Editor-only: a connection port, drawn like the ring-and-dot marker it places. */
export const PORT_TOOL: ToolDef<'port'> = {
  tool: 'port',
  label: 'Port',
  key: 'O',
  title: 'Place a connection port (O) — pipes attach to ports, in the order you place them',
  icon: (
    <>
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
    </>
  ),
};

/** A vertical strip of tool buttons: icon, name, and the shortcut letter in the corner. */
export function ToolRailView<T extends string>({
  tools,
  active,
  onSelect,
  compact = false,
}: {
  tools: ToolDef<T>[];
  active: T;
  onSelect: (tool: T) => void;
  /** Tighter spacing and no panel background — for use inside a dialog. */
  compact?: boolean;
}) {
  return (
    <div className={`tool-rail${compact ? ' tool-rail--compact' : ''}`} role="toolbar" aria-label="Drawing tools">
      {tools.map(({ tool, label, key, title, icon }) => (
        <button key={tool} className={`tool-button${active === tool ? ' active' : ''}`} onClick={() => onSelect(tool)} title={title} aria-pressed={active === tool}>
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

const MAIN_TOOLS: ToolDef[] = Object.values(SHARED_TOOLS);

/** The drawing tools down the left edge of the canvas. */
export function ToolRail() {
  const activeTool = useSketchStore((s) => s.activeTool);
  const setTool = useSketchStore((s) => s.setTool);
  return <ToolRailView tools={MAIN_TOOLS} active={activeTool} onSelect={(t) => setTool(t as Parameters<typeof setTool>[0])} />;
}
