import { AppShell } from "@/components/app-shell";

export default function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
