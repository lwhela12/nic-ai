/**
 * Direct Firm Chat API
 *
 * Fast, lightweight firm-level chat using direct Anthropic API calls.
 * Has access to portfolio context and tools for getting case details,
 * updating todos, and delegating report generation.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile, readdir, mkdir } from "fs/promises";
import { join } from "path";

// Lazy client creation - API key is set by auth middleware before requests
// Web shim (imported in server/index.ts) handles runtime selection
let _anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_anthropic) {
    // Explicitly pass API key - env var reading may not work in bundled binary
    _anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      fetch: globalThis.fetch.bind(globalThis),
    });
  }
  return _anthropic;
}

// Message format for conversation history
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Firm todo format
interface FirmTodo {
  id: string;
  text: string;
  caseRef?: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "completed";
  createdAt: string;
}

// Tool definitions
const TOOLS: Anthropic.Tool[] = [
  {
    name: "read_file",
    description: "Read a firm-level file (knowledge base, template, config). Use for reading firm configuration or knowledge documents.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Relative path from firm root (e.g., '.pi_tool/firm-config.json', '.pi_tool/knowledge/manifest.json')"
        }
      },
      required: ["path"]
    }
  },
  {
    name: "get_case_details",
    description: "Get full index details for a specific case by folder name. Use when you need more information than the summary provides about a specific case.",
    input_schema: {
      type: "object" as const,
      properties: {
        case_name: {
          type: "string",
          description: "The case folder name (e.g., 'Smith, John' or 'Garcia_Maria')"
        }
      },
      required: ["case_name"]
    }
  },
  {
    name: "update_todos",
    description: "Update the firm todo list. Use when the user asks to add tasks, generate a task list, or create action items.",
    input_schema: {
      type: "object" as const,
      properties: {
        todos: {
          type: "array",
          description: "Array of todo items to save",
          items: {
            type: "object",
            properties: {
              text: { type: "string", description: "Description of the task" },
              caseRef: { type: "string", description: "Optional case name reference" },
              priority: { type: "string", enum: ["high", "medium", "low"], description: "Task priority" }
            },
            required: ["text", "priority"]
          }
        }
      },
      required: ["todos"]
    }
  },
  {
    name: "generate_report",
    description: "Delegate to a specialized agent for generating formal reports. Use for portfolio summaries, SOL deadline reports, or case phase analyses that need detailed formatting.",
    input_schema: {
      type: "object" as const,
      properties: {
        report_type: {
          type: "string",
          enum: ["portfolio_summary", "sol_deadline_report", "phase_analysis", "financial_summary"],
          description: "Type of report to generate"
        },
        instructions: {
          type: "string",
          description: "Specific instructions for the report"
        }
      },
      required: ["report_type", "instructions"]
    }
  },
  {
    name: "start_review",
    description: "Start reviewing pending tasks with the user. Enters an interactive review mode where you walk through each pending todo item one by one, asking the user what action to take (complete, skip, modify, or delete).",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: []
    }
  },
  {
    name: "update_todo_item",
    description: "Update a specific todo item during review mode. Use this to mark items as completed, modify their text, or delete them.",
    input_schema: {
      type: "object" as const,
      properties: {
        todo_id: {
          type: "string",
          description: "The ID of the todo item to update"
        },
        action: {
          type: "string",
          enum: ["complete", "modify", "delete"],
          description: "The action to take on the todo item"
        },
        new_text: {
          type: "string",
          description: "New text for the todo (only used with 'modify' action)"
        },
        new_priority: {
          type: "string",
          enum: ["high", "medium", "low"],
          description: "New priority for the todo (optional, only used with 'modify' action)"
        }
      },
      required: ["todo_id", "action"]
    }
  }
];

// Helper to load current todos from file
async function loadTodos(firmRoot: string): Promise<{ updated_at: string; todos: FirmTodo[] }> {
  const todosPath = join(firmRoot, ".pi_tool", "todos.json");
  try {
    const content = await readFile(todosPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return { updated_at: new Date().toISOString(), todos: [] };
  }
}

// Helper to save todos to file
async function saveTodos(firmRoot: string, todos: FirmTodo[]): Promise<void> {
  const todosDir = join(firmRoot, ".pi_tool");
  const todosPath = join(todosDir, "todos.json");
  await mkdir(todosDir, { recursive: true });
  const data = {
    updated_at: new Date().toISOString(),
    todos,
  };
  await writeFile(todosPath, JSON.stringify(data, null, 2));
}

// Execute a tool and return result
async function executeTool(
  toolName: string,
  toolInput: Record<string, any>,
  firmRoot: string
): Promise<string> {
  try {
    switch (toolName) {
      case "read_file": {
        const filePath = join(firmRoot, toolInput.path);
        // Security check - ensure path is within firm root
        if (!filePath.startsWith(firmRoot)) {
          return "Error: Cannot read files outside the firm folder";
        }
        const content = await readFile(filePath, "utf-8");
        return content.slice(0, 15000); // Limit output to avoid context overflow
      }

      case "get_case_details": {
        const caseName = toolInput.case_name;
        const casePath = join(firmRoot, caseName);
        const indexPath = join(casePath, ".pi_tool", "document_index.json");

        try {
          const indexContent = await readFile(indexPath, "utf-8");
          const index = JSON.parse(indexContent);

          // Return a trimmed version focused on key details
          const trimmed = {
            case_name: index.case_name,
            case_phase: index.case_phase,
            summary: index.summary,
            case_analysis: index.case_analysis,
            liability_assessment: index.liability_assessment,
            injury_tier: index.injury_tier,
            estimated_value_range: index.estimated_value_range,
            needs_review: index.needs_review,
          };

          return JSON.stringify(trimmed, null, 2);
        } catch {
          return `Error: Could not find case index for "${caseName}". Make sure the case folder exists and is indexed.`;
        }
      }

      case "update_todos": {
        const todos = toolInput.todos as Array<{ text: string; caseRef?: string; priority: string }>;

        // Transform to FirmTodo format with IDs
        const firmTodos: FirmTodo[] = todos.map((t, i) => ({
          id: `todo-${Date.now()}-${i}`,
          text: t.text,
          caseRef: t.caseRef,
          priority: (t.priority || "medium") as "high" | "medium" | "low",
          status: "pending",
          createdAt: new Date().toISOString(),
        }));

        // Save to file
        const todosDir = join(firmRoot, ".pi_tool");
        const todosPath = join(todosDir, "todos.json");

        await mkdir(todosDir, { recursive: true });

        const data = {
          updated_at: new Date().toISOString(),
          todos: firmTodos,
        };

        await writeFile(todosPath, JSON.stringify(data, null, 2));
        return `Successfully saved ${firmTodos.length} tasks to the firm todo list.`;
      }

      case "generate_report": {
        // For now, return a message indicating delegation would happen
        // In a full implementation, this would call a Sonnet agent
        const reportType = toolInput.report_type;
        const instructions = toolInput.instructions;

        return `Report generation for "${reportType}" would be delegated to a specialized agent. Instructions: ${instructions}. (Note: Full report delegation not yet implemented - please provide the analysis directly based on the portfolio data.)`;
      }

      case "start_review": {
        // Load current todos and return pending items for review
        const todosData = await loadTodos(firmRoot);
        const pendingTodos = todosData.todos.filter(t => t.status === "pending");

        if (pendingTodos.length === 0) {
          return JSON.stringify({
            status: "no_items",
            message: "There are no pending tasks to review.",
            pending_count: 0
          });
        }

        // Return the pending todos for the agent to walk through
        return JSON.stringify({
          status: "review_started",
          message: `Found ${pendingTodos.length} pending task(s) to review.`,
          pending_count: pendingTodos.length,
          items: pendingTodos.map((t, index) => ({
            index: index + 1,
            id: t.id,
            text: t.text,
            caseRef: t.caseRef || null,
            priority: t.priority,
            createdAt: t.createdAt
          }))
        });
      }

      case "update_todo_item": {
        const { todo_id, action, new_text, new_priority } = toolInput;
        const todosData = await loadTodos(firmRoot);
        const todoIndex = todosData.todos.findIndex(t => t.id === todo_id);

        if (todoIndex === -1) {
          return JSON.stringify({
            success: false,
            error: `Todo item with ID "${todo_id}" not found.`
          });
        }

        const todo = todosData.todos[todoIndex];
        let resultMessage = "";

        switch (action) {
          case "complete":
            todosData.todos[todoIndex].status = "completed";
            resultMessage = `Marked "${todo.text}" as completed.`;
            break;
          case "modify":
            if (new_text) {
              todosData.todos[todoIndex].text = new_text;
            }
            if (new_priority) {
              todosData.todos[todoIndex].priority = new_priority as "high" | "medium" | "low";
            }
            resultMessage = `Updated "${todo.text}"${new_text ? ` to "${new_text}"` : ""}${new_priority ? ` with priority ${new_priority}` : ""}.`;
            break;
          case "delete":
            todosData.todos.splice(todoIndex, 1);
            resultMessage = `Deleted "${todo.text}".`;
            break;
          default:
            return JSON.stringify({
              success: false,
              error: `Unknown action: ${action}`
            });
        }

        // Save updated todos
        await saveTodos(firmRoot, todosData.todos);

        // Count remaining pending items
        const remainingPending = todosData.todos.filter(t => t.status === "pending").length;

        return JSON.stringify({
          success: true,
          message: resultMessage,
          remaining_pending: remainingPending
        });
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (error) {
    return `Error executing ${toolName}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// Build context from firm data
async function buildFirmContext(firmRoot: string): Promise<string> {
  const parts: string[] = [];

  // Current date
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  parts.push(`TODAY'S DATE: ${dateStr}`);

  // Load firm config
  try {
    const configPath = join(firmRoot, ".pi_tool", "firm-config.json");
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    parts.push(`\n## FIRM CONFIGURATION\n${JSON.stringify(config, null, 2)}`);
  } catch {
    // No config file
  }

  // Load knowledge manifest (abbreviated)
  try {
    const manifestPath = join(firmRoot, ".pi_tool", "knowledge", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    parts.push(`\n## PRACTICE KNOWLEDGE\nArea: ${manifest.practiceArea} (${manifest.jurisdiction})`);

    if (manifest.sections) {
      const sectionList = manifest.sections.slice(0, 10).map((s: any) => `- ${s.title}`).join('\n');
      parts.push(`Available sections:\n${sectionList}`);
    }
  } catch {
    // No knowledge base
  }

  // Load templates list
  try {
    const templatesPath = join(firmRoot, ".pi_tool", "templates", "templates.json");
    const templatesData = JSON.parse(await readFile(templatesPath, "utf-8"));
    if (templatesData.templates?.length > 0) {
      const templateList = templatesData.templates
        .map((t: any) => `- ${t.name}: ${t.description || 'No description'}`)
        .join("\n");
      parts.push(`\n## AVAILABLE DOCUMENT TEMPLATES\n${templateList}`);
    }
  } catch {
    // No templates
  }

  // Build portfolio summary
  const caseSummaries: any[] = [];
  const casesByPhase: Record<string, number> = {};
  let totalSpecials = 0;
  let solUrgent = 0;
  let indexedCount = 0;

  try {
    const entries = await readdir(firmRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".pi_tool") continue;

      const casePath = join(firmRoot, entry.name);
      const indexPath = join(casePath, ".pi_tool", "document_index.json");

      try {
        const indexContent = await readFile(indexPath, "utf-8");
        const index = JSON.parse(indexContent);
        indexedCount++;

        // Parse amounts consistently
        const parseAmount = (val: any): number => {
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const cleaned = val.replace(/[$,]/g, '');
            const num = parseFloat(cleaned);
            return isNaN(num) ? 0 : num;
          }
          return 0;
        };

        const clientName = index.summary?.client || index.client_name || index.case_name?.split(" v.")[0] || entry.name;
        const casePhase = index.case_phase || index.summary?.case_phase || "Unknown";
        const dateOfLoss = index.summary?.dol || index.date_of_loss || "";
        const specials = parseAmount(index.total_specials)
          || parseAmount(index.summary?.total_specials)
          || parseAmount(index.summary?.total_charges)
          || 0;

        // Calculate SOL days remaining
        let solDaysRemaining: number | undefined;
        let statuteOfLimitations = index.statute_of_limitations || index.summary?.statute_of_limitations;

        if (!statuteOfLimitations && dateOfLoss) {
          try {
            const dolStr = dateOfLoss;
            let dolDate: Date;
            if (dolStr.includes('/')) {
              const [month, day, year] = dolStr.split('/');
              dolDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
            } else {
              dolDate = new Date(dolStr);
            }
            if (!isNaN(dolDate.getTime())) {
              const solDate = new Date(dolDate);
              solDate.setFullYear(solDate.getFullYear() + 2);
              statuteOfLimitations = solDate.toISOString().split('T')[0];
            }
          } catch {
            // Could not parse DOL
          }
        }

        if (statuteOfLimitations) {
          const solDate = new Date(statuteOfLimitations);
          const diffMs = solDate.getTime() - now.getTime();
          solDaysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
          if (solDaysRemaining <= 90) solUrgent++;
        }

        // Extract providers
        let providers: string[] = [];
        if (index.providers) {
          providers = Array.isArray(index.providers)
            ? index.providers.map((p: any) => typeof p === 'string' ? p : p.name)
            : Object.keys(index.providers);
        } else if (index.summary?.providers) {
          providers = index.summary.providers;
        }

        // Extract policy limits
        let policyLimits: string | undefined;
        const limits = index.policy_limits || index.summary?.policy_limits;
        if (typeof limits === 'string') {
          policyLimits = limits;
        } else if (typeof limits === 'object' && limits !== null) {
          const biValue = limits['3P_bi'] || limits['3p_bi'] || limits['bi'] || limits['bodily_injury'] || limits['3P'];
          if (typeof biValue === 'string') policyLimits = biValue;
        }

        // Track phase counts
        casesByPhase[casePhase] = (casesByPhase[casePhase] || 0) + 1;
        totalSpecials += specials;

        caseSummaries.push({
          folder: entry.name,
          clientName,
          casePhase,
          dateOfLoss,
          totalSpecials: specials,
          solDaysRemaining,
          providers,
          policyLimits,
        });
      } catch {
        // Case not indexed, skip
      }
    }

    // Sort by SOL urgency
    caseSummaries.sort((a, b) => {
      if (a.solDaysRemaining !== undefined && b.solDaysRemaining !== undefined) {
        return a.solDaysRemaining - b.solDaysRemaining;
      }
      if (a.solDaysRemaining !== undefined) return -1;
      if (b.solDaysRemaining !== undefined) return 1;
      return a.clientName.localeCompare(b.clientName);
    });

    // Add portfolio metrics
    parts.push(`\n## PORTFOLIO METRICS
- Total Cases: ${entries.filter(e => e.isDirectory() && e.name !== ".pi_tool").length}
- Indexed Cases: ${indexedCount}
- Total Medical Specials: $${totalSpecials.toLocaleString()}
- Cases with SOL < 90 days: ${solUrgent}

CASES BY PHASE:
${Object.entries(casesByPhase).map(([phase, count]) => `- ${phase}: ${count}`).join('\n')}`);

    // Add case summaries
    parts.push(`\n## CASE SUMMARIES (sorted by SOL urgency)`);
    for (const c of caseSummaries) {
      parts.push(`
### ${c.clientName} (${c.folder})
- Phase: ${c.casePhase}
- DOL: ${c.dateOfLoss || 'Unknown'}
- Specials: $${c.totalSpecials.toLocaleString()}
- SOL: ${c.solDaysRemaining !== undefined ? `${c.solDaysRemaining} days remaining` : 'Unknown'}
- Policy: ${c.policyLimits || 'Unknown'}
- Providers: ${c.providers.length > 0 ? c.providers.join(', ') : 'None listed'}`);
    }

  } catch (error) {
    parts.push(`\nError loading portfolio data: ${error instanceof Error ? error.message : String(error)}`);
  }

  parts.push(`\n## FIRM ROOT DIRECTORY\n${firmRoot}`);

  return parts.join("\n");
}

// System prompt for firm chat
const BASE_SYSTEM_PROMPT = `You are a helpful legal assistant for a Personal Injury law firm. You help attorneys and staff with firm-level portfolio analysis, case management, and task generation.

## YOUR CAPABILITIES

1. **Answer Questions**: Use the portfolio data to answer questions about cases, deadlines, and financial summaries.

2. **Read Firm Documents**: Use read_file to review firm configuration, knowledge base, or templates when needed.

3. **Get Case Details**: Use get_case_details when you need more information than the summary provides about a specific case.

4. **Update Todos**: Use update_todos when the user asks to generate tasks, create action items, or add todos.

5. **Generate Reports**: Use generate_report to delegate formal report generation to a specialized agent.

6. **Review Tasks**: Use start_review when the user wants to review their pending tasks interactively.

## WHEN TO USE get_case_details

Use this tool when:
- User asks for specific details about a case that aren't in the summary
- You need case analysis, liability assessment, or injury tier info
- User wants to know about a case's needs_review items

Do NOT use it for:
- Questions answerable from the portfolio summary
- General portfolio analysis
- Phase distributions or financial summaries

## WHEN TO USE update_todos

Use this tool when the user says:
- "Generate a task list"
- "Create action items"
- "Add tasks for..."
- "What should we work on?"
- "Prioritize the workload"

Always use high/medium/low priorities based on:
- **High**: SOL < 30 days, urgent deadlines, critical issues
- **Medium**: SOL 30-90 days, follow-ups needed, pending items
- **Low**: Routine tasks, early stage cases, no urgency

## REVIEW MODE

When the user asks to "review tasks", "review my todos", "go through tasks", or similar, use the start_review tool to enter review mode.

**In review mode:**
1. Call start_review to get all pending tasks
2. Present the FIRST pending item to the user with context:
   - Show the task text and priority
   - If it has a caseRef, mention which case it's related to
   - Ask: "What would you like to do? (complete / skip / modify / delete)"
3. Wait for the user's response
4. Based on their response:
   - **complete**: Use update_todo_item with action "complete"
   - **skip**: Move to the next item without changes
   - **modify**: Ask what they want to change, then use update_todo_item with action "modify"
   - **delete**: Use update_todo_item with action "delete"
   - **done**: Exit review mode and provide a summary
5. After processing, present the NEXT pending item
6. Continue until all items are reviewed or user says "done"
7. When finished, provide a summary of changes made

**Example review interaction:**
User: "Let's review my tasks"
Assistant: [calls start_review]
Assistant: "Let's review your 3 pending tasks.

**Task 1 of 3** [HIGH]
Request medical records for Garcia case
Related to: Garcia, Maria

What would you like to do? (complete / skip / modify / delete)"

User: "complete"
Assistant: [calls update_todo_item with action "complete"]
Assistant: "Done! Marked as completed.

**Task 2 of 3** [MEDIUM]
Follow up on Smith settlement offer

What would you like to do? (complete / skip / modify / delete)"

## GUIDELINES

- Be concise but thorough
- Answer from the portfolio data when possible - no need for tools on simple lookups
- Use specific case names when relevant
- Keep responses professional and actionable
- When generating tasks, also include the JSON in your response for display
- In review mode, present one item at a time and wait for user input before proceeding`;

// Main chat function with streaming
export async function* directFirmChat(
  firmRoot: string,
  message: string,
  history: ChatMessage[] = []
): AsyncGenerator<{ type: string; content?: string; tool?: string; done?: boolean; usage?: any; todos?: any[] }> {

  // Build context and include it in the system prompt
  const context = await buildFirmContext(firmRoot);
  const systemPrompt = `${BASE_SYSTEM_PROMPT}\n\n---\n\n${context}`;

  // Build messages array from history
  const messages: Anthropic.MessageParam[] = [];

  // Add history
  for (const msg of history) {
    messages.push({
      role: msg.role,
      content: msg.content
    });
  }

  // Add current message
  messages.push({
    role: "user",
    content: message
  });

  // Initial API call - context is in system prompt, available on every turn
  let response = await getClient().messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    system: systemPrompt,
    messages,
    tools: TOOLS,
    stream: true
  });

  let fullText = "";
  let toolUseBlocks: Array<{ id: string; name: string; input: any }> = [];
  let currentToolUse: { id: string; name: string; input: string } | null = null;
  let stopReason: string | null = null;
  let savedTodos: any[] | undefined;

  // Process streaming response
  for await (const event of response) {
    if (event.type === "content_block_start") {
      if (event.content_block.type === "tool_use") {
        currentToolUse = {
          id: event.content_block.id,
          name: event.content_block.name,
          input: ""
        };
        yield { type: "tool", tool: event.content_block.name };
      }
    } else if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta") {
        fullText += event.delta.text;
        yield { type: "text", content: event.delta.text };
      } else if (event.delta.type === "input_json_delta" && currentToolUse) {
        currentToolUse.input += event.delta.partial_json;
      }
    } else if (event.type === "content_block_stop") {
      if (currentToolUse) {
        try {
          toolUseBlocks.push({
            id: currentToolUse.id,
            name: currentToolUse.name,
            input: JSON.parse(currentToolUse.input)
          });
        } catch {
          // Invalid JSON, skip
        }
        currentToolUse = null;
      }
    } else if (event.type === "message_delta") {
      stopReason = event.delta.stop_reason;
    } else if (event.type === "message_stop") {
      // Message complete
    }
  }

  // Handle tool use if needed
  if (stopReason === "tool_use" && toolUseBlocks.length > 0) {
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      yield { type: "tool_executing", tool: toolUse.name };
      const result = await executeTool(toolUse.name, toolUse.input, firmRoot);

      // Track saved todos for the response
      if (toolUse.name === "update_todos" && toolUse.input.todos) {
        savedTodos = toolUse.input.todos;
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result
      });
    }

    // Continue with tool results
    messages.push({
      role: "assistant",
      content: [
        ...(fullText ? [{ type: "text" as const, text: fullText }] : []),
        ...toolUseBlocks.map(t => ({
          type: "tool_use" as const,
          id: t.id,
          name: t.name,
          input: t.input
        }))
      ]
    });

    messages.push({
      role: "user",
      content: toolResults
    });

    // Make follow-up call (non-streaming for simplicity after tool use)
    const followUp = await getClient().messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      tools: TOOLS
    });

    // Extract text from follow-up
    for (const block of followUp.content) {
      if (block.type === "text") {
        yield { type: "text", content: block.text };
        fullText += block.text;
      }
    }

    yield {
      type: "done",
      done: true,
      todos: savedTodos,
      usage: {
        inputTokens: followUp.usage.input_tokens,
        outputTokens: followUp.usage.output_tokens
      }
    };
  } else {
    yield {
      type: "done",
      done: true
    };
  }
}
