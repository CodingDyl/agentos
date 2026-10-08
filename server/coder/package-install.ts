import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

export interface InstallProgress {
  type: "output" | "success" | "error";
  data?: string;
  exitCode?: number;
}

export class PackageInstaller extends EventEmitter {
  private process: ReturnType<typeof spawn> | null = null;

  async install(
    packageManager: string,
    projectRoot: string,
  ): Promise<{ success: boolean; exitCode: number }> {
    return new Promise((resolve) => {
      const installCmd = packageManager === "npm" ? "npm" : packageManager === "pnpm" ? "pnpm" : packageManager === "yarn" ? "yarn" : "bun";
      const args = ["install"];

      this.process = spawn(installCmd, args, {
        cwd: projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });

      this.process.stdout?.on("data", (data: Buffer) => {
        this.emit("progress", {
          type: "output",
          data: data.toString(),
        });
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        this.emit("progress", {
          type: "output",
          data: data.toString(),
        });
      });

      this.process.on("error", (error) => {
        this.emit("progress", {
          type: "error",
          data: error.message,
        });
        resolve({ success: false, exitCode: 1 });
      });

      this.process.on("close", (code) => {
        const exitCode = code ?? 1;
        this.emit("progress", {
          type: exitCode === 0 ? "success" : "error",
          exitCode,
        });
        resolve({ success: exitCode === 0, exitCode });
      });
    });
  }

  cancel(): void {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
  }
}

const activeInstallers = new Map<string, PackageInstaller>();

export function startInstall(
  installId: string,
  packageManager: string,
  projectRoot: string,
): PackageInstaller {
  const installer = new PackageInstaller();
  activeInstallers.set(installId, installer);

  void installer.install(packageManager, projectRoot).finally(() => {
    activeInstallers.delete(installId);
  });

  return installer;
}

export function getInstaller(installId: string): PackageInstaller | undefined {
  return activeInstallers.get(installId);
}

export function cancelInstall(installId: string): void {
  const installer = activeInstallers.get(installId);
  if (installer) {
    installer.cancel();
    activeInstallers.delete(installId);
  }
}
