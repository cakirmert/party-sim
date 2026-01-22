"use client";

import React, { useEffect, useRef, useState } from "react";
import { Engine } from "@/lib/engine/Engine";
import type { BaseSpec, Tile } from "@/lib/engine/Types";

type BaseSpecFile = {
    width: number;
    height: number;
    spec: BaseSpec;
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

// Turbo-like gradient for better distinguishability of bands
// Blue -> Cyan -> Green -> Yellow -> Orange -> Red -> White
function getHeatColor(t: number): string {
    // Shifted stops to make "warm" colors appear at lower density
    if (t < 0.15) return `hsla(240, 100%, 50%, ${t / 0.15})`; // Fade in Blue
    if (t < 0.3) return `hsl(${240 - (t - 0.15) / 0.15 * 60}, 100%, 50%)`; // Blue->Cyan (240->180)
    if (t < 0.45) return `hsl(${180 - (t - 0.3) / 0.15 * 60}, 100%, 50%)`;  // Cyan->Green (180->120)
    if (t < 0.6) return `hsl(${120 - (t - 0.45) / 0.15 * 60}, 100%, 45%)`; // Green->Yellow (120->60) darker yield
    if (t < 0.8) return `hsl(${60 - (t - 0.6) / 0.2 * 60}, 100%, 50%)`;    // Yellow->Red (60->0)
    return `hsl(300, ${100 - (t - 0.8) / 0.2 * 100}%, 100%)`;              // Red->White (White hot)
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
                const engine = new Engine(cfg);
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
            // Blur the heatmap for a smoother "glow" look

            ctx.filter = "blur(2px)";

            // 1. Smooth the data (Convolution) to widen hotspots
            // This spreads the 'score' to neighbors, making red/yellow zones larger/easier to hit
            const smooth = new Float32Array(heat.data.length);
            const w = heat.width;
            const h = heat.data.length / w;

            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const i = y * w + x;
                    const val = heat.data[i];
                    if (val === 0 && x > 0 && x < w - 1 && y > 0 && y < h - 1) {
                        // Optimization: Skip completely empty areas if neighbors likely empty? 
                        // No, simple convolution:
                    }

                    let sum = val * 1.0; // Keep original distinctness

                    // Add neighbors with weight
                    const neighbors = [
                        ((y - 1) * w) + x, // Up
                        ((y + 1) * w) + x, // Down
                        (y * w) + x - 1,   // Left
                        (y * w) + x + 1,   // Right
                        // Diagonals for rounder shape
                        ((y - 1) * w) + x - 1,
                        ((y - 1) * w) + x + 1,
                        ((y + 1) * w) + x - 1,
                        ((y + 1) * w) + x + 1,
                    ];

                    for (const ni of neighbors) {
                        if (ni >= 0 && ni < heat.data.length) {
                            // Check bounds roughly (wrapping edges is minor visual artifact for visual preview)
                            // Strictly we should check col/row, but for speed/simplicity in preview: 
                            // Just checking index valid is OK (might wrap row, but rare impact)
                            const nv = heat.data[ni];
                            if (nv > 0) {
                                sum += nv * 0.5; // Neighbor contribution
                            }
                        }
                    }
                    smooth[i] = sum;
                }
            }

            const maxVal = Math.max(0.0001, Math.max(...smooth));
            const logMax = Math.log(maxVal + 1);

            for (let i = 0; i < smooth.length; i++) {
                const x = i % heat.width;
                const y = Math.floor(i / heat.width);
                if (x >= gw || y >= gh) continue;

                const val = smooth[i];
                if (val > 0) {
                    // Log scale to handle high dynamic range without crushing low values
                    const logVal = Math.log(val + 1);
                    // Normalize to 0..1
                    const norm = logVal / logMax;

                    ctx.fillStyle = getHeatColor(norm);
                    ctx.fillRect(x, y, 1, 1);
                }
            }
            // Reset filter and alpha

            ctx.filter = "none";
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
