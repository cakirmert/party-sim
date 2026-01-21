
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

            <div className="absolute left-1/2 transform -translate-x-1/2 -bottom-2 translate-y-full w-64 p-3 bg-slate-800 border border-slate-700 rounded-xl shadow-xl text-xs text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none group-hover:pointer-events-auto">
                <h4 className="font-bold mb-2 text-white border-b border-slate-700 pb-1">Score Methodology</h4>

                <div className="mb-2">
                    <span className="text-blue-400 font-semibold">Capacity:</span> Occupancy vs Room Limit. Ideal: 100%.
                </div>

                <div className="mb-2">
                    <span className="text-cyan-400 font-semibold">Room Usage:</span> Active use of Bar/Gym. 40% occupancy = "Full Vibe" (100 pts).
                </div>

                <div className="mb-2">
                    <span className="text-amber-400 font-semibold">Congestion:</span>
                    {score.emergency !== undefined ? (
                        <span className="block text-slate-400 pl-2 mt-1">• Emergency: 40% Speed + 40% Density + 20% Stuck.</span>
                    ) : (
                        <span className="block text-slate-400 pl-2 mt-1">• Normal: 70% Density + 30% Stuck.</span>
                    )}
                </div>

                <div className="mb-0">
                    <span className="text-indigo-400 font-semibold">Path Eff:</span> Distance vs Optimal. Lower overhead is better.
                </div>
            </div>
        </div>
    );
};
