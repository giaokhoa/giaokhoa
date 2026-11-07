import { SessionProvider } from "../../features/identity/session-provider";
import { PlatformCentersContent } from "../../features/tenancy/center-administration";

export const dynamic = "force-dynamic";

export default function PlatformPage() {
  return (
    <SessionProvider>
      <PlatformCentersContent />
    </SessionProvider>
  );
}
