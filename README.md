# Nexus — AI Agent Fusion Platform

**Nexus** fuses the best of Hermes Agent + OpenCode + OpenClaw into one production-ready AI agent.

## Features
- 🧠 **Hermes Memory**: File-based MEMORY.md/USER.md with atomic writes
- ⚡ **Token Budget**: Built-in enforcement (gpt-4o-mini compression, never main model)
- 🔌 **Channels**: Telegram, Discord, and more via OpenClaw plugin system
- 🛠️ **Skills**: Three-tier budget system (full → compact → binary)
- 💭 **Dreaming**: Background memory consolidation (ON by default, budget-capped)
- 🔒 **Permissions**: Ruleset-based access control

## Quick Start

```bash
# Install
npm install

# Setup (interactive)
bun run src/setup.ts

# Run
bun run src/index.ts
```

## Environment Variables
```
NEXUS_TELEGRAM_TOKEN=xxx   # Telegram bot token
OPENAI_API_KEY=xxx         # OpenAI API key
ANTHROPIC_API_KEY=xxx      # Anthropic API key
```

## Architecture
```
packages/
├── core/      # Effect.ts + Agent Loop + Token Budget
├── brain/     # Memory + Skills + Dreaming
├── channels/  # Telegram, Discord plugins
└── runtime/   # Code execution engine
```

## License: MIT
