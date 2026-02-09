"use client";

import { EntityRow } from "./entity-row";
import type { Entity } from "@/types/entity";

export function EntityList({
  entities,
}: {
  entities: (Entity & { fieldCount: number })[];
}) {
  if (entities.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No target entities found.</p>
        <p className="text-sm mt-1">Import a target schema to get started.</p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <th className="px-4 py-2.5">Entity</th>
            <th className="px-4 py-2.5 w-20">Tier</th>
            <th className="px-4 py-2.5 w-28">Status</th>
            <th className="px-4 py-2.5 w-24 text-right">Fields</th>
            <th className="px-4 py-2.5 w-48">Progress</th>
          </tr>
        </thead>
        <tbody>
          {entities.map((e) => (
            <EntityRow key={e.id} entity={e} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
