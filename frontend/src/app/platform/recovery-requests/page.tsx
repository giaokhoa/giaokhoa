import { SessionProvider } from "../../../features/identity/session-provider";
import { PlatformRecoveryContent } from "./platform-recovery-content";

export const dynamic = "force-dynamic";

export default function PlatformRecoveryPage() {
  return (
    <SessionProvider>
      <PlatformRecoveryContent />
    </SessionProvider>
  );
}
