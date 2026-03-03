import { readFile, writeFile, readdir, stat, mkdir, unlink } from "fs/promises";
import { existsSync, createReadStream as fsCreateReadStream } from "fs";
import { FileSystemProvider, FileStats } from "./interface";

export class LocalFileSystemProvider implements FileSystemProvider {
    name = "local";

    async readFile(path: string, encoding?: "utf-8"): Promise<any> {
        if (encoding === "utf-8") {
            return readFile(path, "utf-8");
        }
        return readFile(path);
    }

    async writeFile(path: string, data: string | Buffer): Promise<void> {
        await writeFile(path, data);
    }

    async readdir(path: string, options?: { withFileTypes?: boolean }): Promise<any> {
        if (options?.withFileTypes) {
            return readdir(path, { withFileTypes: true });
        }
        return readdir(path);
    }

    async stat(path: string): Promise<FileStats> {
        const s = await stat(path);
        return {
            mtimeMs: s.mtimeMs,
            size: s.size,
            isDirectory: () => s.isDirectory(),
            isFile: () => s.isFile(),
        };
    }

    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
        await mkdir(path, options);
    }

    async exists(path: string): Promise<boolean> {
        return existsSync(path);
    }

    async unlink(path: string): Promise<void> {
        await unlink(path);
    }

    async createReadStream(path: string): Promise<NodeJS.ReadableStream> {
        return fsCreateReadStream(path);
    }
}
