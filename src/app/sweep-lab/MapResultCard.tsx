import React from "react";
import MapPreview from "@/components/MapPreview";

// Helper for metrics
const Metric = ({ label, value }: { label: string; value?: number | string }) => (
    <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
        <span className="font-mono">
            {typeof value === 'number' ? value.toFixed(3) : (value ?? "-")}
        </span>
    </div>
);

type MapRow = {
    map: string;
    rank: number;
    score: number;
    metrics: Record<string, number>;
    params?: Record<string, unknown> | null;
    mapFile?: string;
    scoreBreakdown?: Record<string, number>;
    heatmap?: string | null;
    heatmapPath?: string;
    runPath?: string;
};

type Props = {
    m: MapRow;
    showHeatmaps: boolean;
    showMap: boolean;
    mapOpacity: number;
    heatmapOpacity: number;
    mapLink: (path?: string) => string | undefined;
};

export default function MapResultCard({ m, showHeatmaps, showMap, mapOpacity, heatmapOpacity, mapLink }: Props) {
    const url = mapLink(m.mapFile);

    return (
        <div className="rounded-lg border border-white/10 bg-white/5 p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <span className="px-2 py-1 rounded bg-white/10 text-xs">#{m.rank}</span>
                    <div>
                        <p className="font-semibold text-lg">{m.map}</p>
                        <p className="text-xs text-slate-400">Score {m.score.toFixed(1)} / 100</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {url && (
                        <a
                            href={url}
                            className="text-xs text-blue-300 hover:underline"
                            target="_blank"
                            rel="noreferrer"
                        >
                            View map JSON
                        </a>
                    )}
                    {url && (
                        <a
                            href={`/?map=${encodeURIComponent(url)}`}
                            className="text-xs text-emerald-300 hover:underline"
                            target="_blank"
                            rel="noreferrer"
                            onClick={() => {
                                if (typeof window !== "undefined") {
                                    window.localStorage.setItem("simMapPath", url);
                                }
                            }}
                        >
                            Watch in sim
                        </a>
                    )}
                </div>
            </div>

            {/* Score Breakdown */}
            {m.scoreBreakdown && (
                <div className="flex gap-2 text-[10px] text-slate-500 border-b border-white/5 pb-2 mb-1 overflow-x-auto">
                    {Object.entries(m.scoreBreakdown).map(([k, v]) => (
                        <div key={k} className="flex flex-col items-center min-w-[50px]">
                            <span className="uppercase tracking-wider">{k.slice(0, 4)}</span>
                            <span className="font-mono text-slate-300">+{v.toFixed(0)}</span>
                        </div>
                    ))}
                </div>
            )}

            <div className="grid md:grid-cols-4 gap-2 text-xs text-slate-300">
                <Metric label="Path" value={m.metrics?.avgPathLength} />
                <Metric label="Peak Density" value={m.metrics?.corridorPeakDensity} />
                <Metric label="Avg Density" value={m.metrics?.corridorMeanDensity} />
                <Metric label="Evac Time" value={typeof (m.metrics as any).avgExitTime === 'number' ? Math.round((m.metrics as any).avgExitTime) : '-'} />
            </div>
            <div className="grid md:grid-cols-4 gap-2 text-xs text-slate-300">
                <Metric label="Stuck %" value={((m.metrics?.stuckRate || 0) * 100).toFixed(2) + '%'} />
                <Metric label="Bar Util" value={m.metrics?.barOccupancyRatio} />
                <Metric label="Gym Util" value={m.metrics?.gymOccupancyRatio} />
                <Metric label="Evac Rate" value={((m.metrics as any).evacuationRate || 0).toFixed(2)} />
            </div>
            {/*
            <div className="grid md:grid-cols-4 gap-2 text-xs text-slate-300">
                <Metric label="Capacity" value={m.metrics?.roomCapacity} />
                <Metric label="Agents" value={m.metrics?.actualAgents} />
            </div>
            */}

            {m.params && (
                <details className="text-xs text-slate-400">
                    <summary className="cursor-pointer text-slate-200">Params</summary>
                    <pre className="mt-1 bg-slate-900/70 border border-white/10 rounded p-2 overflow-auto max-h-40">{JSON.stringify(m.params, null, 2)}</pre>
                </details>
            )}

            {showMap && url && (
                <div className="mt-1 rounded overflow-hidden border border-white/10 bg-black/30 relative min-h-[300px]">
                    {/* Map Preview with Data Overlay */}
                    <MapPreviewContainer
                        mapUrl={url}
                        heatmapUrl={
                            showHeatmaps
                                ? (m.runPath ? `/api/sweep/run/${m.runPath}` : (m.heatmap ? `/api/sweep/run/${m.heatmap}` : null))
                                : null
                        }
                        mapOpacity={mapOpacity}
                        heatmapOpacity={heatmapOpacity}
                    />
                </div>
            )}
        </div>
    );
}

// Wrapper to handle data fetching for preview
function MapPreviewContainer({ mapUrl, heatmapUrl, mapOpacity, heatmapOpacity }: {
    mapUrl: string;
    heatmapUrl: string | null;
    mapOpacity: number;
    heatmapOpacity: number;
}) {
    const [heatmapData, setHeatmapData] = React.useState<any>(null);

    React.useEffect(() => {
        if (!heatmapUrl) {
            setHeatmapData(null);
            return;
        }
        fetch(heatmapUrl)
            .then(res => res.json())
            .then(data => {
                // If the run JSON contains heatmapData directly (it should if we use JSON mode)
                if (data.heatmapData) setHeatmapData(data.heatmapData);
                // If fetching raw heatmap json file directly
                else setHeatmapData(data);
            })
            .catch(err => console.error("Failed to load heatmap data", err));
    }, [heatmapUrl]);

    return (
        <div className="absolute inset-0" style={{ opacity: 1 }}>
            {/* MapPreview handles overlay mixing and specific opacities */}
            <MapPreview mapUrl={mapUrl} heatmapData={heatmapData} mapOpacity={mapOpacity} heatmapOpacity={heatmapOpacity} />
        </div>
    );
}

