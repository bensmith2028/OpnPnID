import { useState } from 'react';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

/** Every control the canvas responds to, in the order someone would reach for them. Kept next to
 * the card that shows it so the two get updated together. */
const CONTROLS: { heading: string; rows: [keys: string, what: string][] }[] = [
  {
    heading: 'Tools',
    rows: [
      ['V', 'Select / move'],
      ['L', 'Line'],
      ['A', 'Arc (Shift+click to follow a connected pipe\'s tangent)'],
      ['P', 'Point'],
      ['C', 'Circle'],
      ['T', 'Text note'],
      ['Esc', 'Stop placing / cancel / deselect'],
    ],
  },
  {
    heading: 'Editing',
    rows: [
      ['R', 'Rotate selected component 45° (Shift+R back)'],
      ['Delete', 'Delete selected'],
      [`${MOD}+C / ${MOD}+V`, 'Copy / paste'],
      [`${MOD}+Z / ${MOD}+Shift+Z`, 'Undo / redo'],
      [`${MOD}+A`, 'Select all'],
      [`${MOD}+S`, 'Save As…'],
    ],
  },
  {
    heading: 'Mouse',
    rows: [
      ['Click / drag', 'Select / move (drag empty space to box-select)'],
      [`Shift or ${MOD}+click`, 'Add to / remove from selection'],
      ['Double-click', 'Edit a text note; reset a dragged label'],
      ['Alt (hold)', 'Place freely, off the grid'],
      ['Scroll', 'Zoom'],
      ['Space + drag', 'Pan (or middle-click drag)'],
    ],
  },
];

/** The "Start your schematic" card shown on an empty canvas: a short walkthrough, and a Controls
 * tab listing every keybind and mouse control. */
export function EmptyGuide() {
  const [tab, setTab] = useState<'start' | 'controls'>('start');
  return (
    <div className="canvas-empty">
      <div className="canvas-empty-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'start'} className={tab === 'start' ? 'active' : ''} onClick={() => setTab('start')}>
          Start
        </button>
        <button role="tab" aria-selected={tab === 'controls'} className={tab === 'controls' ? 'active' : ''} onClick={() => setTab('controls')}>
          Controls
        </button>
      </div>
      {tab === 'start' ? (
        <>
          <h2>Start your schematic</h2>
          <ol>
            <li>
              Open a family in the <strong>Library</strong> and click a component
            </li>
            <li>Click the canvas to place it</li>
            <li>
              Pick the <strong>Line</strong> tool, then click one port and another to connect them
            </li>
          </ol>
          <p>Use File ▸ Save As… to keep your drawing as a file.</p>
        </>
      ) : (
        <div className="controls-list">
          {CONTROLS.map((group) => (
            <section key={group.heading}>
              <h3>{group.heading}</h3>
              <dl>
                {group.rows.map(([keys, what]) => (
                  <div key={keys} className="controls-row">
                    <dt>
                      <kbd>{keys}</kbd>
                    </dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
