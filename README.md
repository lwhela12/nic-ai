# Claude PI

Personal Injury case management tool powered by Claude agents.

## Overview

Claude PI helps law firms manage personal injury cases by:
- **Document Indexing** - Automatically parses and indexes case documents (PDFs, images)
- **Case Analysis** - Answers questions about cases using indexed data
- **Work Product Generation** - Drafts demand letters, case memos, and settlement calculations
- **Batch Processing** - Index multiple cases in parallel

## Requirements

- [Bun](https://bun.sh/) (v1.0+)
- Node.js (v18+)
- `pdftotext` (part of poppler-utils)

```bash
# macOS
brew install poppler

# Ubuntu/Debian
apt-get install poppler-utils
```

## Installation

```bash
# Clone the repository
git clone https://github.com/your-org/claude-pi.git
cd claude-pi

# Install dependencies
npm install
```

## Running the App

```bash
# Start both frontend and backend in development mode
npm run dev
```

This starts:
- **Frontend** at http://localhost:5173 (React + Vite)
- **Backend** at http://localhost:3001 (Hono + Bun)

## Project Structure

```
claude-pi/
├── agent/              # Agent system prompt and configuration
├── app/                # React frontend (Vite + TypeScript + Tailwind)
├── server/             # Hono backend (Bun runtime)
│   └── routes/
│       ├── claude.ts   # Chat/agent endpoints
│       ├── firm.ts     # Batch indexing endpoints
│       ├── files.ts    # File browsing
│       └── docs.ts     # Generated document management
├── test-cases/         # Sample case folders for testing
└── subscription-server/ # API key management service
```

## How It Works

### Document Indexing

1. Place case files in a folder structure (e.g., `Intake/`, `1P/`, `3P/`, `Records and Bills/`)
2. Click "Re-index" in the case view
3. The agent reads all documents and creates `.ai_tool/document_index.json`
4. Index tracks: client info, dates, providers, charges, policy limits, and issues found

### Parallel Processing

The agent uses subagents to process folders in parallel:

```
Main Agent
├── Task: "Process Intake folder" ──► Subagent
├── Task: "Process 1P folder"     ──► Subagent
├── Task: "Process 3P folder"     ──► Subagent
└── (all run concurrently)
```

### Batch Indexing

For multiple cases, an orchestrator spawns case agents in parallel:

```
Orchestrator
├── Task: "Index Case A" ──► Case Agent ──► Folder Subagents
├── Task: "Index Case B" ──► Case Agent ──► Folder Subagents
└── (all cases processed concurrently)
```

## Configuration

Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY=your-key-here
```

## License

ISC
