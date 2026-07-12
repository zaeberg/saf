const redacted = "[REDACTED]";

export function redact(value: string, secrets: readonly string[]): string {
  return secrets
    .filter((secret) => secret.length > 0)
    .sort((a, b) => b.length - a.length)
    .reduce((result, secret) => result.split(secret).join(redacted), value);
}

export function redactArgv(argv: readonly string[], secrets: readonly string[]): string[] {
  return argv.map((argument) => redact(argument, secrets));
}
