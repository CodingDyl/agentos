import {
  Activity,
  AudioLines,
  BarChart3,
  Bot,
  Bug,
  Calendar,
  CreditCard,
  Database,
  Folder,
  GitBranch,
  HardDrive,
  Image,
  Landmark,
  Mail,
  MonitorPlay,
  Music,
  NotebookText,
  PenTool,
  Plug,
  Search,
  Sparkles,
  Triangle,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A connector's mark, from the server's icon key.
 *
 * Lucide carries no brand logos, so each service gets a plain glyph for what
 * it is — except GitHub, whose mark is recognisable enough to be worth an
 * inline path. An unknown key falls back to a plug rather than nothing.
 */

const ICONS: Record<string, LucideIcon> = {
  activity: Activity,
  audio: AudioLines,
  "bar-chart": BarChart3,
  bot: Bot,
  bug: Bug,
  calendar: Calendar,
  "credit-card": CreditCard,
  database: Database,
  folder: Folder,
  "git-branch": GitBranch,
  "hard-drive": HardDrive,
  image: Image,
  landmark: Landmark,
  mail: Mail,
  music: Music,
  notebook: NotebookText,
  youtube: MonitorPlay,
  "pen-tool": PenTool,
  search: Search,
  sparkles: Sparkles,
  triangle: Triangle,
  users: Users,
  zap: Zap,
};

function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** A square tile with the connector's glyph. Decorative: the name always sits beside it. */
export function ConnectorIcon({ icon, size = "md" }: { icon: string; size?: "sm" | "md" | "lg" }) {
  const box = size === "lg" ? "size-12" : size === "sm" ? "size-8" : "size-10";
  const glyph = size === "lg" ? "size-6" : size === "sm" ? "size-4" : "size-5";
  const Icon = ICONS[icon] ?? Plug;

  return (
    <span className={cn("inline-grid shrink-0 place-items-center rounded-none border border-paper-mist bg-paper-linen text-paper-moss", box)} aria-hidden="true">
      {icon === "github" ? <GithubMark className={glyph} /> : <Icon className={glyph} strokeWidth={1.75} />}
    </span>
  );
}
