import { useRef, useState } from "react";
import { readAudioMetadata } from "../audio/analyzeAudio";

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function isSupportedAudio(file) {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".mp3") ||
    name.endsWith(".wav") ||
    file.type === "audio/mpeg" ||
    file.type === "audio/wav" ||
    file.type === "audio/x-wav"
  );
}

const SKYLINE_BUILDINGS = [
  { x: 20, w: 68, h: 150, color: "#1d2b4f" },
  { x: 96, w: 82, h: 230, color: "#233963" },
  { x: 186, w: 60, h: 175, color: "#224a6e" },
  { x: 254, w: 90, h: 310, color: "#285d75" },
  { x: 354, w: 72, h: 215, color: "#2e7378" },
  { x: 434, w: 64, h: 145, color: "#264d6b" },
  { x: 508, w: 78, h: 265, color: "#3b8273" },
  { x: 594, w: 58, h: 190, color: "#588c6b" },
  // Central road gap (660..780)
  { x: 788, w: 60, h: 195, color: "#588c6b" },
  { x: 856, w: 80, h: 270, color: "#3b8273" },
  { x: 946, w: 66, h: 150, color: "#264d6b" },
  { x: 1020, w: 74, h: 235, color: "#8c6954" },
  { x: 1102, w: 92, h: 320, color: "#b36d52" },
  { x: 1204, w: 62, h: 185, color: "#6b556b" },
  { x: 1274, w: 84, h: 240, color: "#2b426b" },
  { x: 1366, w: 64, h: 160, color: "#1d2b4f" },
];

const STARS = [
  [120, 95, 1.4], [210, 165, 1.1], [340, 75, 1.6], [470, 140, 1.0],
  [580, 60, 1.5], [690, 120, 1.2], [810, 85, 1.3], [930, 155, 1.1],
  [1040, 70, 1.5], [1260, 110, 1.4], [1340, 180, 1.1], [160, 260, 1.0],
  [390, 230, 1.2], [520, 280, 1.0], [900, 250, 1.3], [1290, 270, 1.2],
];

export default function UploadScreen({ onGenerate, isLoading, error }) {
  const inputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [duration, setDuration] = useState(null);
  const [localError, setLocalError] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  async function handleFile(file) {
    if (!file) return;
    setLocalError("");

    if (!isSupportedAudio(file)) {
      setSelectedFile(null);
      setDuration(null);
      setLocalError("Please upload an MP3 or WAV audio file.");
      return;
    }

    setSelectedFile(file);
    setDuration(null);

    try {
      const meta = await readAudioMetadata(file);
      setDuration(meta.duration);
    } catch {
      setLocalError("Could not decode this audio file. Try another MP3 or WAV.");
      setSelectedFile(null);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    handleFile(file);
  }

  return (
    <div className="upload-screen">
      {/* Twilight Sonic Skyline Background */}
      <svg
        className="upload-bg"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMax slice"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0a0f1d" />
            <stop offset="55%" stopColor="#141e36" />
            <stop offset="100%" stopColor="#202e52" />
          </linearGradient>
          <radialGradient id="moonGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#dbe9ff" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#dbe9ff" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="1440" height="900" fill="url(#skyGrad)" />

        {/* Stars */}
        {STARS.map(([cx, cy, r], i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="#dce8ff"
            opacity="0.7"
          />
        ))}

        {/* Moon */}
        <circle cx="1160" cy="185" r="110" fill="url(#moonGlow)" />
        <circle cx="1160" cy="185" r="38" fill="#eef4ff" opacity="0.92" />

        {/* Distant horizon haze */}
        <rect x="0" y="640" width="1440" height="260" fill="#131c31" opacity="0.55" />

        {/* Central perspective road */}
        <polygon points="656,900 784,900 732,690 708,690" fill="#181d27" />
        <line
          x1="720"
          y1="885"
          x2="720"
          y2="705"
          stroke="#7e8ea8"
          strokeWidth="3"
          strokeDasharray="16 14"
          opacity="0.6"
        />

        {/* Soundwave-inspired low-poly buildings + glowing windows */}
        {SKYLINE_BUILDINGS.map((b, idx) => {
          const topY = 900 - b.h;
          const floors = b.h >= 250 ? 6 : b.h >= 190 ? 4 : 2;
          const cols = b.w >= 76 ? 3 : 2;
          const windows = [];

          for (let f = 0; f < floors; f++) {
            for (let c = 0; c < cols; c++) {
              const isLit = (idx * 7 + f * 3 + c * 5) % 4 !== 0;
              if (!isLit) continue;
              const wx = b.x + 12 + c * ((b.w - 28) / Math.max(1, cols - 1));
              const wy = topY + 22 + f * ((b.h - 46) / floors);
              windows.push(
                <rect
                  key={`${f}-${c}`}
                  x={wx}
                  y={wy}
                  width="8"
                  height="11"
                  rx="1"
                  fill="#ffd066"
                  opacity="0.78"
                />
              );
            }
          }

          return (
            <g key={idx}>
              <rect
                x={b.x}
                y={topY}
                width={b.w}
                height={b.h}
                fill={b.color}
                opacity="0.92"
              />
              {windows}
            </g>
          );
        })}
      </svg>

      <div className="upload-card">
        <h1 className="title">SONIC ATLAS</h1>
        <p className="tagline">WALK INSIDE YOUR SOUND</p>

        <div
          className={`dropzone ${isDragging ? "dragging" : ""}`}
          onClick={() => !isLoading && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
        >
          <p className="dropzone-text">
            Drag &amp; drop an MP3 or WAV file here
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={isLoading}
          >
            Select Audio File
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".mp3,.wav,audio/mpeg,audio/wav"
            hidden
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>

        {selectedFile && (
          <div className="file-info">
            <span className="file-name" title={selectedFile.name}>
              {selectedFile.name}
            </span>
            <span className="file-duration">
              {duration !== null ? formatDuration(duration) : "Reading..."}
            </span>
          </div>
        )}

        {(localError || error) && (
          <p className="error-msg">{localError || error}</p>
        )}

        {isLoading && (
          <div className="loading-row">
            <span className="spinner" />
            <span>Analyzing audio &amp; generating city...</span>
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary"
          disabled={!selectedFile || duration === null || isLoading}
          onClick={() => onGenerate(selectedFile)}
        >
          GENERATE CITY
        </button>
      </div>
    </div>
  );
}