// Single-user auth gate for the ai-os dashboard bridge.
//
// Why this exists: ai-os running in Codespaces is implicitly gated by GitHub
// (your forwarded-port URL only opens for accounts with repo access). ai-os
// running on a public-internet VM (Oracle / home server / Tailscale public
// node) has no such gate — the bridge URL is just an HTTP server and would
// happily run AI commands for anyone who finds it. This module adds a
// password-gate and a cookie session.
//
// Single-user model: ONE username + ONE bcrypt-hashed password from env.
// Each fork (per-owner deployment) sets these in its own dotfiles.
//
// Auth is ENFORCED only when:
//   - AIOS_AUTH_USER and AIOS_AUTH_PASSWORD_HASH are both set
//   - AND we're not running in Codespaces (CODESPACES env != "true")
//   - OR AIOS_AUTH_FORCE=true is set explicitly (overrides Codespace bypass)
// In Codespaces, GitHub already gates the URL — adding a password on top
// would just mean re-typing it constantly. The dotfiles auth vars still
// load there, but the gate stays open.
//
// Generate the password hash from a password (do this once, store the hash):
//   node -e "console.log(require('bcryptjs').hashSync('YourPassword!', 12))"

import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { WebSocketServer } from "ws";
import type { Socket } from "node:net";
import bcrypt from "bcryptjs";
import cookieSession from "cookie-session";
import crypto from "node:crypto";

const AUTH_USER = process.env.AIOS_AUTH_USER ?? "";
const AUTH_HASH = process.env.AIOS_AUTH_PASSWORD_HASH ?? "";
const SESSION_SECRET =
  process.env.AIOS_SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const IN_CODESPACE = process.env.CODESPACES === "true";
const FORCE = process.env.AIOS_AUTH_FORCE === "true";
const ENFORCE = (!!AUTH_USER && !!AUTH_HASH && !IN_CODESPACE) || FORCE;

// In-memory rate limit. Per-IP, recent-fail-window. After N fails in W min,
// lock for L min. Memory only — restarts clear it. Fine for single-user.
const failLog = new Map<string, number[]>();
const LOCKOUT_MS = 5 * 60 * 1000;
const FAIL_LOCKOUT_THRESHOLD = 5;

function isLockedOut(ip: string): boolean {
  const now = Date.now();
  const fails = (failLog.get(ip) ?? []).filter((t) => now - t < LOCKOUT_MS);
  failLog.set(ip, fails);
  return fails.length >= FAIL_LOCKOUT_THRESHOLD;
}
function recordFail(ip: string): void {
  const fails = failLog.get(ip) ?? [];
  fails.push(Date.now());
  failLog.set(ip, fails);
}
function clearFails(ip: string): void {
  failLog.delete(ip);
}

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0a0a0a">
  <title>ai-os — Sign in</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      background: #0a0a0a; color: #e5e5e5; margin: 0; padding: 1rem;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
    }
    .card {
      background: #141414; border: 1px solid #2a2a2a; border-radius: 12px;
      padding: 2rem; width: 100%; max-width: 360px;
    }
    h1 { margin: 0 0 0.25rem 0; font-size: 1.25rem; font-weight: 500; letter-spacing: -0.01em; }
    .sub { color: #888; font-size: 0.85rem; margin-bottom: 1.5rem; }
    label { display: block; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 0.4rem; }
    input {
      width: 100%; padding: 0.75rem; background: #0a0a0a; color: #e5e5e5;
      border: 1px solid #2a2a2a; border-radius: 6px; font-size: 16px;
      font-family: inherit;
    }
    input:focus { outline: none; border-color: #4a8fe7; }
    .field { margin-bottom: 1rem; }
    button {
      width: 100%; padding: 0.75rem; background: #4a8fe7; color: #fff;
      border: none; border-radius: 6px; font-size: 0.95rem; font-weight: 500;
      cursor: pointer; margin-top: 0.5rem;
    }
    button:hover { background: #3a7fd8; }
    .err { color: #e74c3c; font-size: 0.85rem; min-height: 1.25em; margin-bottom: 0.5rem; }
  </style>
</head>
<body>
  <form method="POST" action="/login" class="card" autocomplete="on">
    <h1>ai-os</h1>
    <div class="sub">Sign in to your dashboard</div>
    <div class="err">__ERR__</div>
    <div class="field">
      <label for="user">Username</label>
      <input id="user" name="user" autocomplete="username" autofocus required>
    </div>
    <div class="field">
      <label for="pw">Password</label>
      <input id="pw" name="pw" type="password" autocomplete="current-password" required>
    </div>
    <button type="submit">Sign in</button>
  </form>
</body>
</html>`;

function loginPage(error?: string): string {
  return LOGIN_HTML.replace("__ERR__", error ?? "");
}

interface AuthHandle {
  enforced: boolean;
  /**
   * Wire the WS upgrade auth check.
   * If `expectedPath` is set (e.g. "/ws"), only upgrade requests on that
   * exact path are handled — others get a 400. If unset, any upgrade is
   * passed to wss after auth check.
   */
  bindWs(server: HttpServer, wss: WebSocketServer, expectedPath?: string): void;
}

export function mountAuth(app: Express): AuthHandle {
  if (!ENFORCE) {
    if (!AUTH_USER || !AUTH_HASH) {
      console.log("[auth] DISABLED — AIOS_AUTH_USER / AIOS_AUTH_PASSWORD_HASH not set");
    } else if (IN_CODESPACE) {
      console.log("[auth] DISABLED — running in Codespaces (GitHub already gates the URL)");
    }
    return {
      enforced: false,
      bindWs(server, wss, expectedPath) {
        server.on("upgrade", (req, socket, head) => {
          if (expectedPath) {
            const url = new URL(req.url || "/", "http://x");
            if (url.pathname !== expectedPath) {
              (socket as Socket).destroy();
              return;
            }
          }
          wss.handleUpgrade(req, socket as Socket, head, (ws) => {
            wss.emit("connection", ws, req);
          });
        });
      },
    };
  }

  console.log(`[auth] ENABLED — single-user gate for "${AUTH_USER}"`);

  app.use("/login", express.urlencoded({ extended: false }));

  const sessionMw = cookieSession({
    name: "aios_session",
    keys: [SESSION_SECRET],
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "lax",
    secureProxy: true,
  });
  app.use(sessionMw);

  app.get("/login", (req: Request, res: Response) => {
    if ((req.session as unknown as { authed?: boolean })?.authed) return res.redirect("/");
    let err = "";
    if (req.query.err === "1") err = "Wrong username or password";
    else if (req.query.err === "lockout") err = "Too many attempts. Wait 5 minutes.";
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(loginPage(err));
  });

  app.post("/login", async (req: Request, res: Response) => {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.ip ||
      req.socket.remoteAddress ||
      "unknown";
    if (isLockedOut(ip)) return res.redirect("/login?err=lockout");
    const body = (req.body ?? {}) as { user?: string; pw?: string };
    const user = String(body.user ?? "");
    const pw = String(body.pw ?? "");
    if (!user || !pw) return res.redirect("/login?err=1");
    const ok = user === AUTH_USER && (await bcrypt.compare(pw, AUTH_HASH));
    if (user !== AUTH_USER) await bcrypt.compare(pw, AUTH_HASH);
    if (!ok) {
      recordFail(ip);
      return res.redirect("/login?err=1");
    }
    clearFails(ip);
    (req.session as unknown as { authed: boolean; user: string }).authed = true;
    (req.session as unknown as { authed: boolean; user: string }).user = user;
    return res.redirect("/");
  });

  app.post("/logout", (req: Request, res: Response) => {
    req.session = null;
    res.redirect("/login");
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/login" || req.path === "/logout") return next();
    if ((req.session as unknown as { authed?: boolean })?.authed) return next();
    if (req.path.startsWith("/api/")) {
      return res.status(401).json({ error: "auth required" });
    }
    return res.redirect("/login");
  });

  return {
    enforced: true,
    bindWs(server: HttpServer, wss: WebSocketServer, expectedPath?: string) {
      server.on("upgrade", (req: IncomingMessage, socket, head) => {
        if (expectedPath) {
          const url = new URL(req.url || "/", "http://x");
          if (url.pathname !== expectedPath) {
            (socket as Socket).destroy();
            return;
          }
        }
        const stubRes = {
          getHeader: () => undefined,
          setHeader: () => undefined,
          on: () => undefined,
          end: () => undefined,
        } as unknown as Response;
        sessionMw(req as unknown as Request, stubRes, () => {
          if (!(req as unknown as { session?: { authed?: boolean } }).session?.authed) {
            (socket as Socket).write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            (socket as Socket).destroy();
            return;
          }
          wss.handleUpgrade(req, socket as Socket, head, (ws) => {
            wss.emit("connection", ws, req);
          });
        });
      });
    },
  };
}
