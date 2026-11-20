#!/usr/bin/env bash
# Checks that this machine and folder are ready for Tool Passport development.
# Read-only: it changes nothing. Run from the app folder: bash scripts/check-prereqs.sh

pass=0; fail=0; warn=0
ok()   { echo "  PASS  $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL  $1"; fail=$((fail+1)); }
note() { echo "  WARN  $1"; warn=$((warn+1)); }

echo "Tools"
if command -v node >/dev/null 2>&1; then
  v=$(node --version | sed 's/^v//'); major=${v%%.*}
  case "$major" in
    22|24) ok "Node.js $v (Forge CLI supports 22.x and 24.x)" ;;
    *) bad "Node.js $v: Forge CLI needs 22.x or 24.x LTS" ;;
  esac
else bad "Node.js not found"; fi
command -v npm >/dev/null 2>&1 && ok "npm $(npm --version)" || bad "npm not found"
command -v git >/dev/null 2>&1 && ok "$(git --version)" || bad "git not found"
if command -v forge >/dev/null 2>&1; then
  ok "Forge CLI $(forge --version 2>/dev/null | head -n1)"
  if forge whoami >/dev/null 2>&1; then ok "forge login: $(forge whoami 2>/dev/null | head -n1)"
  else bad "Not logged in to Forge: run forge login"; fi
else bad "Forge CLI not found: npm install -g @forge/cli@latest"; fi
[ -n "$NODE_ENV" ] && note "NODE_ENV is set to '$NODE_ENV'; unset it if npm skips dependencies"

echo "Folder"
[ -f manifest.yml ] && ok "manifest.yml present (run from the app folder)" || bad "manifest.yml missing: run this from the folder forge create made"
grep -q "^  id:" manifest.yml 2>/dev/null && ok "manifest has an app id" || bad "No app id in manifest.yml"
[ -f package.json ] && ok "package.json present" || bad "package.json missing"
[ -d node_modules ] && ok "dependencies installed" || note "node_modules missing: run npm install"
[ -f CLAUDE.md ] && ok "CLAUDE.md present" || bad "CLAUDE.md missing: copy the kit into this folder"
[ -f docs/tool-passport-v2.1.md ] && ok "spec present" || bad "docs/tool-passport-v2.1.md missing"
[ -f docs/ENVIRONMENT.md ] && ok "ENVIRONMENT.md present" || bad "docs/ENVIRONMENT.md missing"
grep -q "atlassian.net" docs/ENVIRONMENT.md 2>/dev/null && ok "demo site URL recorded" || note "Demo site URL not yet recorded in docs/ENVIRONMENT.md"

echo "Git and secrets"
[ -d .git ] && ok "git repository initialised" || bad "Not a git repository: git init"
if [ -f .gitignore ]; then
  for p in node_modules .env; do grep -q "$p" .gitignore && ok ".gitignore covers $p" || bad ".gitignore is missing $p"; done
else bad ".gitignore missing"; fi
if git ls-files 2>/dev/null | grep -Eq '(^|/)\.env'; then bad ".env file is tracked by git"; else ok "no .env tracked"; fi
if grep -rIlE "ATATT[0-9A-Za-z_-]{20,}" --exclude-dir=node_modules --exclude-dir=.git . >/dev/null 2>&1; then
  bad "Something that looks like an Atlassian API token is in this folder: remove it"
else ok "no Atlassian API token found in files"; fi

echo
echo "Result: $pass passed, $warn warnings, $fail failed"
[ "$fail" -eq 0 ] && echo "Ready for Claude Code." || echo "Fix the FAIL lines, then run this again."
exit "$fail"
