
// Shared types for scoring
export type ScoringMetrics = {
    roomCapacity: number;
    actualAgents: number;
    corridorP95: number;
    pathEfficiency: number; // 0-100 (Distance)
    stuckRate: number;
    barOccupancyRatio: number;
    gymOccupancyRatio: number;
    evacuationRate: number;
    avgExitTime: number;
    rerouteCount: number; // Congestion (Total Reroutes)
    emergencyEfficiency?: number;
};

// ... (omitting ScoreBreakdown unchanged)
export type ScoreBreakdown = {
    total: number;
    capacity: number;
    utilization: number;
    congestion: number;
    path: number;
    emergency?: number;
    details: {
        density: number;
        evac: number;
        wait: number;
    };
};

export function calculateLiveScore(m: ScoringMetrics): ScoreBreakdown {
    // Weights
    const w = {
        capacity: 0.4,
        utilization: 0.2,
        congestion: 0.25,
        path: 0.15,
    };

    // Capacity (Static Load)
    // 100 if full. 0 if empty.
    const capRatio = m.roomCapacity > 0 ? (m.actualAgents / m.roomCapacity) : 0;
    const scoreCap = Math.min(100, capRatio * 100);

    // Utilization (Peak Persistent)
    // "Half full = 100" => If ratio >= 0.5, score 100.
    const barScore = Math.min(100, (m.barOccupancyRatio / 0.5) * 100);
    const gymScore = Math.min(100, (m.gymOccupancyRatio / 0.5) * 100);
    const scoreUtil = (barScore + gymScore) / 2;

    // Congestion Score: Starts at 100 (0 reroutes), decreases as reroutes increase.
    const scoreCongestionTotal = 100 - m.rerouteCount;

    const isEmergency = m.emergencyEfficiency !== undefined;

    if (isEmergency) {
        const scoreEvRate = m.evacuationRate * 100;
        const scoreEvTime = Math.max(0, 100 - Math.max(0, m.avgExitTime - 30) * (100 / 150));
        const scoreEvac = scoreEvRate * 0.6 + scoreEvTime * 0.4;

        // Override congestion in emergency?
        // scoreCongestionTotal = ...
    }

    // Path (Distance)
    const scorePath = m.pathEfficiency;

    const finalScore = (
        scoreCap * w.capacity +
        scoreUtil * w.utilization +
        scoreCongestionTotal * w.congestion +
        scorePath * w.path
    ) / (w.capacity + w.utilization + w.congestion + w.path);

    return {
        total: Number(finalScore.toFixed(1)),
        capacity: Number(scoreCap.toFixed(1)),
        utilization: Number(scoreUtil.toFixed(1)),
        congestion: Number(m.rerouteCount.toFixed(1)), // Display Raw "Badness" (Starts at 0)
        path: Number(scorePath.toFixed(1)),
        emergency: m.emergencyEfficiency !== undefined ? Number(m.emergencyEfficiency.toFixed(1)) : undefined,
        details: {
            density: Number(m.corridorP95.toFixed(1)),
            evac: isEmergency ? Number(scoreCongestionTotal.toFixed(1)) : 0,
            wait: 0,
        }
    };
}
