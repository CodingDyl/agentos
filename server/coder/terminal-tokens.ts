import { randomBytes } from "node:crypto";

const tokens = new Map<string, { terminalId: string; expiresAt: number }>();

const TOKEN_EXPIRY_MS = 60000; // 1 minute

export function generateTerminalToken(terminalId: string): string {
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + TOKEN_EXPIRY_MS;
  
  tokens.set(token, { terminalId, expiresAt });
  
  setTimeout(() => {
    tokens.delete(token);
  }, TOKEN_EXPIRY_MS);
  
  return token;
}

export function validateTerminalToken(token: string): string | null {
  const entry = tokens.get(token);
  
  if (!entry) {
    return null;
  }
  
  if (Date.now() > entry.expiresAt) {
    tokens.delete(token);
    return null;
  }
  
  tokens.delete(token);
  return entry.terminalId;
}

export function clearAllTokens(): void {
  tokens.clear();
}
