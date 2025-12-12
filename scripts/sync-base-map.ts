import { resolve } from "node:path";
import { DEFAULT_BASE_PARAMS, DEFAULT_GRID, DEFAULT_TEMPLATE } from "./generate-maps";
import { buildSpecRuntime } from "../src/lib/mapgen/runtime";
import { BaseSpecFile, directCliRun, loadMapFile, writeJson } from "./pipeline-utils";

async function syncBaseMap() {
  const basePath = resolve(DEFAULT_TEMPLATE);
  let width = DEFAULT_GRID.width;
  let height = DEFAULT_GRID.height;

  try {
    const existing = await loadMapFile(basePath);
    width = existing.width ?? width;
    height = existing.height ?? height;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`Falling back to default grid ${width}x${height}; could not read ${basePath}: ${String(err)}`);
  }

  const spec = buildSpecRuntime({ width, height }, DEFAULT_BASE_PARAMS);
  const file: BaseSpecFile = {
    width,
    height,
    spec,
    name: DEFAULT_BASE_PARAMS.name,
    meta: {
      source: "sync-base-map",
      generatedAt: new Date().toISOString(),
      params: DEFAULT_BASE_PARAMS,
    },
  };

  await writeJson(basePath, file);
  // eslint-disable-next-line no-console
  console.log(`Updated base map at ${basePath} (${width}x${height})`);
}

if (directCliRun(import.meta.url)) {
  syncBaseMap().catch(err => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });
}
