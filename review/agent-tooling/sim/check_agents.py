"""Static check of .claude/agents/*.md frontmatter. Run from the repo root."""
import pathlib
import re
import sys

ok = True
paths = sorted(pathlib.Path(".claude/agents").glob("*.md"))
expected = {f"{name}-builder" for name in ("general", "imaging", "models", "platform", "shop", "ui")}
expected |= {f"{name}-reviewer" for name in ("general", "imaging", "models", "release", "security", "shop")}
if {p.stem for p in paths} != expected:
    print("MISSING OR UNEXPECTED AGENTS", sorted(expected ^ {p.stem for p in paths}))
    ok = False
for p in paths:
    text = p.read_text()
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        print("NO FRONTMATTER", p)
        ok = False
        continue
    fm = {}
    for line in m.group(1).splitlines():
        key, sep, value = line.partition(": ")
        if not sep or ": " in value:
            print("BAD YAML LINE", p.name, repr(line))
            ok = False
        fm[key] = value
    tools = [t.strip() for t in fm.get("tools", "").split(",")]
    role = "builder" if p.stem.endswith("-builder") else "reviewer"
    want = "claude-sonnet-5-5" if role == "builder" else "claude-opus-5-5"
    errors = []
    if fm.get("name") != p.stem:
        errors.append("name mismatch")
    if fm.get("model") != want:
        errors.append(f"model {fm.get('model')}")
    if role == "reviewer" and {"Edit", "Write"} & set(tools):
        errors.append("reviewer can write")
    if role == "builder" and fm.get("permissionMode") != "acceptEdits":
        errors.append("builder permissionMode")
    if any(t.startswith("mcp__") or t in ("Agent", "Workflow", "ToolSearch") for t in tools):
        errors.append("forbidden tool")
    if not text[m.end():].lstrip().startswith('You are a subagent. Follow "Subagent rules"'):
        errors.append("no Subagent rules preamble")
    print(f"{p.name:24} {role:8} {fm.get('model'):18} {'OK' if not errors else errors}")
    ok = ok and not errors
print("ALL OK" if ok else "PROBLEMS")
sys.exit(0 if ok else 1)
