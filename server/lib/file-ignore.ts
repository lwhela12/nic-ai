const IGNORED_FILES = new Set([
  ".DS_Store",
  "._.DS_Store",
  "Thumbs.db",
  "ehthumbs.db",
  "desktop.ini",
  ".Spotlight-V100",
  ".Trashes",
  ".TemporaryItems",
]);

const IGNORED_PATTERNS = [
  /^\._/, // macOS resource forks (._filename)
  /\.swp$/, // vim swap files
  /\.swo$/, // vim swap files
  /~$/, // backup files (file~)
  /^~\$/, // Office temp files (~$document.docx)
  /^\.~lock\./, // LibreOffice locks
];

export function shouldIgnoreFile(name: string): boolean {
  if (IGNORED_FILES.has(name)) return true;
  return IGNORED_PATTERNS.some((pattern) => pattern.test(name));
}
