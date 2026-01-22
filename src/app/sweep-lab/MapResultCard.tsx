import React from "react";
import MapPreview from "@/components/MapPreview";

// Helper for metrics
// Helper for metrics
const Metric = ({ label, value, score }: { label: string; value?: number | string; score?: number }) => (
    <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
        <div className="flex items-baseline gap-1">
            <span className="font-mono">
                {typeof value === 'number' ? value.toFixed(3) : (value ?? "-")}
            </span>
            {score !== undefined && (
                <span className={`text-[10px] ${score >= 50 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    ({score})
                </span>
            )}
        </div>
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

    const [showDetails, setShowDetails] = React.useState(false);

    return (
        <div className="rounded-lg border border-white/10 bg-white/5 p-3 flex flex-col gap-2 transition-all duration-200 hover:bg-white/10">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <span className="px-2 py-1 rounded bg-white/10 text-xs font-mono text-slate-300">#{m.rank}</span>
                    <div>
                        <p className="font-semibold text-lg text-slate-200 leading-tight">{m.map}</p>
                        <div className="flex items-center gap-2">
                            <p className="text-xs text-slate-400">Score <span className={`font-mono font-bold ${m.score >= 80 ? 'text-emerald-400' : m.score >= 50 ? 'text-amber-400' : 'text-rose-400'}`}>{m.score.toFixed(1)}</span></p>
                            <button onClick={() => setShowDetails(!showDetails)} className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 hover:bg-white/10 text-slate-400 transition-colors">
                                {showDetails ? "Hide Table" : "Show Breakdown"}
                            </button>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {url && (
                        <a href={url} className="text-xs text-blue-300 hover:text-blue-200 hover:underline" target="_blank" rel="noreferrer">
                            JSON
                        </a>
                    )}
                    {url && (
                        <a
                            href={`/?map=${encodeURIComponent(url)}`}
                            className="text-xs text-emerald-300 hover:text-emerald-200 hover:underline"
                            target="_blank"
                            rel="noreferrer"
                            onClick={() => {
                                if (typeof window !== "undefined") window.localStorage.setItem("simMapPath", url);
                            }}
                        >
                            Simulate
                        </a>
                    )}
                </div>
            </div>

            {/* Expanded Score Table */}
            {showDetails && m.scoreBreakdown && (
                <div className="mt-2 mb-2 overflow-hidden rounded border border-white/10 bg-black/20 text-[10px]">
                    <table className="w-full text-left text-slate-300">
                        <thead className="bg-white/5 text-slate-400">
                            <tr>
                                <th className="p-1.5 font-medium">Component</th>
                                <th className="p-1.5 font-medium text-right">Raw Value</th>
                                <th className="p-1.5 font-medium text-right">Score (0-100)</th>
                                <th className="p-1.5 font-medium text-right">Weight</th>
                                <th className="p-1.5 font-medium text-right">Points</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 font-mono">
                            <tr>
                                <td className="p-1.5">Capacity (Target 150)</td>
                                <td className="p-1.5 text-right opacity-70">{(m.metrics?.roomCapacity || m.metrics?.actualAgents)?.toFixed(0) ?? '-'}</td>
                                <td className="p-1.5 text-right text-emerald-400">{m.scoreBreakdown.capacity}</td>
                                <td className="p-1.5 text-right opacity-50">35%</td>
                                <td className="p-1.5 text-right font-bold text-slate-200">{(m.scoreBreakdown.capacity * 0.35).toFixed(1)}</td>
                            </tr>
                            <tr>
                                <td className="p-1.5">Utilization (Bar/Gym)</td>
                                <td className="p-1.5 text-right opacity-70">{(m.metrics?.barOccupancyRatio ?? 0).toFixed(2)} / {(m.metrics?.gymOccupancyRatio ?? 0).toFixed(2)}</td>
                                <td className="p-1.5 text-right text-emerald-400">{m.scoreBreakdown.utilization}</td>
                                <td className="p-1.5 text-right opacity-50">20%</td>
                                <td className="p-1.5 text-right font-bold text-slate-200">{(m.scoreBreakdown.utilization * 0.20).toFixed(1)}</td>
                            </tr>
                            <tr>
                                <td className="p-1.5 text-amber-200">Congestion Total</td>
                                <td className="p-1.5 text-right opacity-70">-</td>
                                <td className="p-1.5 text-right text-amber-400">{m.scoreBreakdown.congestion}</td>
                                <td className="p-1.5 text-right opacity-50">35%</td>
                                <td className="p-1.5 text-right font-bold text-slate-200">{(m.scoreBreakdown.congestion * 0.35).toFixed(1)}</td>
                            </tr>
                            {/* Breakdown of Congestion */}
                            <tr className="bg-white/5 opacity-75">
                                <td className="p-1.5 pl-4 flex items-center gap-1">
                                    <span>↳ Density (50%)</span>
                                </td>
                                <td className="p-1.5 text-right opacity-70 px-6">{(m.metrics?.corridorP95 ?? 0).toFixed(2)}</td>
                                <td className="p-1.5 text-right">{m.scoreBreakdown._density}</td>
                                <td className="p-1.5 text-right opacity-50">-</td>
                                <td className="p-1.5 text-right opacity-50">-</td>
                            </tr>
                            <tr className="bg-white/5 opacity-75">
                                <td className="p-1.5 pl-4 flex items-center gap-1">
                                    <span>↳ Evacuation (25%)</span>
                                </td>
                                <td className="p-1.5 text-right opacity-70 px-6">{(m.metrics as any).avgExitTime?.toFixed(0) ?? '-'}s</td>
                                <td className="p-1.5 text-right">{m.scoreBreakdown._evac}</td>
                                <td className="p-1.5 text-right opacity-50">-</td>
                                <td className="p-1.5 text-right opacity-50">-</td>
                            </tr>
                            <tr className="bg-white/5 opacity-75">
                                <td className="p-1.5 pl-4 flex items-center gap-1">
                                    <span>↳ Stuck/Wait (25%)</span>
                                </td>
                                <td className="p-1.5 text-right opacity-70 px-6">{((m.metrics?.stuckRate || 0) * 100).toFixed(2)}%</td>
                                <td className="p-1.5 text-right">{m.scoreBreakdown._wait}</td>
                                <td className="p-1.5 text-right opacity-50">-</td>
                                <td className="p-1.5 text-right opacity-50">-</td>
                            </tr>

                            <tr>
                                <td className="p-1.5">Path Efficiency</td>
                                <td className="p-1.5 text-right opacity-70">{(m.metrics?.avgPathLength ?? 0).toFixed(1)}</td>
                                <td className="p-1.5 text-right text-emerald-400">{m.scoreBreakdown.path}</td>
                                <td className="p-1.5 text-right opacity-50">10%</td>
                                <td className="p-1.5 text-right font-bold text-slate-200">{(m.scoreBreakdown.path * 0.10).toFixed(1)}</td>
                            </tr>
                            <tr className="border-t border-white/10 bg-white/5 font-bold text-white">
                                <td className="p-1.5">TOTAL</td>
                                <td className="p-1.5"></td>
                                <td className="p-1.5"></td>
                                <td className="p-1.5 text-right">100%</td>
                                <td className="p-1.5 text-right">{m.score.toFixed(1)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            )}

            {!showDetails && m.scoreBreakdown && (
                <div className="flex gap-2 text-[10px] text-slate-500 border-b border-white/5 pb-2 mb-1 overflow-x-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
                    <div className="flex flex-col items-center min-w-[50px]">
                        <span className="uppercase tracking-wider text-[8px]">Congest</span>
                        <span className={`font-mono ${m.scoreBreakdown.congestion > 80 ? 'text-emerald-300' : 'text-slate-300'}`}>{m.scoreBreakdown.congestion}</span>
                    </div>
                    <div className="flex flex-col items-center min-w-[50px]">
                        <span className="uppercase tracking-wider text-[8px]">Util</span>
                        <span className="font-mono text-slate-300">{m.scoreBreakdown.utilization}</span>
                    </div>
                    <div className="flex flex-col items-center min-w-[50px]">
                        <span className="uppercase tracking-wider text-[8px]">Cap</span>
                        <span className="font-mono text-slate-300">{m.scoreBreakdown.capacity}</span>
                    </div>
                    <div className="flex flex-col items-center min-w-[50px]">
                        <span className="uppercase tracking-wider text-[8px]">Evac</span>
                        <span className="font-mono text-slate-300">{m.scoreBreakdown._evac}</span>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-4 gap-4 mt-3 pt-3 border-t border-white/5">
                <Metric label="Capacity" value={`${(m.metrics?.actualAgents || 0)} / ${m.metrics?.roomCapacity}`} score={m.scoreBreakdown?.capacity} />
                <Metric label="Utilization" value={`${((m.metrics?.barOccupancyRatio || 0) * 100).toFixed(0)}% / ${((m.metrics?.gymOccupancyRatio || 0) * 100).toFixed(0)}%`} score={m.scoreBreakdown?.utilization} />
                <Metric label="Congestion" value={(m.metrics?.corridorP95 ?? 0).toFixed(2)} score={m.scoreBreakdown?.congestion} />
                <Metric label="Path Efficiency" value={(m.metrics?.avgPathEfficiency ? (m.metrics?.avgPathEfficiency).toFixed(0) + '%' : '-')} score={m.scoreBreakdown?.path} />
            </div>

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

