import { readFile, writeFile, mkdir } from "fs/promises";
import { basename, join } from "path";
import { buildDocumentId } from "./document-id";

export type TaskPriority = "high" | "medium" | "low";
export type TaskStatus = "pending" | "completed";

export interface FirmTodo {
  id: string;
  text: string;
  caseRef?: string;
  casePath?: string;
  priority: TaskPriority;
  status: TaskStatus;
  createdAt: string;
  taskKey?: string;
  sourceDocIds?: string[];
  sourceSignatures?: Record<string, string>;
  resolvedAt?: string;
}

export interface FirmTodosData {
  updated_at: string;
  todos: FirmTodo[];
}

export type TaskHistoryStatus = "completed" | "dismissed" | "reopened";

export interface TaskHistoryEntry {
  taskKey: string;
  status: TaskHistoryStatus;
  caseRef?: string;
  casePath?: string;
  text?: string;
  sourceSignatures?: Record<string, string>;
  lastResolvedAt?: string;
  updatedAt: string;
}

export interface CaseTaskScanState {
  caseRef: string;
  casePath: string;
  scannedAt: string;
  docSignatures: Record<string, string>;
}

export interface TaskMemoryData {
  updated_at: string;
  caseScans: Record<string, CaseTaskScanState>;
  history: Record<string, TaskHistoryEntry>;
}

export interface IndexedCaseDocument {
  docId: string;
  folder: string;
  filename: string;
  path: string;
  type: string;
  date?: string;
  keyInfo: string;
  signature: string;
}

export interface CaseTaskState {
  case_ref: string;
  case_path: string;
  total_documents: number;
  changed_documents_count: number;
  changed_documents: Array<{
    doc_id: string;
    path: string;
    type: string;
    date?: string;
    key_info: string;
  }>;
  pending_tasks: Array<{
    id: string;
    text: string;
    priority: TaskPriority;
    created_at: string;
    task_key?: string;
  }>;
  completed_task_history_count: number;
  last_scanned_at?: string;
}

export interface ProposedCaseTask {
  text: string;
  priority?: TaskPriority;
  source_documents?: string[];
  sourceDocuments?: string[];
  task_key?: string;
  taskKey?: string;
}

export interface ApplyCaseTaskProposalInput {
  firmRoot: string;
  caseFolder: string;
  indexData: any;
  tasks: ProposedCaseTask[];
  markAllDocumentsScanned?: boolean;
}

export interface ApplyCaseTaskProposalResult {
  success: boolean;
  case_ref: string;
  case_path: string;
  scanned_documents: number;
  changed_documents_count: number;
  added: number;
  skipped: number;
  added_tasks: FirmTodo[];
  skipped_items: Array<{ text: string; reason: string }>;
  pending_for_case: number;
}

const FIRM_DIR = ".ai_tool";
const TODOS_FILE = "todos.json";
const TASK_MEMORY_FILE = "task-memory.json";

function hashFNV1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
      .join(",")}}`;
  }

  return JSON.stringify(String(value));
}

function normalizeText(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s\t\n\r]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .trim();
}

function normalizePath(value: string): string {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .trim()
    .toLowerCase();
}

function normalizeCaseRef(value: string | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s\t\n\r]+/g, " ");
}

function normalizePriority(value: unknown): TaskPriority {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "high" || normalized === "low") return normalized;
  return "medium";
}

function normalizeStatus(value: unknown): TaskStatus {
  return String(value || "").trim().toLowerCase() === "completed"
    ? "completed"
    : "pending";
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const unique = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    unique.add(trimmed);
  }
  return unique.size > 0 ? Array.from(unique) : undefined;
}

function normalizeSignatureMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "string") continue;
    const normalizedKey = String(key).trim();
    const normalizedValue = raw.trim();
    if (!normalizedKey || !normalizedValue) continue;
    result[normalizedKey] = normalizedValue;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function signatureMapsEqual(
  left?: Record<string, string>,
  right?: Record<string, string>
): boolean {
  const leftEntries = Object.entries(left || {}).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right || {}).sort(([a], [b]) => a.localeCompare(b));

  if (leftEntries.length !== rightEntries.length) return false;
  for (let i = 0; i < leftEntries.length; i += 1) {
    if (leftEntries[i][0] !== rightEntries[i][0]) return false;
    if (leftEntries[i][1] !== rightEntries[i][1]) return false;
  }
  return true;
}

function buildTodoId(seed: string, index: number): string {
  return `todo-${Date.now()}-${index}-${hashFNV1a(seed).slice(0, 6)}`;
}

export function normalizeCaseKey(caseFolder: string): string {
  return normalizePath(caseFolder);
}

export function defaultCaseRefFromIndex(indexData: any, caseFolder: string): string {
  const fromSummary = typeof indexData?.summary?.client === "string"
    ? indexData.summary.client.trim()
    : "";
  if (fromSummary) return fromSummary;

  const fromCase = typeof indexData?.case_name === "string"
    ? indexData.case_name.trim()
    : "";
  if (fromCase) return fromCase;

  const folderName = basename(caseFolder).trim();
  return folderName || "Unknown Case";
}

function fileSignature(file: any): string {
  const payload = {
    type: typeof file?.type === "string" ? file.type : "other",
    key_info: typeof file?.key_info === "string" ? file.key_info : "",
    date: typeof file?.date === "string" ? file.date : null,
    issues: typeof file?.issues === "string" ? file.issues : null,
    has_handwritten_data: Boolean(file?.has_handwritten_data),
    handwritten_fields: Array.isArray(file?.handwritten_fields) ? file.handwritten_fields : [],
    user_reviewed: typeof file?.user_reviewed === "boolean" ? file.user_reviewed : null,
    reviewed_at: typeof file?.reviewed_at === "string" ? file.reviewed_at : null,
    review_notes: typeof file?.review_notes === "string" ? file.review_notes : null,
    user_context: typeof file?.user_context === "string" ? file.user_context : null,
    user_context_at: typeof file?.user_context_at === "string" ? file.user_context_at : null,
    extracted_data: file?.extracted_data ?? null,
  };
  return `sig_${hashFNV1a(stableStringify(payload))}`;
}

export function collectIndexedCaseDocuments(indexData: any): IndexedCaseDocument[] {
  const docs: IndexedCaseDocument[] = [];
  const folders = indexData?.folders && typeof indexData.folders === "object"
    ? indexData.folders
    : {};

  for (const [folderName, folderValue] of Object.entries(folders as Record<string, unknown>)) {
    const folderData = folderValue as any;
    const files = Array.isArray(folderData)
      ? folderData
      : Array.isArray(folderData?.files)
        ? folderData.files
        : [];

    for (const file of files) {
      const filename = typeof file?.filename === "string" ? file.filename.trim() : "";
      if (!filename) continue;

      const docId = typeof file?.doc_id === "string" && file.doc_id.trim()
        ? file.doc_id.trim()
        : buildDocumentId(folderName, filename);

      const normalizedFolder = String(folderName || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
      const path = normalizedFolder ? `${normalizedFolder}/${filename}` : filename;

      docs.push({
        docId,
        folder: folderName,
        filename,
        path,
        type: typeof file?.type === "string" ? file.type : "other",
        date: typeof file?.date === "string" && file.date.trim() ? file.date.trim() : undefined,
        keyInfo: typeof file?.key_info === "string" ? file.key_info : "",
        signature: fileSignature(file),
      });
    }
  }

  return docs;
}

export function buildTaskKey(
  caseRef: string,
  text: string,
  sourceDocIds: string[] = []
): string {
  const normalizedCase = normalizeCaseRef(caseRef);
  const normalizedText = normalizeText(text);
  const normalizedDocs = Array.from(new Set(sourceDocIds.map((entry) => entry.trim()).filter(Boolean))).sort();
  const seed = `${normalizedCase}|${normalizedText}|${normalizedDocs.join("|")}`;
  return `task_${hashFNV1a(seed)}`;
}

export function ensureTodoTaskKey(todo: FirmTodo): string {
  if (typeof todo.taskKey === "string" && todo.taskKey.trim()) {
    todo.taskKey = todo.taskKey.trim();
    return todo.taskKey;
  }

  const fallbackCase = todo.casePath?.trim() || todo.caseRef?.trim() || "";
  const fallbackDocs = Array.isArray(todo.sourceDocIds) ? todo.sourceDocIds : [];
  const taskKey = buildTaskKey(fallbackCase, todo.text, fallbackDocs);
  todo.taskKey = taskKey;
  return taskKey;
}

export async function loadFirmTodos(firmRoot: string): Promise<FirmTodosData> {
  const todosPath = join(firmRoot, FIRM_DIR, TODOS_FILE);
  try {
    const content = await readFile(todosPath, "utf-8");
    const parsed = JSON.parse(content);
    const todos = Array.isArray(parsed?.todos)
      ? parsed.todos.filter((todo: unknown) => !!todo && typeof todo === "object") as FirmTodo[]
      : [];

    return {
      updated_at: typeof parsed?.updated_at === "string" ? parsed.updated_at : new Date().toISOString(),
      todos,
    };
  } catch {
    return {
      updated_at: new Date().toISOString(),
      todos: [],
    };
  }
}

export async function saveFirmTodos(firmRoot: string, todos: FirmTodo[]): Promise<FirmTodosData> {
  const dir = join(firmRoot, FIRM_DIR);
  const todosPath = join(dir, TODOS_FILE);
  await mkdir(dir, { recursive: true });

  const data: FirmTodosData = {
    updated_at: new Date().toISOString(),
    todos,
  };

  await writeFile(todosPath, JSON.stringify(data, null, 2));
  return data;
}

export async function loadTaskMemory(firmRoot: string): Promise<TaskMemoryData> {
  const memoryPath = join(firmRoot, FIRM_DIR, TASK_MEMORY_FILE);
  try {
    const content = await readFile(memoryPath, "utf-8");
    const parsed = JSON.parse(content);

    const caseScans: Record<string, CaseTaskScanState> = {};
    if (parsed?.caseScans && typeof parsed.caseScans === "object") {
      for (const [caseKey, value] of Object.entries(parsed.caseScans as Record<string, any>)) {
        if (!value || typeof value !== "object") continue;

        const docSignatures = normalizeSignatureMap((value as any).docSignatures) || {};
        caseScans[caseKey] = {
          caseRef: typeof (value as any).caseRef === "string" ? (value as any).caseRef : "",
          casePath: typeof (value as any).casePath === "string" ? (value as any).casePath : "",
          scannedAt: typeof (value as any).scannedAt === "string"
            ? (value as any).scannedAt
            : new Date().toISOString(),
          docSignatures,
        };
      }
    }

    const history: Record<string, TaskHistoryEntry> = {};
    if (parsed?.history && typeof parsed.history === "object") {
      for (const [taskKey, raw] of Object.entries(parsed.history as Record<string, any>)) {
        if (!raw || typeof raw !== "object") continue;
        const statusRaw = String((raw as any).status || "").toLowerCase();
        const status: TaskHistoryStatus =
          statusRaw === "dismissed"
            ? "dismissed"
            : statusRaw === "reopened"
              ? "reopened"
              : "completed";

        history[taskKey] = {
          taskKey,
          status,
          caseRef: typeof (raw as any).caseRef === "string" ? (raw as any).caseRef : undefined,
          casePath: typeof (raw as any).casePath === "string" ? (raw as any).casePath : undefined,
          text: typeof (raw as any).text === "string" ? (raw as any).text : undefined,
          sourceSignatures: normalizeSignatureMap((raw as any).sourceSignatures),
          lastResolvedAt: typeof (raw as any).lastResolvedAt === "string"
            ? (raw as any).lastResolvedAt
            : undefined,
          updatedAt: typeof (raw as any).updatedAt === "string"
            ? (raw as any).updatedAt
            : new Date().toISOString(),
        };
      }
    }

    return {
      updated_at: typeof parsed?.updated_at === "string" ? parsed.updated_at : new Date().toISOString(),
      caseScans,
      history,
    };
  } catch {
    return {
      updated_at: new Date().toISOString(),
      caseScans: {},
      history: {},
    };
  }
}

export async function saveTaskMemory(firmRoot: string, memory: TaskMemoryData): Promise<TaskMemoryData> {
  const dir = join(firmRoot, FIRM_DIR);
  const memoryPath = join(dir, TASK_MEMORY_FILE);
  await mkdir(dir, { recursive: true });

  const payload: TaskMemoryData = {
    ...memory,
    updated_at: new Date().toISOString(),
  };

  await writeFile(memoryPath, JSON.stringify(payload, null, 2));
  return payload;
}

function normalizeIncomingTodo(raw: unknown, previous?: FirmTodo): FirmTodo | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const text = typeof obj.text === "string" ? obj.text.trim() : "";
  if (!text) return null;

  const id = typeof obj.id === "string" && obj.id.trim()
    ? obj.id.trim()
    : previous?.id || buildTodoId(text, Math.floor(Math.random() * 1000));

  const todo: FirmTodo = {
    id,
    text,
    caseRef: typeof obj.caseRef === "string"
      ? obj.caseRef.trim() || undefined
      : previous?.caseRef,
    casePath: typeof obj.casePath === "string"
      ? obj.casePath.trim() || undefined
      : previous?.casePath,
    priority: normalizePriority(obj.priority ?? previous?.priority),
    status: normalizeStatus(obj.status ?? previous?.status),
    createdAt: typeof obj.createdAt === "string"
      ? obj.createdAt
      : previous?.createdAt || new Date().toISOString(),
    taskKey: typeof obj.taskKey === "string"
      ? obj.taskKey.trim() || previous?.taskKey
      : previous?.taskKey,
    sourceDocIds: normalizeStringArray(obj.sourceDocIds) || previous?.sourceDocIds,
    sourceSignatures: normalizeSignatureMap(obj.sourceSignatures) || previous?.sourceSignatures,
    resolvedAt: typeof obj.resolvedAt === "string"
      ? obj.resolvedAt
      : previous?.resolvedAt,
  };

  ensureTodoTaskKey(todo);
  return todo;
}

export async function saveFirmTodosWithMemory(
  firmRoot: string,
  incomingTodos: unknown[]
): Promise<FirmTodosData> {
  const existingTodosData = await loadFirmTodos(firmRoot);
  const memory = await loadTaskMemory(firmRoot);

  const existingById = new Map(existingTodosData.todos.map((todo) => [todo.id, todo]));
  const normalizedTodos: FirmTodo[] = [];

  for (const rawTodo of incomingTodos) {
    if (!rawTodo || typeof rawTodo !== "object") continue;
    const raw = rawTodo as Record<string, unknown>;
    const previous = typeof raw.id === "string" ? existingById.get(raw.id) : undefined;
    const normalized = normalizeIncomingTodo(rawTodo, previous);
    if (!normalized) continue;
    normalizedTodos.push(normalized);
  }

  const now = new Date().toISOString();
  const nextById = new Map(normalizedTodos.map((todo) => [todo.id, todo]));

  for (const todo of normalizedTodos) {
    const taskKey = ensureTodoTaskKey(todo);

    if (todo.status === "completed") {
      if (!todo.resolvedAt) {
        todo.resolvedAt = now;
      }
      memory.history[taskKey] = {
        taskKey,
        status: "completed",
        caseRef: todo.caseRef,
        casePath: todo.casePath,
        text: todo.text,
        sourceSignatures: todo.sourceSignatures,
        lastResolvedAt: todo.resolvedAt,
        updatedAt: now,
      };
      continue;
    }

    const previous = existingById.get(todo.id);
    if (previous?.status === "completed" && memory.history[taskKey]) {
      memory.history[taskKey] = {
        ...memory.history[taskKey],
        status: "reopened",
        updatedAt: now,
      };
    }
  }

  for (const previous of existingTodosData.todos) {
    if (previous.status !== "completed") continue;
    if (nextById.has(previous.id)) continue;

    const taskKey = ensureTodoTaskKey(previous);
    memory.history[taskKey] = {
      taskKey,
      status: "completed",
      caseRef: previous.caseRef,
      casePath: previous.casePath,
      text: previous.text,
      sourceSignatures: previous.sourceSignatures,
      lastResolvedAt: previous.resolvedAt || now,
      updatedAt: now,
    };
  }

  await saveTaskMemory(firmRoot, memory);
  return saveFirmTodos(firmRoot, normalizedTodos);
}

export async function getCaseTaskState(input: {
  firmRoot: string;
  caseFolder: string;
  indexData: any;
}): Promise<CaseTaskState> {
  const { firmRoot, caseFolder, indexData } = input;
  const docs = collectIndexedCaseDocuments(indexData);
  const todosData = await loadFirmTodos(firmRoot);
  const memory = await loadTaskMemory(firmRoot);

  const caseRef = defaultCaseRefFromIndex(indexData, caseFolder);
  const caseKey = normalizeCaseKey(caseFolder);
  const scanState = memory.caseScans[caseKey];

  const changedDocs = docs.filter((doc) => scanState?.docSignatures?.[doc.docId] !== doc.signature);

  const pendingTasks = todosData.todos
    .filter((todo) => {
      if (todo.status !== "pending") return false;
      const todoCasePath = normalizeCaseKey(todo.casePath || "");
      if (todoCasePath && todoCasePath === caseKey) return true;
      return !todoCasePath && normalizeCaseRef(todo.caseRef) === normalizeCaseRef(caseRef);
    })
    .map((todo) => ({
      id: todo.id,
      text: todo.text,
      priority: todo.priority,
      created_at: todo.createdAt,
      task_key: todo.taskKey,
    }));

  const completedTaskHistoryCount = Object.values(memory.history).filter((entry) => {
    if (entry.status !== "completed") return false;
    const entryCasePath = normalizeCaseKey(entry.casePath || "");
    if (entryCasePath && entryCasePath === caseKey) return true;
    return !entryCasePath && normalizeCaseRef(entry.caseRef) === normalizeCaseRef(caseRef);
  }).length;

  return {
    case_ref: caseRef,
    case_path: caseFolder,
    total_documents: docs.length,
    changed_documents_count: changedDocs.length,
    changed_documents: changedDocs.map((doc) => ({
      doc_id: doc.docId,
      path: doc.path,
      type: doc.type,
      date: doc.date,
      key_info: doc.keyInfo,
    })),
    pending_tasks: pendingTasks,
    completed_task_history_count: completedTaskHistoryCount,
    last_scanned_at: scanState?.scannedAt,
  };
}

function resolveSourceDocIds(
  selectors: string[],
  docs: IndexedCaseDocument[],
  fallbackIds: string[]
): string[] {
  if (selectors.length === 0) {
    return fallbackIds;
  }

  const byId = new Map<string, string>();
  const byPath = new Map<string, string>();
  const byBasename = new Map<string, string>();
  const ambiguousBasenames = new Set<string>();

  for (const doc of docs) {
    byId.set(doc.docId, doc.docId);
    byPath.set(normalizePath(doc.path), doc.docId);

    const base = normalizePath(basename(doc.path));
    if (!base) continue;
    if (!byBasename.has(base)) {
      byBasename.set(base, doc.docId);
    } else if (byBasename.get(base) !== doc.docId) {
      ambiguousBasenames.add(base);
    }
  }

  const resolved = new Set<string>();

  for (const selector of selectors) {
    const trimmed = selector.trim();
    if (!trimmed) continue;

    if (byId.has(trimmed)) {
      resolved.add(trimmed);
      continue;
    }

    const normalizedPath = normalizePath(trimmed);
    if (byPath.has(normalizedPath)) {
      resolved.add(byPath.get(normalizedPath)!);
      continue;
    }

    const base = normalizePath(basename(trimmed));
    if (base && byBasename.has(base) && !ambiguousBasenames.has(base)) {
      resolved.add(byBasename.get(base)!);
      continue;
    }
  }

  if (resolved.size === 0) {
    return fallbackIds;
  }

  return Array.from(resolved);
}

export async function applyCaseTaskProposal(
  input: ApplyCaseTaskProposalInput
): Promise<ApplyCaseTaskProposalResult> {
  const {
    firmRoot,
    caseFolder,
    indexData,
    tasks,
    markAllDocumentsScanned = true,
  } = input;

  const todosData = await loadFirmTodos(firmRoot);
  const memory = await loadTaskMemory(firmRoot);

  const caseRef = defaultCaseRefFromIndex(indexData, caseFolder);
  const caseKey = normalizeCaseKey(caseFolder);
  const docs = collectIndexedCaseDocuments(indexData);
  const currentSignatures = Object.fromEntries(docs.map((doc) => [doc.docId, doc.signature]));
  const scanState = memory.caseScans[caseKey];
  const changedDocIds = docs
    .filter((doc) => scanState?.docSignatures?.[doc.docId] !== doc.signature)
    .map((doc) => doc.docId);
  const fallbackDocIds = changedDocIds.length > 0 ? changedDocIds : docs.map((doc) => doc.docId);

  const pendingKeys = new Set<string>();
  for (const todo of todosData.todos) {
    if (todo.status !== "pending") continue;
    pendingKeys.add(ensureTodoTaskKey(todo));
  }

  const addedTasks: FirmTodo[] = [];
  const skippedItems: Array<{ text: string; reason: string }> = [];

  const now = new Date().toISOString();

  tasks.forEach((task, index) => {
    const text = typeof task?.text === "string" ? task.text.trim() : "";
    if (!text) {
      skippedItems.push({ text: "", reason: "invalid_text" });
      return;
    }

    const selectorsRaw = Array.isArray(task?.source_documents)
      ? task.source_documents
      : Array.isArray(task?.sourceDocuments)
        ? task.sourceDocuments
        : [];
    const selectors = selectorsRaw
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);

    const sourceDocIds = resolveSourceDocIds(selectors, docs, fallbackDocIds);
    const sourceSignatures = Object.fromEntries(
      sourceDocIds
        .map((docId) => [docId, currentSignatures[docId]])
        .filter(([, signature]) => typeof signature === "string" && signature.length > 0)
    );

    const providedTaskKey = typeof task?.task_key === "string"
      ? task.task_key.trim()
      : typeof task?.taskKey === "string"
        ? task.taskKey.trim()
        : "";

    const taskKey = providedTaskKey || buildTaskKey(`${caseKey}|${caseRef}`, text, sourceDocIds);

    if (pendingKeys.has(taskKey)) {
      skippedItems.push({ text, reason: "already_pending" });
      return;
    }

    const historyEntry = memory.history[taskKey];
    if (
      historyEntry &&
      (historyEntry.status === "completed" || historyEntry.status === "dismissed") &&
      signatureMapsEqual(historyEntry.sourceSignatures, sourceSignatures)
    ) {
      skippedItems.push({ text, reason: "already_resolved_unchanged" });
      return;
    }

    const todo: FirmTodo = {
      id: buildTodoId(`${text}|${taskKey}`, index),
      text,
      caseRef,
      casePath: caseFolder,
      priority: normalizePriority(task?.priority),
      status: "pending",
      createdAt: now,
      taskKey,
      sourceDocIds,
      sourceSignatures,
    };

    addedTasks.push(todo);
    pendingKeys.add(taskKey);
  });

  const mergedTodos = [...todosData.todos, ...addedTasks];

  if (markAllDocumentsScanned) {
    memory.caseScans[caseKey] = {
      caseRef,
      casePath: caseFolder,
      scannedAt: now,
      docSignatures: currentSignatures,
    };
  }

  await saveTaskMemory(firmRoot, memory);
  await saveFirmTodos(firmRoot, mergedTodos);

  const pendingForCase = mergedTodos.filter((todo) => {
    if (todo.status !== "pending") return false;
    const todoCasePath = normalizeCaseKey(todo.casePath || "");
    if (todoCasePath && todoCasePath === caseKey) return true;
    return !todoCasePath && normalizeCaseRef(todo.caseRef) === normalizeCaseRef(caseRef);
  }).length;

  return {
    success: true,
    case_ref: caseRef,
    case_path: caseFolder,
    scanned_documents: docs.length,
    changed_documents_count: changedDocIds.length,
    added: addedTasks.length,
    skipped: skippedItems.length,
    added_tasks: addedTasks,
    skipped_items: skippedItems,
    pending_for_case: pendingForCase,
  };
}
