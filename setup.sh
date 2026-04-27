#!/bin/bash
# Nexus AI Agent — Setup Script
# Run this once after cloning the repo

set -e

echo "🔧 Nexus Setup"
echo "=============="

# Check if .env exists
if [ -f ".env" ]; then
  echo "✅ .env already exists"
else
  echo "📝 Creating .env from template..."
  cp .env.example .env
  echo "✅ Created .env — please edit it and add your API keys"
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Type check
echo "🔍 Running type check..."
npx tsc --noEmit

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env and add your OPENROUTER_API_KEY"
echo "2. Run: bun run src/index.ts"
echo ""
