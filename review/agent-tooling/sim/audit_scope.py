"""Verify the review changed only authorized files and CLAUDE.md sections."""
import pathlib
import re
import subprocess


def git(*args):
    return subprocess.check_output(["git", *args], text=True)


base = "agent-tooling-review-base"
tracked_at_base = set(git("ls-tree", "-r", "--name-only", base).splitlines())
paths = set(git("diff", "--name-only", base).splitlines())
paths.update(git("ls-files", "--others", "--exclude-standard").splitlines())
for name in paths:
    assert (
        re.fullmatch(r"\.claude/(agents/[^/]+\.md|workflows/[^/]+\.js|settings\.json)", name)
        or name == "CLAUDE.md"
        or name.startswith("review/agent-tooling/sim/")
        or (name.startswith("review/agent-tooling/") and name not in tracked_at_base)
    ), f"outside authorized scope: {name}"

before = git("show", f"{base}:CLAUDE.md")
after = pathlib.Path("CLAUDE.md").read_text()
new_pointer = (
    '  follow "Subagent rules" under "Agents and workflows"; leads use that section\'s\n'
    '  workflow routing and status steps before editing and before finishing.\n'
)
old_pointer = '  follow "Subagent rules" under "Agents and workflows".\n'
assert after.count(new_pointer) == 1
after = after.replace(new_pointer, old_pointer)


def outside_allowed_sections(text):
    start = text.index("## Agents and workflows\n")
    end = text.index("## Finish each ticket\n", start)
    return text[:start] + text[end:]


assert outside_allowed_sections(before) == outside_allowed_sections(after), "CLAUDE.md changed outside allowed sections/pointer"
print(f"SCOPE OK: {len(paths)} authorized changed paths; CLAUDE.md outside allowed sections unchanged")
