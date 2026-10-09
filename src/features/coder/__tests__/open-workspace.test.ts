import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTauri } from "@tauri-apps/api/core";
import {
  extractWorkspaceLocalPath,
  folderPickerMode,
  formatWorkspaceOpenError,
  isUsableLocalPath,
  planWorkspaceOpen,
  shouldAttemptOpenWorkspace,
} from "../open-workspace";

describe("isTauri", () => {
  it("is false in Node and in a plain browser without the Tauri runtime", () => {
    assert.equal(isTauri(), false);
  });
});

describe("shouldAttemptOpenWorkspace", () => {
  it("runs even when the projects list has not loaded", () => {
    assert.equal(
      shouldAttemptOpenWorkspace({
        workspaceParam: "pantry-pilot",
        projectRoot: null,
        handledWorkspaceParam: null,
      }),
      true,
    );
  });

  it("runs again when the workspace query param changes", () => {
    assert.equal(
      shouldAttemptOpenWorkspace({
        workspaceParam: "virtara",
        projectRoot: null,
        handledWorkspaceParam: "pantry-pilot",
      }),
      true,
    );
  });

  it("does not loop on the same param after a failed attempt", () => {
    assert.equal(
      shouldAttemptOpenWorkspace({
        workspaceParam: "pantry-pilot",
        projectRoot: null,
        handledWorkspaceParam: "pantry-pilot",
      }),
      false,
    );
  });

  it("does not run when a project is already open or there is no param", () => {
    assert.equal(
      shouldAttemptOpenWorkspace({
        workspaceParam: "pantry-pilot",
        projectRoot: "/Users/dylan/dev/pantry-pilot",
        handledWorkspaceParam: null,
      }),
      false,
    );
    assert.equal(
      shouldAttemptOpenWorkspace({
        workspaceParam: null,
        projectRoot: null,
        handledWorkspaceParam: null,
      }),
      false,
    );
  });
});

describe("extractWorkspaceLocalPath", () => {
  it("reads configuration.localPath from the AgentOS project detail shape", () => {
    assert.equal(
      extractWorkspaceLocalPath({
        configuration: { localPath: "~/AgentOS/coder/pantry-pilot" },
      }),
      "~/AgentOS/coder/pantry-pilot",
    );
  });

  it("accepts a top-level localPath if configuration is nested differently", () => {
    assert.equal(
      extractWorkspaceLocalPath({ localPath: "/Users/dylan/dev/agentos" }),
      "/Users/dylan/dev/agentos",
    );
  });

  it("ignores blank paths", () => {
    assert.equal(extractWorkspaceLocalPath({ configuration: { localPath: "  " } }), undefined);
    assert.equal(extractWorkspaceLocalPath({ configuration: {} }), undefined);
    assert.equal(extractWorkspaceLocalPath(null), undefined);
  });
});

describe("planWorkspaceOpen", () => {
  it("opens the linked folder when localPath is set", () => {
    assert.deepEqual(
      planWorkspaceOpen({
        slug: "pantry-pilot",
        name: "Pantry Pilot",
        detail: { configuration: { localPath: "/Users/dylan/dev/pantry-pilot" } },
      }),
      { kind: "open", localPath: "/Users/dylan/dev/pantry-pilot", slug: "pantry-pilot" },
    );
  });

  it("sends an unlinked workspace to the setup wizard", () => {
    assert.deepEqual(
      planWorkspaceOpen({
        slug: "virtara",
        name: "Virtara",
        detail: {
          name: "Virtara",
          githubRepo: "acme/virtara",
          configuration: {},
        },
      }),
      {
        kind: "setup",
        slug: "virtara",
        name: "Virtara",
        repoUrl: "https://github.com/acme/virtara.git",
      },
    );
  });
});

describe("folderPickerMode", () => {
  it("uses a path input in the browser and the native dialog in Tauri", () => {
    assert.equal(folderPickerMode(false), "path-input");
    assert.equal(folderPickerMode(true), "native-dialog");
  });
});

describe("isUsableLocalPath", () => {
  it("accepts absolute and home-relative paths", () => {
    assert.equal(isUsableLocalPath("/Users/dylan/dev/agentos"), true);
    assert.equal(isUsableLocalPath("~/AgentOS/coder/x"), true);
    assert.equal(isUsableLocalPath("C:\\Users\\dylan\\dev"), true);
  });

  it("rejects empty or relative names that are not folders on disk", () => {
    assert.equal(isUsableLocalPath(""), false);
    assert.equal(isUsableLocalPath("   "), false);
    assert.equal(isUsableLocalPath("agentos"), false);
  });
});

describe("formatWorkspaceOpenError", () => {
  it("shows the real error text instead of a generic alert", () => {
    assert.equal(formatWorkspaceOpenError(new Error("plugin:dialog not allowed"), "fallback"), "plugin:dialog not allowed");
    assert.equal(formatWorkspaceOpenError("CORS blocked", "fallback"), "CORS blocked");
    assert.equal(formatWorkspaceOpenError(null, "Failed to open folder picker"), "Failed to open folder picker");
  });
});
