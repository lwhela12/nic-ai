import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFile, appendFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { getSession, saveSession } from "../sessions";
import { indexCase } from "./firm";

// Types for chat history
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  tools?: string[];
}

interface ChatHistory {
  messages: ChatMessage[];
  startedAt: string;
  lastUpdated: string;
}

interface ChatArchiveEntry {
  id: string;
  date: string;
  summary: string;
  messageCount: number;
  file: string;
}

// Log to file for debugging
const LOG_FILE = "/tmp/claude-pi-debug.log";
async function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  await appendFile(LOG_FILE, line);
  console.log(msg); // Also try console
}

const app = new Hono();

// Cache the system prompts
let routerPromptCache: string | null = null;
let fullSystemPromptCache: string | null = null;

// Phase determination prompt - used after indexing to classify case phase
const phasePrompt = `Read .pi_tool/document_index.json and determine the case phase based on these markers:

**Phase Detection Logic:**
- **Intake**: Has intake docs but no LOR files sent
- **Investigation**: LORs sent, gathering insurance/police info
- **Treatment**: Medical records accumulating, no demand yet
- **Demand**: Demand letter exists in 3P folder
- **Negotiation**: Settlement correspondence exists, no settlement memo
- **Settlement**: Settlement memo exists
- **Complete**: Release signed, case complete

**Check the folders object for these indicator files:**
1. Look for LOR files (LOR 1P, LOR 3P) → at least Investigation phase
2. Look for medical records in "Records & Bills" → at least Treatment phase
3. Look for "Demand" in filename in 3P folder → at least Demand phase
4. Look for settlement correspondence → Negotiation phase
5. Look for settlement memo in Settlement folder → Settlement phase
6. Look for signed release in Settlement folder → Complete phase

Read the index, determine the phase, update the "case_phase" field, and write the updated index back to .pi_tool/document_index.json.`;

async function loadRouterPrompt(): Promise<string> {
  if (routerPromptCache) return routerPromptCache;
  const routerPromptPath = join(import.meta.dir, "../../agent/router-prompt.md");
  routerPromptCache = await readFile(routerPromptPath, "utf-8");
  return routerPromptCache;
}

async function loadFullSystemPrompt(): Promise<string> {
  if (fullSystemPromptCache) return fullSystemPromptCache;
  const systemPromptPath = join(import.meta.dir, "../../agent/system-prompt.md");
  fullSystemPromptCache = await readFile(systemPromptPath, "utf-8");
  return fullSystemPromptCache;
}


// Main chat endpoint - Haiku agent that can spawn Sonnet specialists via Task tool
app.post("/chat", async (c) => {
  const { caseFolder, message, sessionId: providedSessionId } = await c.req.json();

  if (!caseFolder || !message) {
    return c.json({ error: "caseFolder and message required" }, 400);
  }

  const routerPrompt = await loadRouterPrompt();
  const sessionId = providedSessionId || (await getSession(caseFolder));

  // Load full case index for context
  let caseContext = "";
  try {
    const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
    const indexContent = await readFile(indexPath, "utf-8");
    const indexData = JSON.parse(indexContent);

    // Include full index for Haiku to reference
    caseContext = `
CASE INDEX (use this to answer questions):
${JSON.stringify(indexData, null, 2)}

WORKING DIRECTORY: ${caseFolder}

USER REQUEST: `;
  } catch {
    caseContext = `
CASE CONTEXT:
- Working Directory: ${caseFolder}
- No document index found. You may need to read documents directly or run indexing first.

USER REQUEST: `;
  }

  return streamSSE(c, async (stream) => {
    try {
      let currentSessionId: string | undefined;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;

      const promptWithContext = caseContext + message;

      for await (const msg of query({
        prompt: promptWithContext,
        options: {
          cwd: caseFolder,
          systemPrompt: routerPrompt,
          model: "haiku",
          resume: sessionId || undefined,
          // Haiku has Task tool to spawn Sonnet specialists
          allowedTools: ["Read", "Glob", "Grep", "Bash", "Write", "Edit", "Task"],
          permissionMode: "acceptEdits",
          maxTurns: 15, // Allow more turns for Task spawning
        },
      })) {
        // Capture session ID
        if (msg.type === "system" && msg.subtype === "init") {
          currentSessionId = msg.session_id;
          await stream.writeSSE({
            data: JSON.stringify({ type: "init", sessionId: msg.session_id }),
          });
          continue;
        }

        // Stream assistant text and track usage
        if (msg.type === "assistant") {
          const usage = (msg as any).message?.usage || (msg as any).usage;
          if (usage) {
            totalInputTokens = usage.input_tokens ?? usage.inputTokens ?? totalInputTokens;
            totalOutputTokens += usage.output_tokens ?? usage.outputTokens ?? 0;
            await stream.writeSSE({
              data: JSON.stringify({
                type: "usage",
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
                contextPercent: Math.round((totalInputTokens / 200000) * 100),
              }),
            });
          }

          for (const block of msg.message.content) {
            if (block.type === "text") {
              await stream.writeSSE({
                data: JSON.stringify({ type: "text", content: block.text }),
              });
            } else if (block.type === "tool_use") {
              await stream.writeSSE({
                data: JSON.stringify({ type: "tool", name: block.name }),
              });
            }
          }
        }

        // Stream result with final usage
        if (msg.type === "result") {
          const resultUsage = (msg as any).usage;
          if (resultUsage) {
            const inputTokens = resultUsage.input_tokens ?? 0;
            const cacheCreation = resultUsage.cache_creation_input_tokens ?? 0;
            const cacheRead = resultUsage.cache_read_input_tokens ?? 0;
            totalInputTokens = inputTokens + cacheCreation + cacheRead;
            totalOutputTokens = resultUsage.output_tokens ?? 0;
          }

          const modelUsage = (msg as any).modelUsage;
          let contextWindow = 200000;
          if (modelUsage) {
            for (const model of Object.values(modelUsage) as any[]) {
              if (model.contextWindow) {
                contextWindow = Math.max(contextWindow, model.contextWindow);
              }
            }
          }

          const contextPercent = Math.round((totalInputTokens / contextWindow) * 100);

          await stream.writeSSE({
            data: JSON.stringify({
              type: "done",
              success: msg.subtype === "success",
              result: msg.subtype === "success" ? msg.result : undefined,
              sessionId: msg.session_id,
              usage: {
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
                contextPercent,
              },
            }),
          });
        }
      }

      // Save session for continuity
      if (currentSessionId) {
        await saveSession(caseFolder, currentSessionId);
      }
    } catch (error) {
      console.error("Agent error:", error);
      await stream.writeSSE({
        data: JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    }
  });
});

// Initialize case - uses shared indexCase from firm.ts
// This provides file-by-file extraction with Haiku + Sonnet summary
app.post("/init", async (c) => {
  await log("========== INIT ENDPOINT HIT ==========");

  const { caseFolder, files } = await c.req.json();
  await log(`Case folder: ${caseFolder}`);
  if (files?.length) {
    await log(`Incremental mode: ${files.length} file(s)`);
  }

  if (!caseFolder) {
    return c.json({ error: "caseFolder is required" }, 400);
  }

  const startTime = Date.now();

  return streamSSE(c, async (stream) => {
    try {
      // Use the shared indexCase function from firm.ts
      // Pass incrementalFiles if provided for incremental indexing
      const options = files?.length ? { incrementalFiles: files } : undefined;
      const result = await indexCase(caseFolder, async (event) => {
        await log(`[${((Date.now() - startTime) / 1000).toFixed(1)}s] ${event.type}: ${JSON.stringify(event)}`);
        await stream.writeSSE({
          data: JSON.stringify(event),
        });
      }, options);

      console.log(`\n========== INIT DONE ==========`);
      console.log(`Total time: ${((Date.now() - startTime) / 1000).toFixed(1)}s\n`);

      await stream.writeSSE({
        data: JSON.stringify({
          type: "done",
          success: result.success,
          error: result.error,
          durationSeconds: ((Date.now() - startTime) / 1000).toFixed(1),
        }),
      });
    } catch (error) {
      console.error("Init error:", error);
      await stream.writeSSE({
        data: JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    }
  });
});

// Determine case phase on existing index (without re-indexing)
app.post("/determine-phase", async (c) => {
  const { caseFolder } = await c.req.json();

  if (!caseFolder) {
    return c.json({ error: "caseFolder is required" }, 400);
  }

  return streamSSE(c, async (stream) => {
    try {
      await stream.writeSSE({
        data: JSON.stringify({ type: "phase", phase: "determining_phase" }),
      });

      let success = false;

      for await (const msg of query({
        prompt: phasePrompt,
        options: {
          cwd: caseFolder,
          model: "haiku", // Use cheaper/faster model for phase classification
          allowedTools: ["Read", "Write"],
          permissionMode: "acceptEdits",
          maxTurns: 3,
        },
      })) {
        if (msg.type === "assistant") {
          for (const block of msg.message.content) {
            if (block.type === "text") {
              await stream.writeSSE({
                data: JSON.stringify({ type: "text", content: block.text }),
              });
            }
          }
        }

        if (msg.type === "result") {
          success = msg.subtype === "success";
        }
      }

      await stream.writeSSE({
        data: JSON.stringify({
          type: "done",
          success,
        }),
      });
    } catch (error) {
      console.error("Phase determination error:", error);
      await stream.writeSSE({
        data: JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    }
  });
});

// Get extracted data for a specific document from the index
app.post("/document", async (c) => {
  const { caseFolder, documentPath } = await c.req.json();

  if (!caseFolder || !documentPath) {
    return c.json({ error: "caseFolder and documentPath required" }, 400);
  }

  try {
    const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
    const indexContent = await readFile(indexPath, "utf-8");
    const index = JSON.parse(indexContent);

    // Search for the document in the folders structure
    let documentData = null;
    let folderName = null;

    if (index.folders) {
      for (const [folder, docs] of Object.entries(index.folders)) {
        if (Array.isArray(docs)) {
          const doc = docs.find((d: any) =>
            d.path === documentPath ||
            d.filename === documentPath ||
            d.path?.endsWith(documentPath)
          );
          if (doc) {
            documentData = doc;
            folderName = folder;
            break;
          }
        }
      }
    }

    if (!documentData) {
      return c.json({ error: "Document not found in index", documentPath }, 404);
    }

    return c.json({
      folder: folderName,
      document: documentData,
      indexed_at: index.indexed_at,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return c.json({ error: "No index found. Run /init first." }, 404);
    }
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// Submit feedback to re-extract a document with corrections
app.post("/document/feedback", async (c) => {
  const { caseFolder, documentPath, feedback } = await c.req.json();

  if (!caseFolder || !documentPath || !feedback) {
    return c.json({ error: "caseFolder, documentPath, and feedback required" }, 400);
  }

  const feedbackPrompt = `Re-extract information from the document "${documentPath}" with the following user feedback:

**User Feedback:**
${feedback}

**Instructions:**
1. Read the document using pdftotext: \`pdftotext "${documentPath}" - 2>/dev/null\`
2. Re-extract the information, paying special attention to the user's feedback
3. Read the current index from .pi_tool/document_index.json
4. Update ONLY this document's entry in the appropriate folder
5. Add a "user_reviewed" field set to true and "review_notes" with a brief summary of changes
6. Write the updated index back

Be precise and follow the user's corrections.`;

  return streamSSE(c, async (stream) => {
    try {
      await stream.writeSSE({
        data: JSON.stringify({ type: "phase", phase: "re_extracting" }),
      });

      let success = false;

      for await (const msg of query({
        prompt: feedbackPrompt,
        options: {
          cwd: caseFolder,
          model: "haiku", // Use Haiku for targeted re-extraction
          allowedTools: ["Read", "Write", "Bash"],
          permissionMode: "acceptEdits",
          maxTurns: 5,
        },
      })) {
        if (msg.type === "assistant") {
          for (const block of msg.message.content) {
            if (block.type === "text") {
              await stream.writeSSE({
                data: JSON.stringify({ type: "text", content: block.text }),
              });
            } else if (block.type === "tool_use") {
              await stream.writeSSE({
                data: JSON.stringify({ type: "tool", name: block.name }),
              });
            }
          }
        }

        if (msg.type === "result") {
          success = msg.subtype === "success";
        }
      }

      await stream.writeSSE({
        data: JSON.stringify({
          type: "done",
          success,
        }),
      });
    } catch (error) {
      console.error("Document feedback error:", error);
      await stream.writeSSE({
        data: JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    }
  });
});

// Clear session
app.post("/clear-session", async (c) => {
  const { caseFolder } = await c.req.json();
  if (!caseFolder) {
    return c.json({ error: "caseFolder is required" }, 400);
  }
  await saveSession(caseFolder, "");
  return c.json({ success: true });
});

// Summarize conversation to reduce context size
app.post("/summarize", async (c) => {
  const { messages } = await c.req.json();

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return c.json({ error: "messages array required" }, 400);
  }

  // Format messages for summarization
  const conversationText = messages
    .map((m: { role: string; content: string }) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n');

  const summarizePrompt = `Summarize this conversation between a user and an AI assistant about a personal injury legal case. Focus on:
- Key facts discussed (dates, amounts, providers, etc.)
- Decisions made or actions taken
- Outstanding questions or issues
- Any file references or documents mentioned

Keep the summary concise but include all important details that would be needed to continue the conversation.

CONVERSATION:
${conversationText}

SUMMARY:`;

  try {
    let summary = '';

    for await (const msg of query({
      prompt: summarizePrompt,
      options: {
        model: "haiku", // Fast and cheap
        allowedTools: [],
        permissionMode: "acceptEdits",
        maxTurns: 1,
      },
    })) {
      if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "text") {
            summary += block.text;
          }
        }
      }
    }

    return c.json({
      success: true,
      summary: summary.trim(),
    });
  } catch (error) {
    console.error("Summarization error:", error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// Chat history endpoints

// GET /history - Load active chat history
app.get("/history", async (c) => {
  const caseFolder = c.req.query("case");

  if (!caseFolder) {
    return c.json({ error: "case query param required" }, 400);
  }

  try {
    const historyPath = join(caseFolder, ".pi_tool", "chat_history.json");
    const historyContent = await readFile(historyPath, "utf-8");
    const history: ChatHistory = JSON.parse(historyContent);
    return c.json(history);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // No history file - return empty
      return c.json({ messages: [], startedAt: null, lastUpdated: null });
    }
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// POST /history - Save chat history
app.post("/history", async (c) => {
  const { caseFolder, messages } = await c.req.json();

  if (!caseFolder || !messages) {
    return c.json({ error: "caseFolder and messages required" }, 400);
  }

  try {
    const piToolDir = join(caseFolder, ".pi_tool");
    const historyPath = join(piToolDir, "chat_history.json");

    // Ensure .pi_tool directory exists
    await mkdir(piToolDir, { recursive: true });

    // Load existing history or create new
    let history: ChatHistory;
    try {
      const existingContent = await readFile(historyPath, "utf-8");
      history = JSON.parse(existingContent);
    } catch {
      history = {
        messages: [],
        startedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      };
    }

    // Update with new messages
    history.messages = messages;
    history.lastUpdated = new Date().toISOString();
    if (!history.startedAt) {
      history.startedAt = new Date().toISOString();
    }

    await writeFile(historyPath, JSON.stringify(history, null, 2));
    return c.json({ success: true });
  } catch (error) {
    console.error("Save history error:", error);
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// GET /history/archives - Get list of archived conversations
app.get("/history/archives", async (c) => {
  const caseFolder = c.req.query("case");

  if (!caseFolder) {
    return c.json({ error: "case query param required" }, 400);
  }

  try {
    // Load archives from document index
    const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
    const indexContent = await readFile(indexPath, "utf-8");
    const index = JSON.parse(indexContent);
    return c.json({ archives: index.chat_archives || [] });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return c.json({ archives: [] });
    }
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// POST /history/archive - Archive current conversation
app.post("/history/archive", async (c) => {
  const { caseFolder } = await c.req.json();

  if (!caseFolder) {
    return c.json({ error: "caseFolder required" }, 400);
  }

  const piToolDir = join(caseFolder, ".pi_tool");
  const historyPath = join(piToolDir, "chat_history.json");
  const archivesDir = join(piToolDir, "chat_archives");
  const indexPath = join(piToolDir, "document_index.json");

  try {
    // Load current chat history
    let history: ChatHistory;
    try {
      const historyContent = await readFile(historyPath, "utf-8");
      history = JSON.parse(historyContent);
    } catch {
      return c.json({ error: "No chat history to archive" }, 400);
    }

    if (history.messages.length === 0) {
      return c.json({ error: "No messages to archive" }, 400);
    }

    // Generate summary using Haiku
    let summary = "Conversation archived";
    try {
      const conversationText = history.messages
        .slice(0, 10) // Just first 10 messages for summary
        .map(m => `${m.role.toUpperCase()}: ${m.content.slice(0, 200)}`)
        .join('\n\n');

      const summaryPrompt = `Summarize this PI case conversation in 1-2 sentences. Focus on what was discussed or accomplished:\n\n${conversationText}\n\nSUMMARY:`;

      for await (const msg of query({
        prompt: summaryPrompt,
        options: {
          model: "haiku",
          allowedTools: [],
          permissionMode: "acceptEdits",
          maxTurns: 1,
        },
      })) {
        if (msg.type === "assistant") {
          for (const block of msg.message.content) {
            if (block.type === "text") {
              summary = block.text.trim();
            }
          }
        }
      }
    } catch (error) {
      console.error("Summary generation failed:", error);
      // Continue with default summary
    }

    // Create archive file
    await mkdir(archivesDir, { recursive: true });
    const dateStr = new Date().toISOString().split('T')[0];
    const archiveId = `archive-${Date.now()}`;
    const archiveFileName = `${dateStr}_session.json`;
    const archivePath = join(archivesDir, archiveFileName);

    await writeFile(archivePath, JSON.stringify({
      ...history,
      archivedAt: new Date().toISOString(),
    }, null, 2));

    // Update document index with archive entry
    let index: any = {};
    try {
      const indexContent = await readFile(indexPath, "utf-8");
      index = JSON.parse(indexContent);
    } catch {
      // No index yet
    }

    if (!index.chat_archives) {
      index.chat_archives = [];
    }

    const archiveEntry: ChatArchiveEntry = {
      id: archiveId,
      date: dateStr,
      summary,
      messageCount: history.messages.length,
      file: `chat_archives/${archiveFileName}`,
    };

    index.chat_archives.unshift(archiveEntry); // Add to beginning
    await writeFile(indexPath, JSON.stringify(index, null, 2));

    // Clear active chat history
    const emptyHistory: ChatHistory = {
      messages: [],
      startedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };
    await writeFile(historyPath, JSON.stringify(emptyHistory, null, 2));

    // Clear the session for fresh context
    await saveSession(caseFolder, "");

    return c.json({
      success: true,
      archive: archiveEntry,
    });
  } catch (error) {
    console.error("Archive error:", error);
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// GET /history/archive/:id - Load a specific archived conversation
app.get("/history/archive/:id", async (c) => {
  const caseFolder = c.req.query("case");
  const archiveId = c.req.param("id");

  if (!caseFolder) {
    return c.json({ error: "case query param required" }, 400);
  }

  try {
    // Find the archive entry in the index
    const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
    const indexContent = await readFile(indexPath, "utf-8");
    const index = JSON.parse(indexContent);

    const archiveEntry = (index.chat_archives || []).find(
      (a: ChatArchiveEntry) => a.id === archiveId
    );

    if (!archiveEntry) {
      return c.json({ error: "Archive not found" }, 404);
    }

    // Load the archive file
    const archivePath = join(caseFolder, ".pi_tool", archiveEntry.file);
    const archiveContent = await readFile(archivePath, "utf-8");
    const archive = JSON.parse(archiveContent);

    return c.json({
      ...archiveEntry,
      messages: archive.messages,
    });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// Correct an errata item (user override)
app.post("/errata-correct", async (c) => {
  const { caseFolder, field, correctedValue } = await c.req.json();

  if (!caseFolder || !field || correctedValue === undefined) {
    return c.json({ error: "caseFolder, field, and correctedValue required" }, 400);
  }

  try {
    const indexPath = join(caseFolder, ".pi_tool", "document_index.json");
    const indexContent = await readFile(indexPath, "utf-8");
    const index = JSON.parse(indexContent);

    // Update reconciled_values with user correction
    if (!index.reconciled_values) {
      index.reconciled_values = {};
    }
    index.reconciled_values[field] = {
      value: correctedValue,
      source: "User correction",
      note: `Corrected by user from AI decision`
    };

    // Remove from errata since it's now user-verified
    if (index.errata) {
      index.errata = index.errata.filter((e: any) => e.field !== field);
    }

    await writeFile(indexPath, JSON.stringify(index, null, 2));
    return c.json({ success: true });
  } catch (error) {
    console.error("Errata correction error:", error);
    return c.json({
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

export default app;
