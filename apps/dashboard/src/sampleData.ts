export type Run = {
  id: string
  label: string
  outcome: string
  tone: "good" | "warn" | "bad" | "muted"
  screenshot: boolean
  actions: { action: string; target: string; result: string }[]
}

export const experiment = {
  id: "exp_ghostloop_01",
  name: "Free plan onboarding",
  status: "First test complete",
  prototypeUrl: "https://acme-onboarding.example",
  task: "Create an account, create exactly one workspace on the Free plan, and successfully invite one fictional teammate without starting a paid trial.",
}

export const runs: Run[] = [
  {
    id: "run_012",
    label: "Trial 12",
    outcome: "Goal verified",
    tone: "good",
    screenshot: true,
    actions: [
      {
        action: "Clicked",
        target: "Create account",
        result: "Signup form opened",
      },
      {
        action: "Entered details",
        target: "Account form",
        result: "Account created",
      },
      { action: "Selected", target: "Free plan", result: "Plan selected" },
      {
        action: "Clicked",
        target: "Continue",
        result: "Workspace form opened",
      },
      {
        action: "Invited",
        target: "teammate@example.test",
        result: "Goal verified from app state",
      },
    ],
  },
  {
    id: "run_011",
    label: "Trial 11",
    outcome: "Action limit reached",
    tone: "warn",
    screenshot: true,
    actions: [
      {
        action: "Clicked",
        target: "Create account",
        result: "Signup form opened",
      },
      { action: "Selected", target: "Free plan", result: "Plan selected" },
      {
        action: "Navigated back",
        target: "Plan picker",
        result: "Free plan reselected",
      },
      {
        action: "Navigated back",
        target: "Plan picker",
        result: "Action limit reached",
      },
    ],
  },
  {
    id: "run_010",
    label: "Trial 10",
    outcome: "Product flow blocked",
    tone: "bad",
    screenshot: false,
    actions: [
      { action: "Selected", target: "Free plan", result: "Plan selected" },
      {
        action: "Clicked",
        target: "Start trial",
        result: "Paid-trial dialog opened",
      },
      {
        action: "Stopped",
        target: "Trial dialog",
        result: "Protected requirement would be violated",
      },
    ],
  },
  {
    id: "run_009",
    label: "Trial 09",
    outcome: "Browser/model error",
    tone: "muted",
    screenshot: false,
    actions: [
      {
        action: "Opened",
        target: "Prototype URL",
        result: "Browser session disconnected",
      },
    ],
  },
]

export const observations = [
  {
    id: "obs_01",
    text: "5 of 12 trials revisited plan selection.",
    refs: "Trials 02, 04, 07, 09, 11",
  },
  {
    id: "obs_02",
    text: "4 trials opened the paid-trial dialog after selecting Free.",
    refs: "Trials 03, 06, 08, 10",
  },
]

export const patches = [
  {
    id: "patch_01",
    target: "Free-plan CTA label",
    before: "Continue",
    after: "Continue with Free plan",
    support: "Pattern 01 · Trials 02, 04, 07, 09, 11",
    hypothesis:
      "Naming the selected plan may reduce uncertainty before continuing.",
    risk: "Low risk · Copy only",
    figma: "",
    correspondence: "Verified",
  },
  {
    id: "patch_02",
    target: "Free-plan CTA prominence",
    before: "Secondary / neutral",
    after: "Primary / coral-600 token",
    support: "Pattern 02 · Trials 03, 06, 08, 10",
    hypothesis:
      "A clearer visual priority may keep attention on the selected Free path.",
    risk: "Review needed · Visual hierarchy",
    figma: "",
    correspondence: "Pending",
  },
]

export const scenarios = {
  accepted: {
    label: "Accepted",
    tone: "good",
    candidate: "8 / 12",
    rate: "66.7%",
    improvement: "+16.7 pp",
    guardrail: "Passed",
    reason:
      "Improvement exceeds the 10-point minimum; protected requirements and other measures pass.",
  },
  inconclusive: {
    label: "Inconclusive",
    tone: "warn",
    candidate: "7 / 12",
    rate: "58.3%",
    improvement: "+8.3 pp",
    guardrail: "Passed",
    reason: "Observed improvement does not meet the 10 pp minimum.",
  },
  rejected: {
    label: "Rejected",
    tone: "bad",
    candidate: "9 / 12",
    rate: "75%",
    improvement: "+25 pp",
    guardrail: "Failed",
    reason:
      "The updated version broke a protected plan rule, so it cannot be used.",
  },
  empty: {
    label: "No valid sessions",
    tone: "muted",
    candidate: "0 / 0",
    rate: "N/A",
    improvement: "N/A",
    guardrail: "Not evaluated",
    reason: "All sessions ended with infrastructure errors or cancellations.",
  },
} as const
