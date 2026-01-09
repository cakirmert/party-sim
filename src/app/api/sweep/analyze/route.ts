import { NextResponse } from "next/server";
import { resolve } from "node:path";
import { analyzeResults } from "../../../../../scripts/analyze-results";

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { resultsDir, weights } = body;

        if (!resultsDir || !weights) {
            return NextResponse.json({ error: "Missing resultsDir or weights" }, { status: 400 });
        }

        const absResultsDir = resolve(process.cwd(), resultsDir);
        const absOutDir = resolve(absResultsDir, "analysis");

        // Run the analysis
        await analyzeResults(absResultsDir, absOutDir, { weights });

        return NextResponse.json({ success: true });
    } catch (err) {
        console.error("Analysis failed:", err);
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
