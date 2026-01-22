# Migration Plan: claude-pi → Claude Agent SDK

## Status: COMPLETED

Migration has been implemented with a simplified single-agent approach.

---

## Architecture

```
Before:
React App → Hono Server → Bun.spawn("claude") → Claude Code CLI

After:
React App → Hono Server → Agent SDK query() → Anthropic API
```

---

## What Changed

### Backend (`server/routes/claude.ts`)
- Removed `Bun.spawn(["claude", ...])` CLI spawning
- Now uses `query()` from `@anthropic-ai/claude-agent-sdk`
- Streams typed messages (text, tool, done, error) to frontend
- Session management for conversation continuity

### Session Management (`server/sessions.ts`)
- Stores session IDs per case in `.pi_tool/session.json`
- Enables multi-turn conversations that remember context

### Frontend (`app/src/components/Chat.tsx`)
- Handles new message format (type: text, tool, done, init)
- Displays which tools are being used
- Session indicator and clear session button
- Quick action buttons for common tasks

---

## How It Works

**One agent** with your CLAUDE.md as its system prompt handles everything:
- "Draft a demand letter" → Agent reads case files, generates letter
- "Find gaps" → Agent scans folder, identifies missing docs
- "Calculate settlement" → Agent computes disbursement

The quick action buttons are just prompts to the same agent:
```typescript
const quickActions = [
  { label: 'Case Memo', prompt: 'Generate a case memo summarizing this case' },
  { label: 'Gaps', prompt: 'Identify missing documents and gaps in this case' },
  { label: 'Draft Demand', prompt: 'Draft a demand letter for this case' },
  // ...
];
```

---

## Running the App

```bash
# Terminal 1: Start server
cd claude-pi/server
bun run dev

# Terminal 2: Start frontend
cd claude-pi/app
npm run dev
```

Make sure you're logged into Claude Code (`claude` command works).

---

## Files Modified

- `server/routes/claude.ts` - Rewritten with Agent SDK
- `server/sessions.ts` - New file for session management
- `app/src/components/Chat.tsx` - Updated for new message format
- `server/package.json` - Added `@anthropic-ai/claude-agent-sdk`

---

## Authentication

**Local development**: Uses your Claude Code login (no API key needed)

**Production deployment**: Set `ANTHROPIC_API_KEY` environment variable
