import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Client-boundary guards (SPEC 3): server secrets stay in server-only modules.
// These are regression guards; the current code has no leak.

const SECRET_NAMES = ["MODEL_API_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "VISITOR_HASH_SECRET"];

const secretMessage = (name) =>
  `${name} is a server secret. Read it only in the server-only modules (SPEC 3), never anywhere else.`;

// Each secret gets five selectors: obj.NAME, obj["NAME"], obj[`NAME`], and { NAME } / { "NAME": x } destructuring.
const SECRET_SELECTORS = SECRET_NAMES.flatMap((name) => [
  { selector: `MemberExpression[computed=false][property.name='${name}']`, message: secretMessage(name) },
  { selector: `MemberExpression[computed=true][property.value='${name}']`, message: secretMessage(name) },
  {
    selector: `MemberExpression[computed=true][property.type='TemplateLiteral'][property.quasis.0.value.cooked='${name}']`,
    message: secretMessage(name),
  },
  { selector: `ObjectPattern > Property[computed=false][key.name='${name}']`, message: secretMessage(name) },
  { selector: `ObjectPattern > Property[key.value='${name}']`, message: secretMessage(name) },
]);

const ENV_MESSAGE = "Browser-reachable code must not read process.env. Move it to a server module (SPEC 3).";
const SERVER_IMPORT_MESSAGE = "Browser-reachable code must not import from a server directory (SPEC 3).";

// Matches "@/lib/server", "@/lib/server/x", "./server/x", "../lib/server/x" (not "next/server").
const SERVER_PATH_REGEX = "^(@/|\\.{1,2}/)(.*/)?server(/|$)";

const BROWSER_SYNTAX_SELECTORS = [
  { selector: "MemberExpression[computed=true][object.name='process'][property.value='env']", message: ENV_MESSAGE },
  {
    selector: "ImportExpression[source.value=/^(@\\/|\\.{1,2}\\/)(.*\\/)?server(\\/|$)/]",
    message: SERVER_IMPORT_MESSAGE,
  },
];

// Server components render into HTML and the RSC payload: process.env may be read field by field
// (NODE_ENV), but the whole object must never become a value (a prop, a spread, a variable).
const WHOLE_ENV_SELECTORS = [
  {
    selector: ":not(MemberExpression) > MemberExpression[object.name='process'][property.name='env']",
    message: "Do not pass process.env as a whole in a rendered file; read single non-secret fields (SPEC 3).",
  },
  {
    selector: "VariableDeclarator[init.name='process'] > ObjectPattern > Property[key.name='env']",
    message: "Do not take process.env as a whole in a rendered file; read single non-secret fields (SPEC 3).",
  },
  {
    // process["env"] and globalThis.process.env would slip past the two selectors above.
    selector: "MemberExpression[computed=true][object.name='process'][property.value='env']",
    message: "Use process.env.NAME in a rendered file, not process[\"env\"] (SPEC 3).",
  },
  {
    selector: "MemberExpression[object.property.name='process'][property.name='env']",
    message: "Use process.env.NAME in a rendered file, not globalThis.process.env (SPEC 3).",
  },
  {
    // process.env[name] hides which field is read, so the secret selectors cannot see it.
    selector: "MemberExpression[computed=true][object.object.name='process'][object.property.name='env'][property.type!='Literal']",
    message: "Read process.env fields by a literal name in a rendered file, so secret reads stay visible (SPEC 3).",
  },
];

const SERVER_SECRET_FILES = [
  "src/lib/server/meta.ts",
  "src/lib/server/config.ts",
  "src/lib/server/http.ts",
  "src/lib/server/paid.ts",
  "src/app/api/budget/route.ts",
  "src/app/api/health/route.ts",
];

// Every "use client" file must match this list; tests/client-boundary.test.ts checks it.
const BROWSER_FILES = [
  "src/components/**/*.{ts,tsx}",
  "src/lib/browser/**/*.{ts,tsx}",
  "src/lib/*.{ts,tsx}",
  "src/lib/mocks/**/*.{ts,tsx}",
  "src/app/layout.tsx",
  // Next requires these to be client components.
  "src/app/**/{error,global-error}.tsx",
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // (b) secrets: everywhere in src except the modules allowed to read them.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: SERVER_SECRET_FILES,
    rules: { "no-restricted-syntax": ["error", ...SECRET_SELECTORS] },
  },
  // (c) rendered app files (pages, layouts): (b) plus no whole process.env as a value.
  {
    files: ["src/app/**/*.tsx"],
    rules: { "no-restricted-syntax": ["error", ...WHOLE_ENV_SELECTORS, ...SECRET_SELECTORS] },
  },
  // (a) browser files. Flat config replaces a rule entry instead of merging it, and these
  // files also match block (b), so this later block repeats the secret selectors.
  {
    files: BROWSER_FILES,
    rules: {
      "no-restricted-properties": ["error", { object: "process", property: "env", message: ENV_MESSAGE }],
      "no-restricted-imports": ["error", { patterns: [{ regex: SERVER_PATH_REGEX, message: SERVER_IMPORT_MESSAGE }] }],
      "no-restricted-syntax": ["error", ...BROWSER_SYNTAX_SELECTORS, ...SECRET_SELECTORS],
    },
  },
  globalIgnores([".next/**", "out/**", "spike/**", ".venv/**", "next-env.d.ts", "node_modules/**", ".claude/worktrees/**"]),
]);
