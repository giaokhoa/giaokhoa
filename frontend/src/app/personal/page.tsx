import { SessionProvider } from "../../features/identity/session-provider";
import { PersonalContent } from "./personal-content";

export const dynamic = "force-dynamic";

export default function PersonalPage() {
  return (
    <SessionProvider>
      <PersonalContent />
    </SessionProvider>
  );
}
