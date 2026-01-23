
// Shared types for scoring
export type ScoringMetrics = {
    roomCapacity: number;
    actualAgents: number;
    corridorP95: number;
    pathEfficiency?: number; // 0-100 (Distance)
    stuckRate: number;
    barOccupancyRatio?: number;
    gymOccupancyRatio?: number;
    evacuationRate: number;
    avgExitTime: number;
    rerouteCount?: number; // Congestion (Total Reroutes)
    emergencyEfficiency?: number;
};

// ... (omitting ScoreBreakdown unchanged)
export type ScoreBreakdown = {
    total: number | undefined;
    capacity: number;
    utilization: number | undefined;
    congestion: number | undefined;
    path: number | undefined;
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
    const barScore = m.barOccupancyRatio !== undefined ? Math.min(100, (m.barOccupancyRatio / 0.5) * 100) : undefined;
    const gymScore = m.gymOccupancyRatio !== undefined ? Math.min(100, (m.gymOccupancyRatio / 0.5) * 100) : undefined;
    const scoreUtil = (barScore !== undefined && gymScore !== undefined) ? (barScore + gymScore) / 2 : undefined;

    // Congestion Score: Starts at 100 (0 reroutes), decreases as reroutes increase.
    const scoreCongestionTotal = m.rerouteCount !== undefined ? 100 - m.rerouteCount : undefined;

    const isEmergency = m.emergencyEfficiency !== undefined;

    if (isEmergency) {
        // ... (emergency logic omitted for brevity as it's not currently used, but keeping structure)
    }

    // Path (Distance)
    const scorePath = m.pathEfficiency;

    // Final score is undefined if any weighted component is undefined
    const finalScore = (scoreCap !== undefined && scoreUtil !== undefined && scoreCongestionTotal !== undefined && scorePath !== undefined)
        ? (
            scoreCap * w.capacity +
            scoreUtil * w.utilization +
            scoreCongestionTotal * w.congestion +
            scorePath * w.path
        ) / (w.capacity + w.utilization + w.congestion + w.path)
        : undefined;

    return {
        total: finalScore !== undefined ? Number(finalScore.toFixed(1)) : undefined,
        capacity: Number(scoreCap.toFixed(1)),
        utilization: scoreUtil !== undefined ? Number(scoreUtil.toFixed(1)) : undefined,
        congestion: m.rerouteCount !== undefined ? Number(m.rerouteCount.toFixed(1)) : undefined,
        path: scorePath !== undefined ? Number(scorePath.toFixed(1)) : undefined,
        emergency: m.emergencyEfficiency !== undefined ? Number(m.emergencyEfficiency.toFixed(1)) : undefined,
        details: {
            density: Number(m.corridorP95.toFixed(1)),
            evac: isEmergency && scoreCongestionTotal !== undefined ? Number(scoreCongestionTotal.toFixed(1)) : 0,
            wait: 0,
        }
    };
}
