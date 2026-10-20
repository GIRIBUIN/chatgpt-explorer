import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./style.css";
import { watchWindowBounds } from "./window-bounds";
const stopBounds = watchWindowBounds();
window.addEventListener("pagehide", stopBounds, { once: true });
createRoot(document.getElementById("root")!).render(<App />);
