import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { connectRequestFrom, INITIAL_PROVIDER, PROVIDER_OPTIONS, serverFieldsFor, testedKey } from "../mail-account-form-model";

describe("mail account connect form", () => {
  it("opens on GoDaddy and lists the presets, then Custom", () => {
    assert.equal(INITIAL_PROVIDER, "godaddy");
    assert.deepEqual(
      PROVIDER_OPTIONS.map((option) => option.id),
      ["godaddy", "titan", "hostinger", "custom"],
    );
    assert.equal(PROVIDER_OPTIONS[0].label, "GoDaddy Workspace Email");
  });

  it("shows each preset's servers, and leaves Custom empty rather than borrowing Titan's", () => {
    assert.deepEqual(serverFieldsFor("godaddy"), { imapHost: "imap.secureserver.net", imapPort: "993", smtpHost: "smtpout.secureserver.net", smtpPort: "465" });
    assert.equal(serverFieldsFor("titan").smtpHost, "smtp.titan.email");
    assert.equal(serverFieldsFor("hostinger").imapHost, "imap.hostinger.com");
    assert.deepEqual(serverFieldsFor("custom"), { imapHost: "", imapPort: "993", smtpHost: "", smtpPort: "465" });
  });

  it("sends only the preset id for a preset, and all four servers for Custom", () => {
    const form = { address: " a@virtara.co.za ", password: "x", senderName: " Dylan ", provider: "godaddy" as const, servers: serverFieldsFor("titan"), confirmServers: false };
    assert.deepEqual(connectRequestFrom(form), { address: "a@virtara.co.za", password: "x", senderName: "Dylan", provider: "godaddy" });
    const custom = connectRequestFrom({
      ...form,
      senderName: "",
      provider: "custom",
      servers: { imapHost: "mail.x.co", imapPort: "993", smtpHost: "mail.x.co", smtpPort: "587" },
      confirmServers: true,
    });
    assert.deepEqual(custom, { address: "a@virtara.co.za", password: "x", provider: "custom", imapHost: "mail.x.co", imapPort: 993, smtpHost: "mail.x.co", smtpPort: 587, confirmServers: true });
  });

  it("invalidates a passed test when the provider or password changes", () => {
    const form = { address: "a@virtara.co.za", password: "x", senderName: "", provider: "godaddy" as const, servers: serverFieldsFor("godaddy"), confirmServers: false };
    assert.notEqual(testedKey(form), testedKey({ ...form, provider: "titan" }));
    assert.notEqual(testedKey(form), testedKey({ ...form, password: "y" }));
    assert.equal(testedKey(form), testedKey({ ...form }));
  });
});
