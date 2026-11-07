import { SessionProvider } from "../../features/identity/session-provider";
import { OnboardingContent } from "./onboarding-content";

export const dynamic = "force-dynamic";

export default function OnboardingPage() {
  return (
    <SessionProvider>
      <OnboardingContent />
    </SessionProvider>
  );
}
