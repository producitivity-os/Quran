import { createRoot } from "react-dom/client";
import "@productivity-os/shared-ui/globals.css";
import { SharedUiProvider } from "@productivity-os/shared-ui/components/shared-ui-provider";
import { NativeThemeSync } from "@productivity-os/shared-ui/components/native-theme-sync";
import { ThemeProvider } from "@productivity-os/shared-ui/components/theme-provider";
import { App } from "./App";
import "./App.css";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider
    defaultTheme="system"
    storageKey="quran-theme"
    systemThemeMigrationVersion="2026-09"
  >
    <SharedUiProvider><NativeThemeSync /><App /></SharedUiProvider>
  </ThemeProvider>,
);
