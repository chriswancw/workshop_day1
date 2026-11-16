import { randomInt } from "node:crypto";
import { realpathSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "Location",
};

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { ...cors, ...headers } });
}

function contained(root, path) {
  const child = relative(root, path);
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

export function createHandler(env = process.env) {
  const links = new Map();
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  const origin = new URL(
    env.BASE_URL ||
      (env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${env.RAILWAY_PUBLIC_DOMAIN}`
        : `http://localhost:${port}`),
  );
  if (!["http:", "https:"].includes(origin.protocol)) {
    throw new Error("BASE_URL must use HTTP or HTTPS");
  }
  const publicRoot = env.PUBLIC_DIR ? realpathSync(resolve(env.PUBLIC_DIR)) : null;

  return async function handle(request) {
    try {
      const { pathname } = new URL(request.url);
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors });
      }

      if (pathname === "/api/links") {
        if (request.method === "GET") return json([...links.values()]);
        if (request.method !== "POST") {
          return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST, OPTIONS" });
        }
        let body;
        try {
          body = await request.json();
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          return json({ error: "Invalid JSON" }, 400);
        }
        let url;
        try {
          if (typeof body?.url !== "string") throw new TypeError("URL must be a string");
          url = new URL(body.url);
          if (!["http:", "https:"].includes(url.protocol)) {
            throw new TypeError("URL must use HTTP or HTTPS");
          }
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
          return json({ error: "Provide a valid HTTP or HTTPS URL" }, 400);
        }
        let code;
        do {
          code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
        } while (links.has(code));
        const link = {
          code,
          url: url.href,
          shortUrl: `${origin.origin}/${code}`,
          hits: 0,
          createdAt: new Date().toISOString(),
        };
        links.set(code, link);
        return json(link, 201);
      }

      if (pathname === "/api" || pathname.startsWith("/api/")) {
        return json({ error: "Not found" }, 404);
      }
      if (!["GET", "HEAD"].includes(request.method)) {
        return json({ error: "Method not allowed" }, 405, { Allow: "GET, HEAD, OPTIONS" });
      }

      if (publicRoot) {
        let decoded;
        try {
          decoded = decodeURIComponent(pathname);
        } catch (error) {
          if (!(error instanceof URIError)) throw error;
          return json({ error: "Invalid path" }, 400);
        }
        const candidate = resolve(publicRoot, `.${decoded === "/" ? "/index.html" : decoded}`);
        if (!contained(publicRoot, candidate) || decoded.includes("\0")) {
          return json({ error: "Not found" }, 404);
        }
        let filePath;
        try {
          const actual = await realpath(candidate);
          if (contained(publicRoot, actual) && (await stat(actual)).isFile()) filePath = actual;
        } catch (error) {
          if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
        }
        if (filePath) {
          return new Response(request.method === "HEAD" ? null : Bun.file(filePath), {
            headers: { ...cors, "Content-Type": Bun.file(filePath).type },
          });
        }
      }

      const code = pathname.slice(1);
      const link = links.get(code);
      if (!link) return json({ error: "Not found" }, 404);
      if (request.method === "HEAD") {
        return new Response(null, { status: 302, headers: { ...cors, Location: link.url } });
      }
      link.hits += 1;
      return new Response(null, { status: 302, headers: { ...cors, Location: link.url } });
    } catch (error) {
      console.error("Request failed:", error);
      return json({ error: "Internal server error" }, 500);
    }
  };
}

if (import.meta.main) {
  const fetch = createHandler();
  const server = Bun.serve({ port: Number(process.env.PORT || 3000), fetch });
  console.log(`Snip backend listening on ${server.url}`);
}
