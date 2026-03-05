import { FileSystemProvider, FileStats, VfsDirent } from "./interface";
import { google, drive_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { join } from "path";
import { Readable } from "stream";
import { LocalFileSystemProvider } from "./local-provider";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minute cache for path mapping
const GOOGLE_APPS_PREFIX = "application/vnd.google-apps.";
const GOOGLE_APPS_FOLDER = `${GOOGLE_APPS_PREFIX}folder`;
const GOOGLE_APPS_SHORTCUT = `${GOOGLE_APPS_PREFIX}shortcut`;

const GOOGLE_WORKSPACE_EXPORT_MIME_TYPES: Record<
    string,
    { text?: string; binary?: string; stream?: string }
> = {
    [`${GOOGLE_APPS_PREFIX}document`]: {
        text: "text/plain",
        binary: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        stream: "application/pdf",
    },
    [`${GOOGLE_APPS_PREFIX}spreadsheet`]: {
        text: "text/csv",
        binary: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        stream: "application/pdf",
    },
    [`${GOOGLE_APPS_PREFIX}presentation`]: {
        text: "text/plain",
        binary: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        stream: "application/pdf",
    },
};

interface CacheEntry {
    id: string;
    isDir: boolean;
    name: string;
    mimeType?: string;
    timestamp: number;
}

export class GDriveProvider implements FileSystemProvider {
    name = "gdrive";
    private drive: drive_v3.Drive;
    private pathCache = new Map<string, CacheEntry>();
    private localProvider = new LocalFileSystemProvider();

    // Rate limiting queue
    private writeQueue: Promise<any> = Promise.resolve();

    /**
     * Initialize with authenticated OAuth client
     */
    constructor(authClient: OAuth2Client, private rootFolderId: string) {
        this.drive = google.drive({ version: 'v3', auth: authClient });
        // Seed the root path
        this.pathCache.set('/', {
            id: rootFolderId,
            isDir: true,
            name: 'root',
            mimeType: GOOGLE_APPS_FOLDER,
            timestamp: Date.now()
        });
    }

    // --- Utility: Rate Limiting & Backoff ---

    private async executeWithBackoff<T>(operation: () => Promise<T>, maxRetries = 5): Promise<T> {
        let retries = 0;
        while (true) {
            try {
                return await operation();
            } catch (error: any) {
                if (error.status === 429 || error.status === 403) {
                    if (retries >= maxRetries) throw error;

                    // Exponential backoff with jitter
                    const backoff = Math.min((2 ** retries) * 1000 + (Math.random() * 1000), 30000);
                    console.log(`[GDrive] Rate limit hit. Retrying in ${Math.round(backoff)}ms (Attempt ${retries + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, backoff));
                    retries++;
                } else {
                    throw error;
                }
            }
        }
    }

    // Throttle writes to max ~2 per second
    private async executeWrite<T>(operation: () => Promise<T>): Promise<T> {
        const minDelay = 500; // 500ms between writes

        // Add to queue
        const queuedAction = this.writeQueue.then(async () => {
            const start = Date.now();
            try {
                const result = await this.executeWithBackoff(operation);
                return result;
            } finally {
                const elapsed = Date.now() - start;
                if (elapsed < minDelay) {
                    await new Promise(resolve => setTimeout(resolve, minDelay - elapsed));
                }
            }
        });

        this.writeQueue = queuedAction.catch(() => { }); // prevent chain failure
        return queuedAction;
    }

    // --- Path Mapping & Caching ---

    private normalizePath(path: string): string {
        let normalized = '/' + path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
        const prefix = '/' + this.rootFolderId;
        if (normalized === prefix) {
            return '/';
        } else if (normalized.startsWith(prefix + '/')) {
            return normalized.substring(prefix.length);
        }
        return normalized;
    }

    private isGoogleWorkspaceFile(mimeType?: string): boolean {
        return !!mimeType
            && mimeType.startsWith(GOOGLE_APPS_PREFIX)
            && mimeType !== GOOGLE_APPS_FOLDER
            && mimeType !== GOOGLE_APPS_SHORTCUT;
    }

    private getGoogleWorkspaceExportMimeType(
        sourceMimeType: string,
        mode: "text" | "binary" | "stream"
    ): string | null {
        const mapping = GOOGLE_WORKSPACE_EXPORT_MIME_TYPES[sourceMimeType];
        if (!mapping) return null;
        if (mode === "text") return mapping.text || mapping.stream || mapping.binary || null;
        if (mode === "stream") return mapping.stream || mapping.binary || mapping.text || null;
        return mapping.binary || mapping.stream || mapping.text || null;
    }

    private async getEntryMimeType(entry: CacheEntry): Promise<string | undefined> {
        if (entry.mimeType) return entry.mimeType;
        try {
            const res = await this.executeWithBackoff(() => this.drive.files.get({
                fileId: entry.id,
                fields: "mimeType"
            }));
            const mimeType = typeof res.data.mimeType === "string" ? res.data.mimeType : undefined;
            if (mimeType) entry.mimeType = mimeType;
            return mimeType;
        } catch {
            return undefined;
        }
    }

    /**
     * Resolves a virtual path (e.g. /Smith/Intake/file.pdf) to a Google Drive File ID.
     */
    private async resolvePath(path: string): Promise<CacheEntry | null> {
        const normPath = this.normalizePath(path);
        if (normPath === '/') return this.pathCache.get('/') || null;

        // Check cache
        const cached = this.pathCache.get(normPath);
        if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
            return cached;
        }

        // Traverse down from closest cached parent
        const parts = normPath.split('/').filter(Boolean);
        let currentId = this.rootFolderId;
        let currentPath = '';

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const nextPath = currentPath + '/' + part;

            // Check if we have this prefix cached
            const prefixCache = this.pathCache.get(nextPath);
            if (prefixCache && (Date.now() - prefixCache.timestamp < CACHE_TTL_MS)) {
                currentId = prefixCache.id;
                currentPath = nextPath;
                continue;
            }

            // We need to fetch this part from Drive API
            const query = `'${currentId}' in parents and name = '${part}' and trashed = false`;
            const res = await this.executeWithBackoff(() => this.drive.files.list({
                q: query,
                fields: "files(id, name, mimeType, shortcutDetails(targetId,targetMimeType))",
                spaces: 'drive'
            }));

            if (!res.data.files || res.data.files.length === 0) {
                return null; // Not found
            }

            const file = res.data.files[0]; // Take first match
            let isDir = file.mimeType === GOOGLE_APPS_FOLDER;
            let targetId = file.id!;
            let targetMimeType = file.mimeType || undefined;
            if (file.mimeType === 'application/vnd.google-apps.shortcut' && file.shortcutDetails?.targetId) {
                targetId = file.shortcutDetails.targetId;
                targetMimeType = file.shortcutDetails.targetMimeType || targetMimeType;
                isDir = file.shortcutDetails.targetMimeType === GOOGLE_APPS_FOLDER;
            }

            const entry: CacheEntry = {
                id: targetId,
                isDir,
                name: file.name!,
                mimeType: targetMimeType,
                timestamp: Date.now()
            };
            this.pathCache.set(nextPath, entry);

            currentId = targetId;
            currentPath = nextPath;
        }

        return this.pathCache.get(normPath) || null;
    }

    // --- Provider Interface Implementation ---

    async readFile(path: string, encoding?: "utf-8"): Promise<any> {
        const normPath = this.normalizePath(path);

        const entry = await this.resolvePath(normPath);
        if (!entry) throw new Error(`ENOENT: no such file or directory '${path}'`);
        if (entry.isDir) throw new Error(`EISDIR: illegal operation on a directory, read '${path}'`);

        const mimeType = await this.getEntryMimeType(entry);
        if (this.isGoogleWorkspaceFile(mimeType)) {
            const exportMimeType = this.getGoogleWorkspaceExportMimeType(
                mimeType!,
                encoding === "utf-8" ? "text" : "binary"
            );
            if (!exportMimeType) {
                throw new Error(`Unsupported Google Workspace MIME type for export: ${mimeType}`);
            }

            const res = await this.executeWithBackoff(() => this.drive.files.export(
                { fileId: entry.id, mimeType: exportMimeType },
                { responseType: encoding === "utf-8" ? "text" : "arraybuffer" }
            ));

            if (encoding === "utf-8") {
                if (typeof res.data === "string") return res.data;
                return Buffer.from(res.data as any).toString("utf-8");
            }

            return Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data as any);
        }

        const res = await this.executeWithBackoff(() => this.drive.files.get(
            { fileId: entry.id, alt: 'media' },
            { responseType: encoding === 'utf-8' ? 'text' : 'arraybuffer' }
        ));

        const content = res.data as any;

        return content;
    }

    async writeFile(path: string, data: string | Buffer): Promise<void> {
        const normPath = this.normalizePath(path);
        const parts = normPath.split('/').filter(Boolean);
        const fileName = parts.pop()!;
        const parentPath = '/' + parts.join('/');

        const parentEntry = await this.resolvePath(parentPath);
        if (!parentEntry || !parentEntry.isDir) {
            throw new Error(`ENOENT: parent directory does not exist for '${path}'`);
        }

        // Check if file already exists
        const existingEntry = await this.resolvePath(normPath);

        // Build media body
        const media = {
            mimeType: typeof data === 'string' && normPath.endsWith('.json') ? 'application/json' : 'application/octet-stream',
            body: typeof data === 'string' ? Readable.from([data]) : Readable.from([data])
        };

        await this.executeWrite(async () => {
            if (existingEntry) {
                // Update existing file
                await this.drive.files.update({
                    fileId: existingEntry.id,
                    media: media
                });
                // Update cache timestamp
                existingEntry.timestamp = Date.now();
            } else {
                // Create new file
                const res = await this.drive.files.create({
                    requestBody: {
                        name: fileName,
                        parents: [parentEntry.id]
                    },
                    media: media,
                    fields: 'id'
                });

                // Add to cache
                this.pathCache.set(normPath, {
                    id: res.data.id!,
                    isDir: false,
                    name: fileName,
                    mimeType: media.mimeType,
                    timestamp: Date.now()
                });
            }
        });
    }

    async readdir(path: string, options?: { withFileTypes?: boolean }): Promise<any> {
        const entry = await this.resolvePath(path);
        if (!entry) throw new Error(`ENOENT: no such file or directory '${path}'`);
        if (!entry.isDir) throw new Error(`ENOTDIR: not a directory '${path}'`);

        const result = await this.executeWithBackoff(() => this.drive.files.list({
            q: `'${entry.id}' in parents and trashed = false`,
            fields: "files(id, name, mimeType, shortcutDetails(targetId,targetMimeType))",
            pageSize: 1000 // Increase page size to limit pagination calls
        }));

        const files = result.data.files || [];

        // Pre-seed cache with listed items
        const normPath = this.normalizePath(path);
        const resolvedFiles: Array<{ id: string; name: string; isDir: boolean; mimeType?: string }> = [];
        files.forEach(f => {
            let targetId = f.id!;
            let targetMimeType = f.mimeType || undefined;
            let isDir = f.mimeType === GOOGLE_APPS_FOLDER;
            if (f.mimeType === 'application/vnd.google-apps.shortcut' && f.shortcutDetails?.targetId) {
                targetId = f.shortcutDetails.targetId;
                targetMimeType = f.shortcutDetails.targetMimeType || targetMimeType;
                isDir = f.shortcutDetails.targetMimeType === GOOGLE_APPS_FOLDER;
            }

            const childPath = normPath === '/' ? `/${f.name}` : `${normPath}/${f.name}`;
            this.pathCache.set(childPath, {
                id: targetId,
                isDir,
                name: f.name!,
                mimeType: targetMimeType,
                timestamp: Date.now()
            });

            resolvedFiles.push({ id: targetId, name: f.name!, isDir, mimeType: targetMimeType });
        });

        if (options?.withFileTypes) {
            return resolvedFiles.map(f => ({
                name: f.name,
                mimeType: f.mimeType,
                isDirectory: () => f.isDir,
                isFile: () => !f.isDir
            }));
        }

        return resolvedFiles.map(f => f.name);
    }

    async stat(path: string): Promise<FileStats> {
        const entry = await this.resolvePath(path);
        if (!entry) throw new Error(`ENOENT: no such file or directory '${path}'`);

        if (entry.isDir) {
            return {
                mtimeMs: 0,
                size: 0,
                mimeType: entry.mimeType || GOOGLE_APPS_FOLDER,
                isDirectory: () => true,
                isFile: () => false
            };
        }

        const res = await this.executeWithBackoff(() => this.drive.files.get({
            fileId: entry.id,
            fields: 'modifiedTime, size, mimeType'
        }));

        const mtimeMs = new Date(res.data.modifiedTime || 0).getTime();
        const sizeInfo = res.data.size ? parseInt(res.data.size, 10) : 0;
        const mimeType = typeof res.data.mimeType === "string" ? res.data.mimeType : entry.mimeType;
        if (mimeType) entry.mimeType = mimeType;

        return {
            mtimeMs,
            size: sizeInfo,
            mimeType,
            isDirectory: () => false,
            isFile: () => true,
        };
    }

    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
        const normPath = this.normalizePath(path);
        if (await this.resolvePath(normPath)) return; // Already exists

        const parts = normPath.split('/').filter(Boolean);
        let currentId = this.rootFolderId;
        let currentPath = '';

        for (const part of parts) {
            currentPath += '/' + part;
            let entry = await this.resolvePath(currentPath);

            if (!entry) {
                if (!options?.recursive && currentPath !== normPath) {
                    throw new Error(`ENOENT: parent path does not exist '${currentPath}'`);
                }

                // Create folder
                const res = await this.executeWrite(() => this.drive.files.create({
                    requestBody: {
                        name: part,
                        mimeType: 'application/vnd.google-apps.folder',
                        parents: [currentId]
                    },
                    fields: 'id'
                }));

                entry = {
                    id: res.data.id!,
                    isDir: true,
                    name: part,
                    mimeType: GOOGLE_APPS_FOLDER,
                    timestamp: Date.now()
                };
                this.pathCache.set(currentPath, entry);
            }
            currentId = entry.id;
        }
    }

    async exists(path: string): Promise<boolean> {
        const entry = await this.resolvePath(path);
        return !!entry;
    }

    async unlink(path: string): Promise<void> {
        const entry = await this.resolvePath(path);
        if (!entry) return;

        await this.executeWrite(() => this.drive.files.delete({ fileId: entry.id }));
        this.pathCache.delete(this.normalizePath(path));
    }

    async createReadStream(path: string): Promise<NodeJS.ReadableStream> {
        const entry = await this.resolvePath(path);
        if (!entry || entry.isDir) throw new Error(`Cannot stream file '${path}'`);

        const mimeType = await this.getEntryMimeType(entry);
        if (this.isGoogleWorkspaceFile(mimeType)) {
            const exportMimeType = this.getGoogleWorkspaceExportMimeType(mimeType!, "stream");
            if (!exportMimeType) {
                throw new Error(`Unsupported Google Workspace MIME type for stream export: ${mimeType}`);
            }

            const exported = await this.executeWithBackoff(() => this.drive.files.export(
                { fileId: entry.id, mimeType: exportMimeType },
                { responseType: "stream" }
            ));
            return exported.data as NodeJS.ReadableStream;
        }

        // Pass raw true to get standard http response stream from axios/gaxios
        const res = await this.executeWithBackoff(() => this.drive.files.get(
            { fileId: entry.id, alt: 'media' },
            { responseType: 'stream' }
        ));

        return res.data as NodeJS.ReadableStream;
    }
}
