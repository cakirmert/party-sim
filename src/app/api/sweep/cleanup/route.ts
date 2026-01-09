import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";

export async function POST() {
    try {
        const resultsDir = resolve(process.cwd(), "results");
        const mapsDir = resolve(process.cwd(), "public/maps/generated");

        // Remove directories if they exist
        await fs.rm(resultsDir, { recursive: true, force: true });
        await fs.rm(mapsDir, { recursive: true, force: true });

        return NextResponse.json({ success: true, message: "Cleaned up results and generated maps" });
    } catch (error) {
        return NextResponse.json(
            { error: "Failed to cleanup", detail: String(error) },
            { status: 500 }
        );
    }
}
