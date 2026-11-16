import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandler } from "./server.js";

const temporary = [];
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});

function request(path = "/api/links", options) {
  return new Request(`http://localhost:3000${path}`, options);
}

async function add(handle, url = "https://example.com/hello?x=1") {
  return handle(request("/api/links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  }));
}

test("shared contract: create, list, redirect, hits, unknown code, restart", async () => {
  const handle = createHandler({});
  expect(await (await handle(request())).json()).toEqual([]);
  const response = await add(handle);
  expect(response.status).toBe(201);
  const link = await response.json();
  expect(Object.keys(link).sort()).toEqual(["code", "createdAt", "hits", "shortUrl", "url"]);
  expect(link.code).toMatch(/^[a-zA-Z0-9]{6}$/);
  expect(link.shortUrl).toBe(`http://localhost:3000/${link.code}`);
  expect(link.hits).toBe(0);
  expect(new Date(link.createdAt).toISOString()).toBe(link.createdAt);
  expect(await (await handle(request())).json()).toEqual([link]);
  const redirect = await handle(request(`/${link.code}`));
  expect(redirect.status).toBe(302);
  expect(redirect.headers.get("Location")).toBe(link.url);
  expect((await (await handle(request())).json())[0].hits).toBe(1);
  expect((await handle(request("/unknown"))).status).toBe(404);
  expect(await (await createHandler({})(request())).json()).toEqual([]);
});

test("invalid inputs consistently return 400 JSON errors", async () => {
  const handle = createHandler({});
  for (const body of ["{", "", "null", "[]", "{}", '{"url":42}', '{"url":"ftp://example.com"}',
    '{"url":"javascript:alert(1)"}', '{"url":"/relative"}']) {
    const response = await handle(request("/api/links", { method: "POST", body }));
    expect(response.status).toBe(400);
    expect(typeof (await response.json()).error).toBe("string");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  }
  expect((await add(handle, "http://example.com")).status).toBe(201);
});

test("CORS, preflight, method handling and API namespace", async () => {
  const handle = createHandler({});
  const response = await handle(request("/api/links", { method: "OPTIONS" }));
  expect(response.status).toBe(204);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
  const method = await handle(request("/api/links", { method: "DELETE" }));
  expect(method.status).toBe(405);
  expect(method.headers.get("Allow")).toContain("POST");
  expect((await handle(request("/api/missing"))).status).toBe(404);
});

test("configured origins and invalid startup settings", async () => {
  for (const [env, expected] of [
    [{ PORT: "4123" }, "http://localhost:4123"],
    [{ RAILWAY_PUBLIC_DOMAIN: "snip.example.com" }, "https://snip.example.com"],
    [{ BASE_URL: "https://custom.example.com/", RAILWAY_PUBLIC_DOMAIN: "ignored.example.com" },
      "https://custom.example.com"],
  ]) {
    const link = await (await add(createHandler(env))).json();
    expect(link.shortUrl).toBe(`${expected}/${link.code}`);
  }
  expect(() => createHandler({ PORT: "oops" })).toThrow("PORT");
  expect(() => createHandler({ BASE_URL: "ftp://example.com" })).toThrow("BASE_URL");
});

test("static index, MIME, precedence, API isolation, and path containment", async () => {
  const folder = await mkdtemp(join(tmpdir(), "snip-backend-test-"));
  temporary.push(folder);
  const publicDir = join(folder, "public");
  await mkdir(publicDir);
  await writeFile(join(publicDir, "index.html"), "<h1>Snip</h1>");
  await writeFile(join(folder, "private.txt"), "not public");
  await mkdir(join(publicDir, "api"));
  await writeFile(join(publicDir, "api", "links"), "not the API");
  const handle = createHandler({ PUBLIC_DIR: publicDir });
  const index = await handle(request("/"));
  expect(await index.text()).toBe("<h1>Snip</h1>");
  expect(index.headers.get("Content-Type")).toContain("text/html");
  const link = await (await add(handle)).json();
  await writeFile(join(publicDir, link.code), "static wins");
  expect(await (await handle(request(`/${link.code}`))).text()).toBe("static wins");
  expect((await (await handle(request())).json())[0].hits).toBe(0);
  for (const path of ["/..%2fprivate.txt", "/..%5cprivate.txt", "/%00", "/%zz"]) {
    const response = await handle(request(path));
    expect([400, 404]).toContain(response.status);
    expect(await response.text()).not.toContain("not public");
  }
  expect((await handle(request("/missing.js"))).status).toBe(404);
});

test("generated codes do not overwrite existing records", async () => {
  const handle = createHandler({});
  const codes = new Set();
  for (let i = 0; i < 250; i++) {
    const link = await (await add(handle)).json();
    expect(codes.has(link.code)).toBe(false);
    codes.add(link.code);
  }
  expect((await (await handle(request())).json()).length).toBe(250);
});
