import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { ActivityPage } from "@/features/activity";
import { AgentPage, CommandPaletteProvider } from "@/features/agent";
import { AppShellActionsContext, AppShellMediaContext, AppShellVoiceContext } from "@/components/os";
import { JarvisPanel, JarvisProvider, VoiceLauncher } from "@/features/voice";
import { QuickCreateProvider, ShellActions, WorkspaceFeedbackProvider } from "@/features/workspace";
import {
  AutomationDetailPage,
  AutomationsPage,
} from "@/features/automations";
import { ConnectorDetailPage, ConnectorsPage } from "@/features/connectors";
import { MailPage } from "@/features/mail";
import { BusinessPage } from "@/features/business";
import { OperatorChatPage, OperatorPage } from "@/features/operator";
import { ChatPanel, ChatPanelProvider } from "@/features/chat-panel";
import { TractionPage } from "@/features/traction";
import { RebuildPage } from "@/features/rebuild";
import { CompassPage } from "@/features/compass";
import { PersonasPage, StartupsPage, VenturePage } from "@/features/startups";
import { FinancePage } from "@/features/finance";
import { CareerPage } from "@/features/career";
import { MissionControlPage } from "@/features/mission-control";
import { AgentDetailPage, OperationsPage } from "@/features/operations";
import {
  BoardDetailPage,
  BoardsPage,
  DesignsPage,
  DownloadToastProvider,
  GenerationsPage,
  AnimateJobPage,
  AnimatePage,
  MotionJobPage,
  MotionPage,
} from "@/features/designs";
import { KnowledgePage } from "@/features/knowledge";
import { LibraryPage } from "@/features/reengineer";
import { MemoryPage } from "@/features/memory";
import { FocusSessionProvider, LearningPage, MediaDock, SpotifyProvider } from "@/features/learning";
import { WorkspacePage, WorkspacesPage } from "@/features/workspaces";
import { AgentProfilePage, AgentsPage } from "@/features/agents";
import { JobDetailPage, WorkersPage } from "@/features/workers";
import { CoderPage } from "@/features/coder";
import { DesignSystemPage } from "@/pages/design-system-page";

function App() {
  return (
    <BrowserRouter>
      {/* Above everything: what's playing and the focus timer outlive any page. */}
      <SpotifyProvider>
      <FocusSessionProvider>
      {/* Wraps every route: an undo offer has to outlive the screen that
          produced it, because navigating away is often the moment the
          operator realises they wanted it back. */}
      <WorkspaceFeedbackProvider>
      <DownloadToastProvider>
        {/* Quick Create hosts the global forms; the palette, the shell's `+`
            and Mission Control all open them from here. */}
        <QuickCreateProvider>
        {/* The palette wraps every route: ⌘K works wherever the operator is, and
            the route it opens from is what makes its ranking context-aware. */}
        <CommandPaletteProvider>
        {/* ⌘J: a chat over any screen, told which screen it is. */}
        <ChatPanelProvider>
        <AppShellActionsContext.Provider value={<ShellActions />}>
        {/* Above the routes so a conversation survives navigating away. */}
        <JarvisProvider>
        <AppShellVoiceContext.Provider value={<VoiceLauncher />}>
        <AppShellMediaContext.Provider value={<MediaDock />}>
        <Routes>
          {/* Dashboard (nav label). Still Mission Control / Today underneath.
              `/today` keeps working for anything that bookmarked the old path. */}
          <Route path="/" element={<MissionControlPage />} />
          <Route path="/today" element={<Navigate to="/" replace />} />
          <Route path="/dashboard" element={<Navigate to="/" replace />} />
          <Route path="/compass" element={<CompassPage />} />
          <Route path="/startups" element={<StartupsPage />} />
          <Route path="/startups/personas" element={<PersonasPage />} />
          <Route path="/startups/:slug" element={<VenturePage />} />
          <Route path="/inbox" element={<MailPage />} />
          <Route path="/mail" element={<Redirect to="/inbox" />} />
          {/* Getting customers, beside the work — not under it. */}
          <Route path="/traction" element={<TractionPage />} />
          <Route path="/rebuilds/:id" element={<RebuildPage />} />
          <Route path="/business" element={<BusinessPage />} />
          <Route path="/growth" element={<Redirect to="/traction" />} />
          {/* Money: read-only from Investec, the arithmetic done here. */}
          <Route path="/finance" element={<FinancePage />} />
          <Route path="/career" element={<CareerPage />} />
          {/* Projects are presented as workspaces. The vault still says
              `projects/`; the old URLs redirect with their query strings, so
              every saved `?tab=tasks&task=PP-031` link keeps working. */}
          {/* One request in, one auditable run out. A run keeps its own URL. */}
          <Route path="/operator" element={<OperatorChatPage />} />
          <Route path="/operator/chats/:chatId" element={<OperatorChatPage />} />
          {/* Planned runs (plan, approve, execute, audit) keep their own view. */}
          <Route path="/operator/runs" element={<OperatorPage />} />
          <Route path="/operator/runs/:id" element={<OperatorPage />} />
          <Route path="/workspaces" element={<WorkspacesPage />} />
          <Route path="/workspaces/:slug" element={<WorkspacePage />} />
          <Route path="/projects" element={<Redirect to="/workspaces" />} />
          <Route path="/projects/:slug" element={<ProjectRedirect />} />
          <Route path="/coder" element={<CoderPage />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/knowledge/library" element={<LibraryPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/learning" element={<LearningPage />} />
          <Route path="/hub" element={<Navigate to="/learning" replace />} />
          <Route path="/agent" element={<AgentPage />} />
          <Route path="/automations" element={<AutomationsPage />} />
          <Route
            path="/automations/:id"
            element={<AutomationDetailPage />}
          />
          {/* The capability registry: what AgentOS can reach and may do. */}
          <Route path="/connectors" element={<ConnectorsPage />} />
          <Route path="/connectors/:id" element={<ConnectorDetailPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/designs" element={<DesignsPage />} />
          <Route path="/designs/boards" element={<BoardsPage />} />
          <Route path="/designs/generations" element={<GenerationsPage />} />
          <Route path="/designs/animate" element={<AnimatePage />} />
          <Route path="/designs/animate/:id" element={<AnimateJobPage />} />
          <Route path="/designs/motion" element={<MotionPage />} />
          <Route path="/designs/motion/:id" element={<MotionJobPage />} />
          <Route path="/designs/boards/:id" element={<BoardDetailPage />} />
          <Route path="/operations" element={<OperationsPage />} />
          {/* Named for the agent, not the worker: Hermes is on this page too,
              and it is not a worker. */}
          <Route
            path="/operations/agents/:id"
            element={<AgentDetailPage />}
          />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/:id" element={<AgentProfilePage />} />
          <Route path="/workers" element={<WorkersPage />} />
          <Route path="/workers/jobs/:id" element={<JobDetailPage />} />
          <Route path="/design-system" element={<DesignSystemPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <JarvisPanel />
        <ChatPanel />
        </AppShellMediaContext.Provider>
        </AppShellVoiceContext.Provider>
        </JarvisProvider>
        </AppShellActionsContext.Provider>
        </ChatPanelProvider>
        </CommandPaletteProvider>
        </QuickCreateProvider>
      </DownloadToastProvider>
      </WorkspaceFeedbackProvider>
      </FocusSessionProvider>
      </SpotifyProvider>
    </BrowserRouter>
  );
}

/** A redirect that keeps the query string and hash of the URL it replaces. */
function Redirect({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={`${to}${search}${hash}`} replace />;
}

function ProjectRedirect() {
  const { slug = "" } = useParams();
  return <Redirect to={`/workspaces/${encodeURIComponent(slug)}`} />;
}

export default App;
