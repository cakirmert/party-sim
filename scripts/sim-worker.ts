/**
 * Simulation Worker - Runs a single simulation in a child process
 * 
 * Receives tasks via process.on('message'), runs Engine simulation,
 * writes results to disk, and reports completion back to parent.
 */
import type { WorkerTask, WorkerResult } from "./pipeline-utils";
import { runSimulationTask, type SimulationTask, type SimulationResult } from "./run-batch";

process.on("message", async (task: WorkerTask<SimulationTask>) => {
  const { id, data } = task;
  
  try {
    const result = await runSimulationTask(data);
    
    const response: WorkerResult<SimulationResult> = {
      id,
      result,
    };
    process.send!(response);
  } catch (err) {
    const response: WorkerResult<SimulationResult> = {
      id,
      error: err instanceof Error ? err.message : String(err),
    };
    process.send!(response);
  }
});
