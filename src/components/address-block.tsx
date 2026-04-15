import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ADDRESS_TYPES, ADDRESS_TYPE_LABELS, type AddressType } from "@/lib/db/enums";
import type { City, Nation } from "@/lib/db/types";

/** Editor for a sender or recipient address. Fields shown depend on address_type:
 *  full: name, citizen number, city (with code), nation
 *  lookup_1: name, citizen number, city (with code)              (no nation)
 *  lookup_2: name, citizen number                                (no nation, no city)
 *  lookup_3: name only                                           (citizen id only)
 */
export function AddressBlock({
  prefix,
  label,
  values,
  cities,
  nations,
}: {
  prefix: "sender" | "recipient";
  label: string;
  values: {
    type: AddressType;
    citizen_number: string | null;
    name: string | null;
    city_id: string | null;
    city_name: string | null;
    city_code: string | null;
    nation_id: string | null;
  };
  cities: City[];
  nations: Nation[];
}) {
  const t = values.type;
  const showCity = t === "full" || t === "lookup_1";
  const showNation = t === "full";
  const showCitizenNumber = t !== "lookup_3";

  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </h4>
        <Select
          name={`${prefix}_type`}
          defaultValue={t}
          className="h-7 w-56"
        >
          {ADDRESS_TYPES.map((a) => (
            <option key={a} value={a}>
              {ADDRESS_TYPE_LABELS[a]}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-6 gap-2">
        <div className="col-span-4 flex flex-col gap-1">
          <Label>Name</Label>
          <Input
            name={`${prefix}_name`}
            defaultValue={values.name ?? ""}
            className="h-8"
          />
        </div>
        <div className="col-span-2 flex flex-col gap-1">
          <Label>Citizen #</Label>
          <Input
            name={`${prefix}_citizen_number`}
            defaultValue={values.citizen_number ?? ""}
            disabled={!showCitizenNumber}
            className="h-8"
            placeholder={showCitizenNumber ? "#0042" : "(hidden)"}
          />
        </div>
        <div className="col-span-3 flex flex-col gap-1">
          <Label>City</Label>
          <Select
            name={`${prefix}_city_id`}
            defaultValue={values.city_id ?? ""}
            disabled={!showCity}
            className="h-8"
          >
            <option value="">—</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="col-span-1 flex flex-col gap-1">
          <Label>Code</Label>
          <Input
            name={`${prefix}_city_code`}
            defaultValue={values.city_code ?? ""}
            disabled={!showCity}
            className="h-8 font-mono"
            placeholder="(auto)"
          />
        </div>
        <div className="col-span-2 flex flex-col gap-1">
          <Label>Nation</Label>
          <Select
            name={`${prefix}_nation_id`}
            defaultValue={values.nation_id ?? ""}
            disabled={!showNation}
            className="h-8"
          >
            <option value="">—</option>
            {nations.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </Select>
        </div>
        <input
          type="hidden"
          name={`${prefix}_city_name`}
          value={values.city_name ?? ""}
        />
      </div>
    </div>
  );
}
