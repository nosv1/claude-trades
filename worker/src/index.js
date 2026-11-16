// Trade Pulse sync: saves each signed-in person's quiz progress and "make a call" guesses.
//
// Sign-in is "Sign in with Google" on the page. The page sends Google's ID token to /login; we check
// its signature against Google's public keys, then give the page our own random session token.
// Each person gets one Durable Object, named after Google's ID number for them (the "sub").
// We never store email, name or anything else from the Google token.
import { DurableObject } from 'cloudflare:workers';

const MAX_BYTES = 64 * 1024;      // progress is small; refuse anything bigger
const SESSION_DAYS = 120;
const MAX_SESSIONS = 10;          // devices signed in at once
const GOOGLE_ISS = ['accounts.google.com', 'https://accounts.google.com'];

export class User extends DurableObject {
  async newSession() {
    const id = randomId();
    const now = Date.now();
    const sessions = ((await this.ctx.storage.get('sessions')) || []).filter((s) => s.exp > now);
    sessions.push({ id, exp: now + SESSION_DAYS * 864e5 });
    await this.ctx.storage.put('sessions', sessions.slice(-MAX_SESSIONS));
    return id;
  }
  async valid(id) {
    const sessions = (await this.ctx.storage.get('sessions')) || [];
    return sessions.some((s) => s.id === id && s.exp > Date.now());
  }
  async endSession(id) {
    const sessions = (await this.ctx.storage.get('sessions')) || [];
    await this.ctx.storage.put('sessions', sessions.filter((s) => s.id !== id));
  }
  async getProgress(id) {
    if (!(await this.valid(id))) return null;
    return (await this.ctx.storage.get('progress')) || { quiz: {}, calls: [], updated: 0 };
  }
  async putProgress(id, progress) {
    if (!(await this.valid(id))) return false;
    await this.ctx.storage.put('progress', { ...progress, updated: Date.now() });
    return true;
  }
  async wipe(id) {
    if (!(await this.valid(id))) return false;
    await this.ctx.storage.deleteAll();
    return true;
  }
}

function corsHeaders(origin, ok) {
  return ok ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  } : { Vary: 'Origin' };
}

async function login(req, env, json) {
  const body = await readJSON(req);
  const sub = env.DEV_FAKE_LOGIN === '1' && body && typeof body.dev_sub === 'string'
    ? body.dev_sub // local testing only (.dev.vars)
    : await verifyGoogle(body && body.credential, env.GOOGLE_CLIENT_ID);
  if (!sub) return json({ error: 'sign-in failed' }, 401);
  const sid = await userStub(env, sub).newSession();
  return json({ token: `${sub}.${sid}` });
}

async function putProgress(req, stub, auth, json) {
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BYTES) return json({ error: 'too big' }, 413);
  let parsed;
  try { parsed = JSON.parse(text); } catch { return json({ error: 'bad data' }, 400); }
  const p = clean(parsed);
  if (!p) return json({ error: 'bad data' }, 400);
  return (await stub.putProgress(auth.sid, p)) ? json({ ok: true }) : json({ error: 'not signed in' }, 401);
}

// Routes that need a session token. Each gets (req, stub, auth, json).
const SIGNED_IN = {
  'GET /progress': async (req, stub, auth, json) => {
    const p = await stub.getProgress(auth.sid);
    return p ? json(p) : json({ error: 'not signed in' }, 401);
  },
  'PUT /progress': putProgress,
  'DELETE /progress': async (req, stub, auth, json) =>
    ((await stub.wipe(auth.sid)) ? json({ ok: true }) : json({ error: 'not signed in' }, 401)),
  'POST /logout': async (req, stub, auth, json) => {
    await stub.endSession(auth.sid);
    return json({ ok: true });
  },
};

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);
    const ok = allowed.includes(origin);
    const cors = corsHeaders(origin, ok);
    const json = (body, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors },
    });

    if (req.method === 'OPTIONS') return new Response(null, { status: ok ? 204 : 403, headers: cors });
    if (!ok) return json({ error: 'origin not allowed' }, 403);
    const route = `${req.method} ${new URL(req.url).pathname}`;

    try {
      if (route === 'POST /login') return await login(req, env, json);
      const auth = parseToken(req.headers.get('Authorization'));
      if (!auth) return json({ error: 'not signed in' }, 401);
      const handler = Object.hasOwn(SIGNED_IN, route) ? SIGNED_IN[route] : null;
      if (!handler) return json({ error: 'not found' }, 404);
      return await handler(req, userStub(env, auth.sub), auth, json);
    } catch {
      return json({ error: 'server error' }, 500); // never leak internals; the page just retries later
    }
  },
};

function userStub(env, sub) {
  return env.USERS.get(env.USERS.idFromName('google:' + sub));
}

function parseToken(h) {
  const m = /^Bearer ([0-9A-Za-z_-]{1,64})\.([0-9a-f]{32})$/.exec(h || '');
  return m ? { sub: m[1], sid: m[2] } : null;
}

function randomId() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function readJSON(req) {
  try { return await req.json(); } catch { return null; }
}

// Keep only the shapes the page writes, so the store can't be used for anything else.
function clean(p) {
  if (!p || typeof p !== 'object') return null;
  const quiz = {};
  for (const [k, v] of Object.entries(p.quiz || {}).slice(0, 200)) {
    if (!/^[a-z0-9-]{1,40}$/.test(k) || !v || typeof v !== 'object') continue;
    quiz[k] = { box: num(v.box), due: num(v.due), t: num(v.t) };
  }
  const calls = (Array.isArray(p.calls) ? p.calls : []).slice(-60).filter((c) => c && typeof c.s === 'string' && /^[a-z_]{1,20}$/.test(c.s))
    .map((c) => ({
      s: c.s, from: num(c.from), v: num(c.v), call: c.call === 'down' ? 'down' : 'up', made: num(c.made),
      ...(c.result && typeof c.result === 'object' ? { result: { v: num(c.result.v), right: !!c.result.right } } : {}),
      ...(typeof c.seen === 'boolean' ? { seen: c.seen } : {}),
    }));
  return { quiz, calls };
}
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

// ---- Google ID token check (RS256 JWT signed with Google's published keys) ----
let jwks = null, jwksAt = 0;
async function googleKeys(force = false) {
  if (!force && jwks && Date.now() - jwksAt < 3600e3) return jwks;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!r.ok) throw new Error('jwks');
  jwks = (await r.json()).keys;
  jwksAt = Date.now();
  return jwks;
}
const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function verifyGoogle(token, clientId) {
  if (typeof token !== 'string' || !clientId) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
  } catch { return null; }
  if (header.alg !== 'RS256') return null;
  // Google rotates keys: on an unknown key ID, refetch once before giving up
  let jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await googleKeys(true)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) return null;
  const now = Date.now() / 1000;
  if (!GOOGLE_ISS.includes(payload.iss) || payload.aud !== clientId || !(payload.exp > now) || !/^[0-9]{1,64}$/.test(payload.sub || '')) return null;
  return payload.sub;
}
