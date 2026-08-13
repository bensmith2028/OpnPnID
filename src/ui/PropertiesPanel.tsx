import { openUrl } from '@tauri-apps/plugin-opener';
import { useEffect, useState } from 'react';
import type { AxisLock, Id, Line } from '../types/geometry';
import { hasCustomLabelOffset } from '../canvas/componentLabels';
import { useSketchStore } from '../canvas/store/useSketchStore';
import type { SceneGraph } from '../canvas/sceneGraph';

const RAD_TO_DEG = 180 / Math.PI;

/** Normalizes an angle in degrees to [0, 360) — JS's `%` can return negative results. */
function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function PropertiesPanel() {
  const selection = useSketchStore((s) => s.selection);

  // "Exactly one thing, of one kind" — with five kinds now, spelled as a total count plus
  // the one set that holds it, rather than four "every other set is empty" conjunctions.
  const total = selection.pointIds.size + selection.lineIds.size + selection.arcIds.size + selection.componentIds.size + selection.textIds.size;

  if (total === 1) {
    if (selection.pointIds.size === 1) return <PointProperties pointId={[...selection.pointIds][0]} />;
    if (selection.lineIds.size === 1) return <LineProperties lineId={[...selection.lineIds][0]} />;
    if (selection.arcIds.size === 1) return <ArcProperties arcId={[...selection.arcIds][0]} />;
    if (selection.componentIds.size === 1) return <ComponentProperties componentId={[...selection.componentIds][0]} />;
    if (selection.textIds.size === 1) return <TextProperties textId={[...selection.textIds][0]} />;
  }
  return (
    <div className="properties-panel properties-panel--empty">
      <p>Select a single point, line, arc, component, or text note to edit its properties.</p>
    </div>
  );
}

function PointProperties({ pointId }: { pointId: Id }) {
  const version = useSketchStore((s) => s.version);
  const setPointPosition = useSketchStore((s) => s.setPointPosition);
  const applyFillet = useSketchStore((s) => s.applyFillet);

  const graph = useSketchStore.getState().graph;
  const point = graph.points.get(pointId);

  const [xText, setXText] = useState('');
  const [yText, setYText] = useState('');
  const [radiusText, setRadiusText] = useState('1');
  const [filletError, setFilletError] = useState(false);

  useEffect(() => {
    if (point) {
      setXText(point.x.toFixed(2));
      setYText(point.y.toFixed(2));
    }
    setFilletError(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointId, version]);

  if (!point) return null;

  const commitX = () => {
    const value = parseFloat(xText);
    if (Number.isFinite(value)) setPointPosition(pointId, value, point.y);
    else setXText(point.x.toFixed(2));
  };
  const commitY = () => {
    const value = parseFloat(yText);
    if (Number.isFinite(value)) setPointPosition(pointId, point.x, value);
    else setYText(point.y.toFixed(2));
  };

  // Fillet only applies to a plain two-line corner (see SceneGraph.filletAtPoint).
  const eligibleForFillet = graph.arcsOfPoint(pointId).length === 0 && graph.linesOfPoint(pointId).length === 2;

  const onApplyFillet = () => {
    const radius = parseFloat(radiusText);
    if (!Number.isFinite(radius) || radius <= 0) {
      setFilletError(true);
      return;
    }
    setFilletError(!applyFillet(pointId, radius));
  };

  return (
    <div className="properties-panel">
      <h3>Point</h3>
      <label className="field">
        <span>X</span>
        <input type="number" step="any" value={xText} onChange={(e) => setXText(e.target.value)} onBlur={commitX} onKeyDown={onEnter(commitX)} />
      </label>
      <label className="field">
        <span>Y</span>
        <input type="number" step="any" value={yText} onChange={(e) => setYText(e.target.value)} onBlur={commitY} onKeyDown={onEnter(commitY)} />
      </label>
      {eligibleForFillet && (
        <div className="field">
          <span>Fillet radius</span>
          <div className="fillet-row">
            <input
              type="number"
              step="any"
              min="0"
              value={radiusText}
              onChange={(e) => {
                setRadiusText(e.target.value);
                setFilletError(false);
              }}
            />
            <button onClick={onApplyFillet}>Apply Fillet</button>
          </div>
          {filletError && <p className="field-error">Radius doesn't fit this corner.</p>}
        </div>
      )}
    </div>
  );
}

function LineProperties({ lineId }: { lineId: Id }) {
  const version = useSketchStore((s) => s.version); // re-derive length/angle after any graph change
  const setLineLength = useSketchStore((s) => s.setLineLength);
  const setLineAngleDeg = useSketchStore((s) => s.setLineAngleDeg);
  const setAxisLock = useSketchStore((s) => s.setAxisLock);

  const graph = useSketchStore.getState().graph;
  const line: Line | undefined = graph.lines.get(lineId);

  const [lengthText, setLengthText] = useState('');
  const [angleText, setAngleText] = useState('');

  useEffect(() => {
    if (line) {
      setLengthText(graph.getLineLength(line).toFixed(2));
      setAngleText((graph.getLineAngle(line) * RAD_TO_DEG).toFixed(2));
    }
    // Re-sync displayed values whenever the selected line or its geometry changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineId, version]);

  if (!line) return null;

  const commitLength = () => {
    const value = parseFloat(lengthText);
    if (Number.isFinite(value) && value > 0) setLineLength(lineId, value);
    else setLengthText(graph.getLineLength(line).toFixed(2));
  };

  const commitAngle = () => {
    const value = parseFloat(angleText);
    if (Number.isFinite(value)) setLineAngleDeg(lineId, value);
    else setAngleText((graph.getLineAngle(line) * RAD_TO_DEG).toFixed(2));
  };

  return (
    <div className="properties-panel">
      <h3>Line</h3>
      <label className="field">
        <span>Length</span>
        <input
          type="number"
          step="any"
          value={lengthText}
          onChange={(e) => setLengthText(e.target.value)}
          onBlur={commitLength}
          onKeyDown={onEnter(commitLength)}
        />
      </label>
      <label className="field">
        <span>Angle (°)</span>
        <input
          type="number"
          step="any"
          value={angleText}
          onChange={(e) => setAngleText(e.target.value)}
          onBlur={commitAngle}
          onKeyDown={onEnter(commitAngle)}
        />
      </label>
      <div className="field">
        <span>Axis lock</span>
        <div className="axis-lock-buttons">
          {(['H', 'V', null] as AxisLock[]).map((lock) => (
            <button
              key={lock ?? 'none'}
              className={line.axisLock === lock ? 'active' : ''}
              onClick={() => setAxisLock(lineId, lock)}
            >
              {lock ?? 'None'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The single other edge (not `excludeEdgeId`) touching `pointId`, if there's exactly
 * one — that's the only case a tangent-to relation is unambiguous. */
function otherEdgeAt(graph: SceneGraph, pointId: Id, excludeEdgeId: Id): { id: Id; kind: 'line' | 'arc' } | null {
  const otherLines = graph.linesOfPoint(pointId).filter((l) => l.id !== excludeEdgeId);
  const otherArcs = graph.arcsOfPoint(pointId).filter((a) => a.id !== excludeEdgeId);
  if (otherLines.length + otherArcs.length !== 1) return null;
  return otherLines.length === 1 ? { id: otherLines[0].id, kind: 'line' } : { id: otherArcs[0].id, kind: 'arc' };
}

function ArcProperties({ arcId }: { arcId: Id }) {
  const version = useSketchStore((s) => s.version);
  const setArcBulge = useSketchStore((s) => s.setArcBulge);
  const setTangentStart = useSketchStore((s) => s.setTangentStart);
  const setTangentEnd = useSketchStore((s) => s.setTangentEnd);

  const graph = useSketchStore.getState().graph;
  const arc = graph.arcs.get(arcId);

  const [bulgeText, setBulgeText] = useState('');

  useEffect(() => {
    if (arc) setBulgeText(arc.bulge.toFixed(3));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arcId, version]);

  if (!arc) return null;

  const geo = graph.getArcGeometry(arc);
  const includedAngleDeg = (4 * Math.atan(arc.bulge) * RAD_TO_DEG).toFixed(1);
  const isTangentLocked = Boolean(arc.tangentStart || arc.tangentEnd);

  const commitBulge = () => {
    const value = parseFloat(bulgeText);
    if (Number.isFinite(value) && Math.abs(value) > 1e-6) setArcBulge(arcId, value);
    else setBulgeText(arc.bulge.toFixed(3));
  };

  const startOther = otherEdgeAt(graph, arc.startId, arc.id);
  const endOther = otherEdgeAt(graph, arc.endId, arc.id);

  return (
    <div className="properties-panel">
      <h3>Arc</h3>
      <label className="field">
        <span>Curvature (bulge){isTangentLocked ? ' — tangent-locked' : ''}</span>
        {isTangentLocked ? (
          <div className="readonly-value">{arc.bulge.toFixed(3)}</div>
        ) : (
          <input
            type="number"
            step="any"
            value={bulgeText}
            onChange={(e) => setBulgeText(e.target.value)}
            onBlur={commitBulge}
            onKeyDown={onEnter(commitBulge)}
          />
        )}
      </label>
      <div className="field">
        <span>Radius</span>
        <div className="readonly-value">{geo.isStraight ? '—' : geo.radius.toFixed(2)}</div>
      </div>
      <div className="field">
        <span>Included angle (°)</span>
        <div className="readonly-value">{includedAngleDeg}</div>
      </div>
      {startOther && (
        <label className="field field--checkbox">
          <input
            type="checkbox"
            checked={Boolean(arc.tangentStart)}
            onChange={(e) => setTangentStart(arcId, e.target.checked ? startOther.id : null)}
          />
          <span>Tangent at start (to connected {startOther.kind})</span>
        </label>
      )}
      {endOther && (
        <label className="field field--checkbox">
          <input
            type="checkbox"
            checked={Boolean(arc.tangentEnd)}
            onChange={(e) => setTangentEnd(arcId, e.target.checked ? endOther.id : null)}
          />
          <span>Tangent at end (to connected {endOther.kind})</span>
        </label>
      )}
    </div>
  );
}

function ComponentProperties({ componentId }: { componentId: Id }) {
  const version = useSketchStore((s) => s.version);
  const setComponentTag = useSketchStore((s) => s.setComponentTag);
  const setComponentName = useSketchStore((s) => s.setComponentName);
  const setComponentRotationDeg = useSketchStore((s) => s.setComponentRotationDeg);
  const resetComponentLabelOffsets = useSketchStore((s) => s.resetComponentLabelOffsets);

  const graph = useSketchStore.getState().graph;
  const instance = graph.components.get(componentId);

  const [tagText, setTagText] = useState('');
  const [nameText, setNameText] = useState('');
  const [rotationText, setRotationText] = useState('');

  useEffect(() => {
    if (instance) {
      setTagText(instance.tag);
      setNameText(instance.name ?? '');
      setRotationText(normalizeDegrees(instance.rotation * RAD_TO_DEG).toFixed(1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [componentId, version]);

  if (!instance) return null;

  const commitTag = () => {
    if (tagText.trim()) setComponentTag(componentId, tagText.trim());
    else setTagText(instance.tag);
  };

  // Unlike the tag, an empty name is a valid value (it clears the name), so there's
  // nothing to revert to — but skip unchanged text so merely tabbing through the field
  // doesn't push an undo entry.
  const commitName = () => {
    if (nameText.trim() !== (instance.name ?? '')) setComponentName(componentId, nameText);
  };

  const commitRotation = () => {
    const value = parseFloat(rotationText);
    if (Number.isFinite(value)) setComponentRotationDeg(componentId, value);
    else setRotationText(normalizeDegrees(instance.rotation * RAD_TO_DEG).toFixed(1));
  };

  const realPart = instance.snapshot.realPart;
  const specEntries = realPart ? Object.entries(realPart.specs) : [];

  return (
    <div className="properties-panel">
      <h3>Component</h3>
      <div className="field">
        <span>Type</span>
        <div className="readonly-value">
          {instance.snapshot.familyName} — {instance.snapshot.categoryName}
        </div>
      </div>
      <label className="field">
        <span>Tag</span>
        <input value={tagText} onChange={(e) => setTagText(e.target.value)} onBlur={commitTag} onKeyDown={onEnter(commitTag)} />
      </label>
      <label className="field">
        <span>Name</span>
        <input
          value={nameText}
          placeholder="e.g. Reactor feed pump"
          onChange={(e) => setNameText(e.target.value)}
          onBlur={commitName}
          onKeyDown={onEnter(commitName)}
        />
      </label>
      <label className="field">
        <span>Rotation (°)</span>
        <input
          type="number"
          step="any"
          value={rotationText}
          onChange={(e) => setRotationText(e.target.value)}
          onBlur={commitRotation}
          onKeyDown={onEnter(commitRotation)}
        />
      </label>

      {/* Only offered once a label has actually been dragged — there's nothing to reset
          otherwise, and a permanently-disabled button would just be noise. */}
      {hasCustomLabelOffset(instance) && (
        <div className="field">
          <span>Labels</span>
          <div className="fillet-row">
            <button onClick={() => resetComponentLabelOffsets(componentId)}>Reset Label Positions</button>
          </div>
        </div>
      )}

      <div className="field">
        <span>Real part</span>
        {realPart ? (
          <>
            <div className="readonly-value">
              {realPart.manufacturer} {realPart.modelNumber}
            </div>
            {specEntries.length > 0 && (
              <ul className="component-specs">
                {specEntries.map(([key, value]) => (
                  <li key={key}>
                    <span>{key}</span>
                    <span>{String(value)}</span>
                  </li>
                ))}
              </ul>
            )}
            {realPart.datasheetUrl && (
              <button onClick={() => void openUrl(realPart.datasheetUrl!)}>View Datasheet</button>
            )}
          </>
        ) : (
          <div className="readonly-value">No part assigned</div>
        )}
        <div className="fillet-row">
          <button onClick={() => useSketchStore.getState().openRealHardwareModal(componentId)}>Real Hardware…</button>
        </div>
      </div>
    </div>
  );
}

/** A free text annotation: its content and its size. Content is edited here as well as in
 * the canvas's inline editor — the panel is where every other entity's fields live, and
 * this is the only place a note's size can be changed. */
function TextProperties({ textId }: { textId: Id }) {
  const version = useSketchStore((s) => s.version);
  const setTextContent = useSketchStore((s) => s.setTextContent);
  const setTextFontSize = useSketchStore((s) => s.setTextFontSize);

  const graph = useSketchStore.getState().graph;
  const annotation = graph.texts.get(textId);

  const [contentText, setContentText] = useState('');
  const [sizeText, setSizeText] = useState('');

  useEffect(() => {
    if (annotation) {
      setContentText(annotation.text);
      setSizeText(String(annotation.fontSize));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textId, version]);

  if (!annotation) return null;

  // Skip unchanged text so merely tabbing through the field doesn't push an undo entry.
  // Emptying the field deletes the note (see SceneGraph.setTextContent), which is why
  // there's no "revert to the old value" branch here.
  const commitContent = () => {
    if (contentText.trim() !== annotation.text) setTextContent(textId, contentText);
  };

  const commitSize = () => {
    const value = parseFloat(sizeText);
    if (Number.isFinite(value) && value > 0) setTextFontSize(textId, value);
    else setSizeText(String(annotation.fontSize));
  };

  return (
    <div className="properties-panel">
      <h3>Text</h3>
      <label className="field">
        <span>Content</span>
        <input
          value={contentText}
          placeholder="Clear to delete the note"
          onChange={(e) => setContentText(e.target.value)}
          onBlur={commitContent}
          onKeyDown={onEnter(commitContent)}
        />
      </label>
      <label className="field">
        <span>Size (drawing units)</span>
        <input
          type="number"
          step="any"
          min="0.1"
          value={sizeText}
          onChange={(e) => setSizeText(e.target.value)}
          onBlur={commitSize}
          onKeyDown={onEnter(commitSize)}
        />
      </label>
    </div>
  );
}

function onEnter(commit: () => void) {
  return (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    else if (e.key === 'Escape') commit();
  };
}
