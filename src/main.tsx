import { createRoot } from "react-dom/client";
import "@productivity-os/shared-ui/globals.css";
import { SharedUiProvider } from "@productivity-os/shared-ui/components/shared-ui-provider";
import { ThemeProvider } from "@productivity-os/shared-ui/components/theme-provider";
import { App } from "./App";
import "./App.css";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider defaultTheme="dark" storageKey="quran-theme">
    <SharedUiProvider><App /></SharedUiProvider>
  </ThemeProvider>,
);
