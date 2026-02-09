"use client";

import { Input } from "@/components/ui/input";

interface EnumMappingEditorProps {
  enumValues: string[];
  mapping: Record<string, string>;
  onChange: (mapping: Record<string, string>) => void;
}

export function EnumMappingEditor({
  enumValues,
  mapping,
  onChange,
}: EnumMappingEditorProps) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium">Enum Mapping</label>
      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50">
              <th className="px-2 py-1.5 text-left font-medium">Source Value</th>
              <th className="px-2 py-1.5 text-left font-medium">Target Value</th>
            </tr>
          </thead>
          <tbody>
            {enumValues.map((val) => (
              <tr key={val} className="border-t">
                <td className="px-2 py-1.5 font-mono">{val}</td>
                <td className="px-2 py-1">
                  <Input
                    value={mapping[val] || ""}
                    onChange={(e) =>
                      onChange({ ...mapping, [val]: e.target.value })
                    }
                    placeholder="mapped value"
                    className="h-7 text-xs"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
