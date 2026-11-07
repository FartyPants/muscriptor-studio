import { useEffect, useState } from "react";
import { useAudioEngine } from "./hooks/useAudioEngine";
import { Editor } from "./screens/Editor";
import { NewTranscription } from "./screens/NewTranscription";

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
  const project = useHash().match(/^#\/p\/([0-9a-f]{32})$/)?.[1];
  return project ? <Editor key={project} id={project} audio={audio} /> : <NewTranscription />;
}
