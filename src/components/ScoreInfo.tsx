
import React from 'react';
import { ScoreBreakdown } from '@/lib/scoring';

interface ScoreInfoProps {
    score: ScoreBreakdown;
}

export const ScoreInfo: React.FC<ScoreInfoProps> = ({ score }) => {
    return (
        <div className="relative group ml-2 inline-block">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4 text-gray-400 hover:text-slate-600 cursor-pointer transition-colors"
            >
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>

            <div className="absolute left-1/2 transform -translate-x-1/2 -bottom-2 translate-y-full w-72 p-4 bg-slate-900 border border-slate-700 rounded-xl shadow-xl text-xs text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none group-hover:pointer-events-auto leading-relaxed">
                <h4 className="font-bold mb-3 text-white border-b border-slate-700 pb-2 uppercase tracking-wider text-[10px]">Scoring Metrics</h4>

                <div className="mb-3">
                    <div className="text-blue-400 font-semibold mb-1">Capacity</div>
                    Ratio of current population to room capacity. Values exceeding capacity are capped at 100%.
                </div>

                <div className="mb-3">
                    <div className="text-cyan-400 font-semibold mb-1">Utilization</div>
                    Activity levels in amenities (Bar/Gym). Target occupancy is 40% for maximum score.
                </div>

                <div className="mb-3">
                    <div className="text-amber-400 font-semibold mb-1">Congestion</div>
                    <div>Composite metric of flow efficiency.</div>
                    {score.emergency !== undefined ? (
                        <div className="text-slate-500 mt-1 pl-2 border-l-2 border-slate-700">
                            <strong>Emergency Protocol:</strong> Includes Evacuation Time and Rate, weighted against Crowd Density and Stuck events.
                        </div>
                    ) : (
                        <div className="text-slate-500 mt-1 pl-2 border-l-2 border-slate-700">
                            <strong>Standard Operations:</strong> Evacuation metrics are excluded. Score is derived from Crowd Density and Stuck Rate only.
                        </div>
                    )}
                </div>

                <div className="mb-3">
                    <div className="text-indigo-400 font-semibold mb-1">Path Efficiency</div>
                    Ratio of optimal Euclidean distance to actual steps taken. Higher percentages indicate direct, efficient movement.
                </div>

                <div className="mt-3 pt-3 border-t border-slate-700 text-[10px] text-slate-400">
                    <div className="font-semibold text-slate-300 mb-1">Total Score Calculation</div>
                    <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
                        <span>Capacity:</span> <span className="text-right">40%</span>
                        <span>Utilization:</span> <span className="text-right">20%</span>
                        <span>Congestion:</span> <span className="text-right">25%</span>
                        <span>Path Efficiency:</span> <span className="text-right">15%</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
