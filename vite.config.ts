import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// The build is ONE self-contained HTML file (script, styles and all) so it can be opened
// straight from disk — double-click it, no server, no hosting, no internet. Browsers refuse
// to load separate script files from file:// URLs, which is why everything is inlined.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
});
