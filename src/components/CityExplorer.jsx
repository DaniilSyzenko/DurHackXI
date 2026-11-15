import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { SECONDS_PER_ROW, WALK_SPEED } from "../city/generateCity";

const PLAYER_RADIUS = 0.65;
const LAMP_LIGHT_POOL_SIZE = 8;

const LIT_WINDOW_BASE = new THREE.Color("#ffd066");
const LIT_WINDOW_OFF = new THREE.Color("#101726");
const ACTIVE_WINDOW_COLOR = new THREE.Color();

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function collidesWithBuildings(x, z, colliders) {
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    if (
      x + PLAYER_RADIUS > b.minX &&
      x - PLAYER_RADIUS < b.maxX &&
      z + PLAYER_RADIUS > b.minZ &&
      z - PLAYER_RADIUS < b.maxZ
    ) {
      return true;
    }
  }
  return false;
}

export default function CityExplorer({
  cityData,
  fileName,
  duration,
  audioUrl,
  onExit,
}) {
  const mountRef = useRef(null);
  const audioRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const freqDataRef = useRef(null);
  const controlsRef = useRef(null);
  const cameraRef = useRef(null);

  const [isLocked, setIsLocked] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isCruise, setIsCruise] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeRowIdx, setActiveRowIdx] = useState(0);

  const isPlayingRef = useRef(false);
  const isCruiseRef = useRef(true);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    isCruiseRef.current = isCruise;
  }, [isCruise]);

  useEffect(() => {
    if (!audioUrl) return;
    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    const handleEnded = () => {
      setIsPlaying(false);
      isPlayingRef.current = false;
    };
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("ended", handleEnded);
      audio.pause();
      audioRef.current = null;
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
        analyserRef.current = null;
        freqDataRef.current = null;
      }
    };
  }, [audioUrl]);

  function ensureAudioAnalyser() {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      if (!audioCtxRef.current) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioCtx();
        const source = ctx.createMediaElementSource(audio);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.55;
        source.connect(analyser);
        analyser.connect(ctx.destination);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
        freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);
      }
      if (audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume().catch(() => {});
      }
    } catch {
      // Fall back gracefully if Web Audio analyser cannot attach
    }
  }

  function toggleAudio(lockPointer = false) {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      ensureAudioAnalyser();
      audio
        .play()
        .then(() => {
          setIsPlaying(true);
          isPlayingRef.current = true;
          if (lockPointer && controlsRef.current && !controlsRef.current.isLocked) {
            controlsRef.current.lock();
          }
        })
        .catch(() => {});
    } else {
      audio.pause();
      setIsPlaying(false);
      isPlayingRef.current = false;
    }
  }

  function setCruiseMode(enabled) {
    isCruiseRef.current = enabled;
    setIsCruise(enabled);
  }

  function restartRun() {
    const cam = cameraRef.current;
    if (cam) {
      cam.position.set(cityData.spawn.x, cityData.spawn.y, cityData.spawn.z);
      cam.rotation.set(0, 0, 0);
    }
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = 0;
      setCurrentTime(0);
      setActiveRowIdx(0);
    }
    setCruiseMode(true);
  }

  function handleSeek(e) {
    const audio = audioRef.current;
    if (!audio || !duration || duration <= 0) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newTime = ratio * duration;

    audio.currentTime = newTime;
    setCurrentTime(newTime);

    const rowIdx = Math.min(
      Math.max(0, cityData.rowSummaries.length - 1),
      Math.floor(newTime / SECONDS_PER_ROW)
    );
    setActiveRowIdx(rowIdx);

    const cam = cameraRef.current;
    if (cam) {
      const targetZ = THREE.MathUtils.clamp(
        -newTime * WALK_SPEED,
        cityData.bounds.minZ,
        cityData.bounds.maxZ
      );
      cam.position.set(0, cityData.spawn.y, targetZ);
    }
  }

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const disposables = [];
    const track = (item) => {
      disposables.push(item);
      return item;
    };

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#141d33");
    scene.fog = new THREE.Fog("#141d33", 75, 270);

    const camera = new THREE.PerspectiveCamera(
      70,
      container.clientWidth / container.clientHeight,
      0.1,
      450
    );
    camera.position.set(cityData.spawn.x, cityData.spawn.y, cityData.spawn.z);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Balanced twilight ambient so street PointLights & beat pulses contrast clearly
    const ambientLight = new THREE.AmbientLight("#495e8a", 0.72);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight("#5a74ad", "#1c2230", 0.42);
    scene.add(hemiLight);

    const moonLight = new THREE.DirectionalLight("#a8c4f0", 0.62);
    moonLight.position.set(60, 105, -80);
    moonLight.castShadow = true;
    moonLight.shadow.mapSize.set(2048, 2048);
    moonLight.shadow.camera.left = -85;
    moonLight.shadow.camera.right = 85;
    moonLight.shadow.camera.top = 85;
    moonLight.shadow.camera.bottom = -85;
    moonLight.shadow.camera.near = 10;
    moonLight.shadow.camera.far = 320;
    scene.add(moonLight);
    scene.add(moonLight.target);

    const skyGroup = new THREE.Group();
    scene.add(skyGroup);

    const moonGeo = track(new THREE.CircleGeometry(13, 18));
    const moonMat = track(
      new THREE.MeshBasicMaterial({ color: "#eef4ff", fog: false })
    );
    const moonMesh = new THREE.Mesh(moonGeo, moonMat);
    moonMesh.position.set(34, 88, -260);
    skyGroup.add(moonMesh);

    const starCount = 320;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const s1 = Math.sin(i * 12.9898) * 43758.5453;
      const s2 = Math.sin(i * 78.233) * 23421.631;
      const s3 = Math.sin(i * 45.164) * 19283.412;
      const r1 = s1 - Math.floor(s1);
      const r2 = s2 - Math.floor(s2);
      const r3 = s3 - Math.floor(s3);

      starPositions[i * 3] = (r1 - 0.5) * 420;
      starPositions[i * 3 + 1] = 48 + r2 * 110;
      starPositions[i * 3 + 2] = (r3 - 0.5) * 420 - 60;
    }
    const starGeo = track(new THREE.BufferGeometry());
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const starMat = track(
      new THREE.PointsMaterial({
        color: "#dce8ff",
        size: 0.75,
        sizeAttenuation: true,
        fog: false,
      })
    );
    skyGroup.add(new THREE.Points(starGeo, starMat));

    const {
      bounds,
      startPlaza,
      endPlaza,
      sidewalks,
      curbs,
      lamps,
      trees,
      crosswalksZ,
      litWindows,
      unlitWindows,
      buildings,
      colliders,
      roadEndZ,
    } = cityData;

    const groundWidth = bounds.maxX - bounds.minX + 40;
    const groundDepth = bounds.maxZ - bounds.minZ + 40;
    const groundGeo = track(new THREE.PlaneGeometry(groundWidth, groundDepth));
    const groundMat = track(new THREE.MeshLambertMaterial({ color: "#1d222c" }));
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(
      (bounds.minX + bounds.maxX) / 2,
      0,
      (bounds.minZ + bounds.maxZ) / 2
    );
    ground.receiveShadow = true;
    scene.add(ground);

    const plazaMat = track(new THREE.MeshLambertMaterial({ color: "#4c5669" }));
    const startPlazaGeo = track(
      new THREE.BoxGeometry(startPlaza.width, 0.16, startPlaza.depth)
    );
    const startPlazaMesh = new THREE.Mesh(startPlazaGeo, plazaMat);
    startPlazaMesh.position.set(startPlaza.x, 0.08, startPlaza.z);
    startPlazaMesh.receiveShadow = true;
    scene.add(startPlazaMesh);

    const endPlazaGeo = track(
      new THREE.BoxGeometry(endPlaza.width, 0.16, endPlaza.depth)
    );
    const endPlazaMesh = new THREE.Mesh(endPlazaGeo, plazaMat);
    endPlazaMesh.position.set(endPlaza.x, 0.08, endPlaza.z);
    endPlazaMesh.receiveShadow = true;
    scene.add(endPlazaMesh);

    const lineGeo = track(new THREE.PlaneGeometry(10, 0.36));
    const startLineMat = track(new THREE.MeshBasicMaterial({ color: "#7bc4ff" }));
    const startLine = new THREE.Mesh(lineGeo, startLineMat);
    startLine.rotation.x = -Math.PI / 2;
    startLine.position.set(0, 0.025, 0);
    scene.add(startLine);

    const endLineMat = track(new THREE.MeshBasicMaterial({ color: "#ff9e6d" }));
    const endLine = new THREE.Mesh(lineGeo, endLineMat);
    endLine.rotation.x = -Math.PI / 2;
    endLine.position.set(0, 0.025, roadEndZ);
    scene.add(endLine);

    const boxUnitGeo = track(new THREE.BoxGeometry(1, 1, 1));
    const dummy = new THREE.Object3D();

    if (sidewalks.length > 0) {
      const swMat = track(new THREE.MeshLambertMaterial({ color: "#444d5e" }));
      const swMesh = new THREE.InstancedMesh(boxUnitGeo, swMat, sidewalks.length);
      swMesh.receiveShadow = true;
      sidewalks.forEach((sw, idx) => {
        dummy.position.set(sw.x, 0.075, sw.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(sw.width, 0.15, sw.depth);
        dummy.updateMatrix();
        swMesh.setMatrixAt(idx, dummy.matrix);
      });
      scene.add(swMesh);
    }

    if (curbs.length > 0) {
      const curbMat = track(new THREE.MeshLambertMaterial({ color: "#68748a" }));
      const curbMesh = new THREE.InstancedMesh(boxUnitGeo, curbMat, curbs.length);
      curbMesh.receiveShadow = true;
      curbs.forEach((c, idx) => {
        dummy.position.set(c.x, 0.095, c.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(c.width, 0.19, c.depth);
        dummy.updateMatrix();
        curbMesh.setMatrixAt(idx, dummy.matrix);
      });
      scene.add(curbMesh);
    }

    const dashZList = [];
    for (let z = -3; z > roadEndZ + 2; z -= 8) {
      dashZList.push(z);
    }
    if (dashZList.length > 0) {
      const dashGeo = track(new THREE.PlaneGeometry(0.32, 3));
      const dashMat = track(new THREE.MeshBasicMaterial({ color: "#8c9bb3" }));
      const dashMesh = new THREE.InstancedMesh(dashGeo, dashMat, dashZList.length);
      dashZList.forEach((z, idx) => {
        dummy.position.set(0, 0.02, z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        dashMesh.setMatrixAt(idx, dummy.matrix);
      });
      scene.add(dashMesh);
    }

    if (crosswalksZ.length > 0) {
      const stripeXOffsets = [-3.6, -2.4, -1.2, 0, 1.2, 2.4, 3.6];
      const stripeGeo = track(new THREE.PlaneGeometry(0.65, 2.2));
      const stripeMat = track(new THREE.MeshBasicMaterial({ color: "#b6c2d6" }));
      const totalStripes = crosswalksZ.length * stripeXOffsets.length;
      const crosswalkMesh = new THREE.InstancedMesh(
        stripeGeo,
        stripeMat,
        totalStripes
      );
      let sIdx = 0;
      for (const cz of crosswalksZ) {
        for (const sx of stripeXOffsets) {
          dummy.position.set(sx, 0.022, cz);
          dummy.rotation.set(-Math.PI / 2, 0, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          crosswalkMesh.setMatrixAt(sIdx++, dummy.matrix);
        }
      }
      scene.add(crosswalkMesh);
    }

    const buildingMaterials = [];
    const mainRowMaterials = new Map();

    for (const b of buildings) {
      const mat = track(
        new THREE.MeshStandardMaterial({
          color: b.color,
          roughness: 0.78,
          metalness: 0.06,
        })
      );
      buildingMaterials.push(mat);

      if (b.isMainRow) {
        if (!mainRowMaterials.has(b.rowIndex)) {
          mainRowMaterials.set(b.rowIndex, []);
        }
        mainRowMaterials.get(b.rowIndex).push({ mat, baseColor: b.color });
      }

      const mesh = new THREE.Mesh(boxUnitGeo, mat);
      mesh.scale.set(b.width, b.height, b.depth);
      mesh.position.set(b.x, b.height / 2 + 0.15, b.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }

    if (unlitWindows.length > 0) {
      const unlitMat = track(
        new THREE.MeshStandardMaterial({
          color: "#101726",
          roughness: 0.35,
          metalness: 0.25,
        })
      );
      const unlitMesh = new THREE.InstancedMesh(
        boxUnitGeo,
        unlitMat,
        unlitWindows.length
      );
      unlitWindows.forEach((w, idx) => {
        dummy.position.set(w.x, w.y, w.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(w.w, w.h, w.d);
        dummy.updateMatrix();
        unlitMesh.setMatrixAt(idx, dummy.matrix);
      });
      scene.add(unlitMesh);
    }

    let litWindowMesh = null;
    const mainRowLitIndices = new Map();
    const windowStates = new Uint8Array(litWindows.length);
    windowStates.fill(1);

    if (litWindows.length > 0) {
      const litMat = track(new THREE.MeshBasicMaterial({ color: "#ffffff" }));
      litWindowMesh = new THREE.InstancedMesh(
        boxUnitGeo,
        litMat,
        litWindows.length
      );
      litWindows.forEach((w, idx) => {
        dummy.position.set(w.x, w.y, w.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(w.w, w.h, w.d);
        dummy.updateMatrix();
        litWindowMesh.setMatrixAt(idx, dummy.matrix);
        litWindowMesh.setColorAt(idx, LIT_WINDOW_BASE);

        if (w.isMainRow) {
          if (!mainRowLitIndices.has(w.rowIndex)) {
            mainRowLitIndices.set(w.rowIndex, []);
          }
          mainRowLitIndices.get(w.rowIndex).push(idx);
        }
      });
      if (litWindowMesh.instanceColor) {
        litWindowMesh.instanceColor.needsUpdate = true;
      }
      scene.add(litWindowMesh);
    }

    if (trees.length > 0) {
      const trunkGeo = track(new THREE.CylinderGeometry(0.12, 0.17, 1.1, 6));
      const trunkMat = track(new THREE.MeshLambertMaterial({ color: "#4d382a" }));
      const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
      trunkMesh.castShadow = true;

      const lowerConeGeo = track(new THREE.ConeGeometry(0.85, 1.85, 7));
      const upperConeGeo = track(new THREE.ConeGeometry(0.62, 1.45, 7));
      const foliageMat = track(new THREE.MeshLambertMaterial({ color: "#2d6a4f" }));
      const lowerConeMesh = new THREE.InstancedMesh(
        lowerConeGeo,
        foliageMat,
        trees.length
      );
      const upperConeMesh = new THREE.InstancedMesh(
        upperConeGeo,
        foliageMat,
        trees.length
      );
      lowerConeMesh.castShadow = true;
      upperConeMesh.castShadow = true;

      trees.forEach((t, idx) => {
        const s = t.scale;
        dummy.rotation.set(0, idx * 0.7, 0);

        dummy.position.set(t.x, 0.15 + 0.55 * s, t.z);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        trunkMesh.setMatrixAt(idx, dummy.matrix);

        dummy.position.set(t.x, 0.15 + 1.85 * s, t.z);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        lowerConeMesh.setMatrixAt(idx, dummy.matrix);

        dummy.position.set(t.x, 0.15 + 2.75 * s, t.z);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        upperConeMesh.setMatrixAt(idx, dummy.matrix);
      });

      scene.add(trunkMesh);
      scene.add(lowerConeMesh);
      scene.add(upperConeMesh);
    }

    const lampLightTargets = [];
    let bulbMat = null;
    let poolMat = null;

    if (lamps.length > 0) {
      const poleMat = track(new THREE.MeshLambertMaterial({ color: "#242b38" }));
      const poleMesh = new THREE.InstancedMesh(boxUnitGeo, poleMat, lamps.length);
      const armMesh = new THREE.InstancedMesh(boxUnitGeo, poleMat, lamps.length);

      const bulbGeo = track(new THREE.BoxGeometry(0.42, 0.18, 0.28));
      bulbMat = track(new THREE.MeshBasicMaterial({ color: "#ffe099" }));
      const bulbMesh = new THREE.InstancedMesh(bulbGeo, bulbMat, lamps.length);

      const poolGeo = track(new THREE.CircleGeometry(3.8, 16));
      poolMat = track(
        new THREE.MeshBasicMaterial({
          color: "#ffb347",
          transparent: true,
          opacity: 0.1,
          depthWrite: false,
        })
      );
      const poolMesh = new THREE.InstancedMesh(poolGeo, poolMat, lamps.length);

      lamps.forEach((l, idx) => {
        const inward = -l.side;
        const armX = l.x + inward * 0.42;
        const bulbX = l.x + inward * 0.72;

        dummy.position.set(l.x, 0.15 + 2.25, l.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(0.14, 4.5, 0.14);
        dummy.updateMatrix();
        poleMesh.setMatrixAt(idx, dummy.matrix);

        dummy.position.set(armX, 0.15 + 4.46, l.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(0.9, 0.1, 0.12);
        dummy.updateMatrix();
        armMesh.setMatrixAt(idx, dummy.matrix);

        dummy.position.set(bulbX, 0.15 + 4.35, l.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        bulbMesh.setMatrixAt(idx, dummy.matrix);

        dummy.position.set(bulbX, 0.018, l.z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        poolMesh.setMatrixAt(idx, dummy.matrix);

        lampLightTargets.push({ x: bulbX, y: 4.25, z: l.z });
      });

      scene.add(poleMesh);
      scene.add(armMesh);
      scene.add(bulbMesh);
      scene.add(poolMesh);
    }

    const pointLightPool = [];
    for (let i = 0; i < LAMP_LIGHT_POOL_SIZE; i++) {
      const pl = new THREE.PointLight("#ffb85c", 12, 24, 1.5);
      pl.position.set(0, -50, 0);
      scene.add(pl);
      pointLightPool.push(pl);
    }

    const controls = new PointerLockControls(camera, renderer.domElement);
    controlsRef.current = controls;

    const onLock = () => setIsLocked(true);
    const onUnlock = () => setIsLocked(false);
    controls.addEventListener("lock", onLock);
    controls.addEventListener("unlock", onUnlock);

    const onCanvasClick = () => {
      if (!controls.isLocked) {
        controls.lock();
      }
    };
    renderer.domElement.addEventListener("click", onCanvasClick);

    const keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
    };

    const onKeyDown = (e) => {
      switch (e.code) {
        case "KeyW":
        case "ArrowUp":
          keys.forward = true;
          if (isCruiseRef.current) setCruiseMode(false);
          break;
        case "KeyS":
        case "ArrowDown":
          keys.backward = true;
          if (isCruiseRef.current) setCruiseMode(false);
          break;
        case "KeyA":
        case "ArrowLeft":
          keys.left = true;
          if (isCruiseRef.current) setCruiseMode(false);
          break;
        case "KeyD":
        case "ArrowRight":
          keys.right = true;
          if (isCruiseRef.current) setCruiseMode(false);
          break;
        case "KeyP":
          toggleAudio(false);
          break;
        case "KeyC":
          setCruiseMode(!isCruiseRef.current);
          break;
        case "KeyR":
          restartRun();
          break;
        default:
          break;
      }
    };

    const onKeyUp = (e) => {
      switch (e.code) {
        case "KeyW":
        case "ArrowUp":
          keys.forward = false;
          break;
        case "KeyS":
        case "ArrowDown":
          keys.backward = false;
          break;
        case "KeyA":
        case "ArrowLeft":
          keys.left = false;
          break;
        case "KeyD":
        case "ArrowRight":
          keys.right = false;
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const onResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", onResize);

    let animationId = 0;
    let prevTime = performance.now();
    let lastHudTime = -1;
    let highlightedRow = -1;
    let windowToggleTimer = 0;
    let slowBeatAvg = 0;
    let pulse = 0;

    const forwardVec = new THREE.Vector3();
    const rightVec = new THREE.Vector3();
    const moveVec = new THREE.Vector3();

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const now = performance.now();
      const delta = Math.min((now - prevTime) / 1000, 0.1);
      prevTime = now;

      // 1. Beat-transient detection (live bass vs moving baseline)
      let rawBass = 0;
      if (isPlayingRef.current && analyserRef.current && freqDataRef.current) {
        analyserRef.current.getByteFrequencyData(freqDataRef.current);
        const data = freqDataRef.current;
        rawBass = (data[0] + data[1] + data[2]) / (3 * 255);
      }

      slowBeatAvg += (rawBass - slowBeatAvg) * Math.min(1, delta * 2.2);
      const beatPunch = isPlayingRef.current
        ? THREE.MathUtils.clamp((rawBass - slowBeatAvg * 0.82) * 3.8, 0, 1)
        : 0;

      // Fast attack on kick/beat, smooth natural decay
      if (beatPunch > pulse) {
        pulse = beatPunch;
      } else {
        pulse += (beatPunch - pulse) * Math.min(1, delta * 8.5);
      }

      // Pulse street PointLights, ground pools, and lamp bulbs
      const lampIntensity = 12 + pulse * 36;
      const lampDistance = 23 + pulse * 11;
      for (let i = 0; i < LAMP_LIGHT_POOL_SIZE; i++) {
        pointLightPool[i].intensity = lampIntensity;
        pointLightPool[i].distance = lampDistance;
      }
      if (poolMat) {
        poolMat.opacity = 0.08 + pulse * 0.3;
        poolMat.color.setRGB(1.0, 0.68 + pulse * 0.28, 0.25 + pulse * 0.45);
      }
      if (bulbMat) {
        bulbMat.color.setRGB(1.0, 0.76 + pulse * 0.24, 0.35 + pulse * 0.55);
      }

      // 2. Active random window toggling in buildings ahead of the camera
      if (isPlayingRef.current && litWindowMesh && litWindows.length > 0) {
        windowToggleTimer += delta;
        if (windowToggleTimer >= 0.25) {
          windowToggleTimer = 0;

          const camZ = camera.position.z;
          let lo = 0;
          let hi = litWindows.length - 1;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (litWindows[mid].z > camZ) lo = mid + 1;
            else hi = mid;
          }

          // Focus toggles ahead of the player down the street
          const minIdx = Math.max(0, lo - 40);
          const maxIdx = Math.min(litWindows.length - 1, lo + 550);
          const span = Math.max(1, maxIdx - minIdx + 1);
          let changed = false;

          for (let k = 0; k < 10; k++) {
            const idx = minIdx + Math.floor(Math.random() * span);
            const w = litWindows[idx];
            if (w.isMainRow && w.rowIndex === highlightedRow) {
              continue;
            }
            windowStates[idx] = windowStates[idx] ? 0 : 1;
            litWindowMesh.setColorAt(
              idx,
              windowStates[idx] ? LIT_WINDOW_BASE : LIT_WINDOW_OFF
            );
            changed = true;
          }

          if (changed && litWindowMesh.instanceColor) {
            litWindowMesh.instanceColor.needsUpdate = true;
          }
        }
      }

      // 3. Sync audio timestamp, HUD meters, and active building pulse
      const audio = audioRef.current;
      if (audio) {
        if (Math.abs(audio.currentTime - lastHudTime) >= 0.2) {
          lastHudTime = audio.currentTime;
          setCurrentTime(audio.currentTime);
        }

        const clampedRow = Math.min(
          Math.max(0, cityData.rowSummaries.length - 1),
          Math.floor(audio.currentTime / SECONDS_PER_ROW)
        );

        const activeRow =
          isPlayingRef.current || audio.currentTime > 0 ? clampedRow : -1;

        if (activeRow !== highlightedRow) {
          if (highlightedRow >= 0 && mainRowMaterials.has(highlightedRow)) {
            for (const entry of mainRowMaterials.get(highlightedRow)) {
              entry.mat.emissive.setHex(0x000000);
            }
          }
          if (
            litWindowMesh &&
            highlightedRow >= 0 &&
            mainRowLitIndices.has(highlightedRow)
          ) {
            for (const idx of mainRowLitIndices.get(highlightedRow)) {
              litWindowMesh.setColorAt(
                idx,
                windowStates[idx] ? LIT_WINDOW_BASE : LIT_WINDOW_OFF
              );
            }
            if (litWindowMesh.instanceColor) {
              litWindowMesh.instanceColor.needsUpdate = true;
            }
          }

          highlightedRow = activeRow;
          setActiveRowIdx(Math.max(0, activeRow));
        }

        // Pulse the currently playing row's facade & lit windows with the beat
        if (highlightedRow >= 0 && mainRowMaterials.has(highlightedRow)) {
          const glowScale = 0.22 + pulse * 0.45;
          for (const entry of mainRowMaterials.get(highlightedRow)) {
            entry.mat.emissive.copy(entry.baseColor).multiplyScalar(glowScale);
          }
        }
        if (
          litWindowMesh &&
          highlightedRow >= 0 &&
          mainRowLitIndices.has(highlightedRow)
        ) {
          ACTIVE_WINDOW_COLOR.setRGB(
            1.0,
            0.84 + pulse * 0.16,
            0.48 + pulse * 0.52
          );
          for (const idx of mainRowLitIndices.get(highlightedRow)) {
            litWindowMesh.setColorAt(idx, ACTIVE_WINDOW_COLOR);
          }
          if (litWindowMesh.instanceColor) {
            litWindowMesh.instanceColor.needsUpdate = true;
          }
        }
      }

      // 4. Movement: Option A Audio-Locked Auto-Cruise OR manual WASD
      const manualInput =
        keys.forward || keys.backward || keys.left || keys.right;

      if (audio && isPlayingRef.current && isCruiseRef.current && !manualInput) {
        const targetZ = THREE.MathUtils.clamp(
          -audio.currentTime * WALK_SPEED,
          bounds.minZ,
          bounds.maxZ
        );
        const zDiff = targetZ - camera.position.z;

        if (Math.abs(zDiff) > 12 || Math.abs(camera.position.x) > 4.6) {
          if (Math.abs(zDiff) > 12) {
            camera.position.x = 0;
            camera.position.z = targetZ;
          } else {
            const pullX = THREE.MathUtils.clamp(
              -camera.position.x * Math.min(1, delta * 5),
              -WALK_SPEED * 1.5 * delta,
              WALK_SPEED * 1.5 * delta
            );
            if (
              !collidesWithBuildings(
                camera.position.x + pullX,
                camera.position.z,
                colliders
              )
            ) {
              camera.position.x += pullX;
            }
            const stepZ = zDiff * Math.min(1, delta * 8);
            if (
              !collidesWithBuildings(
                camera.position.x,
                camera.position.z + stepZ,
                colliders
              )
            ) {
              camera.position.z += stepZ;
            }
          }
        } else {
          if (Math.abs(camera.position.x) > 0.02) {
            camera.position.x +=
              -camera.position.x * Math.min(1, delta * 4);
          }
          camera.position.z += zDiff * Math.min(1, delta * 10);
        }
      } else if (controls.isLocked && manualInput) {
        const moveZ = Number(keys.forward) - Number(keys.backward);
        const moveX = Number(keys.right) - Number(keys.left);

        camera.getWorldDirection(forwardVec);
        forwardVec.y = 0;
        if (forwardVec.lengthSq() > 1e-6) {
          forwardVec.normalize();
        } else {
          forwardVec.set(0, 0, -1);
        }

        rightVec.crossVectors(forwardVec, camera.up).normalize();

        moveVec
          .set(0, 0, 0)
          .addScaledVector(forwardVec, moveZ)
          .addScaledVector(rightVec, moveX)
          .normalize()
          .multiplyScalar(WALK_SPEED * delta);

        const nextX = THREE.MathUtils.clamp(
          camera.position.x + moveVec.x,
          bounds.minX,
          bounds.maxX
        );
        if (!collidesWithBuildings(nextX, camera.position.z, colliders)) {
          camera.position.x = nextX;
        }

        const nextZ = THREE.MathUtils.clamp(
          camera.position.z + moveVec.z,
          bounds.minZ,
          bounds.maxZ
        );
        if (!collidesWithBuildings(camera.position.x, nextZ, colliders)) {
          camera.position.z = nextZ;
        }
      }

      camera.position.y = cityData.spawn.y;

      if (lampLightTargets.length > 0) {
        const camZ = camera.position.z;
        let lo = 0;
        let hi = lampLightTargets.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (lampLightTargets[mid].z > camZ) lo = mid + 1;
          else hi = mid;
        }
        const halfPool = LAMP_LIGHT_POOL_SIZE >> 1;
        const startIdx = Math.max(
          0,
          Math.min(lampLightTargets.length - LAMP_LIGHT_POOL_SIZE, lo - halfPool)
        );
        for (let i = 0; i < LAMP_LIGHT_POOL_SIZE; i++) {
          const target = lampLightTargets[startIdx + i];
          if (target) {
            pointLightPool[i].position.set(target.x, target.y, target.z);
            pointLightPool[i].visible = true;
          } else {
            pointLightPool[i].visible = false;
          }
        }
      }

      skyGroup.position.z = camera.position.z;
      moonLight.position.set(60, 105, camera.position.z - 80);
      moonLight.target.position.set(0, 0, camera.position.z);
      moonLight.target.updateMatrixWorld();

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("click", onCanvasClick);
      controls.removeEventListener("lock", onLock);
      controls.removeEventListener("unlock", onUnlock);
      controls.dispose();
      controlsRef.current = null;
      cameraRef.current = null;

      disposables.forEach((d) => d.dispose());
      renderer.dispose();

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [cityData]);

  const progressPct =
    duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const activeFeature = cityData.rowSummaries[activeRowIdx] || {
    rms: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    colorCss: "#5ea8ff",
  };

  return (
    <div className="explore-container">
      <div ref={mountRef} className="canvas-mount" />

      {isLocked && <div className="crosshair" />}

      {!isLocked && (
        <div className="lock-prompt">
          Click scene to look around &nbsp;·&nbsp; Press <strong>P</strong> to{" "}
          {isPlaying ? "pause" : "play & cruise"}
        </div>
      )}

      <div className="hud-top-left">
        <div className="hud-title" title={fileName}>
          {fileName}
        </div>
        <div className="hud-meta">
          Time: {formatDuration(currentTime)} / {formatDuration(duration)} ·
          Speed: {WALK_SPEED} u/s
        </div>

        <div
          className="progress-track"
          onClick={handleSeek}
          title="Click to jump to any part of the song"
        >
          <div
            className="progress-fill"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        <div className="feature-meters">
          <div className="feature-row">
            <span className="feature-label">Loudness (H)</span>
            <div className="feature-bar-bg">
              <div
                className="feature-bar-fill"
                style={{ width: `${activeFeature.rms * 100}%` }}
              />
            </div>
          </div>
          <div className="feature-row">
            <span className="feature-label">Bass (W)</span>
            <div className="feature-bar-bg">
              <div
                className="feature-bar-fill"
                style={{ width: `${activeFeature.bass * 100}%` }}
              />
            </div>
          </div>
          <div className="feature-row">
            <span className="feature-label">Mid (D)</span>
            <div className="feature-bar-bg">
              <div
                className="feature-bar-fill"
                style={{ width: `${activeFeature.mid * 100}%` }}
              />
            </div>
          </div>
          <div className="feature-row">
            <span className="feature-label">Treble (Color)</span>
            <div className="feature-bar-bg">
              <div
                className="feature-bar-fill"
                style={{
                  width: `${activeFeature.treble * 100}%`,
                  backgroundColor: activeFeature.colorCss,
                }}
              />
            </div>
          </div>
        </div>

        <div className="hud-actions">
          {audioUrl && (
            <button
              type="button"
              className="hud-btn"
              onClick={() => toggleAudio(true)}
            >
              {isPlaying ? "Pause (P)" : "Play (P)"}
            </button>
          )}
          <button
            type="button"
            className={`hud-btn ${isCruise ? "hud-btn-active" : ""}`}
            onClick={() => setCruiseMode(!isCruise)}
          >
            Cruise: {isCruise ? "ON" : "OFF"} (C)
          </button>
          <button type="button" className="hud-btn" onClick={restartRun}>
            Restart (R)
          </button>
          <button type="button" className="hud-btn" onClick={onExit}>
            Menu
          </button>
        </div>
      </div>

      <div className="hud-bottom-left">
        <div>
          <strong>Move:</strong> W A S D &nbsp;|&nbsp; <strong>Look:</strong>{" "}
          Mouse &nbsp;|&nbsp; <strong>Release:</strong> ESC
        </div>
        <div>
          <strong>Audio:</strong> P &nbsp;|&nbsp; <strong>Auto-Cruise:</strong>{" "}
          C &nbsp;|&nbsp; <strong>Restart:</strong> R
        </div>
      </div>
    </div>
  );
}