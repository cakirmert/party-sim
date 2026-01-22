
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
    avgIntegrity: number; // Reroute Score
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
        capacity: 0.35,
        utilization: 0.20,
        congestion: 0.35,
        path: 0.10,
    };

    // Capacity & Utilization
    const capRatio = m.roomCapacity > 0 ? (m.actualAgents / m.roomCapacity) : 0;
    const scoreCap = Math.min(100, capRatio * 100);

    const scoreBar = Math.min(100, m.barOccupancyRatio * 250);
    const scoreGym = Math.min(100, m.gymOccupancyRatio * 250);
    const scoreUtil = (scoreBar + scoreGym) / 2;

    // Congestion (Reroute Score)
    // Normal: avgIntegrity (100 - drops).
    let scoreCongestionTotal = m.avgIntegrity;

    const isEmergency = m.emergencyEfficiency !== undefined;

    if (isEmergency) {
        const scoreEvRate = m.evacuationRate * 100;
        const scoreEvTime = Math.max(0, 100 - Math.max(0, m.avgExitTime - 30) * (100 / 150));
        const scoreEvac = scoreEvRate * 0.6 + scoreEvTime * 0.4;

        // Emergency: Mix Evac + Reroute Score?
        // Or just Evac?
        scoreCongestionTotal = (scoreEvac * 0.60) + (scoreCongestionTotal * 0.40);
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
        congestion: Number(scoreCongestionTotal.toFixed(1)),
        path: Number(scorePath.toFixed(1)),
        emergency: m.emergencyEfficiency !== undefined ? Number(m.emergencyEfficiency.toFixed(1)) : undefined,
        details: {
            density: Number(m.corridorP95.toFixed(1)),
            evac: isEmergency ? Number(scoreCongestionTotal.toFixed(1)) : 0,
            wait: 0,
        }
    };
}
