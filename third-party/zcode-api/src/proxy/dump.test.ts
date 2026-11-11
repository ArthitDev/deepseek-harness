import { describe, expect, it } from "bun:test";
import { dumpHeaders } from "./dump.js";

describe("dumpHeaders", () => {
  it("masks routing JWT headers regardless of header-name casing", () => {
    const token = "Bearer synthetic.secret.jwt";
    for (const name of ["X-ZCode-Authorization", "x-zcode-authorization", "X-ZCODE-AUTHORIZATION"]) {
      const dumped = dumpHeaders(new Headers({ [name]: token, "content-type": "application/json" }));
      expect(dumped["x-zcode-authorization"]).toBe("Bearer s….jwt (len=27)");
      expect(JSON.stringify(dumped)).not.toContain(token);
      expect(JSON.stringify(dumped)).not.toContain("synthetic.secret.jwt");
      expect(dumped["content-type"]).toBe("application/json");
    }
  });

  it("fully redacts short routing credentials", () => {
    expect(dumpHeaders(new Headers({ "X-ZCode-Authorization": "Bearer x" })))
      .toEqual({ "x-zcode-authorization": "<redacted>" });
  });
});
