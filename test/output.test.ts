import { describe, expect, it } from "vitest";
import { failure } from "../src/contracts/result.js";
import { renderResult } from "../src/output.js";

describe("renderResult", () => {
  it("keeps a stable JSON diagnostic shape", () => {
    const result = failure([{ code: "CONFIG_INVALID", severity: "error", message: "Invalid value", remediation: "Fix it.", path: "version" }]);
    expect(JSON.parse(renderResult(result, "json"))).toEqual({
      ok: false,
      diagnostics: [{ code: "CONFIG_INVALID", severity: "error", message: "Invalid value", remediation: "Fix it.", path: "version" }]
    });
  });
});
