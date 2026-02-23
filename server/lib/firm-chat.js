"use strict";
/**
 * Direct Firm Chat API
 *
 * Fast, lightweight firm-level chat using direct Anthropic API calls.
 * Has access to portfolio context and tools for getting case details,
 * updating todos, and delegating report generation.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype), verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function () { return this; }, i;
    function awaitReturn(f) { return function (v) { return Promise.resolve(v).then(f, reject); }; }
    function verb(n, f) { if (g[n]) { i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; if (f) i[n] = f(i[n]); } }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.directFirmChat = directFirmChat;
var sdk_1 = require("@anthropic-ai/sdk");
var promises_1 = require("fs/promises");
var path_1 = require("path");
var date_format_1 = require("./date-format");
var extract_1 = require("./extract");
// Lazy client creation - API key is set by auth middleware before requests
// Web shim (imported in server/index.ts) handles runtime selection
var _anthropic = null;
function getClient() {
    if (!_anthropic) {
        // Explicitly pass API key - env var reading may not work in bundled binary
        _anthropic = new sdk_1.default({
            apiKey: process.env.ANTHROPIC_API_KEY,
            fetch: globalThis.fetch.bind(globalThis),
        });
    }
    return _anthropic;
}
// Tool definitions
var TOOLS = [
    {
        name: "read_file",
        description: "Read a firm-level file (knowledge base, template, config). Use for reading firm configuration or knowledge documents.",
        input_schema: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "Relative path from firm root (e.g., '.ai_tool/firm-config.json', '.ai_tool/knowledge/manifest.json')"
                }
            },
            required: ["path"]
        }
    },
    {
        name: "get_case_details",
        description: "Get full index details for a specific case by folder name. Use when you need more information than the summary provides about a specific case.",
        input_schema: {
            type: "object",
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
            type: "object",
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
            type: "object",
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
            type: "object",
            properties: {},
            required: []
        }
    },
    {
        name: "update_todo_item",
        description: "Update a specific todo item during review mode. Use this to mark items as completed, modify their text, or delete them.",
        input_schema: {
            type: "object",
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
function loadTodos(firmRoot) {
    return __awaiter(this, void 0, void 0, function () {
        var todosPath, content, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    todosPath = (0, path_1.join)(firmRoot, ".ai_tool", "todos.json");
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, promises_1.readFile)(todosPath, "utf-8")];
                case 2:
                    content = _b.sent();
                    return [2 /*return*/, JSON.parse(content)];
                case 3:
                    _a = _b.sent();
                    return [2 /*return*/, { updated_at: new Date().toISOString(), todos: [] }];
                case 4: return [2 /*return*/];
            }
        });
    });
}
// Helper to save todos to file
function saveTodos(firmRoot, todos) {
    return __awaiter(this, void 0, void 0, function () {
        var todosDir, todosPath, data;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    todosDir = (0, path_1.join)(firmRoot, ".ai_tool");
                    todosPath = (0, path_1.join)(todosDir, "todos.json");
                    return [4 /*yield*/, (0, promises_1.mkdir)(todosDir, { recursive: true })];
                case 1:
                    _a.sent();
                    data = {
                        updated_at: new Date().toISOString(),
                        todos: todos,
                    };
                    return [4 /*yield*/, (0, promises_1.writeFile)(todosPath, JSON.stringify(data, null, 2))];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
function normalizeAssignments(input) {
    if (!Array.isArray(input))
        return [];
    return input
        .filter(function (assignment) {
        return !!assignment &&
            typeof assignment === "object" &&
            typeof assignment.userId === "string";
    })
        .map(function (assignment) { return ({
        userId: assignment.userId,
        assignedAt: assignment.assignedAt,
        assignedBy: assignment.assignedBy,
    }); });
}
function isCaseVisibleForScope(assignments, scope, actorUserId) {
    if (!scope || scope.mode === "firm")
        return true;
    if (scope.mode === "mine") {
        if (!actorUserId)
            return false;
        return assignments.some(function (assignment) { return assignment.userId === actorUserId; });
    }
    return assignments.some(function (assignment) { return assignment.userId === scope.memberId; });
}
function formatAssignmentLabels(assignments, memberById) {
    if (assignments.length === 0)
        return [];
    return assignments.map(function (assignment) {
        var member = memberById.get(assignment.userId);
        if (!member)
            return assignment.userId;
        return member.name ? "".concat(member.name, " (").concat(member.email, ")") : member.email;
    });
}
// Execute a tool and return result
function executeTool(toolName, toolInput, firmRoot, options) {
    return __awaiter(this, void 0, void 0, function () {
        var memberById, _a, filePath, normalizedPath, text, _b, content, caseName, casePath, indexPath, indexContent, index, assignments, trimmed, _c, todos, firmTodos, todosDir, todosPath, data, reportType, instructions, todosData, pendingTodos, todo_id_1, action, new_text, new_priority, todosData, todoIndex, todo, resultMessage, remainingPending, error_1;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    memberById = new Map(((options === null || options === void 0 ? void 0 : options.teamMembers) || []).map(function (member) { return [member.id, member]; }));
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 23, , 24]);
                    _a = toolName;
                    switch (_a) {
                        case "read_file": return [3 /*break*/, 2];
                        case "get_case_details": return [3 /*break*/, 8];
                        case "update_todos": return [3 /*break*/, 12];
                        case "generate_report": return [3 /*break*/, 15];
                        case "start_review": return [3 /*break*/, 16];
                        case "update_todo_item": return [3 /*break*/, 18];
                    }
                    return [3 /*break*/, 21];
                case 2:
                    filePath = (0, path_1.join)(firmRoot, toolInput.path);
                    // Security check - ensure path is within firm root
                    if (!filePath.startsWith(firmRoot)) {
                        return [2 /*return*/, "Error: Cannot read files outside the firm folder"];
                    }
                    normalizedPath = toolInput.path.toLowerCase();
                    if (!normalizedPath.endsWith(".docx")) return [3 /*break*/, 6];
                    _d.label = 3;
                case 3:
                    _d.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, (0, extract_1.extractTextFromDocx)(filePath)];
                case 4:
                    text = _d.sent();
                    return [2 /*return*/, text.slice(0, 15000)];
                case 5:
                    _b = _d.sent();
                    return [2 /*return*/, "Error: Could not extract text from DOCX"];
                case 6: return [4 /*yield*/, (0, promises_1.readFile)(filePath, "utf-8")];
                case 7:
                    content = _d.sent();
                    return [2 /*return*/, content.slice(0, 15000)]; // Limit output to avoid context overflow
                case 8:
                    caseName = toolInput.case_name;
                    casePath = (0, path_1.join)(firmRoot, caseName);
                    indexPath = (0, path_1.join)(casePath, ".ai_tool", "document_index.json");
                    _d.label = 9;
                case 9:
                    _d.trys.push([9, 11, , 12]);
                    return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
                case 10:
                    indexContent = _d.sent();
                    index = JSON.parse(indexContent);
                    assignments = normalizeAssignments(index.assignments);
                    if (!isCaseVisibleForScope(assignments, options === null || options === void 0 ? void 0 : options.scope, options === null || options === void 0 ? void 0 : options.actorUserId)) {
                        return [2 /*return*/, "Error: \"".concat(caseName, "\" is outside your current case view scope.")];
                    }
                    trimmed = {
                        case_name: index.case_name,
                        case_phase: index.case_phase,
                        summary: index.summary,
                        case_analysis: index.case_analysis,
                        liability_assessment: index.liability_assessment,
                        injury_tier: index.injury_tier,
                        estimated_value_range: index.estimated_value_range,
                        needs_review: index.needs_review,
                        assignments: formatAssignmentLabels(assignments, memberById),
                    };
                    return [2 /*return*/, JSON.stringify(trimmed, null, 2)];
                case 11:
                    _c = _d.sent();
                    return [2 /*return*/, "Error: Could not find case index for \"".concat(caseName, "\". Make sure the case folder exists and is indexed.")];
                case 12:
                    todos = toolInput.todos;
                    firmTodos = todos.map(function (t, i) { return ({
                        id: "todo-".concat(Date.now(), "-").concat(i),
                        text: t.text,
                        caseRef: t.caseRef,
                        priority: (t.priority || "medium"),
                        status: "pending",
                        createdAt: new Date().toISOString(),
                    }); });
                    todosDir = (0, path_1.join)(firmRoot, ".ai_tool");
                    todosPath = (0, path_1.join)(todosDir, "todos.json");
                    return [4 /*yield*/, (0, promises_1.mkdir)(todosDir, { recursive: true })];
                case 13:
                    _d.sent();
                    data = {
                        updated_at: new Date().toISOString(),
                        todos: firmTodos,
                    };
                    return [4 /*yield*/, (0, promises_1.writeFile)(todosPath, JSON.stringify(data, null, 2))];
                case 14:
                    _d.sent();
                    return [2 /*return*/, "Successfully saved ".concat(firmTodos.length, " tasks to the firm todo list.")];
                case 15:
                    {
                        reportType = toolInput.report_type;
                        instructions = toolInput.instructions;
                        return [2 /*return*/, "Report generation for \"".concat(reportType, "\" would be delegated to a specialized agent. Instructions: ").concat(instructions, ". (Note: Full report delegation not yet implemented - please provide the analysis directly based on the portfolio data.)")];
                    }
                    _d.label = 16;
                case 16: return [4 /*yield*/, loadTodos(firmRoot)];
                case 17:
                    todosData = _d.sent();
                    pendingTodos = todosData.todos.filter(function (t) { return t.status === "pending"; });
                    if (pendingTodos.length === 0) {
                        return [2 /*return*/, JSON.stringify({
                                status: "no_items",
                                message: "There are no pending tasks to review.",
                                pending_count: 0
                            })];
                    }
                    // Return the pending todos for the agent to walk through
                    return [2 /*return*/, JSON.stringify({
                            status: "review_started",
                            message: "Found ".concat(pendingTodos.length, " pending task(s) to review."),
                            pending_count: pendingTodos.length,
                            items: pendingTodos.map(function (t, index) { return ({
                                index: index + 1,
                                id: t.id,
                                text: t.text,
                                caseRef: t.caseRef || null,
                                priority: t.priority,
                                createdAt: t.createdAt
                            }); })
                        })];
                case 18:
                    todo_id_1 = toolInput.todo_id, action = toolInput.action, new_text = toolInput.new_text, new_priority = toolInput.new_priority;
                    return [4 /*yield*/, loadTodos(firmRoot)];
                case 19:
                    todosData = _d.sent();
                    todoIndex = todosData.todos.findIndex(function (t) { return t.id === todo_id_1; });
                    if (todoIndex === -1) {
                        return [2 /*return*/, JSON.stringify({
                                success: false,
                                error: "Todo item with ID \"".concat(todo_id_1, "\" not found.")
                            })];
                    }
                    todo = todosData.todos[todoIndex];
                    resultMessage = "";
                    switch (action) {
                        case "complete":
                            todosData.todos[todoIndex].status = "completed";
                            resultMessage = "Marked \"".concat(todo.text, "\" as completed.");
                            break;
                        case "modify":
                            if (new_text) {
                                todosData.todos[todoIndex].text = new_text;
                            }
                            if (new_priority) {
                                todosData.todos[todoIndex].priority = new_priority;
                            }
                            resultMessage = "Updated \"".concat(todo.text, "\"").concat(new_text ? " to \"".concat(new_text, "\"") : "").concat(new_priority ? " with priority ".concat(new_priority) : "", ".");
                            break;
                        case "delete":
                            todosData.todos.splice(todoIndex, 1);
                            resultMessage = "Deleted \"".concat(todo.text, "\".");
                            break;
                        default:
                            return [2 /*return*/, JSON.stringify({
                                    success: false,
                                    error: "Unknown action: ".concat(action)
                                })];
                    }
                    // Save updated todos
                    return [4 /*yield*/, saveTodos(firmRoot, todosData.todos)];
                case 20:
                    // Save updated todos
                    _d.sent();
                    remainingPending = todosData.todos.filter(function (t) { return t.status === "pending"; }).length;
                    return [2 /*return*/, JSON.stringify({
                            success: true,
                            message: resultMessage,
                            remaining_pending: remainingPending
                        })];
                case 21: return [2 /*return*/, "Unknown tool: ".concat(toolName)];
                case 22: return [3 /*break*/, 24];
                case 23:
                    error_1 = _d.sent();
                    return [2 /*return*/, "Error executing ".concat(toolName, ": ").concat(error_1 instanceof Error ? error_1.message : String(error_1))];
                case 24: return [2 /*return*/];
            }
        });
    });
}
// Build context from firm data
function buildFirmContext(firmRoot, options) {
    return __awaiter(this, void 0, void 0, function () {
        var parts, memberById, scope, now, dateStr, member, label, configPath, config, _a, _b, _c, manifestPath, manifest, _d, _e, sectionList, _f, templatesPath, templatesData, _g, _h, templateList, _j, caseSummaries, casesByPhase, totalSpecials, solUrgent, indexedCount, visibleCaseCount, entries, _i, entries_1, entry, casePath, indexPath, indexContent, index, assignments, parseAmount, clientName, casePhase, dateOfLoss, specials, solDaysRemaining, statuteOfLimitations, dolDate, solDate, solDate, diffMs, providers, policyLimits, limits, biValue, assignedTo, _k, _l, caseSummaries_1, c, error_2;
        var _m, _o, _p, _q, _r, _s, _t, _u, _v, _w;
        return __generator(this, function (_x) {
            switch (_x.label) {
                case 0:
                    parts = [];
                    memberById = new Map(((options === null || options === void 0 ? void 0 : options.teamMembers) || []).map(function (member) { return [member.id, member]; }));
                    scope = options === null || options === void 0 ? void 0 : options.scope;
                    now = new Date();
                    dateStr = (0, date_format_1.formatDateMMDDYYYY)(now);
                    parts.push("TODAY'S DATE: ".concat(dateStr));
                    if (!scope || scope.mode === "firm") {
                        parts.push("ACTIVE CASE VIEW: Firm (all cases)");
                    }
                    else if (scope.mode === "mine") {
                        parts.push("ACTIVE CASE VIEW: My cases");
                    }
                    else {
                        member = memberById.get(scope.memberId);
                        label = (member === null || member === void 0 ? void 0 : member.name) || (member === null || member === void 0 ? void 0 : member.email) || scope.memberId;
                        parts.push("ACTIVE CASE VIEW: ".concat(label, "'s cases"));
                    }
                    _x.label = 1;
                case 1:
                    _x.trys.push([1, 3, , 4]);
                    configPath = (0, path_1.join)(firmRoot, ".ai_tool", "firm-config.json");
                    _b = (_a = JSON).parse;
                    return [4 /*yield*/, (0, promises_1.readFile)(configPath, "utf-8")];
                case 2:
                    config = _b.apply(_a, [_x.sent()]);
                    parts.push("\n## FIRM CONFIGURATION\n".concat(JSON.stringify(config, null, 2)));
                    return [3 /*break*/, 4];
                case 3:
                    _c = _x.sent();
                    return [3 /*break*/, 4];
                case 4:
                    _x.trys.push([4, 6, , 7]);
                    manifestPath = (0, path_1.join)(firmRoot, ".ai_tool", "knowledge", "manifest.json");
                    _e = (_d = JSON).parse;
                    return [4 /*yield*/, (0, promises_1.readFile)(manifestPath, "utf-8")];
                case 5:
                    manifest = _e.apply(_d, [_x.sent()]);
                    parts.push("\n## PRACTICE KNOWLEDGE\nArea: ".concat(manifest.practiceArea, " (").concat(manifest.jurisdiction, ")"));
                    if (manifest.sections) {
                        sectionList = manifest.sections.slice(0, 10).map(function (s) { return "- ".concat(s.title); }).join('\n');
                        parts.push("Available sections:\n".concat(sectionList));
                    }
                    return [3 /*break*/, 7];
                case 6:
                    _f = _x.sent();
                    return [3 /*break*/, 7];
                case 7:
                    _x.trys.push([7, 9, , 10]);
                    templatesPath = (0, path_1.join)(firmRoot, ".ai_tool", "templates", "templates.json");
                    _h = (_g = JSON).parse;
                    return [4 /*yield*/, (0, promises_1.readFile)(templatesPath, "utf-8")];
                case 8:
                    templatesData = _h.apply(_g, [_x.sent()]);
                    if (((_m = templatesData.templates) === null || _m === void 0 ? void 0 : _m.length) > 0) {
                        templateList = templatesData.templates
                            .map(function (t) { return "- ".concat(t.name, ": ").concat(t.description || 'No description'); })
                            .join("\n");
                        parts.push("\n## AVAILABLE DOCUMENT TEMPLATES\n".concat(templateList));
                    }
                    return [3 /*break*/, 10];
                case 9:
                    _j = _x.sent();
                    return [3 /*break*/, 10];
                case 10:
                    caseSummaries = [];
                    casesByPhase = {};
                    totalSpecials = 0;
                    solUrgent = 0;
                    indexedCount = 0;
                    visibleCaseCount = 0;
                    _x.label = 11;
                case 11:
                    _x.trys.push([11, 19, , 20]);
                    return [4 /*yield*/, (0, promises_1.readdir)(firmRoot, { withFileTypes: true })];
                case 12:
                    entries = _x.sent();
                    _i = 0, entries_1 = entries;
                    _x.label = 13;
                case 13:
                    if (!(_i < entries_1.length)) return [3 /*break*/, 18];
                    entry = entries_1[_i];
                    if (!entry.isDirectory() || entry.name === ".ai_tool")
                        return [3 /*break*/, 17];
                    casePath = (0, path_1.join)(firmRoot, entry.name);
                    indexPath = (0, path_1.join)(casePath, ".ai_tool", "document_index.json");
                    _x.label = 14;
                case 14:
                    _x.trys.push([14, 16, , 17]);
                    return [4 /*yield*/, (0, promises_1.readFile)(indexPath, "utf-8")];
                case 15:
                    indexContent = _x.sent();
                    index = JSON.parse(indexContent);
                    assignments = normalizeAssignments(index.assignments);
                    if (!isCaseVisibleForScope(assignments, scope, options === null || options === void 0 ? void 0 : options.actorUserId)) {
                        return [3 /*break*/, 17];
                    }
                    visibleCaseCount++;
                    indexedCount++;
                    parseAmount = function (val) {
                        if (typeof val === 'number')
                            return val;
                        if (typeof val === 'string') {
                            var cleaned = val.replace(/[$,]/g, '');
                            var num = parseFloat(cleaned);
                            return isNaN(num) ? 0 : num;
                        }
                        return 0;
                    };
                    clientName = ((_o = index.summary) === null || _o === void 0 ? void 0 : _o.client) || index.client_name || ((_p = index.case_name) === null || _p === void 0 ? void 0 : _p.split(" v.")[0]) || entry.name;
                    casePhase = index.case_phase || ((_q = index.summary) === null || _q === void 0 ? void 0 : _q.case_phase) || "Unknown";
                    dateOfLoss = ((_r = index.summary) === null || _r === void 0 ? void 0 : _r.dol) || index.date_of_loss || "";
                    specials = parseAmount(index.total_specials)
                        || parseAmount((_s = index.summary) === null || _s === void 0 ? void 0 : _s.total_specials)
                        || parseAmount((_t = index.summary) === null || _t === void 0 ? void 0 : _t.total_charges)
                        || 0;
                    solDaysRemaining = void 0;
                    statuteOfLimitations = index.statute_of_limitations || ((_u = index.summary) === null || _u === void 0 ? void 0 : _u.statute_of_limitations);
                    if (!statuteOfLimitations && dateOfLoss) {
                        dolDate = (0, date_format_1.parseFlexibleDate)(dateOfLoss);
                        if (dolDate) {
                            solDate = new Date(dolDate);
                            solDate.setFullYear(solDate.getFullYear() + 2);
                            statuteOfLimitations = (0, date_format_1.formatDateYYYYMMDD)(solDate);
                        }
                    }
                    if (statuteOfLimitations) {
                        solDate = new Date(statuteOfLimitations);
                        diffMs = solDate.getTime() - now.getTime();
                        solDaysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                        if (solDaysRemaining <= 90)
                            solUrgent++;
                    }
                    providers = [];
                    if (index.providers) {
                        providers = Array.isArray(index.providers)
                            ? index.providers.map(function (p) { return typeof p === 'string' ? p : p.name; })
                            : Object.keys(index.providers);
                    }
                    else if ((_v = index.summary) === null || _v === void 0 ? void 0 : _v.providers) {
                        providers = index.summary.providers;
                    }
                    policyLimits = void 0;
                    limits = index.policy_limits || ((_w = index.summary) === null || _w === void 0 ? void 0 : _w.policy_limits);
                    if (typeof limits === 'string') {
                        policyLimits = limits;
                    }
                    else if (typeof limits === 'object' && limits !== null) {
                        biValue = limits['3P_bi'] || limits['3p_bi'] || limits['bi'] || limits['bodily_injury'] || limits['3P'];
                        if (typeof biValue === 'string')
                            policyLimits = biValue;
                    }
                    // Track phase counts
                    casesByPhase[casePhase] = (casesByPhase[casePhase] || 0) + 1;
                    totalSpecials += specials;
                    assignedTo = formatAssignmentLabels(assignments, memberById);
                    caseSummaries.push({
                        folder: entry.name,
                        clientName: clientName,
                        casePhase: casePhase,
                        dateOfLoss: dateOfLoss,
                        totalSpecials: specials,
                        solDaysRemaining: solDaysRemaining,
                        providers: providers,
                        policyLimits: policyLimits,
                        assignedTo: assignedTo,
                    });
                    return [3 /*break*/, 17];
                case 16:
                    _k = _x.sent();
                    // Case not indexed
                    if (!scope || scope.mode === "firm") {
                        visibleCaseCount++;
                    }
                    return [3 /*break*/, 17];
                case 17:
                    _i++;
                    return [3 /*break*/, 13];
                case 18:
                    // Sort by SOL urgency
                    caseSummaries.sort(function (a, b) {
                        if (a.solDaysRemaining !== undefined && b.solDaysRemaining !== undefined) {
                            return a.solDaysRemaining - b.solDaysRemaining;
                        }
                        if (a.solDaysRemaining !== undefined)
                            return -1;
                        if (b.solDaysRemaining !== undefined)
                            return 1;
                        return a.clientName.localeCompare(b.clientName);
                    });
                    // Add portfolio metrics
                    parts.push("\n## PORTFOLIO METRICS\n- Total Cases: ".concat(visibleCaseCount, "\n- Indexed Cases: ").concat(indexedCount, "\n- Total Medical Specials: $").concat(totalSpecials.toLocaleString(), "\n- Cases with SOL < 90 days: ").concat(solUrgent, "\n\nCASES BY PHASE:\n").concat(Object.entries(casesByPhase).map(function (_a) {
                        var phase = _a[0], count = _a[1];
                        return "- ".concat(phase, ": ").concat(count);
                    }).join('\n')));
                    // Add case summaries
                    parts.push("\n## CASE SUMMARIES (sorted by SOL urgency)");
                    if (caseSummaries.length === 0) {
                        parts.push("- No indexed cases found in the current view.");
                    }
                    for (_l = 0, caseSummaries_1 = caseSummaries; _l < caseSummaries_1.length; _l++) {
                        c = caseSummaries_1[_l];
                        parts.push("\n### ".concat(c.clientName, " (").concat(c.folder, ")\n- Phase: ").concat(c.casePhase, "\n- DOL: ").concat(c.dateOfLoss || 'Unknown', "\n- Specials: $").concat(c.totalSpecials.toLocaleString(), "\n- SOL: ").concat(c.solDaysRemaining !== undefined ? "".concat(c.solDaysRemaining, " days remaining") : 'Unknown', "\n- Policy: ").concat(c.policyLimits || 'Unknown', "\n- Providers: ").concat(c.providers.length > 0 ? c.providers.join(', ') : 'None listed', "\n- Assigned: ").concat(c.assignedTo && c.assignedTo.length > 0 ? c.assignedTo.join(', ') : 'Unassigned'));
                    }
                    return [3 /*break*/, 20];
                case 19:
                    error_2 = _x.sent();
                    parts.push("\nError loading portfolio data: ".concat(error_2 instanceof Error ? error_2.message : String(error_2)));
                    return [3 /*break*/, 20];
                case 20:
                    parts.push("\n## FIRM ROOT DIRECTORY\n".concat(firmRoot));
                    return [2 /*return*/, parts.join("\n")];
            }
        });
    });
}
// System prompt for firm chat
var BASE_SYSTEM_PROMPT = "You are a helpful legal assistant for a Personal Injury law firm. You help attorneys and staff with firm-level portfolio analysis, case management, and task generation.\n\n## YOUR CAPABILITIES\n\n1. **Answer Questions**: Use the portfolio data to answer questions about cases, deadlines, and financial summaries.\n\n2. **Read Firm Documents**: Use read_file to review firm configuration, knowledge base, or templates when needed.\n\n3. **Get Case Details**: Use get_case_details when you need more information than the summary provides about a specific case.\n\n4. **Update Todos**: Use update_todos when the user asks to generate tasks, create action items, or add todos.\n\n5. **Generate Reports**: Use generate_report to delegate formal report generation to a specialized agent.\n\n6. **Review Tasks**: Use start_review when the user wants to review their pending tasks interactively.\n\n## WHEN TO USE get_case_details\n\nUse this tool when:\n- User asks for specific details about a case that aren't in the summary\n- You need case analysis, liability assessment, or injury tier info\n- User wants to know about a case's needs_review items\n\nDo NOT use it for:\n- Questions answerable from the portfolio summary\n- General portfolio analysis\n- Phase distributions or financial summaries\n\n## WHEN TO USE update_todos\n\nUse this tool when the user says:\n- \"Generate a task list\"\n- \"Create action items\"\n- \"Add tasks for...\"\n- \"What should we work on?\"\n- \"Prioritize the workload\"\n\nAlways use high/medium/low priorities based on:\n- **High**: SOL < 30 days, urgent deadlines, critical issues\n- **Medium**: SOL 30-90 days, follow-ups needed, pending items\n- **Low**: Routine tasks, early stage cases, no urgency\n\n## REVIEW MODE\n\nWhen the user asks to \"review tasks\", \"review my todos\", \"go through tasks\", or similar, use the start_review tool to enter review mode.\n\n**In review mode:**\n1. Call start_review to get all pending tasks\n2. Present the FIRST pending item to the user with context:\n   - Show the task text and priority\n   - If it has a caseRef, mention which case it's related to\n   - Ask: \"What would you like to do? (complete / skip / modify / delete)\"\n3. Wait for the user's response\n4. Based on their response:\n   - **complete**: Use update_todo_item with action \"complete\"\n   - **skip**: Move to the next item without changes\n   - **modify**: Ask what they want to change, then use update_todo_item with action \"modify\"\n   - **delete**: Use update_todo_item with action \"delete\"\n   - **done**: Exit review mode and provide a summary\n5. After processing, present the NEXT pending item\n6. Continue until all items are reviewed or user says \"done\"\n7. When finished, provide a summary of changes made\n\n**Example review interaction:**\nUser: \"Let's review my tasks\"\nAssistant: [calls start_review]\nAssistant: \"Let's review your 3 pending tasks.\n\n**Task 1 of 3** [HIGH]\nRequest medical records for Garcia case\nRelated to: Garcia, Maria\n\nWhat would you like to do? (complete / skip / modify / delete)\"\n\nUser: \"complete\"\nAssistant: [calls update_todo_item with action \"complete\"]\nAssistant: \"Done! Marked as completed.\n\n**Task 2 of 3** [MEDIUM]\nFollow up on Smith settlement offer\n\nWhat would you like to do? (complete / skip / modify / delete)\"\n\n## GUIDELINES\n\n- Be concise but thorough\n- Answer from the portfolio data when possible - no need for tools on simple lookups\n- Use specific case names when relevant\n- Keep responses professional and actionable\n- When generating tasks, also include the JSON in your response for display\n- In review mode, present one item at a time and wait for user input before proceeding";
// Main chat function with streaming
function directFirmChat(firmRoot_1, message_1) {
    return __asyncGenerator(this, arguments, function directFirmChat_1(firmRoot, message, history, options) {
        var context, systemPrompt, messages, _i, history_1, msg, response, fullText, toolUseBlocks, currentToolUse, stopReason, savedTodos, _a, response_1, response_1_1, event_1, e_1_1, toolResults, _b, toolUseBlocks_1, toolUse, result, followUp, _c, _d, block;
        var _e, e_1, _f, _g;
        if (history === void 0) { history = []; }
        return __generator(this, function (_h) {
            switch (_h.label) {
                case 0: return [4 /*yield*/, __await(buildFirmContext(firmRoot, options))];
                case 1:
                    context = _h.sent();
                    systemPrompt = "".concat(BASE_SYSTEM_PROMPT, "\n\n---\n\n").concat(context);
                    messages = [];
                    // Add history
                    for (_i = 0, history_1 = history; _i < history_1.length; _i++) {
                        msg = history_1[_i];
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
                    return [4 /*yield*/, __await(getClient().messages.create({
                            model: "claude-haiku-4-5-20251001",
                            max_tokens: 4096,
                            system: systemPrompt,
                            messages: messages,
                            tools: TOOLS,
                            stream: true
                        }))];
                case 2:
                    response = _h.sent();
                    fullText = "";
                    toolUseBlocks = [];
                    currentToolUse = null;
                    stopReason = null;
                    _h.label = 3;
                case 3:
                    _h.trys.push([3, 17, 18, 23]);
                    _a = true, response_1 = __asyncValues(response);
                    _h.label = 4;
                case 4: return [4 /*yield*/, __await(response_1.next())];
                case 5:
                    if (!(response_1_1 = _h.sent(), _e = response_1_1.done, !_e)) return [3 /*break*/, 16];
                    _g = response_1_1.value;
                    _a = false;
                    event_1 = _g;
                    if (!(event_1.type === "content_block_start")) return [3 /*break*/, 9];
                    if (!(event_1.content_block.type === "tool_use")) return [3 /*break*/, 8];
                    currentToolUse = {
                        id: event_1.content_block.id,
                        name: event_1.content_block.name,
                        input: ""
                    };
                    return [4 /*yield*/, __await({ type: "tool", tool: event_1.content_block.name })];
                case 6: return [4 /*yield*/, _h.sent()];
                case 7:
                    _h.sent();
                    _h.label = 8;
                case 8: return [3 /*break*/, 15];
                case 9:
                    if (!(event_1.type === "content_block_delta")) return [3 /*break*/, 14];
                    if (!(event_1.delta.type === "text_delta")) return [3 /*break*/, 12];
                    fullText += event_1.delta.text;
                    return [4 /*yield*/, __await({ type: "text", content: event_1.delta.text })];
                case 10: return [4 /*yield*/, _h.sent()];
                case 11:
                    _h.sent();
                    return [3 /*break*/, 13];
                case 12:
                    if (event_1.delta.type === "input_json_delta" && currentToolUse) {
                        currentToolUse.input += event_1.delta.partial_json;
                    }
                    _h.label = 13;
                case 13: return [3 /*break*/, 15];
                case 14:
                    if (event_1.type === "content_block_stop") {
                        if (currentToolUse) {
                            try {
                                toolUseBlocks.push({
                                    id: currentToolUse.id,
                                    name: currentToolUse.name,
                                    input: JSON.parse(currentToolUse.input)
                                });
                            }
                            catch (_j) {
                                // Invalid JSON, skip
                            }
                            currentToolUse = null;
                        }
                    }
                    else if (event_1.type === "message_delta") {
                        stopReason = event_1.delta.stop_reason;
                    }
                    else if (event_1.type === "message_stop") {
                        // Message complete
                    }
                    _h.label = 15;
                case 15:
                    _a = true;
                    return [3 /*break*/, 4];
                case 16: return [3 /*break*/, 23];
                case 17:
                    e_1_1 = _h.sent();
                    e_1 = { error: e_1_1 };
                    return [3 /*break*/, 23];
                case 18:
                    _h.trys.push([18, , 21, 22]);
                    if (!(!_a && !_e && (_f = response_1.return))) return [3 /*break*/, 20];
                    return [4 /*yield*/, __await(_f.call(response_1))];
                case 19:
                    _h.sent();
                    _h.label = 20;
                case 20: return [3 /*break*/, 22];
                case 21:
                    if (e_1) throw e_1.error;
                    return [7 /*endfinally*/];
                case 22: return [7 /*endfinally*/];
                case 23:
                    if (!(stopReason === "tool_use" && toolUseBlocks.length > 0)) return [3 /*break*/, 38];
                    toolResults = [];
                    _b = 0, toolUseBlocks_1 = toolUseBlocks;
                    _h.label = 24;
                case 24:
                    if (!(_b < toolUseBlocks_1.length)) return [3 /*break*/, 29];
                    toolUse = toolUseBlocks_1[_b];
                    return [4 /*yield*/, __await({ type: "tool_executing", tool: toolUse.name })];
                case 25: return [4 /*yield*/, _h.sent()];
                case 26:
                    _h.sent();
                    return [4 /*yield*/, __await(executeTool(toolUse.name, toolUse.input, firmRoot, options))];
                case 27:
                    result = _h.sent();
                    // Track saved todos for the response
                    if (toolUse.name === "update_todos" && toolUse.input.todos) {
                        savedTodos = toolUse.input.todos;
                    }
                    toolResults.push({
                        type: "tool_result",
                        tool_use_id: toolUse.id,
                        content: result
                    });
                    _h.label = 28;
                case 28:
                    _b++;
                    return [3 /*break*/, 24];
                case 29:
                    // Continue with tool results
                    messages.push({
                        role: "assistant",
                        content: __spreadArray(__spreadArray([], (fullText ? [{ type: "text", text: fullText }] : []), true), toolUseBlocks.map(function (t) { return ({
                            type: "tool_use",
                            id: t.id,
                            name: t.name,
                            input: t.input
                        }); }), true)
                    });
                    messages.push({
                        role: "user",
                        content: toolResults
                    });
                    return [4 /*yield*/, __await(getClient().messages.create({
                            model: "claude-haiku-4-5-20251001",
                            max_tokens: 4096,
                            system: systemPrompt,
                            messages: messages,
                            tools: TOOLS
                        }))];
                case 30:
                    followUp = _h.sent();
                    _c = 0, _d = followUp.content;
                    _h.label = 31;
                case 31:
                    if (!(_c < _d.length)) return [3 /*break*/, 35];
                    block = _d[_c];
                    if (!(block.type === "text")) return [3 /*break*/, 34];
                    return [4 /*yield*/, __await({ type: "text", content: block.text })];
                case 32: return [4 /*yield*/, _h.sent()];
                case 33:
                    _h.sent();
                    fullText += block.text;
                    _h.label = 34;
                case 34:
                    _c++;
                    return [3 /*break*/, 31];
                case 35: return [4 /*yield*/, __await({
                        type: "done",
                        done: true,
                        todos: savedTodos,
                        usage: {
                            inputTokens: followUp.usage.input_tokens,
                            outputTokens: followUp.usage.output_tokens
                        }
                    })];
                case 36: return [4 /*yield*/, _h.sent()];
                case 37:
                    _h.sent();
                    return [3 /*break*/, 41];
                case 38: return [4 /*yield*/, __await({
                        type: "done",
                        done: true
                    })];
                case 39: return [4 /*yield*/, _h.sent()];
                case 40:
                    _h.sent();
                    _h.label = 41;
                case 41: return [2 /*return*/];
            }
        });
    });
}
