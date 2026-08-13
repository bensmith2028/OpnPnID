import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isSymbolEditorOpen } from '../library/symbolEditorActive';
import { applyTextFieldMenuAction, isTextEditableFocus, onNativeMenuAction } from '../platform/menuBridge';
import type { Id, Vec2 } from '../types/geometry';
import { render } from './renderer';
import { DEFAULT_TEXT_FONT_SIZE, useSketchStore } from './store/useSketchStore';
import type { ToolCtx } from './tools/drawLineTool';
import { drawLineCancel, drawLineOnPointerDown, drawLineOnPointerMove } from './tools/drawLineTool';
import { drawArcCancel, drawArcOnPointerDown, drawArcOnPointerMove } from './tools/drawArcTool';
import { drawCircleCancel, drawCircleOnPointerDown, drawCircleOnPointerMove } from './tools/drawCircleTool';
import { componentOnPointerDown, componentOnPointerMove } from './tools/componentTool';
import { pointOnPointerDown, pointOnPointerMove } from './tools/pointTool';
import {
  componentAtWorld,
  componentLabelAtWorld,
  selectOnPointerDown,
  selectOnPointerMove,
  selectOnPointerUp,
  textAtWorld,
} from './tools/selectTool';
import { textCancel, textOnPointerMove, textPlacementPoint } from './tools/textTool';
import { createInteractionState } from './tools/types';
import type { CanvasSize } from './tools/types';
import { screenToWorld, worldToScreen, zoomAround } from './viewport';

/** The inline text editor's state: an `<input>` positioned over the canvas at `world`,
 * standing in for the note it's writing. `textId` is the annotation being re-edited, or
 * null while placing a new one — the only difference between the two flows is which store
 * action the commit calls. Nothing reaches the document until that commit, so abandoning
 * the editor (Escape) leaves no trace and pushes no undo entry. */
interface TextEditorState {
  textId: Id | null;
  world: Vec2;
  fontSize: number;
  value: string;
}

export function SketchCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef<CanvasSize>({ width: 0, height: 0 });
  const interactionRef = useRef(createInteractionState());
  const spaceHeldRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const activeTool = useSketchStore((s) => s.activeTool);
  const version = useSketchStore((s) => s.version);
  const selection = useSketchStore((s) => s.selection);
  const camera = useSketchStore((s) => s.camera);
  const gridSize = useSketchStore((s) => s.gridSize);
  const gridVisible = useSketchStore((s) => s.gridVisible);
  const theme = useSketchStore((s) => s.theme);
  const componentScale = useSketchStore((s) => s.componentScale);

  // `render` is handed `requestRedraw` (so it can ask for another frame once an uploaded
  // symbol image finishes decoding), and `requestRedraw` in turn calls `render` — the ref
  // breaks that cycle without making either callback unstable.
  const redrawRef = useRef<() => void>(() => {});

  const requestRedraw = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      redrawRef.current();
    });
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const state = useSketchStore.getState();
    render({
      ctx,
      size: sizeRef.current,
      camera: state.camera,
      graph: state.graph,
      selection: state.selection,
      gridSize: state.gridSize,
      gridVisible: state.gridVisible,
      interaction: interactionRef.current,
      theme: state.theme,
      componentScale: state.componentScale,
      requestRedraw,
    });
  }, [requestRedraw]);
  redrawRef.current = redraw;

  const toolCtx: ToolCtx = { interaction: interactionRef.current, requestRedraw };

  /** The open inline text editor, or null. Mirrored into a ref because the commit path is
   * driven by the input's own `blur` — whose timing relative to a canvas click isn't
   * something to depend on — so "is an editor still open?" has to be answerable
   * synchronously, mid-handler, rather than from the last render's closure. */
  const [textEditor, setTextEditor] = useState<TextEditorState | null>(null);
  const textEditorRef = useRef<TextEditorState | null>(null);
  const putTextEditor = useCallback((next: TextEditorState | null) => {
    textEditorRef.current = next;
    setTextEditor(next);
  }, []);

  /** Writes the open editor into the document and closes it. Closes *first*, so the blur
   * that follows a click elsewhere finds nothing left to commit instead of committing the
   * same note twice. An unchanged re-edit is skipped rather than pushed onto the undo
   * stack, the same way the Properties Panel's name field does it. */
  const commitTextEditor = useCallback(() => {
    const editor = textEditorRef.current;
    if (!editor) return;
    putTextEditor(null);
    const store = useSketchStore.getState();
    if (editor.textId === null) {
      store.addText(editor.world, editor.value);
    } else if (editor.value.trim() !== store.graph.texts.get(editor.textId)?.text) {
      store.setTextContent(editor.textId, editor.value);
    }
  }, [putTextEditor]);

  /** Opens the editor on the note under `world`, or on a new one snapped to that spot.
   * Clicking an existing note with the Text tool re-opens it rather than stacking another
   * one on top of it — same "click the thing to edit the thing" as double-clicking one
   * with the Select tool. */
  const openTextEditor = useCallback(
    (world: Vec2) => {
      const existing = textAtWorld(world);
      if (existing) {
        putTextEditor({ textId: existing.id, world: { x: existing.x, y: existing.y }, fontSize: existing.fontSize, value: existing.text });
      } else {
        putTextEditor({ textId: null, world: textPlacementPoint(world, toolCtx), fontSize: DEFAULT_TEXT_FONT_SIZE, value: '' });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [putTextEditor],
  );

  // Resize the canvas backing store to match its container, accounting for DPR.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const applySize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { width: rect.width, height: rect.height };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      requestRedraw();
    };

    applySize();
    const observer = new ResizeObserver(applySize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [requestRedraw]);

  // Redraw whenever document/view state changes from outside a live drag (e.g. undo,
  // properties-panel edits, tool switch, pan/zoom).
  useEffect(() => {
    requestRedraw();
  }, [version, selection, activeTool, camera, gridSize, gridVisible, theme, componentScale, requestRedraw]);

  // Cancel any in-progress line/arc/circle gesture, the Text tool's placement preview —
  // and any half-typed note — when switching away from that tool. Covers both ways the
  // tool can change: the toolbar buttons and the V/L/A/P/C/T hotkeys both go through
  // `setTool`, and Escape lands on the Select tool the same way.
  useEffect(() => {
    if (activeTool !== 'line') drawLineCancel(toolCtx);
    if (activeTool !== 'arc') drawArcCancel(toolCtx);
    if (activeTool !== 'circle') drawCircleCancel(toolCtx);
    if (activeTool !== 'text') textCancel(toolCtx);
    putTextEditor(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  const getWorld = useCallback((e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    return screenToWorld(screen, useSketchStore.getState().camera, sizeRef.current);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // A click on the canvas finishes an open inline editor and does nothing else:
      // committing *and* starting the next gesture in the same click would depend on
      // whether the input's blur lands before or after this handler.
      if (textEditorRef.current) {
        commitTextEditor();
        return;
      }
      canvasRef.current?.setPointerCapture(e.pointerId);
      const isPanGesture = e.button === 1 || (e.button === 0 && spaceHeldRef.current);
      if (isPanGesture) {
        const rect = canvasRef.current!.getBoundingClientRect();
        interactionRef.current.pan = {
          originScreen: { x: e.clientX - rect.left, y: e.clientY - rect.top },
          originCamera: useSketchStore.getState().camera,
        };
        return;
      }
      const world = getWorld(e);
      if (activeTool === 'line') drawLineOnPointerDown(world, toolCtx);
      else if (activeTool === 'arc') drawArcOnPointerDown(world, e.shiftKey, toolCtx);
      else if (activeTool === 'circle') drawCircleOnPointerDown(world, toolCtx);
      else if (activeTool === 'point') pointOnPointerDown(world, toolCtx);
      else if (activeTool === 'text') {
        // Keep the browser's own focus handling out of this one: the click's default
        // action moves focus to the document body, which would immediately blur (and so
        // close) the editor being opened here.
        e.preventDefault();
        openTextEditor(world);
      } else if (activeTool === 'component') void componentOnPointerDown(world, toolCtx);
      else selectOnPointerDown(world, e.shiftKey || e.ctrlKey || e.metaKey, toolCtx);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTool, getWorld, commitTextEditor, openTextEditor],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const pan = interactionRef.current.pan;
      if (pan) {
        const rect = canvasRef.current!.getBoundingClientRect();
        const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const zoom = pan.originCamera.zoom;
        useSketchStore.getState().setCamera({
          x: pan.originCamera.x - (screen.x - pan.originScreen.x) / zoom,
          y: pan.originCamera.y - (screen.y - pan.originScreen.y) / zoom,
          zoom,
        });
        return;
      }
      const world = getWorld(e);
      if (activeTool === 'line') drawLineOnPointerMove(world, toolCtx);
      else if (activeTool === 'arc') drawArcOnPointerMove(world, toolCtx);
      else if (activeTool === 'circle') drawCircleOnPointerMove(world, toolCtx);
      else if (activeTool === 'point') pointOnPointerMove(world, toolCtx);
      else if (activeTool === 'text') textOnPointerMove(world, toolCtx);
      else if (activeTool === 'component') componentOnPointerMove(world, toolCtx);
      else selectOnPointerMove(world, toolCtx);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTool, getWorld],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      canvasRef.current?.releasePointerCapture(e.pointerId);
      if (interactionRef.current.pan) {
        interactionRef.current.pan = null;
        return;
      }
      if (activeTool === 'select') selectOnPointerUp(toolCtx);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTool],
  );

  // The hover preview tracks the cursor, so it has to go when the cursor does — otherwise
  // it stays parked at the canvas edge while the pointer is off over the toolbar/sidebar.
  // Deliberately tool-agnostic (Text, Point and Component all paint into the same slot);
  // an in-progress line/arc chain is unaffected because its preview is drawn from its own
  // `snap`, and a drag holds pointer capture, which suppresses this event entirely.
  const onPointerLeave = useCallback(() => {
    if (!interactionRef.current.hoverSnap) return;
    interactionRef.current.hoverSnap = null;
    requestRedraw();
  }, [requestRedraw]);

  // Double-clicking a placed component opens the real-hardware assignment modal — the
  // one place a component's real part gets picked/added now that LibraryPanel only
  // places bare category symbols. Double-clicking a text annotation re-opens it in the
  // inline editor, so notes are edited where they sit rather than only in the sidebar.
  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (activeTool !== 'select') return;
      const rect = canvasRef.current!.getBoundingClientRect();
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const world = screenToWorld(screen, useSketchStore.getState().camera, sizeRef.current);
      const annotation = textAtWorld(world);
      if (annotation) {
        openTextEditor(world);
        return;
      }
      // Double-clicking a dragged label puts it back where it started — the undo of a
      // label drag you no longer want, available right where the label is (the same
      // "reset" the Properties Panel offers). Tested before the component below, matching
      // the pointer-down order that lets a label be grabbed over its own body.
      const label = componentLabelAtWorld(world);
      if (label) {
        useSketchStore.getState().resetComponentLabelOffsets(label.instance.id, label.kind);
        return;
      }
      const instance = componentAtWorld(world);
      if (instance) useSketchStore.getState().openRealHardwareModal(instance.id);
    },
    [activeTool, openTextEditor],
  );

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const camera = useSketchStore.getState().camera;
    useSketchStore.getState().setCamera(zoomAround(camera, anchor, factor, sizeRef.current));
  }, []);

  // Keyboard shortcuts: Escape, Delete, Undo/Redo, Copy/Paste (selected components and/or
  // lines/arcs/points), Space-to-pan, Alt-to-disable-snap. Undo/Redo/Copy/Paste are also
  // handled here via a plain Ctrl/Cmd+Z|Y|C|V keydown check — this is the *only* path on
  // Windows/Linux, and
  // still a live fallback on macOS for Cmd+Y (redo), which isn't bound to a native menu
  // item below. Cmd+Z/C/V *are* claimed by the native Edit menu on macOS (see the
  // `onNativeMenuAction` effect below), so AppKit consumes those accelerators before they'd
  // ever reach this handler as a keydown there — no double-handling in practice.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditingText = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

      if (e.code === 'Space') spaceHeldRef.current = true;
      if (e.key === 'Alt') interactionRef.current.altHeld = true;

      if (isEditingText) return;

      if (e.key === 'Escape') {
        if (activeTool === 'line') drawLineCancel(toolCtx);
        if (activeTool === 'arc') drawArcCancel(toolCtx);
        if (activeTool === 'circle') drawCircleCancel(toolCtx);
        if (activeTool === 'text') textCancel(toolCtx);
        // Escape always lands back on the select tool (which also clears selection);
        // if already selecting, just clear the selection instead of a no-op tool switch.
        if (activeTool === 'select') useSketchStore.getState().clearSelection();
        else useSketchStore.getState().setTool('select');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        useSketchStore.getState().deleteSelection();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) useSketchStore.getState().redo();
        else useSketchStore.getState().undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        useSketchStore.getState().redo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        useSketchStore.getState().copySelection();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        useSketchStore.getState().pasteSelection();
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key.toLowerCase() === 'v') useSketchStore.getState().setTool('select');
        else if (e.key.toLowerCase() === 'l') useSketchStore.getState().setTool('line');
        else if (e.key.toLowerCase() === 'a') useSketchStore.getState().setTool('arc');
        else if (e.key.toLowerCase() === 'p') useSketchStore.getState().setTool('point');
        else if (e.key.toLowerCase() === 'c') useSketchStore.getState().setTool('circle');
        else if (e.key.toLowerCase() === 't') useSketchStore.getState().setTool('text');
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeldRef.current = false;
      if (e.key === 'Alt') interactionRef.current.altHeld = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  // Native macOS Edit-menu bridge (see src-tauri/src/lib.rs + src/platform/menuBridge.ts).
  // Undo/Redo/Cut/Copy/Paste/Select All arrive here as `app-menu` events instead of
  // `keydown` on macOS. Defers entirely to the symbol editor's own bridge listener while
  // that modal is open on top, so the same menu click doesn't get handled twice.
  useEffect(
    () =>
      onNativeMenuAction((action) => {
        if (isTextEditableFocus()) {
          applyTextFieldMenuAction(action);
          return;
        }
        if (isSymbolEditorOpen()) return;
        const store = useSketchStore.getState();
        if (action === 'copy') store.copySelection();
        else if (action === 'paste') store.pasteSelection();
        else if (action === 'undo') store.undo();
        else if (action === 'redo') store.redo();
        else if (action === 'selectAll') store.selectAll();
        // 'cut' isn't a supported gesture on the main canvas today.
      }),
    [],
  );

  // Recomputed on every render (which `camera` being a subscribed value guarantees for
  // pan/zoom), so an open editor tracks the note's world position instead of sticking to
  // the pixel it was opened at.
  const textEditorScreen = textEditor ? worldToScreen(textEditor.world, camera, sizeRef.current) : null;

  return (
    <div ref={containerRef} className="sketch-canvas-container">
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
      />
      {textEditor && textEditorScreen && (
        // Positioned and sized in screen space from the note's world position, so the
        // input sits exactly where the committed text will be drawn — typing in place
        // rather than in a dialog. Enter commits (via blur, the same idiom the Properties
        // Panel's fields use), Escape abandons the edit.
        <input
          className="canvas-text-editor"
          autoFocus
          value={textEditor.value}
          placeholder="Type a note…"
          style={{
            left: textEditorScreen.x,
            top: textEditorScreen.y,
            fontSize: `${textEditor.fontSize * camera.zoom}px`,
          }}
          onChange={(e) => putTextEditor({ ...textEditor, value: e.target.value })}
          onBlur={commitTextEditor}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            else if (e.key === 'Escape') putTextEditor(null);
          }}
        />
      )}
    </div>
  );
}
