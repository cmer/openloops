import { createSign, generateKeyPairSync, type JsonWebKey } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accessStartupWarning, normalizeTeamHost } from "../server/access.js";
import { createApp } from "../server/app.js";
import { openDatabase, type DB } from "../server/db.js";

const TOKEN = "test-token";
const TEAM = "example.cloudflareaccess.com";
const AUD = "audience-tag";
const ISSUER = `https://${TEAM}`;

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
const pem = publicKey.export({ type: "spki", format: "pem" }).toString();

let dir = "";
let db: DB;
let clock = new Date("2026-06-01T12:00:00.000Z");

function signJwt(
  payload: Record<string, unknown>,
  opts: { kid?: string; alg?: string; key?: typeof privateKey } = {},
): string {
  const header = Buffer.from(JSON.stringify({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "k1", typ: "JWT" })).toString(
    "base64url",
  );
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${header}.${body}`;
  if (opts.alg === "none") return `${data}.`;
  const signer = createSign("RSA-SHA256");
  signer.update(data);
  signer.end();
  return `${data}.${signer.sign(opts.key ?? privateKey).toString("base64url")}`;
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const nowSec = Math.floor(clock.getTime() / 1000);
  return {
    iss: ISSUER,
    aud: AUD,
    exp: nowSec + 3600,
    nbf: nowSec,
    iat: nowSec,
    sub: "person-1",
    ...overrides,
  };
}

function certResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function jwkSet(kids: string[]): { keys: JsonWebKey[] } {
  return { keys: kids.map((kid) => ({ ...jwk, kid, alg: "RS256", use: "sig" })) };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loops-access-"));
  db = openDatabase(join(dir, "test.db"));
  clock = new Date("2026-06-01T12:00:00.000Z");
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function appFor(access: Parameters<typeof createApp>[0]["access"]) {
  return createApp({
    db,
    apiToken: TOKEN,
    access: { now: () => clock, remoteAddress: () => "203.0.113.8", log: () => {}, ...access },
  });
}

describe("team domain", () => {
  it("accepts a cloudflare access host and rejects anything else", () => {
    expect(normalizeTeamHost(" example.cloudflareaccess.com ")).toBe(TEAM);
    expect(normalizeTeamHost("https://Example.CloudflareAccess.com/")).toBe(TEAM);
    expect(normalizeTeamHost("my-team.cloudflareaccess.com.")).toBe("my-team.cloudflareaccess.com");
    expect(normalizeTeamHost("a.cloudflareaccess.com")).toBe("a.cloudflareaccess.com");
    expect(normalizeTeamHost("https://evil.example/cdn-cgi/access/certs")).toBeNull();
    expect(normalizeTeamHost("https://169.254.169.254/")).toBeNull();
    expect(normalizeTeamHost("https://user:pass@example.cloudflareaccess.com")).toBeNull();
    expect(normalizeTeamHost("https://example.cloudflareaccess.com/cdn-cgi/access/certs")).toBeNull();
    expect(normalizeTeamHost("example.cloudflareaccess.com:443")).toBeNull();
    expect(normalizeTeamHost("cloudflareaccess.com")).toBeNull();
    expect(normalizeTeamHost("example.cloudflareaccess.com.evil.test")).toBeNull();
  });
});

describe("startup warning", () => {
  it("describes each mode without repeating secret values", () => {
    expect(accessStartupWarning({})).toMatch(/loopback/i);
    expect(accessStartupWarning({ insecureAllowUnprotected: true })).toMatch(/INSECURE_ALLOW_UNPROTECTED=1/);
    expect(accessStartupWarning({ teamDomain: "evil.example", audience: AUD })).toMatch(/not usable|must both be valid/i);
    expect(accessStartupWarning({ teamDomain: TEAM, audience: AUD })).toBeNull();
    const ignored = accessStartupWarning({ teamDomain: TEAM, audience: AUD, insecureAllowUnprotected: true });
    expect(ignored).toMatch(/still requires a valid Access token/);
    expect(ignored).not.toContain(AUD);
  });
});

describe("ui protection", () => {
  it("refuses the UI and still serves healthz and the bearer API", async () => {
    const fetchImpl = vi.fn();
    const app = appFor({ fetchImpl });
    const denied = await app.request("http://loops.example/");
    expect(denied.status).toBe(503);
    expect(denied.headers.get("content-type")).toContain("text/html");
    expect(denied.headers.get("cache-control")).toBe("no-store");
    const page = await denied.text();
    expect(page).toContain("CF_ACCESS_TEAM_DOMAIN");
    expect(page).toContain("INSECURE_ALLOW_UNPROTECTED=1");
    expect(page).toContain("Cloudflare Access");

    expect((await app.request("http://loops.example/hq/board")).status).toBe(503);
    expect((await app.request("http://loops.example/healthz")).status).toBe(200);
    expect((await app.request("http://loops.example/api/items")).status).toBe(401);
    const authed = await app.request("http://loops.example/api/items", {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(authed.status).toBe(200);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("allows a loopback request to localhost and rejects a public host or a docker bridge", async () => {
    const log = vi.fn();
    const local = appFor({ remoteAddress: () => "127.0.0.1", log });
    expect((await local.request("http://localhost/hq/board")).status).toBe(200);
    expect((await local.request("http://127.0.0.1:4732/hq/board")).status).toBe(200);
    expect((await local.request("http://loops.example/hq/board")).status).toBe(503);
    const spoofed = await local.request("http://loops.example/hq/board", { headers: { host: "localhost" } });
    expect(spoofed.status).toBe(503);
    expect(log).toHaveBeenCalledTimes(1);

    const mappedLocal = appFor({ remoteAddress: () => "::ffff:127.0.0.1" });
    expect((await mappedLocal.request("http://127.0.0.1/hq/board")).status).toBe(200);
    const mappedPublic = appFor({ remoteAddress: () => "::ffff:203.0.113.8" });
    expect((await mappedPublic.request("http://[::1]/hq/board")).status).toBe(503);
    const realV6 = appFor({ remoteAddress: () => "::1" });
    expect((await realV6.request("http://[::1]/hq/board")).status).toBe(200);

    const bridge = appFor({ remoteAddress: () => "172.18.0.1" });
    expect((await bridge.request("http://localhost:4732/hq/board")).status).toBe(503);
  });

  it("lets the insecure switch open the UI only when Access is not configured", async () => {
    const log = vi.fn();
    const open = appFor({ insecureAllowUnprotected: true, remoteAddress: () => "203.0.113.9", log });
    expect((await open.request("http://loops.example/hq/board")).status).toBe(200);
    expect((await open.request("http://loops.example/hq/board")).status).toBe(200);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).toMatch(/INSECURE_ALLOW_UNPROTECTED/);

    const configured = appFor({
      teamDomain: TEAM,
      audience: AUD,
      insecureAllowUnprotected: true,
      fetchImpl: vi.fn(async () => certResponse(jwkSet(["k1"]))),
    });
    const blocked = await configured.request("http://loops.example/hq/board");
    expect(blocked.status).toBe(403);
  });

  it("refuses a broken team domain without fetching, including from localhost", async () => {
    const fetchImpl = vi.fn();
    const app = appFor({
      teamDomain: "https://169.254.169.254/",
      audience: AUD,
      fetchImpl,
      remoteAddress: () => "127.0.0.1",
    });
    const res = await app.request("http://localhost/hq/board");
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("team.cloudflareaccess.com");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts a signed Access token and rejects a bad one", async () => {
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(String(input)).toBe(`https://${TEAM}/cdn-cgi/access/certs`);
      expect(init?.redirect).toBe("error");
      return certResponse(jwkSet(["k1"]));
    });
    const app = appFor({ teamDomain: `https://${TEAM}/`, audience: ` ${AUD} `, fetchImpl });
    const token = signJwt(claims());
    const ok = await app.request("http://loops.example/hq/board", {
      headers: { "cf-access-jwt-assertion": token },
    });
    expect(ok.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const again = await app.request("http://loops.example/hq/items/1", {
      headers: { "cf-access-jwt-assertion": token },
    });
    expect(again.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const listed = await app.request("http://loops.example/hq/board", {
      headers: { "cf-access-jwt-assertion": signJwt(claims({ aud: [AUD, "other-app"] })) },
    });
    expect(listed.status).toBe(200);

    const missing = await app.request("http://loops.example/hq/board");
    expect(missing.status).toBe(403);
    expect(await missing.text()).toContain("Cf-Access-Jwt-Assertion");

    const cookie = await app.request("http://loops.example/hq/message", {
      method: "POST",
      headers: {
        cookie: `other=1; CF_Authorization=${encodeURIComponent(token)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: "hi" }),
    });
    expect(cookie.status).toBe(200);

    const marker = "super-secret-token-marker";
    const junk = await app.request("http://loops.example/hq/board", {
      headers: { "cf-access-jwt-assertion": marker },
    });
    const junkBody = await junk.text();
    expect(junk.status).toBe(403);
    expect(junkBody).not.toContain(marker);

    const none = await app.request("http://loops.example/hq/board", {
      headers: { "cf-access-jwt-assertion": signJwt(claims(), { alg: "none" }) },
    });
    expect(none.status).toBe(403);
    expect(await none.text()).toContain("RS256");

    const forged = await app.request("http://loops.example/hq/board", {
      headers: { "cf-access-jwt-assertion": signJwt(claims(), { key: other.privateKey }) },
    });
    expect(forged.status).toBe(403);
    expect(await forged.text()).toContain("signature");

    const audience = await app.request("http://loops.example/hq/board", {
      headers: { "cf-access-jwt-assertion": signJwt(claims({ aud: "someone-else" })) },
    });
    expect(audience.status).toBe(403);
    expect(await audience.text()).toContain("CF_ACCESS_AUD");

    const issuer = await app.request("http://loops.example/hq/board", {
      headers: { "cf-access-jwt-assertion": signJwt(claims({ iss: "https://other.cloudflareaccess.com" })) },
    });
    expect(issuer.status).toBe(403);
    expect(await issuer.text()).toContain("CF_ACCESS_TEAM_DOMAIN");

    const expired = await app.request("http://loops.example/hq/board", {
      headers: { "cf-access-jwt-assertion": signJwt(claims({ exp: Math.floor(clock.getTime() / 1000) - 120 })) },
    });
    expect(expired.status).toBe(403);
    expect(await expired.text()).toContain("expired");

    const api = await app.request("http://loops.example/api/items", {
      headers: { "cf-access-jwt-assertion": token },
    });
    expect(api.status).toBe(401);
  });

  it("refetches when the key id is new, caches until the ttl, and fails closed if certs never load", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return certResponse(jwkSet([calls === 1 ? "old" : "k1"]));
    });
    const app = appFor({ teamDomain: TEAM, audience: AUD, fetchImpl, cacheTtlMs: 60_000 });
    const ok = await app.request("http://loops.example/hq/board", {
      headers: { "cf-access-jwt-assertion": signJwt(claims()) },
    });
    expect(ok.status).toBe(200);
    expect(calls).toBe(2);

    clock = new Date(clock.getTime() + 30_000);
    await app.request("http://loops.example/hq/board", {
      headers: { "cf-access-jwt-assertion": signJwt(claims()) },
    });
    expect(calls).toBe(2);

    clock = new Date(clock.getTime() + 120_000);
    await app.request("http://loops.example/hq/board", {
      headers: { "cf-access-jwt-assertion": signJwt(claims()) },
    });
    expect(calls).toBe(3);

    const unknown = appFor({
      teamDomain: TEAM,
      audience: AUD,
      fetchImpl: async () => certResponse(jwkSet(["other"])),
    });
    const rejected = await unknown.request("http://loops.example/hq/board", {
      headers: { "cf-access-jwt-assertion": signJwt(claims(), { kid: "missing" }) },
    });
    expect(rejected.status).toBe(403);
    expect(await rejected.text()).toContain("does not publish");

    const down = appFor({
      teamDomain: TEAM,
      audience: AUD,
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });
    const unavailable = await down.request("http://loops.example/hq/board", {
      headers: { "cf-access-jwt-assertion": signJwt(claims()) },
    });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).toContain("signing keys");
    expect((await down.request("http://loops.example/healthz")).status).toBe(200);
  });

  it("accepts a PEM public key from public_certs", async () => {
    const app = appFor({
      teamDomain: TEAM,
      audience: AUD,
      fetchImpl: async () => certResponse({ keys: [], public_certs: [{ kid: "pem1", cert: pem }] }),
    });
    const res = await app.request("http://loops.example/hq/board", {
      headers: { "cf-access-jwt-assertion": signJwt(claims(), { kid: "pem1" }) },
    });
    expect(res.status).toBe(200);
  });

  it("publishes a trimmed assistant name", async () => {
    const named = createApp({
      db,
      apiToken: TOKEN,
      assistantName: "  Helper\n",
      access: { remoteAddress: () => "127.0.0.1", log: () => {} },
    });
    const board = (await (await named.request("http://localhost/hq/board")).json()) as { assistant_name: string };
    expect(board.assistant_name).toBe("Helper");

    const blank = createApp({
      db,
      apiToken: TOKEN,
      assistantName: "   ",
      access: { remoteAddress: () => "127.0.0.1", log: () => {} },
    });
    const fallback = (await (await blank.request("http://localhost/hq/board")).json()) as { assistant_name: string };
    expect(fallback.assistant_name).toBe("Assistant");
  });
});
