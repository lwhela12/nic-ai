export interface FileStats {
    mtimeMs: number;
    size: number;
    mimeType?: string;
    isDirectory(): boolean;
    isFile(): boolean;
}

export interface VfsDirent {
    name: string;
    mimeType?: string;
    isDirectory(): boolean;
    isFile(): boolean;
}

export interface FileSystemProvider {
    /**
     * Name of the provider (e.g. "local", "gdrive")
     */
    name: string;

    /**
     * Read a file's contents as a UTF-8 string.
     */
    readFile(path: string, encoding: "utf-8"): Promise<string>;

    /**
     * Read a file's contents as a Buffer.
     */
    readFile(path: string): Promise<Buffer>;

    /**
     * Write data to a file.
     */
    writeFile(path: string, data: string | Buffer): Promise<void>;

    /**
     * List directory contents.
     */
    readdir(path: string): Promise<string[]>;
    readdir(path: string, options: { withFileTypes: false }): Promise<string[]>;
    readdir(path: string, options: { withFileTypes: true }): Promise<VfsDirent[]>;
    readdir(path: string, options?: { withFileTypes?: boolean }): Promise<string[] | VfsDirent[]>;

    /**
     * Get file or directory metadata.
     */
    stat(path: string): Promise<FileStats>;

    /**
     * Create a directory (and parents if recursive is true).
     */
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;

    /**
     * Check if a file or directory exists.
     */
    exists(path: string): Promise<boolean>;

    /**
     * Delete a file.
     */
    unlink(path: string): Promise<void>;

    /**
     * Get a readable stream for a file (useful for large files/PDFs).
     */
    createReadStream(path: string): Promise<ReadableStream | NodeJS.ReadableStream>;
}
