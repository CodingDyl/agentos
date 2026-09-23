import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ActivityPage } from "@/features/activity";
import { AgentPage, CommandPaletteProvider } from "@/features/agent";
import { AppShellActionsContext } from "@/components/os";
import { QuickCreateProvider, ShellActions, WorkspaceFeedbackProvider } from "@/features/workspace";
import {
  AutomationDetailPage,
  AutomationsPage,
} from "@/features/automations";
import { MailPage } from "@/features/mail";
import { MissionControlPage } from "@/features/mission-control";
import { AgentDetailPage, OperationsPage } from "@/features/operations";
import {
  BoardDetailPage,
  BoardsPage,
  DesignsPage,
  GenerationsPage,
} from "@/features/designs";
import { ProjectDetailPage, ProjectsPage } from "@/features/projects";
import { JobDetailPage, WorkersPage } from "@/features/workers";
import { DesignSystemPage } from "@/pages/design-system-page";

function App() {
  return (
    <BrowserRouter>
      {/* Wraps every route: an undo offer has to outlive the screen that
          produced it, because navigating away is often the moment the
          operator realises they wanted it back. */}
      <WorkspaceFeedbackProvider>
        {/* Quick Create hosts the global forms; the palette, the shell's `+`
            and Mission Control all open them from here. */}
        <QuickCreateProvider>
        {/* The palette wraps every route: ⌘K works wherever the operator is, and
            the route it opens from is what makes its ranking context-aware. */}
        <CommandPaletteProvider>
        <AppShellActionsContext.Provider value={<ShellActions />}>
        <Routes>
          {/* Mission Control replaces the old Dashboard here rather than
              sitting beside it: two screens both answering "what should I do
              now?" is two screens nobody fully trusts. */}
          <Route path="/" element={<MissionControlPage />} />
          <Route path="/mail" element={<MailPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:slug" element={<ProjectDetailPage />} />
          <Route path="/agent" element={<AgentPage />} />
          <Route path="/automations" element={<AutomationsPage />} />
          <Route
            path="/automations/:id"
            element={<AutomationDetailPage />}
          />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/designs" element={<DesignsPage />} />
          <Route path="/designs/boards" element={<BoardsPage />} />
          <Route path="/designs/generations" element={<GenerationsPage />} />
          <Route path="/designs/boards/:id" element={<BoardDetailPage />} />
          <Route path="/operations" element={<OperationsPage />} />
          {/* Named for the agent, not the worker: Hermes is on this page too,
              and it is not a worker. */}
          <Route
            path="/operations/agents/:id"
            element={<AgentDetailPage />}
          />
          <Route path="/workers" element={<WorkersPage />} />
          <Route path="/workers/jobs/:id" element={<JobDetailPage />} />
          <Route path="/design-system" element={<DesignSystemPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </AppShellActionsContext.Provider>
        </CommandPaletteProvider>
        </QuickCreateProvider>
      </WorkspaceFeedbackProvider>
    </BrowserRouter>
  );
}

export default App;
