import { createPublicKey, createVerify, type JsonWebKey, type KeyObject } from "node:crypto";
import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";

const CERT_TTL_MS = 60 * 60 * 1000;
const CERT_TIMEOUT_MS = 5_000;
const CLOCK_SKEW_SEC = 60;
const MAX_TOKEN_CHARS = 16_384;
const MAX_CERT_CHARS = 1_000_000;

export type AccessOptions = {
  teamDomain?: string;
  audience?: string;
  insecureAllowUnprotected?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  cacheTtlMs?: number;
  remoteAddress?: (c: Context) => string | undefined;
  log?: (message: string) => void;
};

export type AccessDecision =
  | { allow: true }
  | { allow: false; status: 403 | 503; html: string };

type AccessMode = "off" | "ready" | "invalid";

export function normalizeTeamHost(raw: string | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;
  if (value.includes("://") || value.startsWith("//")) {
    let url: URL;
    try {
      url = new URL(value.includes("://") ? value : `https:${value}`);
    } catch {
      return null;
    }
    if (url.username || url.password || url.port) return null;
    if (url.search || url.hash) return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    value = url.hostname;
  }
  if (value.includes("/") || value.includes("@") || value.includes(":")) return null;
  value = value.toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(value)) return null;
  return value;
}

function normalizeAudience(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value || value.length > 512) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

export function inspectAccess(options: AccessOptions): {
  mode: AccessMode;
  teamHost: string | null;
  audience: string | null;
} {
  const domainRaw = options.teamDomain?.trim() ?? "";
  const audienceRaw = options.audience?.trim() ?? "";
  const teamHost = normalizeTeamHost(options.teamDomain);
  const audience = normalizeAudience(options.audience);
  if (!domainRaw && !audienceRaw) return { mode: "off", teamHost: null, audience: null };
  if (!teamHost || !audience) return { mode: "invalid", teamHost: null, audience: null };
  return { mode: "ready", teamHost, audience };
}

export function accessStartupWarning(options: AccessOptions): string | null {
  const { mode } = inspectAccess(options);
  if (options.insecureAllowUnprotected && mode === "ready") {
    return "INSECURE_ALLOW_UNPROTECTED=1 is set, but Cloudflare Access is configured, so the UI still requires a valid Access token. Remove the insecure switch.";
  }
  if (options.insecureAllowUnprotected) {
    return "WARNING: INSECURE_ALLOW_UNPROTECTED=1. Open Loops is serving the UI with no Cloudflare Access check. Do not expose this process to a network.";
  }
  if (mode === "invalid") {
    return "WARNING: CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD must both be valid before the UI will load. The team domain must look like team.cloudflareaccess.com. Until then every UI request is refused, including localhost.";
  }
  if (mode === "off") {
    return "Open Loops will refuse the UI except for loopback requests whose Host is localhost. Set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD, or INSECURE_ALLOW_UNPROTECTED=1 for local development only.";
  }
  return null;
}

function defaultRemoteAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  return normalized === "127.0.0.1" || normalized === "::1";
}

function isLoopbackHost(host: string): boolean {
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) return false;
  const name = trimmed.startsWith("[")
    ? trimmed.slice(1, trimmed.indexOf("]"))
    : trimmed.replace(/:\d+$/, "");
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}

function isLoopbackRequest(c: Context, remoteAddress: (c: Context) => string | undefined): boolean {
  if (!isLoopbackAddress(remoteAddress(c))) return false;
  const hosts: string[] = [];
  const header = c.req.header("host");
  if (header) hosts.push(header);
  try {
    hosts.push(new URL(c.req.url).host);
  } catch {
    return false;
  }
  return hosts.length > 0 && hosts.every(isLoopbackHost);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function denialPage(title: string, detail: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; background: #e7e1d4; color: #221c16; font: 16px/1.5 ui-sans-serif, system-ui, sans-serif; }
    main { max-width: 38rem; margin: 0 auto; padding: 3rem 1.25rem; }
    h1 { font-family: ui-serif, Georgia, serif; font-weight: 400; font-size: 2rem; line-height: 1.2; }
    code { font-size: 0.92em; }
    ol { padding-left: 1.2rem; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(detail)}</p>
    <p>Open Loops has no built-in login. The board stays dark unless Cloudflare Access is actually in front of it.</p>
    <ol>
      <li>Run the server and point a Cloudflare Tunnel at its port.</li>
      <li>Create a self-hosted Access application for that hostname. Copy the team domain and the application audience (AUD) tag.</li>
      <li>Set <code>CF_ACCESS_TEAM_DOMAIN</code> (for example <code>team.cloudflareaccess.com</code>) and <code>CF_ACCESS_AUD</code>, then restart.</li>
      <li>Add a Bypass policy for <code>/api</code> and <code>/healthz</code>. The assistant calls <code>/api</code> with its bearer token. Access usually should not challenge those paths.</li>
    </ol>
    <p>For local development only, set <code>INSECURE_ALLOW_UNPROTECTED=1</code>, or open the app on this machine at <code>localhost</code>. The insecure switch does not turn off a check that is already configured, and a tunnel to <code>127.0.0.1</code> is not treated as localhost when the Host header is your public name. Never set the switch on a service other people can reach.</p>
  </main>
</body>
</html>`;
}

function deny(status: 403 | 503, title: string, detail: string): AccessDecision {
  return { allow: false, status, html: denialPage(title, detail) };
}

function readJwt(c: Context): string | null {
  const header = c.req.header("cf-access-jwt-assertion")?.trim();
  if (header) return header;
  const cookie = c.req.header("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]).trim() || null;
  } catch {
    return match[1].trim() || null;
  }
}

type TokenHeader = { alg?: unknown; kid?: unknown };

function decodeJson(segment: string): unknown {
  const json = Buffer.from(segment, "base64url").toString("utf8");
  return JSON.parse(json) as unknown;
}

function tokenKid(token: string): { ok: true; kid: string; signingInput: string; signature: Buffer } | { ok: false; detail: string } {
  if (token.length > MAX_TOKEN_CHARS) return { ok: false, detail: "The Access token is not a readable JWT." };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, detail: "The Access token is not a readable JWT." };
  let header: TokenHeader;
  try {
    if (!parts[0]) return { ok: false, detail: "The Access token is not a readable JWT." };
    const parsed = decodeJson(parts[0]);
    if (!parsed || typeof parsed !== "object") return { ok: false, detail: "The Access token is not a readable JWT." };
    header = parsed as TokenHeader;
  } catch {
    return { ok: false, detail: "The Access token is not a readable JWT." };
  }
  if (header.alg !== "RS256") return { ok: false, detail: "The Access token must be signed with RS256." };
  if (!parts[1] || !parts[2]) return { ok: false, detail: "The Access token is not a readable JWT." };
  if (typeof header.kid !== "string" || !header.kid || header.kid.length > 200) {
    return { ok: false, detail: "The Access token is not a readable JWT." };
  }
  let signature: Buffer;
  try {
    signature = Buffer.from(parts[2], "base64url");
  } catch {
    return { ok: false, detail: "The Access token is not a readable JWT." };
  }
  if (signature.length === 0) return { ok: false, detail: "The Access token is not a readable JWT." };
  return { ok: true, kid: header.kid, signingInput: `${parts[0]}.${parts[1]}`, signature };
}

function audiencesOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return value as string[];
  return [];
}

function claimsError(
  payloadSegment: string,
  audience: string,
  issuer: string,
  now: Date,
): string | null {
  let payload: Record<string, unknown>;
  try {
    const parsed = decodeJson(payloadSegment);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "The Access token is not a readable JWT.";
    payload = parsed as Record<string, unknown>;
  } catch {
    return "The Access token is not a readable JWT.";
  }
  const nowSec = Math.floor(now.getTime() / 1000);
  const exp = payload.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp + CLOCK_SKEW_SEC < nowSec) {
    return "The Access token is expired. Reload the site so Cloudflare can issue a new one.";
  }
  const nbf = payload.nbf;
  if (typeof nbf === "number" && Number.isFinite(nbf) && nbf - CLOCK_SKEW_SEC > nowSec) {
    return "The Access token is not valid yet.";
  }
  const iat = payload.iat;
  if (typeof iat === "number" && Number.isFinite(iat) && iat - CLOCK_SKEW_SEC > nowSec) {
    return "The Access token is not valid yet.";
  }
  if (!audiencesOf(payload.aud).includes(audience)) {
    return "The Access token audience does not match CF_ACCESS_AUD.";
  }
  if (payload.iss !== issuer) {
    return "The Access token issuer does not match CF_ACCESS_TEAM_DOMAIN.";
  }
  return null;
}

function signatureMatches(signingInput: string, signature: Buffer, key: KeyObject): boolean {
  const verifier = createVerify("RSA-SHA256");
  verifier.update(signingInput);
  verifier.end();
  try {
    return verifier.verify(key, signature);
  } catch {
    return false;
  }
}

function keySetFromCerts(body: unknown): Map<string, KeyObject> {
  const keys = new Map<string, KeyObject>();
  if (!body || typeof body !== "object") return keys;
  const record = body as { keys?: unknown; public_certs?: unknown };
  if (Array.isArray(record.keys)) {
    for (const entry of record.keys) {
      if (!entry || typeof entry !== "object") continue;
      const jwk = entry as JsonWebKey;
      if (typeof jwk.kid !== "string" || !jwk.kid || jwk.kty !== "RSA") continue;
      try {
        keys.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" }));
      } catch {
        /* skip a key this runtime cannot import */
      }
    }
  }
  if (Array.isArray(record.public_certs)) {
    for (const entry of record.public_certs) {
      if (!entry || typeof entry !== "object") continue;
      const cert = entry as { kid?: unknown; cert?: unknown };
      if (typeof cert.kid !== "string" || !cert.kid || typeof cert.cert !== "string") continue;
      if (keys.has(cert.kid)) continue;
      try {
        keys.set(cert.kid, createPublicKey(cert.cert));
      } catch {
        /* skip */
      }
    }
  }
  return keys;
}

const INSECURE_USED =
  "WARNING: serving the UI because INSECURE_ALLOW_UNPROTECTED=1 and Cloudflare Access is not configured. Do not expose this process to a network.";
const LOOPBACK_USED =
  "WARNING: serving the UI to a loopback client without Cloudflare Access. A tunnel that connects to 127.0.0.1 still needs a valid Access token when the Host header is a public name.";

export function createAccessChecker(options: AccessOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const ttl = options.cacheTtlMs ?? CERT_TTL_MS;
  const log = options.log ?? ((message: string) => console.warn(message));
  const remoteAddress = options.remoteAddress ?? defaultRemoteAddress;
  const inspected = inspectAccess(options);
  let cache: { expiresAt: number; keys: Map<string, KeyObject> } | null = null;
  let warnedInsecure = false;
  let warnedLoopback = false;

  function warnOnce(kind: "insecure" | "loopback") {
    if (kind === "insecure") {
      if (warnedInsecure) return;
      warnedInsecure = true;
      log(INSECURE_USED);
      return;
    }
    if (warnedLoopback) return;
    warnedLoopback = true;
    log(LOOPBACK_USED);
  }

  async function loadKeys(force: boolean): Promise<Map<string, KeyObject>> {
    if (!inspected.teamHost) throw new Error("access is not configured");
    const at = now().getTime();
    if (!force && cache && cache.expiresAt > at) return cache.keys;
    const url = `https://${inspected.teamHost}/cdn-cgi/access/certs`;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(CERT_TIMEOUT_MS),
      });
    } catch (err) {
      if (cache) return cache.keys;
      const message = err instanceof Error ? err.message : "error";
      throw new Error(message);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (cache) return cache.keys;
      throw new Error(`status ${response.status}`);
    }
    const text = await response.text();
    if (text.length > MAX_CERT_CHARS) {
      if (cache) return cache.keys;
      throw new Error("certs response is too large");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      if (cache) return cache.keys;
      throw new Error("certs response was not JSON");
    }
    const keys = keySetFromCerts(parsed);
    if (keys.size === 0) {
      if (cache) return cache.keys;
      throw new Error("certs response had no usable keys");
    }
    cache = { expiresAt: at + ttl, keys };
    return keys;
  }

  async function check(c: Context): Promise<AccessDecision> {
    if (inspected.mode !== "ready" || !inspected.teamHost || !inspected.audience) {
      if (options.insecureAllowUnprotected) {
        warnOnce("insecure");
        return { allow: true };
      }
      if (inspected.mode === "off" && isLoopbackRequest(c, remoteAddress)) {
        warnOnce("loopback");
        return { allow: true };
      }
      if (inspected.mode === "invalid") {
        return deny(
          503,
          "Cloudflare Access is not configured correctly",
          "Set both CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD. The team domain must look like team.cloudflareaccess.com, with no path, port, or other host.",
        );
      }
      return deny(
        503,
        "This board is closed until Cloudflare Access is in front of it",
        "This request is not from localhost on this machine, and CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are not set.",
      );
    }

    const token = readJwt(c);
    if (!token) {
      return deny(
        403,
        "Cloudflare Access did not vouch for this request",
        "The Cf-Access-Jwt-Assertion header (or CF_Authorization cookie) is missing. Open the site through your Access hostname.",
      );
    }
    const parsed = tokenKid(token);
    if (!parsed.ok) {
      return deny(403, "Cloudflare Access rejected this request", parsed.detail);
    }
    let keys: Map<string, KeyObject>;
    try {
      keys = await loadKeys(false);
      if (!keys.has(parsed.kid)) keys = await loadKeys(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "error";
      console.error(`cloudflare access certs unavailable: ${message}`);
      return deny(
        503,
        "Cloudflare Access keys could not be loaded",
        "Open Loops could not download this team's signing keys, so it is refusing the board instead of skipping the check. Confirm CF_ACCESS_TEAM_DOMAIN and that this server can reach the team's /cdn-cgi/access/certs endpoint.",
      );
    }
    const key = keys.get(parsed.kid);
    if (!key) {
      return deny(
        403,
        "Cloudflare Access rejected this request",
        "The Access token was signed by a key this team does not publish.",
      );
    }
    if (!signatureMatches(parsed.signingInput, parsed.signature, key)) {
      return deny(
        403,
        "Cloudflare Access rejected this request",
        "The Access token signature does not match the team's published keys.",
      );
    }
    const payloadSegment = parsed.signingInput.split(".")[1] ?? "";
    const claim = claimsError(payloadSegment, inspected.audience, `https://${inspected.teamHost}`, now());
    if (claim) return deny(403, "Cloudflare Access rejected this request", claim);
    return { allow: true };
  }

  return { check };
}
