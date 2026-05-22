#!/usr/bin/env bash
# PreToolUse hook for Write.
# Blocks creating plan-shaped .md files outside docs/plans/{active,archive}/.
# See CLAUDE.md > "Plan files" and ../settings.json.
set -e

input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name // empty')
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

# Hook is configured with matcher "Write", but be defensive.
[ "$tool_name" = "Write" ] || exit 0
[ -n "$file_path" ] || exit 0

# Only act on .md files.
case "$file_path" in
  *.md|*.MD|*.markdown) ;;
  *) exit 0 ;;
esac

# Normalize to a project-relative path. If the path isn't under this repo,
# it's not ours to police — fall through.
project_root="/Users/corey/Documents/code/mail-show"
case "$file_path" in
  "$project_root"/*) rel_path="${file_path#$project_root/}" ;;
  /*) exit 0 ;;
  *)  rel_path="$file_path" ;;
esac

# Already under an allowed location.
case "$rel_path" in
  docs/plans/active/*|docs/plans/archive/*) exit 0 ;;
esac

filename=$(basename "$rel_path")
dirname=$(dirname "$rel_path")

is_plan=0

# Pattern 1: filename contains "plan" (case-insensitive).
shopt -s nocasematch 2>/dev/null || true
case "$filename" in
  *plan*) is_plan=1 ;;
esac
shopt -u nocasematch 2>/dev/null || true

# Pattern 2: top-level .md that isn't a canonical repo doc.
if [ "$dirname" = "." ]; then
  case "$filename" in
    README.md|CLAUDE.md|CHANGELOG.md|LICENSE.md|LICENSE|AGENTS.md|CONTRIBUTING.md|CODE_OF_CONDUCT.md|SECURITY.md) ;;
    *) is_plan=1 ;;
  esac
fi

if [ "$is_plan" = "1" ]; then
  cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Plan files belong in docs/plans/active/ or docs/plans/archive/ (see CLAUDE.md). Move the path under there and retry."
  }
}
EOF
fi

exit 0
