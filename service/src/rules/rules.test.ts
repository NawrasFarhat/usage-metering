import { describe, it, expect } from "vitest";
import { evaluate, type ScopeState } from "./rules.js";

const state = (monthlyAllowance: number, maxUnitsPerRequest: number, used: number): ScopeState => ({
  limits: { monthlyAllowance, maxUnitsPerRequest },
  used,
});

describe("evaluate", () => {
     it("accepts when all checks pass", () => {
    expect(evaluate({ units: 10, user: state(1000, 20, 0), account: state(10000, 100, 0) }))
      .toEqual({ accepted: true });
  });

  it("rejects by the user per-request limit", () => {
    expect(evaluate({ units: 25, user: state(1000, 20, 0), account: state(10000, 100, 0) }))
      .toEqual({ accepted: false, scope: "user", rule: "max_units_per_request" });
  });

  it("rejects by the account monthly allowance even if the user has room", () => {
    expect(evaluate({ units: 10, user: state(1000, 20, 0), account: state(100, 100, 95) }))
      .toEqual({ accepted: false, scope: "account", rule: "monthly_allowance" });
  });
});