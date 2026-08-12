import { useEffect } from 'react';
import { SketchCanvas } from './canvas/SketchCanvas';
import { useSketchStore } from './canvas/store/useSketchStore';
import { LibraryPanel } from './library/LibraryPanel';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { RealHardwareModal } from './ui/RealHardwareModal';
import { Toolbar } from './ui/Toolbar';
import './App.css';

export default function App() {
  const theme = useSketchStore((s) => s.theme);
  const libraryPanelOpen = useSketchStore((s) => s.libraryPanelOpen);
  const realHardwareModalComponentId = useSketchStore((s) => s.realHardwareModalComponentId);
  const closeRealHardwareModal = useSketchStore((s) => s.closeRealHardwareModal);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

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
    </div>
  );
}
