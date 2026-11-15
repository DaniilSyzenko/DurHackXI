import { useEffect, useState } from "react";
import { analyzeAudioFile } from "./audio/analyzeAudio";
import { generateCityLayout } from "./city/generateCity";
import UploadScreen from "./components/UploadScreen";
import CityExplorer from "./components/CityExplorer";

export default function App() {
  const [screen, setScreen] = useState("upload");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState(null);

  useEffect(() => {
    return () => {
      if (session?.audioUrl) {
        URL.revokeObjectURL(session.audioUrl);
      }
    };
  }, [session]);

  async function handleGenerate(file) {
    setIsLoading(true);
    setError("");

    try {
      const { duration, segments } = await analyzeAudioFile(file);
      const cityData = generateCityLayout(segments, duration);
      const audioUrl = URL.createObjectURL(file);

      setSession({
        fileName: file.name,
        duration,
        cityData,
        audioUrl,
      });
      setScreen("explore");
    } catch {
      setError("Failed to analyze audio. Please try a different MP3 or WAV.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleExit() {
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    setScreen("upload");
    setSession(null);
  }

  if (screen === "explore" && session) {
    return (
      <CityExplorer
        cityData={session.cityData}
        fileName={session.fileName}
        duration={session.duration}
        audioUrl={session.audioUrl}
        onExit={handleExit}
      />
    );
  }

  return (
    <UploadScreen
      onGenerate={handleGenerate}
      isLoading={isLoading}
      error={error}
    />
  );
}