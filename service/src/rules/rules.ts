export type Scope = "account" | "user";
export type RuleName = "max_units_per_request" | "monthly_allowance";

export type Limits = { monthlyAllowance: number; maxUnitsPerRequest: number };
export type ScopeState = { limits: Limits; used: number };

export type ConsumeInput = { units: number; user: ScopeState; account: ScopeState };

export type Decision =
  | { accepted: true }
  | { accepted: false; scope: Scope; rule: RuleName };

type Rule = {
  name: RuleName;
  allows: (units: number, state: ScopeState) => boolean;
};

export const RULES: Rule[] = [
  { name: "max_units_per_request", allows: (units, s) => units <= s.limits.maxUnitsPerRequest },
  { name: "monthly_allowance", allows: (units, s) => s.used + units <= s.limits.monthlyAllowance },
];

export function evaluate(input: ConsumeInput): Decision {
  const levels: [Scope, ScopeState][] = [
    ["user", input.user],
    ["account", input.account],
  ];

  for (const [scope, state] of levels) {
    for (const rule of RULES) {
      if (!rule.allows(input.units, state)) {
        return { accepted: false, scope, rule: rule.name };
      }
    }
  }
  return { accepted: true };
}

export function remaining(state: ScopeState): number {
  return Math.max(0, state.limits.monthlyAllowance - state.used);
}