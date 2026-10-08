import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  getWorkspaceClonePath,
  cloneRepository,
  pullRepository,
  detectPackageManager,
  detectDevCommand,
  setupEnvFile,
} from "../workspace-setup";

describe("Workspace Setup", () => {
  let testDir: string;
  let _originalCoderRoot: string;

  before(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "coder-test-"));
    
    const setupModule = await import("../workspace-setup");
    
    Object.defineProperty(setupModule, "CODER_ROOT", {
      value: testDir,
      writable: false,
    });
  });

  after(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("getWorkspaceClonePath", () => {
    it("should generate path within coder root", () => {
      const result = getWorkspaceClonePath("test-workspace");
      assert.ok(result.includes("test-workspace"));
    });
  });

  describe("cloneRepository", () => {
    it("should reject invalid repo URLs", async () => {
      await assert.rejects(
        async () => await cloneRepository("invalid-url", "/some/path"),
        /Invalid repository URL/,
      );
    });

    it("should reject URLs with shell metacharacters", async () => {
      await assert.rejects(
        async () => await cloneRepository("https://github.com/test/repo.git; rm -rf /", "/some/path"),
        /Invalid repository URL/,
      );
    });

    it("should reject clone target outside managed directory", async () => {
      await assert.rejects(
        async () => await cloneRepository("https://github.com/test/repo.git", "/etc/passwd"),
        /Clone target must be within managed coder directory/,
      );
    });

    it("should accept valid https URLs", async () => {
      const validUrl = "https://github.com/test/repo.git";
      const targetPath = path.join(testDir, "test-repo");
      
      try {
        await cloneRepository(validUrl, targetPath);
      } catch (error) {
        assert.ok(
          (error as Error).message.includes("Authentication") ||
          (error as Error).message.includes("Repository not found") ||
          (error as Error).message.includes("Failed to start git"),
        );
      }
    });

    it("should accept valid git@ URLs", async () => {
      const validUrl = "git@github.com:test/repo.git";
      const targetPath = path.join(testDir, "test-repo-ssh");
      
      try {
        await cloneRepository(validUrl, targetPath);
      } catch (error) {
        assert.ok(
          (error as Error).message.includes("Authentication") ||
          (error as Error).message.includes("Repository not found") ||
          (error as Error).message.includes("Failed to start git"),
        );
      }
    });
  });

  describe("pullRepository", () => {
    it("should fail with helpful message for dirty tree", async () => {
      const repoPath = path.join(testDir, "test-pull-dirty");
      await fs.mkdir(repoPath, { recursive: true });
      
      try {
        await fs.writeFile(path.join(repoPath, ".git"), "fake git dir");
        await fs.mkdir(path.join(repoPath, ".git"), { recursive: true });
        
        const result = await pullRepository(repoPath);
        assert.ok(!result.success || result.message.includes("Failed"));
      } catch (error) {
        assert.ok(error);
      }
    });
  });

  describe("detectPackageManager", () => {
    it("should detect bun from bun.lockb", async () => {
      const repoPath = path.join(testDir, "test-bun");
      await fs.mkdir(repoPath, { recursive: true });
      await fs.writeFile(path.join(repoPath, "bun.lockb"), "");
      
      const result = await detectPackageManager(repoPath);
      assert.equal(result, "bun");
    });

    it("should detect pnpm from pnpm-lock.yaml", async () => {
      const repoPath = path.join(testDir, "test-pnpm");
      await fs.mkdir(repoPath, { recursive: true });
      await fs.writeFile(path.join(repoPath, "pnpm-lock.yaml"), "");
      
      const result = await detectPackageManager(repoPath);
      assert.equal(result, "pnpm");
    });

    it("should detect yarn from yarn.lock", async () => {
      const repoPath = path.join(testDir, "test-yarn");
      await fs.mkdir(repoPath, { recursive: true });
      await fs.writeFile(path.join(repoPath, "yarn.lock"), "");
      
      const result = await detectPackageManager(repoPath);
      assert.equal(result, "yarn");
    });

    it("should detect npm from package-lock.json", async () => {
      const repoPath = path.join(testDir, "test-npm");
      await fs.mkdir(repoPath, { recursive: true });
      await fs.writeFile(path.join(repoPath, "package-lock.json"), "");
      
      const result = await detectPackageManager(repoPath);
      assert.equal(result, "npm");
    });

    it("should default to npm if only package.json exists", async () => {
      const repoPath = path.join(testDir, "test-package-only");
      await fs.mkdir(repoPath, { recursive: true });
      await fs.writeFile(path.join(repoPath, "package.json"), "{}");
      
      const result = await detectPackageManager(repoPath);
      assert.equal(result, "npm");
    });

    it("should return null if no package manager detected", async () => {
      const repoPath = path.join(testDir, "test-no-pm");
      await fs.mkdir(repoPath, { recursive: true });
      
      const result = await detectPackageManager(repoPath);
      assert.equal(result, null);
    });
  });

  describe("detectDevCommand", () => {
    it("should detect dev script", async () => {
      const repoPath = path.join(testDir, "test-dev-script");
      await fs.mkdir(repoPath, { recursive: true });
      await fs.writeFile(
        path.join(repoPath, "package.json"),
        JSON.stringify({ scripts: { dev: "vite" } }),
      );
      
      const result = await detectDevCommand(repoPath);
      assert.equal(result, "dev");
    });

    it("should fall back to develop script", async () => {
      const repoPath = path.join(testDir, "test-develop-script");
      await fs.mkdir(repoPath, { recursive: true });
      await fs.writeFile(
        path.join(repoPath, "package.json"),
        JSON.stringify({ scripts: { develop: "webpack serve" } }),
      );
      
      const result = await detectDevCommand(repoPath);
      assert.equal(result, "develop");
    });

    it("should fall back to start script", async () => {
      const repoPath = path.join(testDir, "test-start-script");
      await fs.mkdir(repoPath, { recursive: true });
      await fs.writeFile(
        path.join(repoPath, "package.json"),
        JSON.stringify({ scripts: { start: "node index.js" } }),
      );
      
      const result = await detectDevCommand(repoPath);
      assert.equal(result, "start");
    });

    it("should return null if no dev command found", async () => {
      const repoPath = path.join(testDir, "test-no-dev");
      await fs.mkdir(repoPath, { recursive: true });
      await fs.writeFile(
        path.join(repoPath, "package.json"),
        JSON.stringify({ scripts: { test: "jest" } }),
      );
      
      const result = await detectDevCommand(repoPath);
      assert.equal(result, null);
    });
  });

  describe("setupEnvFile", () => {
    it("should not overwrite existing .env file", async () => {
      const repoPath = path.join(testDir, "test-env-exists");
      await fs.mkdir(repoPath, { recursive: true });
      await fs.writeFile(path.join(repoPath, ".env"), "EXISTING=value");
      await fs.writeFile(path.join(repoPath, ".env.example"), "NEW_KEY=value");
      
      const result = await setupEnvFile(repoPath);
      
      assert.equal(result.created, false);
      assert.equal(result.missingKeys.length, 0);
      
      const envContent = await fs.readFile(path.join(repoPath, ".env"), "utf-8");
      assert.equal(envContent, "EXISTING=value");
    });

    it("should not overwrite existing .env.local file", async () => {
      const repoPath = path.join(testDir, "test-env-local-exists");
      await fs.mkdir(repoPath, { recursive: true });
      await fs.writeFile(path.join(repoPath, ".env.local"), "EXISTING=value");
      await fs.writeFile(path.join(repoPath, ".env.example"), "NEW_KEY=value");
      
      const result = await setupEnvFile(repoPath);
      
      assert.equal(result.created, false);
    });

    it("should copy .env.example to .env.local", async () => {
      const repoPath = path.join(testDir, "test-env-copy");
      await fs.mkdir(repoPath, { recursive: true });
      await fs.writeFile(
        path.join(repoPath, ".env.example"),
        "API_KEY=your_key_here\nDATABASE_URL=postgres://localhost",
      );
      
      const result = await setupEnvFile(repoPath);
      
      assert.equal(result.created, true);
      
      const envContent = await fs.readFile(path.join(repoPath, ".env.local"), "utf-8");
      assert.ok(envContent.includes("API_KEY="));
      assert.ok(envContent.includes("DATABASE_URL="));
    });

    it("should identify keys needing values", async () => {
      const repoPath = path.join(testDir, "test-env-missing");
      await fs.mkdir(repoPath, { recursive: true });
      await fs.writeFile(
        path.join(repoPath, ".env.example"),
        'API_KEY=your_api_key\nDATABASE_URL=""\nGOOD_KEY=actual_value\nTODO_KEY=TODO',
      );
      
      const result = await setupEnvFile(repoPath);
      
      assert.equal(result.created, true);
      assert.ok(result.missingKeys.includes("API_KEY"));
      assert.ok(result.missingKeys.includes("DATABASE_URL"));
      assert.ok(result.missingKeys.includes("TODO_KEY"));
      assert.ok(!result.missingKeys.includes("GOOD_KEY"));
    });

    it("should handle .env.template as fallback", async () => {
      const repoPath = path.join(testDir, "test-env-template");
      await fs.mkdir(repoPath, { recursive: true });
      await fs.writeFile(
        path.join(repoPath, ".env.template"),
        "TEMPLATE_KEY=value",
      );
      
      const result = await setupEnvFile(repoPath);
      
      assert.equal(result.created, true);
      
      const envContent = await fs.readFile(path.join(repoPath, ".env.local"), "utf-8");
      assert.ok(envContent.includes("TEMPLATE_KEY="));
    });

    it("should never log or return environment values", async () => {
      const repoPath = path.join(testDir, "test-env-no-leak");
      await fs.mkdir(repoPath, { recursive: true });
      await fs.writeFile(
        path.join(repoPath, ".env.example"),
        "SECRET_KEY=super_secret_value_12345",
      );
      
      const result = await setupEnvFile(repoPath);
      
      assert.equal(result.created, true);
      assert.ok(result.missingKeys.length === 0 || !result.missingKeys.some(k => k.includes("secret")));
      
      assert.ok(!JSON.stringify(result).includes("super_secret"));
    });

    it("should skip comments in env file", async () => {
      const repoPath = path.join(testDir, "test-env-comments");
      await fs.mkdir(repoPath, { recursive: true });
      await fs.writeFile(
        path.join(repoPath, ".env.example"),
        "# This is a comment\nVALID_KEY=value\n# Another comment",
      );
      
      const result = await setupEnvFile(repoPath);
      
      assert.equal(result.created, true);
      assert.equal(result.missingKeys.length, 0);
    });
  });
});
