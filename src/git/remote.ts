import { failure, success, type CommandResult } from "../contracts/result.js";

const patterns = [
  /^(?:ssh:\/\/)?git@github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/,
  /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/
];

export function parseGitHubRemote(remote: string): CommandResult<string> {
  for (const pattern of patterns) {
    const match = remote.trim().match(pattern);
    if (match) return success(`${match[1]}/${match[2]}`);
  }
  return failure([{ code: "CONFIG_INVALID", severity: "error", message: `Origin is not a supported GitHub remote: ${remote}`, remediation: "Set origin to a GitHub SSH or HTTPS URL." }]);
}
