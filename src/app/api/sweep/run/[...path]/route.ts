import { NextRequest, NextResponse } from "next/server";
import { join, resolve, relative } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    try {
        const { path } = await params;
        // The path array comes from [...path], e.g. ["results", "mapName", "scenario", "run-123.json"]
        // Or if m.heatmap was relative to project root, it might be that.

        // We expect the frontend to pass the relative path from project root or results dir.
        // In run-batch.ts, heatmap.rel is relative to process.cwd().
        // Let's interpret the path segments as relative to process.cwd() but restrict to 'results' or 'public'.

        const relPath = path.join("/");
        const fullPath = resolve(process.cwd(), relPath); // Absolute path

        // Security check: ensure we are within expected directories
        const allowed = [
            resolve(process.cwd(), "results"),
            resolve(process.cwd(), "public")
        ];

        const isAllowed = allowed.some(root => fullPath.startsWith(root));
        if (!isAllowed) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        if (!existsSync(fullPath)) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }

        const fileStat = await stat(fullPath);
        if (!fileStat.isFile()) {
            return NextResponse.json({ error: "Not a file" }, { status: 400 });
        }

        // Read and return
        const data = await readFile(fullPath, "utf8");

        // If it's a JSON file, return as json
        if (fullPath.endsWith(".json")) {
            return NextResponse.json(JSON.parse(data));
        }

        // If it's an image, return proper content type (legacy support)
        if (fullPath.endsWith(".png")) {
            // We'd need to return a blob/stream. For now, text/json is our main goal.
            // But let's handle it just in case.
            const buffer = await readFile(fullPath);
            return new NextResponse(buffer, {
                headers: { "Content-Type": "image/png" }
            });
        }

        return new NextResponse(data);
    } catch (err) {
        console.error("Serve run file error:", err);
        return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
}
