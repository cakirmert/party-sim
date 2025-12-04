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
    const buf = await fs.readFile(resolved);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: { "Content-Type": "image/png" },
    });
  } catch (err) {
    return NextResponse.json({ error: `Unable to read ${resolved}`, detail: String(err) }, { status: 404 });
  }
}
