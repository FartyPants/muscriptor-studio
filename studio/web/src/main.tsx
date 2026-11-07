import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./style.css";

// No <StrictMode>: Tone's transport and AudioContext are global, and a simulated
// double-mount would create a second engine (see useAudioEngine).
createRoot(document.getElementById("root")!).render(<App />);
