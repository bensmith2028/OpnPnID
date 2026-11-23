import { useEffect } from 'react';
import { SketchCanvas } from './canvas/SketchCanvas';
import { useSketchStore } from './canvas/store/useSketchStore';
import { PropertiesPopup } from './ui/PropertiesPopup';
import { SidePanel } from './ui/SidePanel';
import { Toaster } from './ui/Toaster';
import { ToolRail } from './ui/ToolRail';
import { TopBar } from './ui/Toolbar';
import { UnsavedChangesDialog } from './ui/UnsavedChangesDialog';
import './App.css';

export default function App() {
  const theme = useSketchStore((s) => s.theme);
  const dirty = useSketchStore((s) => s.dirty);
  const pendingGuardedAction = useSketchStore((s) => s.pendingGuardedAction);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // A browser can't be asked to hold a tab open on our terms, only to show its own generic
  // "leave site?" prompt — so while there's unsaved work, ask for that.
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  return (
    <div className="app">
      <TopBar />
      <div className="app-body">
        <ToolRail />
        <SketchCanvas />
        <PropertiesPopup />
        <SidePanel />
      </div>
      <Toaster />
      {pendingGuardedAction && <UnsavedChangesDialog action={pendingGuardedAction} />}
    </div>
  );
}
