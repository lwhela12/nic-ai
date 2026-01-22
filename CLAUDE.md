# Claude PI - Development Guide

This repo contains a Personal Injury case management tool powered by Claude agents.

## Repository Structure

```
claude-pi/
├── CLAUDE.md                 ← You are here (repo development instructions)
├── agent/
│   ├── system-prompt.md      ← PI agent's system prompt (law knowledge, indexing instructions)
│   └── README.md             ← Agent architecture documentation
├── app/                      ← React frontend (Vite + TypeScript + Tailwind)
│   └── src/
│       └── components/
│           ├── App.tsx           ← Main app, routing between dashboard/case views
│           ├── FirmDashboard.tsx ← Firm-level case list with batch indexing
│           ├── Chat.tsx          ← Case chat interface with streaming
│           ├── FileViewer.tsx    ← Document browser
│           └── Visualizer.tsx    ← Generated content display
├── server/                   ← Hono backend (Bun runtime)
│   ├── index.ts              ← Server entry, route mounting
│   ├── sessions.ts           ← Session persistence per case
│   └── routes/
│       ├── claude.ts         ← Agent SDK integration, chat endpoint
│       ├── firm.ts           ← Firm dashboard, batch indexing endpoints
│       ├── files.ts          ← File browsing, index status detection
│       └── docs.ts           ← Generated document management
└── test-cases/               ← Sample case folders for testing
```

## Running the Development Servers

```bash
# Terminal 1: Backend (port 3001)
cd server
bun run --watch index.ts

# Terminal 2: Frontend (port 5173)
cd app
npm run dev
```

The frontend proxies `/api/*` requests to the backend via Vite config.

## Architecture Overview

### Agent System
- Uses `@anthropic-ai/claude-agent-sdk` for agent interactions
- System prompt loaded from `agent/system-prompt.md`
- Supports parallel subagent spawning via Task tool for batch operations
- Sessions persisted per-case in `.pi_tool/session.json`

### Key Flows

**Single Case Indexing:**
1. User clicks "Re-index" in case view
2. `POST /api/claude/chat` with indexing prompt
3. Agent reads documents, spawns folder subagents in parallel
4. Writes index to `.pi_tool/document_index.json`

**Batch Indexing (Multiple Cases):**
1. User clicks "Index All" in dashboard
2. `POST /api/firm/batch-index` spawns orchestrator agent
3. Orchestrator spawns case agents in parallel (one per case)
4. Each case agent spawns folder agents in parallel
5. Progress streamed via SSE to frontend modal

**Index Freshness Detection:**
- `GET /api/files/index-status` compares file mtimes to index file mtime
- Returns new/modified files list
- Frontend shows amber banner when updates needed

### Data Storage
- Each case folder contains `.pi_tool/` directory:
  - `document_index.json` - Parsed case data
  - `session.json` - Agent session ID for continuity
  - `case_memo.md` - Generated case memo (if created)

## Common Development Tasks

### Adding a New API Endpoint
1. Create or edit route file in `server/routes/`
2. Register in `server/index.ts` if new file
3. Add frontend fetch call in appropriate component

### Modifying Agent Behavior
- Edit `agent/system-prompt.md` for PI knowledge/instructions
- Edit prompts in `server/routes/claude.ts` or `server/routes/firm.ts`

### Adding UI Components
- Create component in `app/src/components/`
- Use Tailwind for styling (already configured)
- Follow existing patterns for API calls and state management

## Testing

For now, testing is manual using the `test-cases/` folder. Add case folders there with PDFs to test indexing and chat functionality.

## Key Dependencies

**Backend:**
- `hono` - Web framework
- `@anthropic-ai/claude-agent-sdk` - Agent interactions
- `bun` - Runtime

**Frontend:**
- `react` 19
- `vite` 7
- `tailwindcss` 4
- `react-markdown` + `remark-gfm` - Markdown rendering
