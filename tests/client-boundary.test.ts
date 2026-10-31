import { beforeAll, describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Offline: runs the real eslint.config.mjs on virtual files under src/.
const RULE_IDS = ["no-restricted-properties", "no-restricted-syntax", "no-restricted-imports"];
const T = 60_000; // ESLint config load takes a few seconds

describe("client boundary lint rules", () => {
  let eslint: ESLint;
  beforeAll(() => {
    eslint = new ESLint({ cwd: process.cwd() });
  }, T);

  async function lint(code: string, filePath: string) {
    const results = await eslint.lintText(code, { filePath: `${process.cwd()}/${filePath}` });
    const result = results[0];
    if (!result) throw new Error("ESLint returned no result (file ignored?)");
    // A parse failure must not make a "no error" case pass.
    expect(result.fatalErrorCount).toBe(0);
    // An ignored file comes back as a warning without a rule id; it must not pass as "no error".
    expect(result.messages.filter((m) => m.ruleId === null)).toEqual([]);
    return result.messages.filter((m) => m.ruleId && RULE_IDS.includes(m.ruleId));
  }

  async function expectRule(code: string, filePath: string, ruleId: string) {
    const messages = await lint(code, filePath);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.map((m) => m.ruleId)).toContain(ruleId);
  }

  describe("process.env in browser-reachable files", () => {
    const code = "export const x = process.env.FOO;\n";
    for (const path of ["src/components/X.tsx", "src/lib/browser/x.ts", "src/lib/browser/X.tsx", "src/lib/x.ts", "src/app/error.tsx"]) {
      it(`rejects ${path}`, () => expectRule(code, path, "no-restricted-properties"), T);
    }
    it("rejects destructuring env from process", () =>
      expectRule("export const { env } = process;\n", "src/lib/x.ts", "no-restricted-properties"), T);
    it('rejects process["env"]', () =>
      expectRule('export const x = process["env"].FOO;\n', "src/lib/x.ts", "no-restricted-syntax"), T);
  });

  describe("server imports in browser-reachable files", () => {
    it("rejects alias import", () =>
      expectRule('import { loadConfig } from "@/lib/server/config";\nexport const x = loadConfig;\n',
        "src/components/X.tsx", "no-restricted-imports"), T);
    it("rejects import type", () =>
      expectRule('import type { ServerConfig } from "@/lib/server/config";\nexport type X = ServerConfig;\n',
        "src/components/X.tsx", "no-restricted-imports"), T);
    it("rejects relative import from components", () =>
      expectRule('import { loadConfig } from "../lib/server/config";\nexport const x = loadConfig;\n',
        "src/components/X.tsx", "no-restricted-imports"), T);
    it("rejects relative import from src/lib", () =>
      expectRule('import { callMeta } from "./server/meta";\nexport const x = callMeta;\n',
        "src/lib/x.ts", "no-restricted-imports"), T);
    it("rejects dynamic import of a server path", () =>
      expectRule('export const load = () => import("@/lib/server/config");\n',
        "src/components/X.tsx", "no-restricted-syntax"), T);
  });

  describe("server secrets", () => {
    const page = "src/app/page.tsx";
    it("rejects process.env.MODEL_API_KEY", () =>
      expectRule("export const k = process.env.MODEL_API_KEY;\n", page, "no-restricted-syntax"), T);
    it('rejects process.env["MODEL_API_KEY"]', () =>
      expectRule('export const k = process.env["MODEL_API_KEY"];\n', page, "no-restricted-syntax"), T);
    it("rejects process.env[`MODEL_API_KEY`]", () =>
      expectRule("export const k = process.env[`MODEL_API_KEY`];\n", page, "no-restricted-syntax"), T);
    it("rejects passing the whole process.env as a prop or spread in a page", async () => {
      await expectRule("export const P = () => <div data-env={process.env} />;\n", page, "no-restricted-syntax");
      await expectRule("export const e = { ...process.env };\n", page, "no-restricted-syntax");
      await expectRule("const { env } = process;\nexport const e = env;\n", page, "no-restricted-syntax");
    }, T);
    it('rejects process["env"] and globalThis.process.env in a page', async () => {
      await expectRule('const e = process["env"];\nexport const k = e.FOO;\n', page, "no-restricted-syntax");
      await expectRule("export const e = globalThis.process.env;\n", page, "no-restricted-syntax");
    }, T);
    for (const path of ["src/lib/server/budget.ts", "src/app/api/edit/route.ts"]) {
      it(`rejects a secret read in ${path}, which is not on the allow list`, () =>
        expectRule("export const k = process.env.MODEL_API_KEY;\n", path, "no-restricted-syntax"), T);
    }
    it("rejects a dynamic process.env key in a page", () =>
      expectRule('const name = "MODEL_API_KEY";\nexport const k = process.env[name];\n', page, "no-restricted-syntax"), T);
    it("rejects destructured VISITOR_HASH_SECRET", () =>
      expectRule("const { VISITOR_HASH_SECRET } = process.env;\nexport const k = VISITOR_HASH_SECRET;\n",
        page, "no-restricted-syntax"), T);
    it("still rejects a secret read in a browser file (selector sets merged)", async () => {
      const messages = await lint("export const k = process.env.UPSTASH_REDIS_REST_TOKEN;\n", "src/components/X.tsx");
      expect(messages.map((m) => m.ruleId)).toContain("no-restricted-syntax");
      expect(messages.map((m) => m.ruleId)).toContain("no-restricted-properties");
    }, T);
  });

  describe("allowed reads", () => {
    it("allows process.env.NODE_ENV in src/app/page.tsx", async () => {
      expect(await lint("export const m = process.env.NODE_ENV;\n", "src/app/page.tsx")).toEqual([]);
    }, T);
    // Exactly the files SPEC 3 allows to read secrets (eslint.config.mjs SERVER_SECRET_FILES).
    const allowed = [
      "src/lib/server/meta.ts", "src/lib/server/config.ts", "src/lib/server/http.ts", "src/lib/server/paid.ts",
      "src/app/api/budget/route.ts", "src/app/api/health/route.ts",
    ];
    for (const path of allowed) {
      it(`allows secret reads in ${path}`, async () => {
        expect(await lint("export const k = process.env.UPSTASH_REDIS_REST_TOKEN;\n", path)).toEqual([]);
      }, T);
    }
  });

  it("every \"use client\" file in src gets the browser rules", async () => {
    const clientFiles = readdirSync("src", { recursive: true, encoding: "utf8" })
      .filter((f) => /\.tsx?$/.test(f))
      .map((f) => join("src", f))
      .filter((f) => /^\s*(\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(readFileSync(f, "utf8")));
    expect(clientFiles.length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const f of clientFiles) {
      const config = await eslint.calculateConfigForFile(f);
      if (!config.rules?.["no-restricted-properties"]) missing.push(f);
    }
    // A client component outside BROWSER_FILES would escape the process.env and server-import rules.
    expect(missing).toEqual([]);
  }, T);
});
