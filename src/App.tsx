import { useEffect } from 'react';
import { SketchCanvas } from './canvas/SketchCanvas';
import { useSketchStore } from './canvas/store/useSketchStore';
import { LibraryPanel } from './library/LibraryPanel';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { Toolbar } from './ui/Toolbar';
import './App.css';

export default function App() {
  const theme = useSketchStore((s) => s.theme);
  const libraryPanelOpen = useSketchStore((s) => s.libraryPanelOpen);

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
    </div>
  );
}
