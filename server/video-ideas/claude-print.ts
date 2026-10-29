import { spawn } from "node:child_process";
import os from "node:os";
import { findOnPath } from "../ai-stack/detect";
import { planEnvironment } from "../designs/motion";

/**
 * One question to Claude Code, one answer back: `claude -p`, no tools, on the
 * Max plan (the API key is stripped from the environment so it never bills).
 * The prompt goes in on stdin, so a long transcript never hits argv limits.
 */
export async function runClaudePrint(prompt: string, options: { timeoutMs?: number } = {}): Promise<string> {
  const binary = await findOnPath("claude");
  if (!binary) throw new Error("Claude Code (`claude`) is not installed.");

  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      binary,
      ["-p", "--output-format", "text", "--setting-sources", "project", "--strict-mcp-config", "--tools", ""],
      { cwd: os.tmpdir(), env: planEnvironment(), stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? 5 * 60 * 1000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && stdout.trim()) resolve(stdout.trim());
      else reject(new Error(signal === "SIGKILL" ? "Claude took too long to answer." : `Claude did not answer: ${stderr.trim().split("\n").pop() ?? `exit ${code}`}`));
    });
    child.stdin.end(prompt);
  });
}
