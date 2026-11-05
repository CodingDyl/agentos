import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { ImapFlow } from "imapflow";

// Never a real mailbox: the IMAP client is a fake that records where it would connect.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-reply-watch-host-"));
process.env.AGENTOS_UI_DIR = directory;

const store = await import("../../traction/store");
const credentials = await import("../../mail/titan-credentials");
const { closeTitanConnection, setImapClientFactoryForTests } = await import("../../mail/titan-client");
const { checkTitanReplies } = await import("../titan-replies");
const { MailConnectRequestSchema } = await import("../../../shared/mail-account-types");
const { ProspectInputSchema } = await import("../../../shared/traction-types");

after(() => {
  setImapClientFactoryForTests(undefined);
  closeTitanConnection();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("Traction reply watch", () => {
  it("searches the stored IMAP host (GoDaddy), over TLS, never Titan's", async () => {
    await credentials.saveTitanCredentials(MailConnectRequestSchema.parse({ address: "dylanpetzer@virtara.co.za", password: "pw-secret", provider: "godaddy" }));
    const prospect = await store.createProspect(ProspectInputSchema.parse({ company: "Parkview", email: "jane@parkview.example" }));
    await store.recordManualSend({ prospectId: prospect.id, subject: "Your site", body: "Hi" });

    const seen: { host: string; port: number; secure?: boolean; rejectUnauthorized?: boolean }[] = [];
    setImapClientFactoryForTests((options) => {
      seen.push({ host: options.host, port: options.port, secure: options.secure, rejectUnauthorized: options.tls?.rejectUnauthorized });
      const fake = {
        usable: false,
        on: () => fake,
        connect: async () => {
          throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        },
        close: () => undefined,
        logout: async () => undefined,
      };
      return fake as unknown as ImapFlow;
    });

    const status = await checkTitanReplies();
    assert.equal(status.connected, true);
    assert.deepEqual(seen, [{ host: "imap.secureserver.net", port: 993, secure: true, rejectUnauthorized: true }]);
    assert.match(status.lastError ?? "", /GoDaddy Workspace Email/);
    assert.doesNotMatch(JSON.stringify(status), /pw-secret/);
  });
});
