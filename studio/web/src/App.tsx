import { useEffect, useState } from "react";
import { useAudioEngine } from "./hooks/useAudioEngine";
import { LibraryScreen } from "./screens/LibraryScreen";
import { ProjectScreen } from "./screens/ProjectScreen";
import { StartScreen } from "./screens/StartScreen";

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

export function App() {
  const audio = useAudioEngine();
  const hash = useHash();
  const project = hash.match(/^#\/p\/([0-9a-f]{32})$/)?.[1];
  if (project) return <ProjectScreen key={project} id={project} audio={audio} />;
  return hash === "#/new" ? <StartScreen /> : <LibraryScreen />;
}
