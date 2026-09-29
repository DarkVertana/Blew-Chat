import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual action code with only the framework/request boundary
// replaced. No browser session or running API is needed for failure injection.
function loadSource(path, modules = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    TextEncoder,
    require(name) {
      if (!(name in modules)) throw new Error(`Unexpected dependency: ${name}`);
      return modules[name];
    },
  });
  return exports;
}

class ApiError extends Error {
  constructor(status) {
    super(`API status ${status}`);
    this.status = status;
    this.problems = [];
  }
}

function actions({ error, token = "test-session" } = {}) {
  const observed = { cleared: false, path: null };
  const redirect = new Error("redirect");
  const code = loadSource("../src/app/actions/auth.ts", {
    "next/cache": { revalidatePath() {} },
    "next/navigation": { redirect() { throw redirect; } },
    "@/lib/api": {
      ApiError,
      async api(path) {
        observed.path = path;
        if (error) throw error;
      },
    },
    "@/lib/session": {
      async getSessionToken() { return token; },
      async clearSessionCookie() { observed.cleared = true; },
    },
  });
  return { code, observed, redirect };
}

for (const name of ["logout", "logoutAll"]) {
  for (const error of [new ApiError(429), new ApiError(500), new Error("network unavailable")]) {
    test(`${name} preserves retry state on ${error.message}`, async () => {
      const { code, observed } = actions({ error });
      const state = await code[name]({});
      assert.ok(state.error);
      assert.equal(observed.cleared, false);
    });
  }
  test(`${name} clears cookie after confirmed revocation`, async () => {
    const { code, observed, redirect } = actions();
    await assert.rejects(code[name]({}), (error) => error === redirect);
    assert.equal(observed.cleared, true);
    assert.equal(observed.path, name === "logout" ? "/api/auth/logout" : "/api/auth/logout-all");
  });
}

test("global logout does not claim success for an expired or missing current session", async () => {
  for (const options of [{ error: new ApiError(401) }, { token: null }]) {
    const { code, observed } = actions(options);
    assert.ok((await code.logoutAll({})).error);
    assert.equal(observed.cleared, false);
  }
});

test("ordinary logout clears an already-invalid token", async () => {
  const { code, observed, redirect } = actions({ error: new ApiError(401) });
  await assert.rejects(code.logout({}), (error) => error === redirect);
  assert.equal(observed.cleared, true);
});

test("password checklist uses Unicode classes and the bcrypt byte limit", () => {
  const { passwordChecks } = loadSource("../src/lib/password-rules.ts");
  assert.ok(passwordChecks("Éé１".repeat(4)).every((check) => check.ok));
  assert.ok(passwordChecks("Aé1".repeat(19)).some((check) => !check.ok));
  assert.ok(passwordChecks("é１".repeat(6)).some((check) => !check.ok));
  assert.ok(!passwordChecks("Password123!").some((check) => /common|email/.test(check.label)));
});
