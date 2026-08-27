import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./atlas.css";
import "./terminal-workspace-review.css";

const root = document.querySelector<HTMLDivElement>("#root");
if (!root) throw new Error("Observatory root element is missing.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
