
// Shared types for scoring
export type ScoringMetrics = {
    roomCapacity: number;
    actualAgents: number;
    corridorP95: number;
    avgPathLength: number;
    stuckRate: number;
    barOccupancyRatio: number;
    gymOccupancyRatio: number;
    evacuationRate: number;
    avgExitTime: number;
};

export type ScoreBreakdown = {
    total: number;
    capacity: number;
    utilization: number;
    congestion: number;
    path: number;
    details: {
        density: number;
        evac: number;
        wait: number;
    };
};

export function calculateLiveScore(m: ScoringMetrics): ScoreBreakdown {
    // Hardcoded baselines for "live" scoring since we don't have a batch to normalize against.
    // These baselines are approximate "good" values.

    // Weights
    const w = {
        capacity: 0.35,
        utilization: 0.20,
        congestion: 0.35,
        path: 0.10,
    };

    // Capacity: Since we can't know global max in live mode, we treat 100% full as 100 score.
    // If actual > capacity, it's still 100 (or should we punish? User said "highest one gets 100").
    // Let's stick to ratio.
    // Capacity: 
    // If actual > capacity, it's 100.
    const capRatio = m.roomCapacity > 0 ? (m.actualAgents / m.roomCapacity) : 0;
    const scoreCap = Math.min(100, capRatio * 100);

    // Utilization: 
    // We want to reward "active" bars/gyms. 
    // Let's say 40% occupancy is "full vibe" (100 score).
    const scoreBar = Math.min(100, m.barOccupancyRatio * 250); // 0.4 -> 100
    const scoreGym = Math.min(100, m.gymOccupancyRatio * 250);
    const scoreUtil = (scoreBar + scoreGym) / 2;

    // Congestion
    // Density: Lower is better. P95 of 0 is perfect (100). 
    // P95 of 5 agents/tile is bad. Let's make it more lenient:
    // 0 -> 100. 10 -> 0. (Current was *20 => 5->0).
    const scoreCongDensity = Math.max(0, 100 - (m.corridorP95 * 10));

    // Evacuation: Rate 1 (100%) is good. Time 0s is good.
    const scoreEvRate = m.evacuationRate * 100;
    // Time: <30s = 100. >180s = 0.
    const scoreEvTime = Math.max(0, 100 - Math.max(0, m.avgExitTime - 30) * (100 / 150));
    const scoreEvac = scoreEvRate * 0.6 + scoreEvTime * 0.4;

    // Stuck: 0% is good (100). 
    // 10% stuck is bad (0). (Current was *500 => 20%->0).
    // Let's make it *1000 => 10% -> 0.
    const scoreStuck = Math.max(0, 100 - (m.stuckRate * 1000));

    const scoreCongestionTotal = (scoreCongDensity * 0.50) + (scoreEvac * 0.25) + (scoreStuck * 0.25);

    // Path: Lower is better. 
    // Optimal path 20. 
    // Let's penalize less aggressively. 
    // 20 -> 100. 200 -> 0.
    const scorePath = Math.max(0, 100 - Math.max(0, m.avgPathLength - 20) * (100 / 180));

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
        details: {
            density: Number(scoreCongDensity.toFixed(1)),
            evac: Number(scoreEvac.toFixed(1)),
            wait: Number(scoreStuck.toFixed(1)),
        }
    };
}
