import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  createTerminal,
  getTerminal,
  writeToTerminal,
  resizeTerminal,
  killTerminal,
  killAllTerminals,
  getTerminalIds,
} from "../pty-manager";

describe("Coder PTY Manager", () => {
  const createdTerminals: string[] = [];

  after(() => {
    killAllTerminals();
  });

  it("should create a terminal", () => {
    const { id, shell } = createTerminal(process.cwd());
    createdTerminals.push(id);
    
    assert.ok(id);
    assert.ok(shell);
    assert.ok(typeof id === "string");
    assert.ok(typeof shell === "string");
  });

  it("should get a terminal by id", () => {
    const { id } = createTerminal(process.cwd());
    createdTerminals.push(id);
    
    const terminal = getTerminal(id);
    assert.ok(terminal);
    assert.equal(terminal.id, id);
    assert.ok(terminal.pty);
    assert.equal(terminal.cwd, process.cwd());
  });

  it("should return undefined for non-existent terminal", () => {
    const terminal = getTerminal("non-existent-id");
    assert.equal(terminal, undefined);
  });

  it("should write to terminal", () => {
    const { id } = createTerminal(process.cwd());
    createdTerminals.push(id);
    
    assert.doesNotThrow(() => {
      writeToTerminal(id, "echo test\r");
    });
  });

  it("should throw when writing to non-existent terminal", () => {
    assert.throws(
      () => writeToTerminal("non-existent-id", "test"),
      /Terminal .* not found/
    );
  });

  it("should resize terminal", () => {
    const { id } = createTerminal(process.cwd());
    createdTerminals.push(id);
    
    assert.doesNotThrow(() => {
      resizeTerminal(id, 120, 40);
    });
  });

  it("should throw when resizing non-existent terminal", () => {
    assert.throws(
      () => resizeTerminal("non-existent-id", 80, 24),
      /Terminal .* not found/
    );
  });

  it("should kill a terminal", () => {
    const { id } = createTerminal(process.cwd());
    
    killTerminal(id);
    
    const terminal = getTerminal(id);
    assert.equal(terminal, undefined);
  });

  it("should not throw when killing non-existent terminal", () => {
    assert.doesNotThrow(() => {
      killTerminal("non-existent-id");
    });
  });

  it("should list terminal ids", () => {
    const { id: id1 } = createTerminal(process.cwd());
    const { id: id2 } = createTerminal(process.cwd());
    createdTerminals.push(id1, id2);
    
    const ids = getTerminalIds();
    assert.ok(ids.includes(id1));
    assert.ok(ids.includes(id2));
  });

  it("should kill all terminals", () => {
    createTerminal(process.cwd());
    createTerminal(process.cwd());
    
    killAllTerminals();
    
    const ids = getTerminalIds();
    assert.equal(ids.length, 0);
  });

  it("should handle multiple terminals independently", () => {
    const { id: id1 } = createTerminal(process.cwd());
    const { id: id2 } = createTerminal(process.cwd());
    createdTerminals.push(id1, id2);
    
    assert.ok(getTerminal(id1));
    assert.ok(getTerminal(id2));
    
    killTerminal(id1);
    
    assert.equal(getTerminal(id1), undefined);
    assert.ok(getTerminal(id2));
  });
});
