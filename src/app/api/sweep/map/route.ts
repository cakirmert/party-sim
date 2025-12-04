import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const path = searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  }
  const resolved = resolve(process.cwd(), path);
  try {
    const raw = await fs.readFile(resolved, "utf8");
    return new NextResponse(raw, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return NextResponse.json({ error: `Unable to read map at ${resolved}`, detail: String(err) }, { status: 404 });
  }
}
