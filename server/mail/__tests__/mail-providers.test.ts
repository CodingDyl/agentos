import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, describe, it } from "node:test";

// Never a real mailbox or DNS server: every network call here is a fake, and the state directory is temporary.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-mail-providers-"));
process.env.AGENTOS_UI_DIR = directory;

const shared = await import("../../../shared/mail-account-types");
const { MAIL_PRESETS, MailConnectRequestSchema, mailServersProblem, providerOfHost } = shared;
const credentials = await import("../titan-credentials");
const { describeTitanError, NO_MAILBOX_MESSAGE, TitanError } = await import("../titan-client");
const { sendTitanRaw, smtpOptions, verifySmtpLogin } = await import("../titan-smtp");
const { assertPublicMailHost, detectMailProvider, isPrivateAddress, testMailConnection } = await import("../mail-connection");
const { sendViaVirtara } = await import("../../outreach/virtara");

const accountFile = path.join(directory, "titan-mail.json");
const GODADDY = { address: "dylanpetzer@virtara.co.za", password: "pw-secret", provider: "godaddy" } as const;

afterEach(async () => {
  await credentials.forgetTitanCredentials();
});

after(() => fs.rmSync(directory, { recursive: true, force: true }));

/** A fake nodemailer transport that records where the password would have gone. */
function recordingTransport(seen: { host: string; port: number; secure: boolean; requireTLS: boolean; rejectUnauthorized: boolean }[], fail?: unknown) {
  return (options: ReturnType<typeof smtpOptions>) => {
    seen.push({ host: options.host, port: options.port, secure: options.secure, requireTLS: options.requireTLS, rejectUnauthorized: options.tls.rejectUnauthorized });
    return {
      sendMail: async () => {
        if (fail) throw fail;
        return {};
      },
      verify: async () => {
        if (fail) throw fail;
        return true;
      },
      close: () => undefined,
    };
  };
}

/** Writes a link file the way an older AgentOS did: no provider. */
async function writeLegacyLink(servers: { imapHost: string; smtpHost: string }) {
  await credentials.saveTitanCredentials(MailConnectRequestSchema.parse({ address: GODADDY.address, password: "pw-secret", provider: "titan" }));
  const stored = JSON.parse(fs.readFileSync(accountFile, "utf8")) as Record<string, unknown>;
  delete stored.provider;
  fs.writeFileSync(accountFile, JSON.stringify({ ...stored, ...servers, imapPort: 993, smtpPort: 465 }));
}

describe("provider presets", () => {
  it("has GoDaddy, Titan and Hostinger on TLS ports", () => {
    assert.deepEqual(
      { imapHost: MAIL_PRESETS.godaddy.imapHost, imapPort: MAIL_PRESETS.godaddy.imapPort, smtpHost: MAIL_PRESETS.godaddy.smtpHost, smtpPort: MAIL_PRESETS.godaddy.smtpPort },
      { imapHost: "imap.secureserver.net", imapPort: 993, smtpHost: "smtpout.secureserver.net", smtpPort: 465 },
    );
    assert.equal(MAIL_PRESETS.titan.imapHost, "imap.titan.email");
    assert.equal(MAIL_PRESETS.titan.smtpHost, "smtp.titan.email");
    assert.equal(MAIL_PRESETS.hostinger.imapHost, "imap.hostinger.com");
    assert.equal(MAIL_PRESETS.hostinger.smtpHost, "smtp.hostinger.com");
    assert.equal(shared.DEFAULT_MAIL_PROVIDER, "godaddy");
  });

  it("fills a preset's own servers", () => {
    const parsed = MailConnectRequestSchema.parse(GODADDY);
    assert.equal(parsed.imapHost, "imap.secureserver.net");
    assert.equal(parsed.smtpHost, "smtpout.secureserver.net");
    assert.equal(MailConnectRequestSchema.parse({ ...GODADDY, provider: "hostinger" }).smtpHost, "smtp.hostinger.com");
  });

  it("knows which provider a host belongs to", () => {
    assert.equal(providerOfHost("smtp.secureserver.net"), "godaddy");
    assert.equal(providerOfHost("mailstore1.secureserver.net."), "godaddy");
    assert.equal(providerOfHost("SMTP.Titan.Email"), "titan");
    assert.equal(providerOfHost("notsecureserver.net"), undefined);
    assert.equal(providerOfHost("mail.example.com"), undefined);
  });
});

describe("server consistency guard", () => {
  it("refuses a preset with another provider's SMTP host, and never fills SMTP from Titan for a GoDaddy IMAP host", () => {
    assert.equal(MailConnectRequestSchema.safeParse({ ...GODADDY, smtpHost: "smtp.titan.email" }).success, false);
    // The old form's request: only the IMAP host changed. There is no Titan fallback any more.
    assert.equal(MailConnectRequestSchema.safeParse({ address: GODADDY.address, password: "x", imapHost: "imap.secureserver.net" }).success, false);
    assert.equal(MailConnectRequestSchema.safeParse({ address: GODADDY.address, password: "x", provider: "titan", imapHost: "imap.secureserver.net" }).success, false);
    // Custom must name SMTP; it is never defaulted.
    assert.equal(MailConnectRequestSchema.safeParse({ address: GODADDY.address, password: "x", provider: "custom", imapHost: "imap.secureserver.net", imapPort: 993 }).success, false);
  });

  it("never lets SMTP on a known provider go with IMAP elsewhere, even when confirmed", () => {
    const servers = { imapHost: "imap.secureserver.net", imapPort: 993, smtpHost: "smtp.titan.email", smtpPort: 465 };
    assert.match(mailServersProblem("custom", servers, true) ?? "", /belongs to Titan/);
    assert.equal(MailConnectRequestSchema.safeParse({ address: GODADDY.address, password: "x", provider: "custom", ...servers, confirmServers: true }).success, false);
  });

  it("lets Custom with unknown hosts through only when confirmed", () => {
    const servers = { imapHost: "mail.example.com", imapPort: 993, smtpHost: "smtp.example.net", smtpPort: 587 };
    assert.match(mailServersProblem("custom", servers) ?? "", /Confirm/);
    assert.equal(mailServersProblem("custom", servers, true), undefined);
    assert.equal(mailServersProblem("custom", { ...servers, imapHost: "imap.secureserver.net", smtpHost: "smtpout.secureserver.net" }), undefined, "one known provider on both sides needs no confirmation");
  });

  it("requires TLS ports and refuses IP literals and local names", () => {
    const base = { address: GODADDY.address, password: "x", provider: "custom", confirmServers: true, imapPort: 993, smtpPort: 465 };
    assert.equal(MailConnectRequestSchema.safeParse({ ...base, imapHost: "mail.x.co", smtpHost: "mail.x.co", imapPort: 143 }).success, false);
    assert.equal(MailConnectRequestSchema.safeParse({ ...base, imapHost: "mail.x.co", smtpHost: "mail.x.co", smtpPort: 25 }).success, false);
    assert.equal(MailConnectRequestSchema.safeParse({ ...base, imapHost: "127.0.0.1", smtpHost: "mail.x.co" }).success, false);
    assert.equal(MailConnectRequestSchema.safeParse({ ...base, imapHost: "10.0.0.5", smtpHost: "mail.x.co" }).success, false);
    assert.equal(MailConnectRequestSchema.safeParse({ ...base, imapHost: "localhost", smtpHost: "mail.x.co" }).success, false);
    assert.equal(MailConnectRequestSchema.safeParse({ ...base, imapHost: "mail.localhost", smtpHost: "mail.x.co" }).success, false);
    assert.equal(MailConnectRequestSchema.safeParse({ ...base, imapHost: "mail.x.co", smtpHost: "mail.x.co", extra: 1 }).success, false, "unknown fields are refused");
  });

  it("a GoDaddy-IMAP account can never send to smtp.titan.email", async () => {
    // A link saved by the old form: GoDaddy IMAP, Titan's SMTP default.
    await writeLegacyLink({ imapHost: "imap.secureserver.net", smtpHost: "smtp.titan.email" });
    const seen: Parameters<typeof recordingTransport>[0] = [];
    await assert.rejects(sendTitanRaw("raw", { from: GODADDY.address, to: ["x@y.co"] }, recordingTransport(seen)), (error: unknown) => {
      assert.ok(error instanceof TitanError);
      assert.equal(error.reason, "not-connected");
      assert.doesNotMatch(error.message, /pw-secret/);
      return true;
    });
    await assert.rejects(credentials.readTitanCredentials(), /link it again/);
    assert.equal(seen.length, 0, "no transport was even created");
    assert.match((await credentials.titanAccount())?.problem ?? "", /Unlink it and link it again/);

    // And directly: the options builder refuses it whatever the stored provider says.
    for (const provider of ["godaddy", "custom", "titan"] as const) {
      assert.throws(
        () => smtpOptions({ address: GODADDY.address, password: "pw", provider, confirmServers: true, imapHost: "imap.secureserver.net", imapPort: 993, smtpHost: "smtp.titan.email", smtpPort: 465 }),
        TitanError,
      );
    }
    // Even a hand-edited file claiming the Titan preset is refused.
    const stored = JSON.parse(fs.readFileSync(accountFile, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(accountFile, JSON.stringify({ ...stored, provider: "titan" }));
    await assert.rejects(sendTitanRaw("raw", { from: GODADDY.address, to: ["x@y.co"] }, recordingTransport(seen)), TitanError);
    assert.equal(seen.length, 0);
  });
});

describe("migrating links saved before providers", () => {
  it("keeps an existing Titan link working, as the Titan preset", async () => {
    await writeLegacyLink({ imapHost: "imap.titan.email", smtpHost: "smtp.titan.email" });
    const account = await credentials.titanAccount();
    assert.equal(account?.provider, "titan");
    assert.equal(account?.problem, undefined);
    assert.equal((await credentials.readTitanCredentials())?.password, "pw-secret");
    assert.equal((JSON.parse(fs.readFileSync(accountFile, "utf8")) as { provider?: string }).provider, "titan", "written back once");
    if (process.platform !== "win32") assert.equal(fs.statSync(accountFile).mode & 0o777, 0o600);
  });

  it("leaves anything else unmigrated and refused until linked again", async () => {
    await writeLegacyLink({ imapHost: "imap.secureserver.net", smtpHost: "smtpout.secureserver.net" });
    assert.ok((await credentials.titanAccount())?.problem);
    await assert.rejects(credentials.readTitanCredentials());
  });
});

describe("saving a link", () => {
  it("stores the preset and both servers, and refuses an inconsistent one", async () => {
    await credentials.saveTitanCredentials(MailConnectRequestSchema.parse(GODADDY));
    const stored = JSON.parse(fs.readFileSync(accountFile, "utf8")) as Record<string, unknown>;
    assert.equal(stored.provider, "godaddy");
    assert.equal(stored.imapHost, "imap.secureserver.net");
    assert.equal(stored.smtpHost, "smtpout.secureserver.net");
    assert.equal(stored.smtpPort, 465);
    assert.equal(JSON.stringify(stored).includes("pw-secret"), false);
    await assert.rejects(
      credentials.saveTitanCredentials({ ...MailConnectRequestSchema.parse(GODADDY), smtpHost: "smtp.titan.email" }),
      credentials.TitanCredentialsError,
    );
  });
});

describe("error messages", () => {
  it("maps AccountNotFound to 'no mailbox here', without Titan's other-apps or 2FA advice", () => {
    const error = describeTitanError(
      Object.assign(new Error("Command failed"), { authenticationFailed: true, serverResponseCode: "AUTHENTICATIONFAILED", response: "Authentication failed: AccountNotFound" }),
      "titan",
    );
    assert.equal(error.reason, "no-mailbox");
    assert.ok(error.message.startsWith(NO_MAILBOX_MESSAGE));
    assert.match(error.message, /virtara\.co\.za uses GoDaddy/);
    assert.doesNotMatch(error.message, /other apps|two-factor/i);
  });

  it("gives Titan's advice only for a wrong password on Titan", () => {
    const refused = Object.assign(new Error("Command failed"), { authenticationFailed: true });
    assert.match(describeTitanError(refused, "titan").message, /Enable Titan on other apps/);
    const godaddy = describeTitanError(refused, "godaddy");
    assert.equal(godaddy.reason, "unauthorized");
    assert.match(godaddy.message, /GoDaddy Workspace Email mail server refused the login/);
    assert.doesNotMatch(godaddy.message, /Titan|two-factor/);
    assert.doesNotMatch(describeTitanError(refused).message, /Titan/);
  });
});

describe("connection test", () => {
  const publicLookup = async () => [{ address: "203.0.113.10" }];
  const input = MailConnectRequestSchema.parse(GODADDY);

  it("passes when IMAP and SMTP both sign in, without sending anything", async () => {
    const seenImap: string[] = [];
    const seenSmtp: Parameters<typeof recordingTransport>[0] = [];
    const outcome = await testMailConnection(input, {
      lookup: publicLookup,
      imap: async (login) => {
        seenImap.push(`${login.imapHost}:${login.imapPort}`);
        return {};
      },
      smtp: (login) => verifySmtpLogin(login, recordingTransport(seenSmtp)),
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.imap.ok, true);
    assert.equal(outcome.smtp.ok, true);
    assert.match(outcome.smtp.message, /No email was sent/);
    assert.deepEqual(seenImap, ["imap.secureserver.net:993"]);
    assert.deepEqual(seenSmtp, [{ host: "smtpout.secureserver.net", port: 465, secure: true, requireTLS: true, rejectUnauthorized: true }]);
  });

  it("reports each side separately and adds the MX hint for 'no mailbox here'", async () => {
    const titanInput = MailConnectRequestSchema.parse({ ...GODADDY, provider: "titan" });
    const outcome = await testMailConnection(titanInput, {
      lookup: publicLookup,
      resolveMx: async () => [
        { exchange: "smtp.secureserver.net", priority: 0 },
        { exchange: "mailstore1.secureserver.net", priority: 10 },
      ],
      imap: async () => {
        throw describeTitanError(Object.assign(new Error("x"), { authenticationFailed: true, response: "AccountNotFound" }), "titan");
      },
      smtp: async () => undefined,
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.imap.ok, false);
    assert.equal(outcome.smtp.ok, true);
    assert.match(outcome.imap.message, /no mailbox for that address/);
    assert.match(outcome.imap.message, /virtara\.co\.za's mail \(MX\) is handled by GoDaddy Workspace Email/);
  });

  it("fails SMTP on a refused login and never passes the password back", async () => {
    const outcome = await testMailConnection(input, {
      lookup: publicLookup,
      imap: async () => ({}),
      smtp: (login) => verifySmtpLogin(login, recordingTransport([], Object.assign(new Error("Invalid login"), { code: "EAUTH", responseCode: 535 }))),
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.imap.ok, true);
    assert.equal(outcome.smtp.ok, false);
    assert.match(outcome.smtp.message, /GoDaddy Workspace Email refused the login for sending/);
    assert.doesNotMatch(JSON.stringify(outcome), /pw-secret/);
  });

  it("refuses a host that resolves to a private address before signing in", async () => {
    let signedIn = false;
    const outcome = await testMailConnection(input, {
      lookup: async () => [{ address: "127.0.0.1" }],
      imap: async () => {
        signedIn = true;
        return {};
      },
      smtp: async () => {
        signedIn = true;
      },
    });
    assert.equal(outcome.ok, false);
    assert.equal(signedIn, false);
    assert.match(outcome.imap.message, /private or local address/);
    await assert.rejects(assertPublicMailHost("x.example", async () => [{ address: "203.0.113.1" }, { address: "::ffff:192.168.1.2" }]));
    await assert.doesNotReject(assertPublicMailHost("x.example", async () => [{ address: "203.0.113.1" }]));
  });

  it("classifies private addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.1.1", "100.64.0.1", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "not-an-ip"]) {
      assert.equal(isPrivateAddress(address), true, address);
    }
    for (const address of ["203.0.113.10", "8.8.8.8", "172.32.0.1", "2001:4860:4860::8888"]) {
      assert.equal(isPrivateAddress(address), false, address);
    }
  });
});

describe("MX detection", () => {
  it("names the provider from the lowest-priority MX, and is unknown on failure", async () => {
    assert.deepEqual(
      await detectMailProvider("dylanpetzer@virtara.co.za", async () => [
        { exchange: "mailstore1.secureserver.net", priority: 10 },
        { exchange: "smtp.secureserver.net", priority: 0 },
      ]),
      { domain: "virtara.co.za", provider: "godaddy", mx: "smtp.secureserver.net" },
    );
    assert.deepEqual(await detectMailProvider("a@b.co", async () => [{ exchange: "mx.example.org", priority: 1 }]), { domain: "b.co", mx: "mx.example.org" });
    assert.deepEqual(
      await detectMailProvider("a@b.co", async () => {
        throw new Error("timeout");
      }),
      { domain: "b.co" },
    );
  });
});

describe("Outreach sends through the stored SMTP host", () => {
  it("a GoDaddy link sends via smtpout.secureserver.net, never Titan", async () => {
    await credentials.saveTitanCredentials(MailConnectRequestSchema.parse(GODADDY));
    const seen: Parameters<typeof recordingTransport>[0] = [];
    await sendViaVirtara(
      { to: "jane@parkview.example", subject: "Hi", body: "Hello", from: { address: GODADDY.address } },
      { send: (raw, envelope) => sendTitanRaw(raw, envelope, recordingTransport(seen)), appendSent: async () => undefined, now: () => new Date("2026-11-05T10:00:00Z") },
    );
    assert.deepEqual(seen, [{ host: "smtpout.secureserver.net", port: 465, secure: true, requireTLS: true, rejectUnauthorized: true }]);
  });

  it("587 must upgrade with STARTTLS", () => {
    const options = smtpOptions({ address: "a@x.co", password: "p", provider: "custom", confirmServers: true, imapHost: "mail.x.co", imapPort: 993, smtpHost: "mail.x.co", smtpPort: 587 });
    assert.equal(options.secure, false);
    assert.equal(options.requireTLS, true);
    assert.equal(options.tls.rejectUnauthorized, true);
  });
});
