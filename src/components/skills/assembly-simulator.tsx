"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useAssemblySimulation } from "@/queries/skill-queries";
import { formatTokens } from "./skill-utils";
import { SKILL_CONTEXT_ROLE_LABELS, type SkillContextRole } from "@/lib/constants";
import { Cpu, Search } from "lucide-react";

const BUDGET_OPTIONS = [
  { label: "160K", value: 160_000 },
  { label: "100K", value: 100_000 },
] as const;

export function AssemblySimulator() {
  const [inputValue, setInputValue] = useState("");
  const [debouncedEntity, setDebouncedEntity] = useState("");
  const [budget, setBudget] = useState(160_000);

  // Debounce input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedEntity(inputValue.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [inputValue]);

  const { data: simulation, isLoading, isError } = useAssemblySimulation(
    debouncedEntity || undefined,
    budget
  );

  const totalContextCount = simulation
    ? simulation.primaryContexts.length +
      simulation.referenceContexts.length +
      simulation.supplementaryContexts.length
    : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Cpu className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Assembly Simulator</h3>
        <span className="text-xs text-muted-foreground">
          Preview what context would be loaded for an entity
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder='Try an entity name, e.g. "borrower"'
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-1 border rounded-md p-0.5">
          {BUDGET_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setBudget(opt.value)}
              className={`px-3 py-1 text-xs rounded transition-colors cursor-pointer ${
                budget === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      {!debouncedEntity && (
        <p className="text-xs text-muted-foreground py-4 text-center">
          Enter an entity name to simulate context assembly
        </p>
      )}

      {isLoading && debouncedEntity && (
        <p className="text-xs text-muted-foreground py-4 text-center">Simulating...</p>
      )}

      {isError && (
        <p className="text-xs text-red-500 py-4 text-center">
          Failed to simulate assembly. Check that the entity name matches known skills.
        </p>
      )}

      {simulation && !isLoading && (
        <div className="border rounded-lg p-4 space-y-4">
          {/* Matched skills */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              Matched Skills
            </h4>
            {simulation.skillsUsed.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No skills match &ldquo;{debouncedEntity}&rdquo;
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {simulation.skillsUsed.map((s) => (
                  <Badge key={s.id} variant="secondary" className="text-xs">
                    {s.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Token usage bar */}
          {totalContextCount > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {totalContextCount} context{totalContextCount !== 1 ? "s" : ""} included
                  {simulation.droppedContexts.length > 0 && (
                    <span className="text-amber-500 ml-1">
                      ({simulation.droppedContexts.length} trimmed)
                    </span>
                  )}
                </span>
                <span>
                  {formatTokens(simulation.totalTokens)} / {formatTokens(simulation.budget)}
                </span>
              </div>
              <Progress value={simulation.totalTokens} max={simulation.budget} />
            </div>
          )}

          {/* Contexts by role */}
          {(["primary", "reference", "supplementary"] as SkillContextRole[]).map((role) => {
            const key = `${role}Contexts` as
              | "primaryContexts"
              | "referenceContexts"
              | "supplementaryContexts";
            const items = simulation[key];
            if (!items.length) return null;
            return (
              <div key={role} className="space-y-1">
                <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {SKILL_CONTEXT_ROLE_LABELS[role]} ({items.length})
                </h4>
                <div className="space-y-0.5">
                  {items.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between text-xs pl-2 py-0.5 border-l-2 border-muted"
                    >
                      <span className="truncate mr-2">{c.name}</span>
                      <span className="text-muted-foreground tabular-nums shrink-0">
                        {formatTokens(c.tokenCount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Dropped contexts */}
          {simulation.droppedContexts.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-[10px] font-semibold text-amber-500 uppercase tracking-wider">
                Trimmed ({simulation.droppedContexts.length})
              </h4>
              <div className="space-y-0.5">
                {simulation.droppedContexts.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between text-xs pl-2 py-0.5 border-l-2 border-amber-300 opacity-50 line-through"
                  >
                    <span className="truncate mr-2">
                      {c.name}
                      <span className="text-muted-foreground no-underline ml-1">
                        ({c.role})
                      </span>
                    </span>
                    <span className="text-muted-foreground tabular-nums shrink-0 no-underline">
                      {formatTokens(c.tokenCount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
