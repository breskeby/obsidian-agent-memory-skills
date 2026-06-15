#!/usr/bin/env bash
# setup.sh — Bootstrap an Obsidian Agent Memory vault and register with installed agents
#
# Usage:
#   ./setup.sh [vault-path]
#
# Examples:
#   ./setup.sh ~/Documents/AgentMemory
#   ./setup.sh                           # defaults to ~/Documents/AgentMemory

set -euo pipefail

VAULT_PATH="${1:-$HOME/Documents/AgentMemory}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE_DIR="$SCRIPT_DIR/vault-template"

if [[ ! -d "$TEMPLATE_DIR" ]]; then
    echo "Error: Template directory not found: $TEMPLATE_DIR" >&2
    echo "Run this script from the obs-memory skill package directory." >&2
    exit 1
fi

echo "=== Obsidian Agent Memory Setup ==="
echo ""

# ── Detect installed agents ────────────────────────────────────────────────

PI_INSTALLED=false
CLAUDE_INSTALLED=false

command -v pi     &>/dev/null && PI_INSTALLED=true
command -v claude &>/dev/null && CLAUDE_INSTALLED=true

# ── Vault ─────────────────────────────────────────────────────────────────

VAULT_CREATED=false

if [[ -d "$VAULT_PATH/.obsidian" ]]; then
    echo "Vault already exists at: $VAULT_PATH"
    echo "  (skipping vault creation — delete the directory to reset)"
else
    echo "Creating vault at: $VAULT_PATH"
    mkdir -p "$VAULT_PATH"

    echo "Copying template files..."
    cp -r "$TEMPLATE_DIR"/* "$VAULT_PATH/"

    mkdir -p "$VAULT_PATH/.obsidian"
    cat > "$VAULT_PATH/.obsidian/app.json" << 'OBSIDIAN_EOF'
{
  "alwaysUpdateLinks": true,
  "newFileLocation": "folder",
  "newFileFolderPath": "inbox",
  "attachmentFolderPath": "attachments"
}
OBSIDIAN_EOF

    mkdir -p "$VAULT_PATH/inbox"
    touch "$VAULT_PATH/inbox/.gitkeep"
    mkdir -p "$VAULT_PATH/attachments"
    touch "$VAULT_PATH/attachments/.gitkeep"

    echo "✓ Vault created"
    VAULT_CREATED=true
fi

echo ""

# ── Pi agent registration ──────────────────────────────────────────────────
# Installs the package into pi so the obs-memory skill, proactive extension,
# and /obs prompt template are all registered automatically.

if $PI_INSTALLED; then
    echo "Pi detected — registering obs-memory package..."
    if pi install "$SCRIPT_DIR" 2>/dev/null; then
        echo "✓ obs-memory installed in Pi"
        echo "  Includes: proactive skill (auto-orients at session start),"
        echo "            /obs prompt template, obs-memory skill"
    else
        echo "  Auto-install failed. Register manually:"
        echo "    pi install \"$SCRIPT_DIR\""
    fi
    echo ""
fi

# ── Next Steps ────────────────────────────────────────────────────────────

echo "=== Next Steps ==="
echo ""
echo "1. Open in Obsidian:"
echo "   Vault Switcher → Open folder as vault → $VAULT_PATH"
echo ""
echo "2. Set the vault path — choose the option for your agent:"
echo ""
echo "   All agents — environment variable (add to shell profile):"
echo "     export OBSIDIAN_VAULT_PATH=\"$VAULT_PATH\""
echo ""

if $PI_INSTALLED; then
    echo "   Pi — add to ~/.pi/agent/AGENTS.md:"
    echo "     ## Obsidian Knowledge Vault"
    echo "     Persistent knowledge vault at \`$VAULT_PATH\`."
    echo ""
fi

if $CLAUDE_INSTALLED; then
    echo "   Claude Code — add to ~/.claude/CLAUDE.md:"
    echo "     ## Obsidian Knowledge Vault"
    echo "     Persistent knowledge vault at \`$VAULT_PATH\`."
    echo ""
fi

if ! $PI_INSTALLED && ! $CLAUDE_INSTALLED; then
    echo "   Agent config (e.g. .cursorrules, .windsurfrules, AGENTS.md):"
    echo "     ## Obsidian Knowledge Vault"
    echo "     Persistent knowledge vault at \`$VAULT_PATH\`."
    echo ""
fi

# Agent registration reminders for agents not yet detected

if ! $PI_INSTALLED; then
    echo "   Pi (not detected) — once installed, register this package:"
    echo "     pi install \"$SCRIPT_DIR\""
    echo ""
fi

if ! $CLAUDE_INSTALLED; then
    echo "   Claude Code (not detected) — once installed, register the plugin:"
    echo "     ln -s \"$SCRIPT_DIR\" ~/.claude/plugins/cache/obs-memory"
    echo ""
fi

echo "3. Start a session — your agent will orient itself from the vault"
echo "   automatically at the start of each new session."
echo ""
