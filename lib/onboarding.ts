export type OnboardingStep = "connect" | "firstPass" | "train" | "done";

// Steps derive from real state (email channel row, learned reply profile row)
// so the wizard can never disagree with what's actually set up.
export function resolveOnboardingStep(input: {
  gmailConnected: boolean;
  styleTrained: boolean;
  justConnected: boolean;
}): OnboardingStep {
  if (input.justConnected) return "firstPass";
  if (!input.gmailConnected) return "connect";
  if (!input.styleTrained) return "train";
  return "done";
}
