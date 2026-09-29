import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function proxy({ token = "owner-token", fetch: upstream } = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL("../src/lib/profile-proxy.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, URL, Headers, Response, AbortSignal,
    process: { env: { API_URL: "http://api:8080" } },
    fetch: upstream ?? (() => { throw new Error("unexpected upstream call"); }),
    require(name) {
      assert.equal(name, "./session");
      return { getSessionToken: async () => token };
    },
  });
  return exports.forwardProfile;
}

test("profile writes require a matching Origin and an authenticated session", async () => {
  for (const origin of [null, "https://attacker.example", "null"]) {
    const headers = { Host: "app.example" };
    if (origin) headers.Origin = origin;
    for (const method of ["PUT", "DELETE"]) {
      assert.equal((await proxy()(new Request("https://app.example/api/profile", { method, headers }))).status, 403);
    }
  }
  assert.equal((await proxy({ token: null })(new Request("https://app.example/api/profile", {
    method: "PUT", headers: { Host: "app.example", Origin: "https://app.example" },
  }))).status, 401);
  assert.equal((await proxy({ token: null })(new Request("https://app.example/api/profile/image"), true)).status, 401);
});

test("profile forwarding streams long About text using the server-side token", async () => {
  const body = JSON.stringify({ name: "Test", about: "Long About 🌱\n".repeat(800000) });
  assert.ok(Buffer.byteLength(body) > 10 * 1024 * 1024);
  const forward = proxy({ fetch: async (url, init) => {
    assert.equal(url, "http://api:8080/api/profile");
    assert.equal(init.headers.get("authorization"), "Bearer owner-token");
    assert.equal(init.duplex, "half");
    assert.equal(await new Response(init.body).text(), body);
    return new Response(null, { status: 204 });
  } });
  const result = await forward(new Request("https://app.example/api/profile", {
    method: "PUT", headers: { Host: "app.example", Origin: "https://app.example", Authorization: "Bearer attacker-token", "Content-Type": "application/json" }, body,
  }));
  assert.equal(result.status, 204);
  assert.equal(result.headers.get("cache-control"), "private, no-store");
});

test("profile image proxy preserves binary data and errors", async () => {
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const forward = proxy({ fetch: async (url) => {
    assert.equal(url, "http://api:8080/api/profile/image");
    return new Response(bytes, { headers: { "Content-Type": "image/png" } });
  } });
  const result = await forward(new Request("https://app.example/api/profile/image"), true);
  assert.equal(result.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes);
  const failed = await proxy({ fetch: async () => { throw new Error("private network details"); } })(new Request("https://app.example/api/profile/image"), true);
  assert.equal(failed.status, 502);
  assert.ok(!(await failed.text()).includes("private network details"));
});
