"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Engine } from "@/lib/engine/Engine";
import { calculateLiveScore } from "@/lib/scoring";
import { Camera } from "@/lib/engine/Camera";
import type { BaseSpec, EngineConfig, Tile, TileTag, Vec2 } from "@/lib/engine/Types";
import { useSimStore } from "@/lib/state/useSimStore";
import { getAgentColor, PEAK_TIMES } from "./utils";
import { buildSpecRuntime, DEFAULT_RUNTIME_PARAMS, type VariantParams as RuntimeVariantParams } from "@/lib/mapgen/runtime";

type Props = {
  engineRef: React.MutableRefObject<Engine | null>;
  variant?: "sim" | "editor";
  mapUrl?: string; // Optional external map URL
};

type BaseSpecFile = {
  width: number;
  height: number;
  spec: BaseSpec;
};

type PaintTool = "wall" | "slow" | "erase" | "tag";

export default function CanvasRenderer({ engineRef, variant = "sim", mapUrl: propMapUrl }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniCanvasRef = useRef<HTMLCanvasElement>(null);
  const renderPosRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [engine, setEngine] = useState<Engine | null>(null);
  const [_baseSpec, setBaseSpec] = useState<BaseSpec | null>(null);
  const [smoothRender, setSmoothRender] = useState(false);
  const editable = variant === "editor";

  const perfStatsRef = useRef({
    ticksPerSecond: 0,
    densityRecomputesPerSecond: 0,
    agentCount: 0,
  });
  const [perfStats, setPerfStats] = useState(perfStatsRef.current);

  const camera = useMemo(() => new Camera(), []);

  const speed = useSimStore(s => s.speed);
  const paused = useSimStore(s => s.paused);
  const agentCount = useSimStore(s => s.agentCount);
  const resetNonce = useSimStore(s => s.resetNonce);
  const selectedAgentId = useSimStore(s => s.selectedAgentId);
  const setSelectedAgentId = useSimStore(s => s.setSelectedAgentId);
  const setToast = useSimStore(s => s.setToast);

  const [paintTool, setPaintTool] = useState<PaintTool>("wall");
  const [tagPaint, setTagPaint] = useState<TileTag | null>("BUILDABLE");
  const paintDragStart = useRef<Vec2 | null>(null);
  const paintDragLastKey = useRef<string>("");
  const lockedToastRef = useRef(false);
  const renderCanvasRef = useRef<() => void>(() => { });
  const baseZoomRef = useRef(1);
  const miniVisibleRef = useRef(false);
  const [miniVisible, setMiniVisible] = useState(false);
  const [mapUrl, setMapUrl] = useState<string | null>(null);

  const prevMapParamsRef = useRef<string>("");

  const resetCamera = useCallback(() => {
    const canvas = canvasRef.current;
    const eng = engineRef.current;
    if (!canvas || !eng) {
      camera.offset = { x: 0, y: 0 };
      camera.zoom = 1;
      baseZoomRef.current = 1;
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const worldW = eng.map.width * eng.cfg.pixelsPerTile;
    const worldH = eng.map.height * eng.cfg.pixelsPerTile;
    const viewW = canvas.clientWidth || worldW;
    const viewH = canvas.clientHeight || worldH;
    const zx = viewW / worldW;
    const zy = viewH / worldH;
    const bestZoom = Math.min(zx, zy);
    baseZoomRef.current = bestZoom;
    camera.zoom = bestZoom;
    camera.offset = { x: (viewW * dpr - worldW * bestZoom) / 2, y: (viewH * dpr - worldH * bestZoom) / 2 };
  }, [camera, canvasRef, engineRef]);

  useEffect(() => {
    if (!editable) setPaintTool("wall");
  }, [editable]);

  useEffect(() => {
    const initialUrl = (() => {
      if (propMapUrl) return propMapUrl;
      if (typeof window === "undefined") return null; // Wait for client
      const params = new URLSearchParams(window.location.search);
      const urlParam = params.get("map");
      if (urlParam) return urlParam;
      const stored = window.localStorage.getItem("simMapPath");
      // avoid pulling sweep-generated API maps by default
      if (stored && !stored.includes("/api/sweep/map") && !stored.includes("/maps/generated")) {
        return stored;
      }
      return null;
    })();
    setMapUrl(initialUrl);

    // If no initial map URL, immediately trigger generation by NOT setting baseSpec/engine from URL
    if (!initialUrl && !engineRef.current) {
      const cfg: EngineConfig = {
        grid: { width: 128, height: 72 },
        diagonal: true,
        seed: "party-sim-seed",
        baseTickRate: 20,
        pixelsPerTile: 24,
      };
      const eng = new Engine(cfg); // Engine will init empty, but we'll trigger resetWorld shortly via effect or direct call?
      // Actually, easiest is to let the resetNonce effect fire if we are "ready".
      // But resetNonce effect relies on engine being present.
      setEngine(eng);
      engineRef.current = eng;

    } else if (initialUrl && !engineRef.current) {
      // Standard Load
      const cfg: EngineConfig = {
        grid: { width: 128, height: 72 },
        diagonal: true,
        seed: "party-sim-seed",
        baseTickRate: 20,
        pixelsPerTile: 24,
      };
      const eng = new Engine(cfg);
      setEngine(eng);
      engineRef.current = eng;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (propMapUrl) setMapUrl(propMapUrl);
  }, [propMapUrl]);

  useEffect(() => {
    if (!mapUrl) return;
    (async () => {
      try {
        const res = await fetch(mapUrl);
        const json: BaseSpecFile = await res.json();
        if (!json || !json.spec) throw new Error("Invalid map JSON");
        const grid = { width: json.width ?? 96, height: json.height ?? 60 };
        const cfg: EngineConfig = {
          grid,
          diagonal: true,
          seed: "party-sim-seed",
          baseTickRate: 20,
          pixelsPerTile: 24,
        };
        let eng = engineRef.current;
        const needsRecreation = !eng ||
          eng.cfg.grid.width !== grid.width ||
          eng.cfg.grid.height !== grid.height ||
          typeof eng.setSpeed !== "function";

        if (needsRecreation) {
          eng = new Engine(cfg);
          engineRef.current = eng;
          setEngine(eng);
        }
        setBaseSpec(json.spec);
        const store = useSimStore.getState();
        const initialAgentCount = store.agentCount;
        if (!eng) return; // Should not happen after creation

        eng.resetWorld(json.spec, initialAgentCount);
        const cap = eng.getRoomCapacity();
        store.setCapacity(cap);
        if (store.agentCount > cap) {
          store.setAgentCount(cap);
          eng.resetWorld(json.spec, cap);
        }
        resetCamera();
      } catch (e) {
        console.error("Failed to load map", e);
      }
    })();
  }, [mapUrl, resetCamera, engineRef]);

  useEffect(() => { engine?.setSpeed(speed); }, [engine, speed]);
  useEffect(() => { engine?.setPaused(paused); }, [engine, paused]);

  const restartNonce = useSimStore(s => s.restartNonce);

  // Initial Generation Effect (when no mapUrl is present)
  useEffect(() => {
    if (engine && !_baseSpec && !mapUrl) {
      // Generate default map immediately
      const store = useSimStore.getState();
      // synth reset
      const seed = `init-${Date.now()}`;
      const params = buildRuntimeParams(store.mapParams, seed);
      const spec = buildSpecRuntime(engine.cfg.grid, params);
      setBaseSpec(spec);
      engine.resetWorld(spec, store.agentCount, false);
      const cap = engine.getRoomCapacity();
      store.setCapacity(cap);
      store.setAgentCount(Math.min(store.agentCount, cap));
      resetCamera();
    }
  }, [engine, _baseSpec, mapUrl, resetCamera]);

  function buildRuntimeParams(mp: any, seed: string): Required<RuntimeVariantParams> {
    const randInt = (min: number, max: number) => Math.floor(min + Math.random() * (max - min + 1));
    const randPick = <T,>(arr: T[]): T => arr[randInt(0, arr.length - 1)];

    return {
      ...DEFAULT_RUNTIME_PARAMS,
      corridorWidth: Math.max(2, mp.corridorWidth),
      crossHeight: Math.max(0, mp.crossHeight),
      bandHeight: Math.max(6, mp.bandHeight),
      bandCount: Math.max(0, mp.bandCount),
      dormRowGap: Math.max(1, Math.min(5, mp.dormRowGap)),
      outsideHeight: 4,
      exitWidth: Math.max(4, mp.exitWidth),
      seed,
      bar: {
        ...DEFAULT_RUNTIME_PARAMS.bar,
        w: Math.max(4, mp.barWidth),
        h: Math.max(4, mp.barHeight),
        side: randPick(["left", "right"]),
        yOffset: 0,
      },
      gym: {
        ...DEFAULT_RUNTIME_PARAMS.gym,
        w: Math.max(4, mp.gymWidth),
        h: Math.max(4, mp.gymHeight),
        side: randPick(["left", "right"]),
        yOffset: 0,
      },
    };
  }

  // Effect: Full Reset (New Map)
  useEffect(() => {
    if (!engine) return;
    if (resetNonce === 0 && _baseSpec) return; // Skip initial mount if already handled
    if (!_baseSpec && !mapUrl) return; // handled by initial gen effect

    // If we have a mapUrl, resetNonce might mean "reload file" or "clear and regen".
    // For now, if we are in "generator mode" (no mapUrl), we regen.
    // If we have mapUrl, we probably just reload it? 
    // User expectation: Reset Map -> Generate New Map (clearing loaded file).
    // So we should verify if user wants to keep the FILE or generate new.
    // Given "Refactoring Sim UI", we assume Reset Map means "Generate procedural".

    // Force generation logic
    setMapUrl(null); // Clear external map if any

    const seed = `reset-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const store = useSimStore.getState();
    const params = buildRuntimeParams(store.mapParams, seed);

    const spec = buildSpecRuntime(engine.cfg.grid, params);
    setBaseSpec(spec);

    engine.resetWorld(spec, store.agentCount, false); // reuseMap = false

    const cap = engine.getRoomCapacity();
    store.setCapacity(cap);
    store.setAgentCount(Math.min(store.agentCount, cap));
    resetCamera();

  }, [resetNonce, engineRef]); // REMOVED other deps to strict reset trigger

  // Effect: Restart (Same Map, Reset Agents)
  useEffect(() => {
    if (!engine || !_baseSpec) return;
    if (restartNonce === 0) return;

    const store = useSimStore.getState();
    engine.resetWorld(_baseSpec, store.agentCount, true); // reuseMap = true

    // Capacity shouldn't change if map is same
    const cap = engine.getRoomCapacity();
    store.setCapacity(cap);
    store.setAgentCount(Math.min(store.agentCount, cap));
    // No camera reset needed usually, but maybe good practice
  }, [restartNonce]);


  useEffect(() => {
    if (!engine) return;
    let raf = 0;
    const loop = (tMs: number) => {
      engine.advance(tMs / 1000);
      renderCanvasRef.current();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  const [spaceDown, setSpaceDown] = useState(false);
  const panStart = useRef<{ x: number; y: number } | null>(null);

  const zoomAtCenter = useCallback((factor: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    camera.zoomAt({ x: canvas.width / (2 * dpr), y: canvas.height / (2 * dpr) }, factor);
  }, [camera]);

  useEffect(() => {
    const isFormTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpaceDown(true);
        return;
      }
      if (isFormTarget(e.target)) return;
      if (e.key === "p" || e.key === "P") {
        const store = useSimStore.getState();
        store.setPaused(!store.paused);
        e.preventDefault();
      } else if (e.key === "." && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const store = useSimStore.getState();
        store.setPaused(true);
        const eng = engineRef.current;
        if (eng) eng.stepOnce();
        e.preventDefault();
      } else if ((e.key === "+" || e.key === "=") && !e.ctrlKey && !e.metaKey) {
        zoomAtCenter(1.1);
        e.preventDefault();
      } else if (e.key === "-" && !e.ctrlKey && !e.metaKey) {
        zoomAtCenter(0.9);
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [engineRef, zoomAtCenter]);

  function getTileColor(t: Tile): string {
    if (t.tag === "WALL") return "#000000";
    if (t.tag === "BED") return "#ef4444";
    if (!t.walkable) return "#94a3b8";
    switch (t.tag) {
      case "BAR": return "#fde68a";
      case "GYM": return "#a7f3d0";
      case "CORRIDOR": return "#dbeafe";
      case "ROOM": return "#e0e7ff";
      case "DOOR": return "#fef3c7";
      case "OUTSIDE": return "#bbf7d0";
      case "EXIT": return "#fca5a5";
      case "ROAD": return "#cbd5e1";
      default:
        return "#f8fafc";
    }
  }

  function renderCanvas() {
    if (!engine) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ppt = engine.cfg.pixelsPerTile;
    // compute world size in pixels (before zoom)
    const worldW = engine.map.width * ppt;
    const worldH = engine.map.height * ppt;

    // Set canvas to container size (or world size scaled—here, fill parent size for panning/zoom)
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || Math.min(960, worldW);
    const cssH = canvas.clientHeight || Math.min(600, worldH);
    if (canvas.width !== Math.floor(cssW * dpr) || canvas.height !== Math.floor(cssH * dpr)) {
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // clear
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = "#f3f4f6";
    ctx.fillRect(0, 0, cssW, cssH);

    // world transform
    ctx.save();
    ctx.translate(camera.offset.x, camera.offset.y);
    ctx.scale(camera.zoom, camera.zoom);

    const labelAccumulator = new Map<TileTag, { x: number; y: number; count: number }>();
    const labelNames: Partial<Record<TileTag, string>> = {
      BAR: "Bar",
      GYM: "Gym",
      OUTSIDE: "Outside",
      EXIT: "Exit",
      // Not displaying the corridor and dorms labels to reduce clutter
      CORRIDOR: "",
      ROOM: "",
    };

    // tiles
    for (let y = 0; y < engine.map.height; y++) {
      for (let x = 0; x < engine.map.width; x++) {
        const t = engine.map.get(x, y);
        if (t.tag)
          // base color
          ctx.fillStyle = getTileColor(t);
        ctx.fillRect(x * ppt, y * ppt, ppt, ppt);

        // slow tile indicator
        if (t.walkable && t.moveCost > 1) {
          ctx.fillStyle = "rgba(37, 99, 235, 0.15)";
          ctx.fillRect(x * ppt, y * ppt, ppt, ppt);
        }

        // locked overlay (anything not BUILDABLE)
        if (t.tag && t.tag !== "BUILDABLE") {
          ctx.fillStyle = "rgba(15, 23, 42, 0.08)";
          ctx.fillRect(x * ppt, y * ppt, ppt, ppt);

          if (labelNames[t.tag]) {
            const key = t.tag;
            const entry = labelAccumulator.get(key as TileTag) ?? { x: 0, y: 0, count: 0 };
            entry.x += x;
            entry.y += y;
            entry.count += 1;
            labelAccumulator.set(key as TileTag, entry);
          }
        }

        if (t.tag === "ROOM") {
          ctx.strokeStyle = "rgba(79, 70, 229, 0.35)";
          ctx.lineWidth = 1;
          ctx.strokeRect(x * ppt + 0.5, y * ppt + 0.5, ppt - 1, ppt - 1);
        }
      }
    }

    // grid (light)
    ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= engine.map.width; gx++) {
      ctx.beginPath();
      ctx.moveTo(gx * ppt + 0.5, 0);
      ctx.lineTo(gx * ppt + 0.5, engine.map.height * ppt);
      ctx.stroke();
    }
    for (let gy = 0; gy <= engine.map.height; gy++) {
      ctx.beginPath();
      ctx.moveTo(0, gy * ppt + 0.5);
      ctx.lineTo(engine.map.width * ppt, gy * ppt + 0.5);
      ctx.stroke();
    }

    // agents
    const agents = engine.getAgents();
    const renderPositions = renderPosRef.current;
    let seenIds: Set<string> | null = null;
    if (smoothRender) {
      seenIds = new Set();
    } else {
      renderPositions.clear();
    }
    const lerpAlpha = 0.25;
    for (const a of agents) {
      let drawX = a.pos.x;
      let drawY = a.pos.y;
      if (smoothRender) {
        let current = renderPositions.get(a.id);
        if (!current) {
          current = { x: a.pos.x, y: a.pos.y };
          renderPositions.set(a.id, current);
        }
        const dx = Math.abs(a.pos.x - current.x);
        const dy = Math.abs(a.pos.y - current.y);
        if (dx > 3 || dy > 3) {
          current.x = a.pos.x;
          current.y = a.pos.y;
        } else {
          current.x += (a.pos.x - current.x) * lerpAlpha;
          current.y += (a.pos.y - current.y) * lerpAlpha;
        }
        drawX = current.x;
        drawY = current.y;
        seenIds?.add(a.id);
      }

      const pad = 4;
      const baseX = drawX * ppt;
      const baseY = drawY * ppt;

      ctx.fillStyle = getAgentColor(a.agentType);
      ctx.fillRect(baseX + pad, baseY + pad, ppt - pad * 2, ppt - pad * 2);

      // front wedge indicates facing
      const cx = baseX + ppt / 2;
      const cy = baseY + ppt / 2;
      const angle = Math.atan2(a.facing.y, a.facing.x);
      if (!Number.isNaN(angle)) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        const head = ppt * 0.32;
        const tail = ppt * 0.18;
        const half = Math.max(4, ppt * 0.18);
        ctx.fillStyle = "#1e293b";
        ctx.beginPath();
        ctx.moveTo(head, 0);
        ctx.lineTo(-tail, half);
        ctx.lineTo(-tail, -half);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      if (paused && selectedAgentId && a.id === selectedAgentId) {
        ctx.strokeStyle = "rgba(37, 99, 235, 0.9)";
        ctx.lineWidth = 2 / camera.zoom;
        const inset = Math.max(1, pad - 1);
        ctx.strokeRect(baseX + inset, baseY + inset, ppt - inset * 2, ppt - inset * 2);
      }
    }

    // Fog of War / Vision Highlight for Selected Agent
    if (selectedAgentId) {
      const agent = agents.find(a => a.id === selectedAgentId);
      if (agent) {
        ctx.save();
        // 1. Fill entire world with semi-transparent darkness
        // We need to use "destination-out" or "xor" to cut holes?
        // Or simpler: Draw darkness over everything, then use composite operation to clear areas?
        // Actually, it's easier to:
        // 1. Create a path of the 'darkness' (Full Rect minus Visible Rects) -> Complicated.
        // 2. Draw black rect full screen. Set composite to 'destination-out' and draw visible circles.

        // BUT we want to darken the underlying map/agents, so we draw black with alpha on top.

        // Steps:
        // a. Draw Dark Overlay (e.g. 0.5 alpha black)
        // b. 'Cut out' visible areas using 'destination-out' to reveal map below? 
        //    No, that would erase the map too if we are drawing on the same canvas.
        //    We want to ERASE the DARK OVERLAY where the agent sees.
        //    So:
        //    - We need a temporary 'darkness' layer or we draw darkness then cut?
        //    - If we draw darkness directly on ctx, 'destination-out' will erase the underlying pixels (the map).

        // Solution: Draw darkness using a path that EXCLUDES the visible areas?
        // Or use 'clip' region inverted?
        // Easiest is to draw a BIG shape with holes (using winding rule).
        // Outer rect (huge) + Inner rects (visible areas) in reverse winding?
        // Canvas supports `evenodd` fill rule. Draw outer rect, then visible rects.

        ctx.beginPath();
        // Outer world bounds
        ctx.rect(0, 0, engine.map.width * ppt, engine.map.height * ppt);

        // Vision Blobs (Visualizing what agent "knows"):
        // 1. Own Room (if known)
        if (agent.roomId) {
          // We need room coords. Map doesn't index rooms by ID easily?
          // Wait, we generate rooms. Engine might not have quick lookup.
          // But we have map tiles. We assume agent knows its room LOC.
          // For now, let's just show Current Position Visibility.
        }

        // 2. Current Position with Radius (Polygon)
        const cx = (agent.pos.x + 0.5) * ppt;
        const cy = (agent.pos.y + 0.5) * ppt;
        const poly = engine.getVisionPolygon(agent);
        if (poly && poly.length > 2) {
          ctx.moveTo(poly[0].x * ppt, poly[0].y * ppt);
          for (let i = 1; i < poly.length; i++) {
            ctx.lineTo(poly[i].x * ppt, poly[i].y * ppt);
          }
          ctx.closePath(); // Determine the hole
        } else {
          // Fallback
          const r = agent.visionRadius * ppt;
          ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
        }

        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx.fill("evenodd"); // This fills the parts between outer rect and the holes

        // Optional: Draw Line to Dest?
        if (agent.dest) {
          ctx.strokeStyle = "rgba(255, 255, 0, 0.5)";
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo((agent.dest.x + 0.5) * ppt, (agent.dest.y + 0.5) * ppt);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        ctx.restore();
      }
    }

    if (smoothRender && seenIds) {
      for (const id of Array.from(renderPositions.keys())) {
        if (!seenIds.has(id)) renderPositions.delete(id);
      }
    }

    ctx.save();
    ctx.fillStyle = "rgba(15, 23, 42, 0.75)";
    ctx.textAlign = "center";
    for (const [tag, data] of labelAccumulator) {
      const label = labelNames[tag];
      if (!label) continue;
      const cx = (data.x / data.count + 0.5) * ppt;
      const cy = (data.y / data.count + 0.5) * ppt;
      ctx.font = `${20 / camera.zoom}px sans-serif`;
      ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
      ctx.fillText(label, cx, cy + 1);
      ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
      ctx.fillText(label, cx, cy);
    }
    ctx.restore();

    // Removed Time & Stats Overlay (Time, Density, Count) as requested.
    // TPS will be moved to UI.

    const minutes = engine.tod.minute;
    let checkPeakTime = false;

    PEAK_TIMES.forEach(([start, end]) => {
      if (checkPeakTime) return;
      if (minutes >= start && minutes < end) {
        checkPeakTime = true;
      }
    });

    if (engine.corridorBoundingBoxes?.length && checkPeakTime) {
      engine.corridorBoundingBoxes.forEach((box) => {
        const agentsInCorridor = agents
          .filter((a) =>
            a.pos.x <= (box.x1 || 0)
            && a.pos.x >= (box.x0 || 0)
            && a.pos.y <= (box.y1 || 0)
            && a.pos.y >= (box.y0 || 0)
          )
          .length

        engine.corridorDensityValues.push(agentsInCorridor);
      });
    }

    // Perf stats logic kept for state update if needed, but not drawing.
    const statsSample = engine.getPerfStats();
    const nextStats = {
      ticksPerSecond: statsSample.ticksPerSecond,
      densityRecomputesPerSecond: statsSample.densityRecomputesPerSecond,
      agentCount: agents.length,
    };
    const currentStats = perfStatsRef.current;
    if (
      currentStats.ticksPerSecond !== nextStats.ticksPerSecond ||
      currentStats.densityRecomputesPerSecond !== nextStats.densityRecomputesPerSecond ||
      currentStats.agentCount !== nextStats.agentCount
    ) {
      perfStatsRef.current = nextStats;
      setPerfStats(nextStats);

      // --- Store Updates for UI ---
      const mins = engine.tod.minute;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

      useSimStore.getState().setSimTime(timeStr);
      useSimStore.getState().setTps(Math.round(nextStats.ticksPerSecond));

      // Live Scoring update (throttled check ~30 ticks)
      // Live Scoring update (throttled check ~30 ticks)
      if (engine.getTick() % 30 === 0) {
        const m = engine.getLiveMetrics();
        const score = calculateLiveScore(m);
        useSimStore.getState().setLiveScore(score);
      }
    }

    ctx.restore(); // end world transform

    const showMini = Math.abs(camera.zoom - (baseZoomRef.current || camera.zoom)) > 0.01;
    if (miniVisibleRef.current !== showMini) {
      miniVisibleRef.current = showMini;
      setMiniVisible(showMini);
    }
    if (showMini) {
      renderMiniMap(cssW, cssH, ppt);
    }
  }

  renderCanvasRef.current = renderCanvas;

  function renderMiniMap(cssW: number, cssH: number, ppt: number) {
    if (!engine) return;
    const mini = miniCanvasRef.current;
    if (!mini) return;
    const miniCtx = mini.getContext("2d");
    if (!miniCtx) return;
    const displayW = 160;
    const displayH = 96;
    const dpr = window.devicePixelRatio || 1;
    if (mini.width !== displayW * dpr || mini.height !== displayH * dpr) {
      mini.width = displayW * dpr;
      mini.height = displayH * dpr;
    }
    miniCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    miniCtx.clearRect(0, 0, displayW, displayH);
    miniCtx.fillStyle = "#f8fafc";
    miniCtx.fillRect(0, 0, displayW, displayH);

    const scaleX = displayW / engine.map.width;
    const scaleY = displayH / engine.map.height;

    for (let y = 0; y < engine.map.height; y++) {
      for (let x = 0; x < engine.map.width; x++) {
        const tile = engine.map.get(x, y);
        miniCtx.fillStyle = getTileColor(tile);
        miniCtx.fillRect(x * scaleX, y * scaleY, scaleX, scaleY);
      }
    }

    const agents = engine.getAgents();
    const dotRadius = Math.max(1, Math.min(scaleX, scaleY) * 0.35);
    for (const agent of agents) {
      const cx = (agent.pos.x + 0.5) * scaleX;
      const cy = (agent.pos.y + 0.5) * scaleY;
      miniCtx.fillStyle = selectedAgentId === agent.id ? "#1d4ed8" : "#2563eb";
      miniCtx.beginPath();
      miniCtx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
      miniCtx.fill();
    }

    // Draw camera viewport rectangle
    const zoom = camera.zoom;
    const viewX0 = (-camera.offset.x) / (ppt * zoom);
    const viewY0 = (-camera.offset.y) / (ppt * zoom);
    const viewX1 = (cssW - camera.offset.x) / (ppt * zoom);
    const viewY1 = (cssH - camera.offset.y) / (ppt * zoom);
    const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));
    const rectX0 = clamp(viewX0, 0, engine.map.width);
    const rectY0 = clamp(viewY0, 0, engine.map.height);
    const rectX1 = clamp(viewX1, 0, engine.map.width);
    const rectY1 = clamp(viewY1, 0, engine.map.height);
    const rectW = Math.max(1, (rectX1 - rectX0) * scaleX);
    const rectH = Math.max(1, (rectY1 - rectY0) * scaleY);
    miniCtx.strokeStyle = "rgba(37, 99, 235, 0.6)";
    miniCtx.lineWidth = 1;
    miniCtx.strokeRect(rectX0 * scaleX, rectY0 * scaleY, rectW, rectH);
  }

  function screenToTile(ev: React.MouseEvent<HTMLCanvasElement, MouseEvent>): Vec2 | null {
    if (!engine) return null;
    const rect = (ev.target as HTMLCanvasElement).getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const world = camera.screenToWorld(px, py, engine.cfg.pixelsPerTile);
    const x = Math.floor(world.x);
    const y = Math.floor(world.y);
    if (!engine.map.inBounds(x, y)) return null;
    return { x, y };
  }

  const isEditableTile = useCallback((t: Tile) => {
    if (editable) return true;
    return t.tag === "BUILDABLE";
  }, [editable]);

  const paintTile = useCallback((x: number, y: number) => {
    if (!engine) return;
    if (!engine.map.inBounds(x, y)) return;
    if (!editable && paintTool !== "tag") return;
    const tile = engine.map.get(x, y);
    if (!editable && tile.tag !== "BUILDABLE") return;
    if (!editable && paintTool === "tag") return;
    if (!editable) return;

    if (paintTool !== "tag" && !isEditableTile(tile)) {
      if (!lockedToastRef.current) {
        setToast("Locked area — adjust via external map builder.");
        lockedToastRef.current = true;
      }
      return;
    }

    if (paintTool === "wall") {
      engine.map.set(x, y, { ...tile, walkable: false, moveCost: tile.moveCost });
    } else if (paintTool === "slow") {
      engine.map.set(x, y, { ...tile, walkable: true, moveCost: 2 });
    } else if (paintTool === "erase") {
      engine.map.set(x, y, { ...tile, walkable: true, moveCost: 1 });
    } else if (paintTool === "tag") {
      const base = engine.map.get(x, y);
      const next: Tile = { ...base, walkable: base.walkable, moveCost: base.moveCost };
      if (tagPaint === null) {
        delete next.tag;
      } else {
        next.tag = tagPaint;
      }
      engine.map.set(x, y, next);
    }
  }, [editable, engine, isEditableTile, paintTool, setToast, tagPaint]);

  const paintRect = useCallback((start: Vec2, end: Vec2) => {
    if (!engine || !editable) return;
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    const key = `${minX}:${minY}:${maxX}:${maxY}:${paintTool}:${tagPaint}`;
    if (paintDragLastKey.current === key) return;
    paintDragLastKey.current = key;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        paintTile(x, y);
      }
    }
  }, [editable, engine, paintTile, paintTool, tagPaint]);

  function handleCanvasDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!engine) return;
    const isMMB = e.button === 1;
    if (spaceDown || isMMB) {
      panStart.current = { x: e.clientX - camera.offset.x, y: e.clientY - camera.offset.y };
      return;
    }
    const tile = screenToTile(e);
    if (!tile) return;

    if (!editable) return;

    paintDragStart.current = tile;
    paintDragLastKey.current = "";
    lockedToastRef.current = false;
    paintDragLastKey.current = "";
    paintTile(tile.x, tile.y);
  }

  function handleCanvasMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!engine) return;
    if (panStart.current) {
      camera.offset.x = e.clientX - panStart.current.x;
      camera.offset.y = e.clientY - panStart.current.y;
      return;
    }

    if (!editable) return;
    if (e.buttons & 1) {
      const tile = screenToTile(e);
      if (!tile) return;
      if (paintDragStart.current) paintRect(paintDragStart.current, tile);
    }
  }

  function handleCanvasUp() {
    panStart.current = null;
    paintDragStart.current = null;
    paintDragLastKey.current = "";
  }

  function handleWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    if (!engine) return;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    // Custom zoom logic to respect min/max
    const currentZoom = camera.zoom;
    const nextZoom = Math.max(0.01, Math.min(10, currentZoom * factor));
    if (nextZoom !== currentZoom) {
      camera.zoomAt({ x: px, y: py }, nextZoom / currentZoom);
    }
  }

  function handleClickSelect(e: React.MouseEvent<HTMLCanvasElement>) {
    const eng = engine;
    if (!eng) return;
    const t = screenToTile(e);
    if (!t) return;
    const a = eng.getAgents().find(a => a.pos.x === t.x && a.pos.y === t.y);
    setSelectedAgentId(a ? a.id : null);
  }

  // UI toolbar embedded for painting shortcut (kept minimal; full controls are in UIControls)
  return (
    <div className="flex flex-col gap-2">
      {editable ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
          <span>Painter:</span>
          <div className="flex items-center gap-2">
            <button className={`px-2 py-1 rounded transition ${paintTool === "wall" ? "bg-blue-200 text-blue-900 font-semibold" : "bg-slate-200 hover:bg-slate-300"}`} onClick={() => setPaintTool("wall")}>Wall</button>
            <button className={`px-2 py-1 rounded transition ${paintTool === "slow" ? "bg-blue-200 text-blue-900 font-semibold" : "bg-slate-200 hover:bg-slate-300"}`} onClick={() => setPaintTool("slow")}>Slow</button>
            <button className={`px-2 py-1 rounded transition ${paintTool === "erase" ? "bg-blue-200 text-blue-900 font-semibold" : "bg-slate-200 hover:bg-slate-300"}`} onClick={() => setPaintTool("erase")}>Erase</button>
            <button className={`px-2 py-1 rounded transition ${paintTool === "tag" ? "bg-blue-200 text-blue-900 font-semibold" : "bg-slate-200 hover:bg-slate-300"}`} onClick={() => setPaintTool("tag")}>Tag</button>
            {paintTool === "tag" && (
              <select
                className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 shadow-sm"
                value={tagPaint ?? "NONE"}
                onChange={(e) => {
                  const value = e.target.value;
                  setTagPaint(value === "NONE" ? null : value as TileTag);
                }}
              >
                <option value="BUILDABLE">Buildable</option>
                <option value="ROOM">Room</option>
                <option value="CORRIDOR">Corridor</option>
                <option value="DOOR">Door</option>
                <option value="BAR">Bar</option>
                <option value="GYM">Gym</option>
                <option value="OUTSIDE">Outside</option>
                <option value="EXIT">Exit</option>
                <option value="ROAD">Road</option>
                <option value="NONE">No tag</option>
              </select>
            )}
          </div>
          <span className="text-slate-500">Hold Space/MMB to pan, scroll to zoom.</span>
          <div className="ml-auto flex items-center gap-2">
            <button className="px-2 py-1 rounded bg-white border border-slate-200 shadow-sm hover:bg-slate-100" onClick={() => zoomAtCenter(0.9)}>Zoom -</button>
            <button className="px-2 py-1 rounded bg-white border border-slate-200 shadow-sm hover:bg-slate-100" onClick={() => zoomAtCenter(1.1)}>Zoom +</button>
            <button className="px-2 py-1 rounded bg-white border border-slate-200 shadow-sm hover:bg-slate-100" onClick={resetCamera}>Reset Camera</button>
            <button className="px-2 py-1 rounded bg-white border border-slate-200 shadow-sm hover:bg-slate-100" onClick={() => setSmoothRender(s => !s)}>{smoothRender ? "Smooth On" : "Smooth Off"}</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
          <span>Hold Space/MMB to pan, scroll to zoom.</span>
          <div className="ml-auto flex items-center gap-2">
            <button className="px-2 py-1 rounded bg-white border border-slate-200 shadow-sm hover:bg-slate-100" onClick={() => zoomAtCenter(0.9)}>Zoom -</button>
            <button className="px-2 py-1 rounded bg-white border border-slate-200 shadow-sm hover:bg-slate-100" onClick={() => zoomAtCenter(1.1)}>Zoom +</button>
            <button className="px-2 py-1 rounded bg-white border border-slate-200 shadow-sm hover:bg-slate-100" onClick={resetCamera}>Reset Camera</button>
            <button className="px-2 py-1 rounded bg-white border border-slate-200 shadow-sm hover:bg-slate-100" onClick={() => setSmoothRender(s => !s)}>{smoothRender ? "Smooth On" : "Smooth Off"}</button>
          </div>
        </div>
      )}

      <div
        className="relative rounded border border-slate-200 shadow-inner"
        style={{ width: "100%", height: 600, background: "#f8fafc", cursor: spaceDown ? "grabbing" : "default" }}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={(e) => { handleCanvasDown(e); handleClickSelect(e); }}
          onMouseMove={handleCanvasMove}
          onMouseUp={handleCanvasUp}
          onMouseLeave={handleCanvasUp}
          onWheel={handleWheel}
          style={{ width: "100%", height: "100%", display: "block" }}
        />
        {miniVisible && (
          <canvas
            ref={miniCanvasRef}
            width={160}
            height={96}
            className="pointer-events-none absolute right-3 top-3 rounded border border-slate-200 bg-white/90 shadow-sm"
            style={{ width: 160, height: 96 }}
          />
        )}
      </div>
    </div>
  );
}
