"use client";

import React, { useEffect, useRef, useState } from "react";
import { Engine } from "@/lib/engine/Engine";
import type { Tile, TileTag } from "@/lib/engine/Types";

type BaseSpecFile = {
    width: number;
    height: number;
    spec: any; // Using any for BaseSpec to avoid importing complex types if not needed, or import BaseSpec
};
// import { getAgentColor } from "./CanvasRenderer"; // reusing utils if exported, or inline them

// Inline color helper if imports are tricky or to keep this self-contained
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

type HeatmapData = {
    width: number;
    height: number;
    data: number[];
    maxMean: number;
    maxInstant: number;
};

type Props = {
    mapUrl: string;
    heatmapData?: HeatmapData | null;
    mapOpacity?: number;
    heatmapOpacity?: number;
    className?: string;
};

// Heat coloring helper
function getHeatColor(val: number): string {
    // simple heat gradient: blue->green->yellow->red
    // val is 0..1
    const h = (1.0 - val) * 240; // 240=blue, 0=red
    return `hsla(${h}, 100%, 50%, 1)`; // alpha handled by global alpha or fill style
}

export default function MapPreview({ mapUrl, heatmapData, mapOpacity = 1, heatmapOpacity = 0.7, className }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const res = await fetch(mapUrl);
                if (!res.ok) throw new Error("Failed to load map");
                const json: BaseSpecFile = await res.json();
                if (!active) return;

                if (!json || !json.spec) throw new Error("Invalid map JSON");

                const cfg = {
                    grid: { width: json.width ?? 96, height: json.height ?? 60 },
                    diagonal: true as const,
                    seed: "preview",
                    baseTickRate: 0,
                    pixelsPerTile: 24,
                };
                const engine = new Engine(cfg, json.spec);
                // Crucial: we must call resetWorld to generate the procedural content (dorms, etc.)
                // passing 0 agents since we only care about map structure here
                engine.resetWorld(json.spec, 0);

                renderStatic(engine, heatmapData, mapOpacity, heatmapOpacity);
            } catch (e) {
                if (active) setError(String(e));
            }
        })();
        return () => { active = false; };
    }, [mapUrl, heatmapData, mapOpacity, heatmapOpacity]);

    function renderStatic(engine: Engine, heat: HeatmapData | null | undefined, activeMapOpacity: number, activeHeatOpacity: number) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const gw = engine.map.width;
        const gh = engine.map.height;
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
        }

        ctx.resetTransform();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, rect.width, rect.height);

        // Background
        ctx.fillStyle = "#f3f4f6"; // Slate-100ish like CanvasRenderer
        ctx.fillRect(0, 0, rect.width, rect.height);

        const scaleX = rect.width / gw;
        const scaleY = rect.height / gh;
        const scale = Math.min(scaleX, scaleY);

        const drawW = gw * scale;
        const drawH = gh * scale;
        const offX = (rect.width - drawW) / 2;
        const offY = (rect.height - drawH) / 2;

        ctx.translate(offX, offY);
        ctx.scale(scale, scale);

        // Draw Base Map
        if (activeMapOpacity > 0) {
            ctx.globalAlpha = activeMapOpacity;
            for (let y = 0; y < gh; y++) {
                for (let x = 0; x < gw; x++) {
                    const t = engine.map.get(x, y);

                    if (t.tag) {
                        ctx.fillStyle = getTileColor(t);
                    } else {
                        // Empty/default tile
                        ctx.fillStyle = "#f8fafc";
                    }
                    ctx.fillRect(x, y, 1, 1);

                    // Slow tile
                    if (t.walkable && t.moveCost > 1) {
                        ctx.fillStyle = "rgba(37, 99, 235, 0.15)";
                        ctx.fillRect(x, y, 1, 1);
                    }

                    // Locked overlay (anything not BUILDABLE)
                    if (t.tag && t.tag !== "BUILDABLE") {
                        ctx.fillStyle = "rgba(15, 23, 42, 0.08)";
                        ctx.fillRect(x, y, 1, 1);
                    }

                    // Stroke for Room
                    if (t.tag === "ROOM") {
                        ctx.strokeStyle = "rgba(79, 70, 229, 0.35)";
                        ctx.lineWidth = 0.05; // Relative to tile size 1
                        ctx.strokeRect(x, y, 1, 1);
                    }

                    // Wall color override if needed (getTileColor handles WALL=#000000)
                    // CanvasRenderer uses black for walls.
                }
            }

            // Grid
            ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
            ctx.lineWidth = 0.02;
            ctx.beginPath();
            for (let gx = 0; gx <= gw; gx++) {
                ctx.moveTo(gx, 0);
                ctx.lineTo(gx, gh);
            }
            for (let gy = 0; gy <= gh; gy++) {
                ctx.moveTo(0, gy);
                ctx.lineTo(gw, gy);
            }
            ctx.stroke();

            ctx.globalAlpha = 1.0;
        }

        // Overlay Heatmap
        if (heat && heat.data && activeHeatOpacity > 0) {
            ctx.globalAlpha = activeHeatOpacity;
            const maxVal = Math.max(0.0001, Math.max(...heat.data));
            for (let i = 0; i < heat.data.length; i++) {
                const x = i % heat.width;
                const y = Math.floor(i / heat.width);
                if (x >= gw || y >= gh) continue;

                const val = heat.data[i];
                if (val > 0) {
                    const norm = val / maxVal;
                    ctx.fillStyle = getHeatColor(norm);
                    ctx.fillRect(x, y, 1, 1);
                }
            }
            ctx.globalAlpha = 1.0;
        }
    }

    if (error) {
        return (
            <div className={`flex items-center justify-center bg-slate-900 text-red-400 text-xs p-4 ${className}`}>
                Preview error
            </div>
        );
    }

    return (
        <canvas
            ref={canvasRef}
            className={`block bg-slate-50 ${className}`}
            style={{ width: "100%", height: "100%" }}
        />
    );
}
