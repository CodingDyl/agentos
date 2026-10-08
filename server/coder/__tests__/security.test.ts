import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { generateTerminalToken, validateTerminalToken, clearAllTokens } from "../terminal-tokens";

describe("Coder Security", () => {
  after(() => {
    clearAllTokens();
  });

  describe("Terminal Tokens", () => {
    it("should generate a valid token", () => {
      const token = generateTerminalToken("test-terminal-id");
      assert.ok(token);
      assert.equal(typeof token, "string");
      assert.ok(token.length > 0);
    });

    it("should validate a fresh token and return terminal id", () => {
      const terminalId = "test-terminal-123";
      const token = generateTerminalToken(terminalId);
      
      const validated = validateTerminalToken(token);
      assert.equal(validated, terminalId);
    });

    it("should invalidate a token after first use", () => {
      const terminalId = "test-terminal-456";
      const token = generateTerminalToken(terminalId);
      
      validateTerminalToken(token);
      
      const secondValidation = validateTerminalToken(token);
      assert.equal(secondValidation, null);
    });

    it("should return null for non-existent token", () => {
      const result = validateTerminalToken("non-existent-token");
      assert.equal(result, null);
    });

    it.skip("should expire tokens after timeout", async () => {
      const terminalId = "test-terminal-expire";
      const token = generateTerminalToken(terminalId);
      
      await new Promise(resolve => setTimeout(resolve, 61000));
      
      const result = validateTerminalToken(token);
      assert.equal(result, null);
    });

    it("should clear all tokens", () => {
      const token1 = generateTerminalToken("terminal-1");
      const token2 = generateTerminalToken("terminal-2");
      
      clearAllTokens();
      
      assert.equal(validateTerminalToken(token1), null);
      assert.equal(validateTerminalToken(token2), null);
    });

    it("should generate unique tokens for different terminals", () => {
      const token1 = generateTerminalToken("terminal-1");
      const token2 = generateTerminalToken("terminal-2");
      
      assert.notEqual(token1, token2);
    });

    it("should handle multiple terminals independently", () => {
      const id1 = "terminal-a";
      const id2 = "terminal-b";
      const token1 = generateTerminalToken(id1);
      const token2 = generateTerminalToken(id2);
      
      assert.equal(validateTerminalToken(token1), id1);
      assert.equal(validateTerminalToken(token2), id2);
      
      assert.equal(validateTerminalToken(token1), null);
      assert.equal(validateTerminalToken(token2), null);
    });
  });
});
