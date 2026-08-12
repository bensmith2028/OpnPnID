import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { render } from './renderer';
import { useSketchStore } from './store/useSketchStore';
import type { ToolCtx } from './tools/drawLineTool';
import { drawLineCancel, drawLineOnPointerDown, drawLineOnPointerMove } from './tools/drawLineTool';
import { drawArcCancel, drawArcOnPointerDown, drawArcOnPointerMove } from './tools/drawArcTool';
import { drawCircleCancel, drawCircleOnPointerDown, drawCircleOnPointerMove } from './tools/drawCircleTool';
import { componentOnPointerDown, componentOnPointerMove } from './tools/componentTool';
import { pointOnPointerDown, pointOnPointerMove } from './tools/pointTool';
import { componentAtWorld, selectOnPointerDown, selectOnPointerMove, selectOnPointerUp } from './tools/selectTool';
import { createInteractionState } from './tools/types';
import type { CanvasSize } from './tools/types';
import { screenToWorld, zoomAround } from './viewport';

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

  // Cancel any in-progress line/arc/circle gesture when switching away from that tool.
  useEffect(() => {
    if (activeTool !== 'line') drawLineCancel(toolCtx);
    if (activeTool !== 'arc') drawArcCancel(toolCtx);
    if (activeTool !== 'circle') drawCircleCancel(toolCtx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  const getWorld = useCallback((e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    return screenToWorld(screen, useSketchStore.getState().camera, sizeRef.current);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
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
      else if (activeTool === 'component') void componentOnPointerDown(world, toolCtx);
      else selectOnPointerDown(world, e.shiftKey || e.ctrlKey || e.metaKey, toolCtx);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTool, getWorld],
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

  // Double-clicking a placed component opens the real-hardware assignment modal — the
  // one place a component's real part gets picked/added now that LibraryPanel only
  // places bare category symbols.
  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (activeTool !== 'select') return;
      const rect = canvasRef.current!.getBoundingClientRect();
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const world = screenToWorld(screen, useSketchStore.getState().camera, sizeRef.current);
      const instance = componentAtWorld(world);
      if (instance) useSketchStore.getState().openRealHardwareModal(instance.id);
    },
    [activeTool],
  );

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const camera = useSketchStore.getState().camera;
    useSketchStore.getState().setCamera(zoomAround(camera, anchor, factor, sizeRef.current));
  }, []);

  // Keyboard shortcuts: Escape, Delete, Undo/Redo, Copy/Paste (selected components),
  // Space-to-pan, Alt-to-disable-snap. Copy/Paste use a plain Ctrl/Cmd+C|V keydown check
  // (not the browser's `copy`/`paste` clipboard events — those turned out not to fire
  // reliably for a canvas-focused, no-text-selection gesture in this app's webview, even
  // though the same keydown-based approach works fine here and in the symbol editor).
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
        useSketchStore.getState().copySelectedComponents();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        useSketchStore.getState().pasteComponents();
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key.toLowerCase() === 'v') useSketchStore.getState().setTool('select');
        else if (e.key.toLowerCase() === 'l') useSketchStore.getState().setTool('line');
        else if (e.key.toLowerCase() === 'a') useSketchStore.getState().setTool('arc');
        else if (e.key.toLowerCase() === 'p') useSketchStore.getState().setTool('point');
        else if (e.key.toLowerCase() === 'c') useSketchStore.getState().setTool('circle');
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

  return (
    <div ref={containerRef} className="sketch-canvas-container">
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
      />
    </div>
  );
}
