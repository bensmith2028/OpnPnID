import { useEffect } from 'react';
import { SketchCanvas } from './canvas/SketchCanvas';
import { useSketchStore } from './canvas/store/useSketchStore';
import { LibraryPanel } from './library/LibraryPanel';
import { onAppCloseRequested, reportUnsavedChanges } from './platform/appClose';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { RealHardwareModal } from './ui/RealHardwareModal';
import { Toolbar } from './ui/Toolbar';
import { UnsavedChangesDialog } from './ui/UnsavedChangesDialog';
import './App.css';

export default function App() {
  const theme = useSketchStore((s) => s.theme);
  const libraryPanelOpen = useSketchStore((s) => s.libraryPanelOpen);
  const realHardwareModalComponentId = useSketchStore((s) => s.realHardwareModalComponentId);
  const closeRealHardwareModal = useSketchStore((s) => s.closeRealHardwareModal);
  const dirty = useSketchStore((s) => s.dirty);
  const pendingGuardedAction = useSketchStore((s) => s.pendingGuardedAction);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // The shell is what actually holds a close/quit back, and it only does so while it
  // knows the drawing is dirty — so this has to be pushed on every change, not read on
  // the way out (by then nothing can be stopped). See platform/appClose.ts.
  useEffect(() => {
    reportUnsavedChanges(dirty);
  }, [dirty]);

  // The shell has already established there's unsaved work by the time it asks, so this
  // goes straight to the prompt rather than back through guardUnsaved.
  useEffect(() => onAppCloseRequested(() => useSketchStore.getState().setPendingGuardedAction('quit')), []);

  return (
    <div className="app">
      <Toolbar />
      <div className="app-body">
        <SketchCanvas />
        {libraryPanelOpen ? <LibraryPanel /> : <PropertiesPanel />}
      </div>
      {realHardwareModalComponentId && (
        <RealHardwareModal componentId={realHardwareModalComponentId} onClose={closeRealHardwareModal} />
      )}
      {pendingGuardedAction && <UnsavedChangesDialog action={pendingGuardedAction} />}
    </div>
  );
}
