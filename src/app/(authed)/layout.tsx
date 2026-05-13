import { AppShell } from "@/components/app-shell";
import { BreadcrumbProvider } from "@/lib/breadcrumb-context";
import { WorkspacePeerClaimsProvider } from "@/lib/realtime/workspace-peer-claims";

export default function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <BreadcrumbProvider>
      <WorkspacePeerClaimsProvider>
        <AppShell>{children}</AppShell>
      </WorkspacePeerClaimsProvider>
    </BreadcrumbProvider>
  );
}
