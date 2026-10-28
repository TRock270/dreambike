// Runs a .claude/workflows script offline with a mocked agent() and parallel(),
// so tests can check its control flow and model choices without real agents.
import { readFileSync } from "node:fs";

export type Obj = Record<string, unknown>;
export interface AgentOpts { label?: string; phase?: string; agentType?: string; model?: string; effort?: string; schema?: unknown }
export interface AgentCall { label: string; agentType: string; model?: string; effort?: string; prompt: string }
export interface WorkflowResult { status: string; depth?: string; [key: string]: unknown }
// respond plays every agent: it gets the call options and prompt and returns the agent's report (or null).
export type Respond = (opts: AgentOpts, prompt: string, calls: AgentCall[]) => unknown;

type Script = (...params: unknown[]) => Promise<unknown>;
// The constructor of async functions. It turns the script body into a function
// that may use await and a top-level return, as the workflow runtime allows.
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...params: string[]) => Script;

export function loadWorkflow(name: string): Script {
  const source = readFileSync(new URL(`../../.claude/workflows/${name}`, import.meta.url), "utf8")
    .replace(/^export const meta/m, "const meta");
  return new AsyncFunction("args", "agent", "parallel", "pipeline", "phase", "log", "budget", source);
}

export async function runWorkflow(name: string, args: unknown, respond: Respond) {
  const calls: AgentCall[] = [];
  const logs: string[] = [];
  const agent = async (prompt: string, opts: AgentOpts = {}) => {
    calls.push({ label: opts.label ?? "", agentType: opts.agentType ?? "", model: opts.model, effort: opts.effort, prompt });
    const report = respond(opts, prompt, calls);
    // A real agent returns a fresh object; workflows may mutate it.
    return report == null ? null : structuredClone(report);
  };
  // Like the runtime, a thunk that throws yields null instead of failing the batch.
  const parallel = async (thunks: Array<() => Promise<unknown>>) => Promise.all(thunks.map((t) => t().catch(() => null)));
  const script = loadWorkflow(name);
  const result = await script(args, agent, parallel, null, () => {}, (message: string) => logs.push(message), { total: null });
  return { result: result as WorkflowResult, calls, logs };
}
