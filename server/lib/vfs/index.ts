import { FileSystemProvider, FileStats, VfsDirent } from "./interface";
import { LocalFileSystemProvider } from "./local-provider";
import { GDriveProvider } from "./gdrive-provider";
import { join } from "path";
import { tmpdir } from "os";
import { writeFile, unlink } from "fs/promises";

let currentConfiguredProvider: FileSystemProvider = new LocalFileSystemProvider();

export function setVfsProvider(provider: FileSystemProvider) {
    currentConfiguredProvider = provider;
}

export function getVfs(): FileSystemProvider {
    return currentConfiguredProvider;
}

/**
 * Ensures a VFS path is available as a local file before executing a callback.
 * If the VFS is already local, it passes the path directly.
 * Otherwise, it downloads to a temporary file, executes, and cleans up.
 */
export async function withLocalVfsFile<T>(vfsPath: string, callback: (localPath: string) => Promise<T>): Promise<T> {
    const vfs = getVfs();
    // If it's already local, just use the path
    if (vfs.name === "local") {
        return callback(vfsPath);
    }

    // Otherwise, copy to temp directory
    const tempName = `vfs-temp-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    const tempPath = join(tmpdir(), tempName);

    try {
        const buffer = await vfs.readFile(vfsPath); // assuming this returns Buffer or can be written directly
        await writeFile(tempPath, buffer);
        return await callback(tempPath);
    } finally {
        try {
            await unlink(tempPath);
        } catch {
            // Ignore cleanup errors
        }
    }
}

export type { FileStats, VfsDirent };
