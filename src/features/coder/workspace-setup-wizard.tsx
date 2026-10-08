import { useReducer, useEffect, useRef } from "react";
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

interface SetupState {
  steps: SetupStep[];
  currentStep: string | null;
  terminalId: string | null;
  terminalToken: string | null;
  localPath: string | null;
}

type SetupAction =
  | { type: "UPDATE_STEP"; stepId: string; status: SetupStep["status"]; message?: string }
  | { type: "SET_CURRENT_STEP"; step: string | null }
  | { type: "SET_TERMINAL"; terminalId: string; terminalToken: string }
  | { type: "SET_LOCAL_PATH"; path: string }
  | { type: "RESET" };

function setupReducer(state: SetupState, action: SetupAction): SetupState {
  switch (action.type) {
    case "UPDATE_STEP":
      return {
        ...state,
        steps: state.steps.map((step) =>
          step.id === action.stepId ? { ...step, status: action.status, message: action.message } : step
        ),
      };
    case "SET_CURRENT_STEP":
      return { ...state, currentStep: action.step };
    case "SET_TERMINAL":
      return { ...state, terminalId: action.terminalId, terminalToken: action.terminalToken };
    case "SET_LOCAL_PATH":
      return { ...state, localPath: action.path };
    case "RESET":
      return {
        steps: [
          { id: "clone", name: "Clone repository", status: "pending" },
          { id: "install", name: "Install dependencies", status: "pending" },
          { id: "env", name: "Setup environment", status: "pending" },
          { id: "ready", name: "Ready to code", status: "pending" },
        ],
        currentStep: null,
        terminalId: null,
        terminalToken: null,
        localPath: null,
      };
    default:
      return state;
  }
}

const initialState: SetupState = {
  steps: [
    { id: "clone", name: "Clone repository", status: "pending" },
    { id: "install", name: "Install dependencies", status: "pending" },
    { id: "env", name: "Setup environment", status: "pending" },
    { id: "ready", name: "Ready to code", status: "pending" },
  ],
  currentStep: null,
  terminalId: null,
  terminalToken: null,
  localPath: null,
};

export function WorkspaceSetupWizard({
  workspaceSlug,
  workspaceName,
  repoUrl,
  onComplete,
  onCancel,
}: WorkspaceSetupWizardProps) {
  const [state, dispatch] = useReducer(setupReducer, initialState);
  const abortControllerRef = useRef<AbortController | null>(null);
  const installWsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    async function runSetup() {
      let currentStepId = "clone";

      try {
        if (signal.aborted) return;

        currentStepId = "clone";
        dispatch({ type: "SET_CURRENT_STEP", step: "clone" });
        dispatch({ type: "UPDATE_STEP", stepId: "clone", status: "running", message: "Cloning repository..." });

        const cloneResult = await coderApi.cloneWorkspace(workspaceSlug, repoUrl);

        if (signal.aborted) return;

        if (!cloneResult.success) {
          dispatch({ type: "UPDATE_STEP", stepId: "clone", status: "error", message: cloneResult.error });
          return;
        }

        dispatch({ type: "SET_LOCAL_PATH", path: cloneResult.path });
        dispatch({ type: "UPDATE_STEP", stepId: "clone", status: "success", message: "Repository cloned" });

        if (signal.aborted) return;

        currentStepId = "install";
        dispatch({ type: "SET_CURRENT_STEP", step: "install" });
        dispatch({ type: "UPDATE_STEP", stepId: "install", status: "running", message: "Opening project..." });

        const openResult = await coderApi.openProject(cloneResult.path, workspaceSlug);

        if (signal.aborted) return;

        if (!openResult.success) {
          dispatch({ type: "UPDATE_STEP", stepId: "install", status: "error", message: openResult.error });
          return;
        }

        dispatch({ type: "UPDATE_STEP", stepId: "install", status: "running", message: "Detecting package manager..." });

        const pmResult = await coderApi.detectPackageManager();

        if (signal.aborted) return;

        if (!pmResult.success || !pmResult.packageManager) {
          dispatch({ type: "UPDATE_STEP", stepId: "install", status: "success", message: "No package manager detected, skipping" });
          currentStepId = "env";
          await runEnvSetup(cloneResult.path);
          return;
        }

        const packageManager = pmResult.packageManager;
        dispatch({ type: "UPDATE_STEP", stepId: "install", status: "running", message: `Installing with ${packageManager}...` });

        const termResult = await coderApi.createTerminal();

        if (signal.aborted) return;

        if (!termResult.success || !termResult.id || !termResult.token) {
          dispatch({ type: "UPDATE_STEP", stepId: "install", status: "error", message: "Failed to create terminal" });
          return;
        }

        dispatch({ type: "SET_TERMINAL", terminalId: termResult.id, terminalToken: termResult.token });

        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            resolve();
            return;
          }

          setTimeout(() => {
            if (signal.aborted) {
              resolve();
              return;
            }

            const ws = new WebSocket(`ws://localhost:3500/api/coder/terminal/ws/${termResult.token}`);
            installWsRef.current = ws;

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
                installWsRef.current = null;
                if (!signal.aborted) {
                  dispatch({ type: "UPDATE_STEP", stepId: "install", status: "success", message: "Dependencies installed" });
                  resolve();
                }
              }, 10000);
            };

            ws.onerror = () => {
              ws.close();
              installWsRef.current = null;
              resolve();
            };
          }, 500);
        });

        if (signal.aborted) return;

        currentStepId = "env";
        await runEnvSetup(cloneResult.path);
      } catch (error) {
        if (signal.aborted) return;
        const errorMessage = error instanceof Error ? error.message : "Setup failed";
        dispatch({ type: "UPDATE_STEP", stepId: currentStepId, status: "error", message: errorMessage });
      }

      async function runEnvSetup(localPath: string) {
        if (signal.aborted) return;

        try {
          dispatch({ type: "SET_CURRENT_STEP", step: "env" });
          dispatch({ type: "UPDATE_STEP", stepId: "env", status: "running", message: "Setting up environment..." });

          const envResult = await coderApi.setupEnvFile();

          if (signal.aborted) return;

          if (!envResult.success) {
            dispatch({ type: "UPDATE_STEP", stepId: "env", status: "error", message: envResult.error });
            return;
          }

          dispatch({ type: "UPDATE_STEP", stepId: "env", status: "success", message: envResult.message });

          if (signal.aborted) return;

          dispatch({ type: "SET_CURRENT_STEP", step: "ready" });
          dispatch({ type: "UPDATE_STEP", stepId: "ready", status: "running", message: "Finalizing setup..." });

          const devResult = await coderApi.detectDevCommand();

          if (signal.aborted) return;

          let message = "Project ready!";
          if (devResult.success && devResult.devCommand) {
            message = `Project ready! Run '${devResult.devCommand}' to start development.`;
          }

          dispatch({ type: "UPDATE_STEP", stepId: "ready", status: "success", message });
          dispatch({ type: "SET_CURRENT_STEP", step: null });

          if (localPath) {
            await fetch(`http://localhost:3500/api/projects/${workspaceSlug}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                configuration: { localPath },
              }),
            });

            setTimeout(() => {
              if (!signal.aborted) {
                onComplete(localPath);
              }
            }, 1000);
          }
        } catch (error) {
          if (signal.aborted) return;
          const errorMessage = error instanceof Error ? error.message : "Environment setup failed";
          dispatch({ type: "UPDATE_STEP", stepId: "env", status: "error", message: errorMessage });
        }
      }
    }

    void runSetup();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (installWsRef.current) {
        installWsRef.current.close();
        installWsRef.current = null;
      }
    };
  }, [workspaceSlug, repoUrl, onComplete]);

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (installWsRef.current) {
      installWsRef.current.close();
      installWsRef.current = null;
    }
    if (state.terminalId) {
      void coderApi.killTerminal(state.terminalId);
    }
    onCancel();
  };

  const handleRetry = (stepId: string) => {
    if (stepId === "clone") {
      dispatch({ type: "RESET" });
      window.location.reload();
    } else if (stepId === "install" || stepId === "env") {
      dispatch({ type: "UPDATE_STEP", stepId, status: "pending" });
      window.location.reload();
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
            {state.steps.map((step, index) => (
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

                {step.id === "install" && state.terminalId && state.terminalToken && step.status === "running" && (
                  <div className="ml-8 mt-2 rounded border border-[#00ffcc33] bg-[#0a0a0a] p-4">
                    <div className="mb-2 flex items-center gap-2 text-xs text-[#00ccff]">
                      <TerminalIcon className="h-4 w-4" />
                      <span>Installation Output</span>
                    </div>
                    <div className="h-64 overflow-hidden">
                      <Terminal terminalId={state.terminalId} token={state.terminalToken} />
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
              disabled={state.steps.every((s) => s.status === "success")}
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
