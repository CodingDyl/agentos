import { useState, useEffect, useCallback, useRef } from "react";
import { CheckCircle2, XCircle, Loader2, AlertCircle, Terminal as TerminalIcon } from "lucide-react";
import type { SetupStep } from "../../../shared/coder-types";
import { Terminal } from "./terminal";
import * as coderApi from "../../lib/agentos/coder-api";

interface WorkspaceSetupWizardProps {
  workspaceSlug: string;
  workspaceName: string;
  repoUrl: string;
  onComplete: (localPath: string) => void;
  onCancel: () => void;
}

export function WorkspaceSetupWizard({
  workspaceSlug,
  workspaceName,
  repoUrl,
  onComplete,
  onCancel,
}: WorkspaceSetupWizardProps) {
  const [steps, setSteps] = useState<SetupStep[]>([
    { id: "clone", name: "Clone repository", status: "pending" },
    { id: "install", name: "Install dependencies", status: "pending" },
    { id: "env", name: "Setup environment", status: "pending" },
    { id: "ready", name: "Ready to code", status: "pending" },
  ]);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [terminalToken, setTerminalToken] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const localPathRef = useRef<string | null>(null);

  const updateStepStatus = useCallback((stepId: string, status: SetupStep["status"], message?: string) => {
    setSteps((prev) =>
      prev.map((step) => (step.id === stepId ? { ...step, status, message } : step)),
    );
  }, []);

  const runSetup = useCallback(async () => {
    if (cancelled) return;

    try {
      setCurrentStep("clone");
      updateStepStatus("clone", "running", "Cloning repository...");

      const cloneResult = await coderApi.cloneWorkspace(workspaceSlug, repoUrl);

      if (!cloneResult.success) {
        updateStepStatus("clone", "error", cloneResult.error);
        return;
      }

      localPathRef.current = cloneResult.path;
      updateStepStatus("clone", "success", "Repository cloned");

      if (cancelled) return;

      setCurrentStep("install");
      updateStepStatus("install", "running", "Opening project...");

      const openResult = await coderApi.openProject(cloneResult.path, workspaceSlug);

      if (!openResult.success) {
        updateStepStatus("install", "error", openResult.error);
        return;
      }

      updateStepStatus("install", "running", "Detecting package manager...");

      const pmResult = await coderApi.detectPackageManager();

      if (!pmResult.success || !pmResult.packageManager) {
        updateStepStatus("install", "success", "No package manager detected, skipping");
        setCurrentStep("env");
      } else {
        const packageManager = pmResult.packageManager;
        updateStepStatus("install", "running", `Installing with ${packageManager}...`);

        const termResult = await coderApi.createTerminal();

        if (!termResult.success || !termResult.id || !termResult.token) {
          updateStepStatus("install", "error", "Failed to create terminal");
          return;
        }

        setTerminalId(termResult.id);
        setTerminalToken(termResult.token);

        setTimeout(() => {
          const ws = new WebSocket(`ws://localhost:3500/api/coder/terminal/ws/${termResult.token}`);

          ws.onopen = () => {
            const installCmd =
              packageManager === "npm"
                ? "npm install\r"
                : packageManager === "pnpm"
                  ? "pnpm install\r"
                  : packageManager === "yarn"
                    ? "yarn install\r"
                    : "bun install\r";

            ws.send(JSON.stringify({ type: "input", data: installCmd }));

            setTimeout(() => {
              ws.close();
              if (!cancelled) {
                updateStepStatus("install", "success", "Dependencies installed");
                setCurrentStep("env");
                void runEnvSetup();
              }
            }, 10000);
          };
        }, 500);

        return;
      }

      if (cancelled) return;
      await runEnvSetup();
    } catch (error) {
      const errorStep = currentStep || "clone";
      updateStepStatus(errorStep, "error", error instanceof Error ? error.message : "Setup failed");
    }
  }, [cancelled, workspaceSlug, repoUrl, currentStep, updateStepStatus]);

  const runEnvSetup = useCallback(async () => {
    if (cancelled) return;

    try {
      setCurrentStep("env");
      updateStepStatus("env", "running", "Setting up environment...");

      const envResult = await coderApi.setupEnvFile();

      if (!envResult.success) {
        updateStepStatus("env", "error", envResult.error);
        return;
      }

      updateStepStatus("env", "success", envResult.message);

      if (cancelled) return;

      setCurrentStep("ready");
      updateStepStatus("ready", "running", "Finalizing setup...");

      const devResult = await coderApi.detectDevCommand();

      let message = "Project ready!";
      if (devResult.success && devResult.devCommand) {
        message = `Project ready! Run '${devResult.devCommand}' to start development.`;
      }

      updateStepStatus("ready", "success", message);
      setCurrentStep(null);

      if (localPathRef.current) {
        await fetch(`http://localhost:3500/api/projects/${workspaceSlug}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            configuration: { localPath: localPathRef.current },
          }),
        });

        setTimeout(() => {
          if (localPathRef.current) {
            onComplete(localPathRef.current);
          }
        }, 1000);
      }
    } catch (error) {
      updateStepStatus("env", "error", error instanceof Error ? error.message : "Environment setup failed");
    }
  }, [cancelled, workspaceSlug, updateStepStatus, onComplete]);

  useEffect(() => {
    void runSetup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = () => {
    setCancelled(true);
    if (terminalId) {
      void coderApi.killTerminal(terminalId);
    }
    onCancel();
  };

  const handleRetry = (stepId: string) => {
    if (stepId === "clone") {
      setSteps([
        { id: "clone", name: "Clone repository", status: "pending" },
        { id: "install", name: "Install dependencies", status: "pending" },
        { id: "env", name: "Setup environment", status: "pending" },
        { id: "ready", name: "Ready to code", status: "pending" },
      ]);
      setCurrentStep(null);
      setTerminalId(null);
      setTerminalToken(null);
      setCancelled(false);
      localPathRef.current = null;
      void runSetup();
    } else if (stepId === "install") {
      updateStepStatus("install", "pending");
      updateStepStatus("env", "pending");
      updateStepStatus("ready", "pending");
      setTerminalId(null);
      setTerminalToken(null);
    } else if (stepId === "env") {
      updateStepStatus("env", "pending");
      updateStepStatus("ready", "pending");
      void runEnvSetup();
    }
  };

  const getStepIcon = (status: SetupStep["status"]) => {
    switch (status) {
      case "pending":
        return <div className="h-5 w-5 rounded-full border-2 border-[#00ffcc33]" />;
      case "running":
        return <Loader2 className="h-5 w-5 animate-spin text-[#00ccff]" />;
      case "success":
        return <CheckCircle2 className="h-5 w-5 text-[#00ff00]" />;
      case "error":
        return <XCircle className="h-5 w-5 text-[#ff0066]" />;
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a] font-mono p-8">
      <div className="w-full max-w-3xl space-y-6">
        <div className="space-y-2 border-l-4 border-[#00ffcc] pl-4">
          <h1 className="font-mono text-2xl font-bold text-[#00ffcc] tracking-wider">
            WORKSPACE_SETUP_
          </h1>
          <p className="text-sm text-[#6a9fb5]">{workspaceName}</p>
        </div>

        <div className="rounded border border-[#00ffcc33] bg-[#141414] p-6">
          <div className="space-y-4">
            {steps.map((step, index) => (
              <div key={step.id} className="space-y-2">
                <div className="flex items-center gap-3">
                  {getStepIcon(step.status)}
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-[#e0e0e0]">
                        {index + 1}. {step.name}
                      </span>
                      {step.status === "error" && (
                        <button
                          type="button"
                          onClick={() => handleRetry(step.id)}
                          className="rounded border border-[#00ccff] px-3 py-1 text-xs text-[#00ccff] hover:bg-[#00ccff1a]"
                        >
                          Retry
                        </button>
                      )}
                    </div>
                    {step.message && (
                      <p
                        className={`mt-1 text-sm ${
                          step.status === "error" ? "text-[#ff0066]" : "text-[#6a9fb5]"
                        }`}
                      >
                        {step.message}
                      </p>
                    )}
                  </div>
                </div>

                {step.id === "install" && terminalId && terminalToken && step.status === "running" && (
                  <div className="ml-8 mt-2 rounded border border-[#00ffcc33] bg-[#0a0a0a] p-4">
                    <div className="mb-2 flex items-center gap-2 text-xs text-[#00ccff]">
                      <TerminalIcon className="h-4 w-4" />
                      <span>Installation Output</span>
                    </div>
                    <div className="h-64 overflow-hidden">
                      <Terminal terminalId={terminalId} token={terminalToken} />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-center justify-between border-t border-[#00ffcc1a] pt-4">
            <div className="flex items-center gap-2 text-sm text-[#6a9fb5]">
              <AlertCircle className="h-4 w-4" />
              <span>Setup can be cancelled at any time</span>
            </div>
            <button
              type="button"
              onClick={handleCancel}
              disabled={steps.every((s) => s.status === "success")}
              className="rounded border border-[#ff0066] px-4 py-2 text-sm text-[#ff0066] hover:bg-[#ff00661a] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
