export interface MappingCodeInput {
  targetEntityName: string;
  targetFieldName: string;
  targetDataType: string | null;
  sourceEntityName: string | null;
  sourceFieldName: string | null;
  mappingType: string | null;
  transform: string | null;
  defaultValue: string | null;
  enumMapping: Record<string, string> | null;
}

export function generateSQL(input: MappingCodeInput): string {
  const target = `${input.targetEntityName}.${input.targetFieldName}`;
  const mappingType = input.mappingType || "unmapped";
  const lines: string[] = [];

  lines.push(`-- Target: ${target}`);
  lines.push(`-- Mapping type: ${mappingType}`);

  const hasSource = !!input.sourceEntityName && !!input.sourceFieldName;
  const hasDefault = !!input.defaultValue;
  const hasEnum =
    input.enumMapping && Object.keys(input.enumMapping).length > 0;

  if (input.transform) {
    lines.push("");
    if (hasSource) {
      lines.push("SELECT");
      lines.push(`  ${input.transform}`);
      lines.push(`FROM ${input.sourceEntityName}`);
    } else {
      lines.push("SELECT");
      lines.push(`  ${input.transform}`);
    }
  } else if (hasSource) {
    const source = `${input.sourceEntityName}.${input.sourceFieldName}`;
    lines.push("");
    lines.push("SELECT");

    let expr: string;

    if (hasEnum) {
      const entries = Object.entries(input.enumMapping!);
      expr = `  CASE`;
      for (const [src, tgt] of entries) {
        expr += `\n    WHEN ${source} = '${src}' THEN '${tgt}'`;
      }
      if (hasDefault) {
        expr += `\n    ELSE '${input.defaultValue}'`;
      }
      expr += `\n  END`;
    } else if (mappingType === "type_cast" && input.targetDataType) {
      expr = hasDefault
        ? `  CAST(COALESCE(${source}, '${input.defaultValue}') AS ${input.targetDataType})`
        : `  CAST(${source} AS ${input.targetDataType})`;
    } else if (hasDefault) {
      expr = `  COALESCE(${source}, '${input.defaultValue}')`;
    } else {
      expr = `  ${source}`;
    }

    lines.push(expr);
    lines.push(`FROM ${input.sourceEntityName}`);
  } else if (hasDefault) {
    lines.push("");
    lines.push("SELECT");
    lines.push(`  '${input.defaultValue}'`);
  } else {
    lines.push("");
    lines.push("-- No source mapping defined");
  }

  return lines.join("\n");
}

export function generateJSON(input: MappingCodeInput): string {
  const obj: Record<string, unknown> = {
    target: {
      entity: input.targetEntityName,
      field: input.targetFieldName,
      dataType: input.targetDataType,
    },
    source:
      input.sourceEntityName && input.sourceFieldName
        ? { entity: input.sourceEntityName, field: input.sourceFieldName }
        : null,
    mappingType: input.mappingType,
    transform: input.transform,
    defaultValue: input.defaultValue,
  };

  if (input.enumMapping && Object.keys(input.enumMapping).length > 0) {
    obj.enumMapping = input.enumMapping;
  }

  return JSON.stringify(obj, null, 2);
}

export function generateYAML(input: MappingCodeInput): string {
  const lines: string[] = [];

  lines.push("target:");
  lines.push(`  entity: ${input.targetEntityName}`);
  lines.push(`  field: ${input.targetFieldName}`);
  lines.push(`  dataType: ${input.targetDataType || "null"}`);

  lines.push("source:");
  if (input.sourceEntityName && input.sourceFieldName) {
    lines.push(`  entity: ${input.sourceEntityName}`);
    lines.push(`  field: ${input.sourceFieldName}`);
  } else {
    lines.push("  null");
  }

  lines.push(`mappingType: ${input.mappingType || "null"}`);

  if (input.transform) {
    lines.push("transform: |");
    input.transform.split("\n").forEach((l) => {
      lines.push(`  ${l}`);
    });
  } else {
    lines.push("transform: null");
  }

  lines.push(
    `defaultValue: ${input.defaultValue ? `"${input.defaultValue}"` : "null"}`
  );

  if (input.enumMapping && Object.keys(input.enumMapping).length > 0) {
    lines.push("enumMapping:");
    for (const [src, tgt] of Object.entries(input.enumMapping)) {
      lines.push(`  "${src}": "${tgt}"`);
    }
  }

  return lines.join("\n");
}

export function generateCode(
  input: MappingCodeInput,
  format: "sql" | "json" | "yaml"
): string {
  switch (format) {
    case "sql":
      return generateSQL(input);
    case "json":
      return generateJSON(input);
    case "yaml":
      return generateYAML(input);
  }
}
