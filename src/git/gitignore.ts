export function mergeGitignore(source: string, entries: readonly string[]): string {
  const normalized = source.replace(/\r\n/g, "\n");
  const existing = new Set(normalized.split("\n").map((line) => line.trim()));
  const missing = entries.filter((entry) => !existing.has(entry));
  if (missing.length === 0) return source;
  const prefix = normalized.length === 0 || normalized.endsWith("\n") ? normalized : `${normalized}\n`;
  return `${prefix}${missing.join("\n")}\n`;
}
