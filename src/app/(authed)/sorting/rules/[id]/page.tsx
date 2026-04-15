import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ConditionBuilder, type BuilderCondition } from "@/components/condition-builder";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Day, SortingRule, SortingRuleCondition } from "@/lib/db/types";
import { deleteRule, saveConditions, updateRule } from "../actions";

export default async function RuleDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data: rData }, { data: cData }, { data: dData }] = await Promise.all([
    supabase.from("sorting_rules").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("sorting_rule_conditions")
      .select("*")
      .eq("rule_id", id)
      .order("position"),
    supabase.from("days").select("*").order("number"),
  ]);
  if (!rData) notFound();
  const rule = rData as SortingRule;
  const conditions = (cData ?? []) as SortingRuleCondition[];
  const days = (dData ?? []) as Day[];

  const initial: BuilderCondition[] = conditions.map((c) => ({
    target: c.target,
    target_slice: c.target_slice,
    operator: c.operator,
    reference_type: c.reference_type,
    reference_value: c.reference_value,
  }));

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono">
              RR-{rule.letter}
            </Badge>
            <span className="text-muted-foreground">Sorting rule</span>
          </span>
        }
        actions={
          <div className="flex gap-2">
            <Link href="/sorting/rules">
              <Button variant="ghost" size="sm">
                All rules
              </Button>
            </Link>
            <form action={deleteRule}>
              <input type="hidden" name="id" value={rule.id} />
              <Button type="submit" variant="destructive" size="sm">
                Delete
              </Button>
            </form>
          </div>
        }
      />

      <Card className="mb-6">
        <CardContent className="pt-5">
          <form action={updateRule} className="grid grid-cols-6 gap-3">
            <input type="hidden" name="id" value={rule.id} />
            <div className="flex flex-col gap-1.5">
              <Label>Letter</Label>
              <Input
                name="letter"
                defaultValue={rule.letter}
                maxLength={1}
                className="uppercase"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Slot (1-8)</Label>
              <Input
                type="number"
                name="destination_slot"
                min={1}
                max={8}
                defaultValue={rule.destination_slot ?? ""}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Match mode</Label>
              <Select name="match_mode" defaultValue={rule.match_mode}>
                <option value="all">All conditions</option>
                <option value="any">Any condition</option>
              </Select>
            </div>
            <div className="col-span-3 flex flex-col gap-1.5">
              <Label>Day implemented</Label>
              <Select
                name="day_implemented_id"
                defaultValue={rule.day_implemented_id ?? ""}
              >
                <option value="">—</option>
                {days.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.identifier}
                  </option>
                ))}
              </Select>
            </div>
            <div className="col-span-3 flex flex-col gap-1.5">
              <Label>Storage location</Label>
              <Input
                name="storage_location"
                defaultValue={rule.storage_location ?? ""}
                placeholder="e.g. Yellow Bin"
              />
            </div>
            <div className="col-span-6 flex flex-col gap-1.5">
              <Label>Summary</Label>
              <Textarea
                name="summary"
                defaultValue={rule.summary ?? ""}
                rows={2}
              />
            </div>
            <div className="col-span-6 flex justify-end">
              <Button type="submit" size="sm">
                Save rule
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <ConditionBuilder
            ruleId={rule.id}
            initial={initial}
            saveAction={saveConditions}
          />
        </CardContent>
      </Card>
    </div>
  );
}
