import { useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/os";
import { PaperStage } from "@/components/paper";
import { useNavigationItems } from "@/config/use-navigation";
import { SpotifyPanel } from "./spotify-player";

/** Music: the Spotify player, on its own page. The sidebar's mini-player links here. */
export function MusicPage() {
  const navigationItems = useNavigationItems();
  const [params] = useSearchParams();

  return (
    <AppShell navigationItems={navigationItems} pageId="music" activeHref="/music" agentState="idle" agentLabel="Music">
      <PaperStage>
        <header>
          <h1 className="text-[28px] leading-none font-semibold tracking-[-0.015em] text-paper-moss">Music</h1>
        </header>
        <div className="pt-7">
          <SpotifyPanel connectResult={params.get("spotify") ?? undefined} />
        </div>
      </PaperStage>
    </AppShell>
  );
}
