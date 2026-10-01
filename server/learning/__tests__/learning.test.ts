import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { formatTimestamp, sourceUrlAt } from "../../../shared/learning-types";
import { MemoryService } from "../../memory/service";
import { closeLearningDatabase } from "../db";
import { continueWatching, importSource, LearningRequestError, listSources, recordProgress, updateSource } from "../library";
import { createNotebook, listNotebooks, providerForUrl } from "../notebooks";
import { createNote, knowledgeItems, listNotes, promoteNote, searchHits, updateNote } from "../notes";
import { parseSpotifyUrl } from "../spotify-urls";
import { buildSpotifyConsentUrl, consumeConsentState, SpotifyError, toPlayback, toTrack } from "../spotify";
import { parseTimeParam, parseYouTubeUrl } from "../youtube";

describe("YouTube addresses", () => {
  it("reads every common shape, and the start time", () => {
    const id = "dQw4w9WgXcQ";
    for (const url of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `youtube.com/shorts/${id}`,
      `https://m.youtube.com/watch?v=${id}&list=x`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube.com/live/${id}`,
      id,
    ]) {
      assert.equal(parseYouTubeUrl(url)?.videoId, id, url);
    }
    assert.equal(parseYouTubeUrl(`https://youtu.be/${id}?t=1m30s`)?.startSeconds, 90);
    assert.equal(parseTimeParam("1h2m3s"), 3723);
    assert.equal(parseTimeParam("75"), 75);
  });

  it("refuses look-alikes", () => {
    for (const url of ["https://evil.example/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=short", "javascript:alert(1)", "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ"]) {
      assert.equal(parseYouTubeUrl(url), undefined, url);
    }
  });
});

describe("Spotify addresses", () => {
  it("reads open.spotify.com links and URIs", () => {
    assert.deepEqual(parseSpotifyUrl("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc"), {
      type: "track",
      id: "4uLU6hMCjMI75M1A2tKUQC",
      uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC",
    });
    assert.equal(parseSpotifyUrl("https://open.spotify.com/intl-de/playlist/37i9dQZF1DX8Uebhn9wzrS")?.uri, "spotify:playlist:37i9dQZF1DX8Uebhn9wzrS");
    assert.equal(parseSpotifyUrl("spotify:album:1DFixLWuPkv3KT3TnV35m3")?.type, "album");
    assert.equal(parseSpotifyUrl("https://evil.example/track/4uLU6hMCjMI75M1A2tKUQC"), undefined);
  });
});

describe("timestamps", () => {
  it("formats and links to a moment", () => {
    assert.equal(formatTimestamp(1938), "32:18");
    assert.equal(formatTimestamp(3725), "1:02:05");
    assert.equal(sourceUrlAt("youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", 1938), "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1938s");
    assert.equal(sourceUrlAt("spotify", "https://open.spotify.com/track/x", 30), "https://open.spotify.com/track/x");
  });
});

describe("Spotify shapes", () => {
  it("maps a playing track and an episode", () => {
    const playback = toPlayback(
      {
        is_playing: true,
        progress_ms: 61_000,
        item: { uri: "spotify:track:1", name: "Cirrus", type: "track", duration_ms: 200_000, artists: [{ name: "Bonobo" }], album: { name: "The North Borders", images: [{ url: "big", width: 640 }, { url: "small", width: 64 }] } },
        device: { id: "d1", name: "Mac", type: "Computer", is_active: true, volume_percent: 40 },
      },
      new Date("2026-10-01T00:00:00Z"),
    );
    assert.equal(playback?.track?.artists[0], "Bonobo");
    assert.equal(playback?.track?.imageUrl, "small");
    assert.equal(playback?.device?.volumePercent, 40);
    assert.equal(toTrack({ uri: "spotify:episode:2", name: "Ep", type: "episode", show: { name: "Show", publisher: "Pub" } })?.artists[0], "Pub");
    assert.equal(toPlayback(undefined), undefined);
  });

  it("only completes a sign-in it started", () => {
    const previous = { id: process.env.SPOTIFY_CLIENT_ID, secret: process.env.SPOTIFY_CLIENT_SECRET };
    process.env.SPOTIFY_CLIENT_ID = "client";
    process.env.SPOTIFY_CLIENT_SECRET = "secret";
    try {
      const url = new URL(buildSpotifyConsentUrl("http://localhost:1420/learning"));
      assert.equal(url.hostname, "accounts.spotify.com");
      assert.match(url.searchParams.get("scope") ?? "", /streaming/);
      assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:8787/api/spotify/oauth/callback");
      const state = url.searchParams.get("state")!;
      assert.equal(consumeConsentState(state).origin, "http://localhost:1420");
      assert.throws(() => consumeConsentState(state), SpotifyError, "single use");
      assert.throws(() => consumeConsentState("forged"), SpotifyError);
      // A non-loopback origin is never carried back.
      const evil = new URL(buildSpotifyConsentUrl("https://evil.example/")).searchParams.get("state")!;
      assert.equal(consumeConsentState(evil).origin, undefined);
    } finally {
      process.env.SPOTIFY_CLIENT_ID = previous.id;
      process.env.SPOTIFY_CLIENT_SECRET = previous.secret;
      if (previous.id === undefined) delete process.env.SPOTIFY_CLIENT_ID;
      if (previous.secret === undefined) delete process.env.SPOTIFY_CLIENT_SECRET;
    }
  });
});

const oembed = (async (url: string | URL | Request) => {
  const text = String(url);
  if (text.includes("youtube.com/oembed")) return new Response(JSON.stringify({ title: "Programmatic SEO Architecture", author_name: "Some Channel" }));
  if (text.includes("open.spotify.com/oembed")) return new Response(JSON.stringify({ title: "Cirrus", thumbnail_url: "https://i.scdn.co/image/x" }));
  return new Response("", { status: 404 });
}) as typeof fetch;

describe("the learning library", () => {
  before(() => closeLearningDatabase());
  after(() => closeLearningDatabase());

  it("saves a video once, keeps progress, and finishes it near the end", async () => {
    const first = await importSource({ url: "https://youtu.be/dQw4w9WgXcQ?t=90", watchLater: true, workspaceId: "agentos", tags: ["SEO"] }, oembed);
    assert.equal(first.created, true);
    assert.equal(first.startSeconds, 90);
    assert.equal(first.source.title, "Programmatic SEO Architecture");
    assert.equal(first.source.author, "Some Channel");
    assert.deepEqual(first.source.tags, ["seo"]);
    assert.equal(first.source.thumbnailUrl, "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");

    const again = await importSource({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }, oembed);
    assert.equal(again.created, false);
    assert.equal(again.source.id, first.source.id);

    let source = recordProgress(first.source.id, { positionSeconds: 600, durationSeconds: 2400 });
    assert.equal(source.positionSeconds, 600);
    assert.equal(source.finished, false);
    assert.deepEqual(continueWatching(listSources()).map((entry) => entry.id), [first.source.id]);

    source = recordProgress(first.source.id, { positionSeconds: 2390 });
    assert.equal(source.finished, true);
    assert.equal(source.watchLater, false, "finished comes off Watch later");

    source = updateSource(first.source.id, { archived: true, workspaceId: null });
    assert.equal(source.archived, true);
    assert.equal(source.workspaceId, undefined);
  });

  it("saves a Spotify link and refuses anything else", async () => {
    const saved = await importSource({ url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC" }, oembed);
    assert.equal(saved.source.kind, "spotify");
    assert.equal(saved.source.externalId, "spotify:track:4uLU6hMCjMI75M1A2tKUQC");
    await assert.rejects(importSource({ url: "https://example.com/video" }, oembed), LearningRequestError);
  });

  it("captures a timestamped note that opens the source at that moment", async () => {
    const video = (await importSource({ url: "https://youtu.be/dQw4w9WgXcQ" }, oembed)).source;
    const note = createNote({
      title: "Deterministic routing first",
      content: "Route context deterministically before semantic retrieval.",
      sourceType: "youtube",
      sourceId: video.id,
      timestampSeconds: 1938,
      workspaceId: "agentos",
      taskId: "ag-12",
      tags: ["Memory"],
    });
    assert.equal(note.sourceUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1938s");
    assert.equal(note.sourceTitle, "Programmatic SEO Architecture");
    assert.equal(note.taskId, "AG-12");

    const [item] = knowledgeItems([note], [{ slug: "agentos", name: "AgentOS", state: "active", priority: "high" }]);
    assert.equal(item.kind, "learning");
    assert.equal(item.projectName, "AgentOS");
    assert.match(item.detail ?? "", /YouTube · 32:18/);
    assert.equal(item.href, `/learning?tab=saved&note=${note.id}`);

    const unlinked = createNote({ title: "Loose idea", content: "x", sourceType: "manual", sourceUrl: "javascript:alert(1)" });
    assert.equal(unlinked.sourceUrl, undefined, "only http(s) links are kept");
    assert.equal(knowledgeItems([unlinked], [])[0].project, "learning");

    assert.ok(searchHits(listNotes()).some((hit) => hit.id === note.id && /semantic retrieval/.test(hit.detail ?? "")));

    updateNote(note.id, { archived: true, taskId: null });
    assert.equal(searchHits(listNotes()).some((hit) => hit.id === note.id), false, "archived learnings leave search");
    assert.equal(knowledgeItems(listNotes(), []).some((entry) => entry.id === `learning:${note.id}`), false);
  });

  it("links notebooks without contacting anything", async () => {
    assert.equal(providerForUrl("https://notebooklm.google.com/notebook/abc"), "notebooklm");
    assert.equal(providerForUrl("https://example.com/notes"), "manual");
    assert.throws(() => providerForUrl("http://notebooklm.google.com/x"), LearningRequestError);

    const notebook = await createNotebook({ name: "Agentic OS Memory Research", externalUrl: "https://notebooklm.google.com/notebook/abc", externalSources: [{ title: "Spec", url: "https://example.com/spec" }] });
    assert.equal(notebook.provider, "notebooklm");
    assert.equal((await listNotebooks())[0].id, notebook.id);
  });
});

describe("promoting a learning to memory", () => {
  let parent: string;
  let service: MemoryService;

  before(async () => {
    closeLearningDatabase();
    parent = await fs.mkdtemp(path.join(os.tmpdir(), "learning-promote-"));
    const root = path.join(parent, "vault");
    await fs.mkdir(path.join(root, "projects/agentos"), { recursive: true });
    await fs.writeFile(path.join(root, "projects/agentos/PROJECT.md"), "# AgentOS\n");
    await fs.writeFile(path.join(root, "projects/agentos/DECISIONS.md"), "# Decisions\n");
    process.env.AGENTOS_ROOT = root;
    service = new MemoryService({ root, cacheFile: path.join(parent, "cache.json"), probeMs: 60_000, reconcileMs: 60_000 });
    await service.start();
  });

  after(async () => {
    service.stop();
    closeLearningDatabase();
    delete process.env.AGENTOS_ROOT;
    await fs.rm(parent, { recursive: true, force: true });
  });

  it("writes memory only on approval, with the learning as its provenance", async () => {
    const note = createNote({ title: "Routing before retrieval", content: "x", sourceType: "manual", sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1938s" });
    const outcome = await promoteNote(service, note.id, {
      workspaceId: "agentos",
      type: "pattern",
      title: "Deterministic context routing",
      body: "Use deterministic context routing before semantic retrieval to reduce unnecessary model context.",
      action: "create",
    });
    assert.equal(outcome.outcome, "created");
    const written = await fs.readFile(path.join(service.root, outcome.target!), "utf8");
    assert.match(written, new RegExp(`sourceLearning: "${note.id}"`));
    assert.match(written, /sourceUrl: "https:\/\/www.youtube.com\/watch\?v=dQw4w9WgXcQ&t=1938s"/);
    assert.match(written, /createdBy: "human"/);
    assert.deepEqual(listNotes().find((entry) => entry.id === note.id)?.promotedTo, [outcome.target]);

    // The same memory again is caught as a duplicate rather than written twice.
    const again = await promoteNote(service, note.id, {
      workspaceId: "agentos",
      type: "pattern",
      title: "Deterministic context routing",
      body: "Use deterministic context routing before semantic retrieval.",
      action: "create",
    });
    assert.equal(again.outcome, "failed");
    assert.match(again.error ?? "", /existing memory/i);
  });
});
