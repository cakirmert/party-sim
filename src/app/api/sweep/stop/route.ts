import { NextResponse } from "next/server";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export async function POST() {
    try {
        // Windows-specific command to kill node processes running 'sweep-maps.ts'
        // We use WMIC to find and terminate the process.
        // WARNING: This is a bit brute-force. Ideally we'd track PID from the start.
        // But since `npm run dev` might be running `next dev`, we must be careful not to kill that.
        // 'sweep-maps.ts' is unique enough for our specific task.

        // Command explanation:
        // wmic process where "name='node.exe' and commandline like '%sweep-maps.ts%'" call terminate

        const cmd = `wmic process where "name='node.exe' and commandline like '%sweep-maps.ts%'" call terminate`;

        const { stdout, stderr } = await execAsync(cmd);

        return NextResponse.json({
            ok: true,
            message: "Stop signal sent.",
            stdout,
            stderr
        });
    } catch (err) {
        const error = err as Error;
        // If no process found, wmic might return error, which is fine (nothing to stop)
        return NextResponse.json({
            ok: false,
            message: `Failed to stop or no process found: ${error.message}`
        }, { status: 200 }); // Return 200 so UI doesn't blow up if nothing was running
    }
}
