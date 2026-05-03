import { PageHeader } from "@/components/page-header";
import { TabBar, Tab } from "@/components/ui/tabs";

export default function EndingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <PageHeader
        title="Endings"
        description="Madlib-style game endings. Variables and their values drive which framework plays and which blocks of text appear."
      />
      <TabBar className="mb-6">
        <Tab href="/endings/frameworks">Frameworks</Tab>
        <Tab href="/endings/logic">Logic</Tab>
        <Tab href="/endings/variables">Variables</Tab>
      </TabBar>
      {children}
    </div>
  );
}
