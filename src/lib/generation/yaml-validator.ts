/**
 * YAML mapping structural validator.
 * Checks parsed YAML output for structural compliance before saving to DB.
 */

import type { YamlParseResult } from "./output-parser";

// ── Public interfaces ──

export interface ValidationIssue {
  /** Target column name or "_structure" for entity-level issues */
  field: string;
  severity: "error" | "warning";
  code: string;
  message: string;
  /** Optional detail (e.g., the hallucinated source name) */
  detail?: string;
}

export interface ValidationResult {
  /** True if no errors (warnings are OK) */
  valid: boolean;
  issues: ValidationIssue[];
  /** 0-100 score: 100 - (errors * 10) - (warnings * 3), clamped */
  score: number;
}

export interface TargetFieldMeta {
  name: string;
  isRequired: boolean;
  enumValues: string[] | null;
}

// Known Python/pandas globals that appear in expressions but are NOT source aliases.
// pd.NA, pd.to_numeric(), np.where(), np.select(), df.column are all legitimate in expression: fields.
// They must STILL be flagged as UNDEFINED_ALIAS in source: fields (pd.FieldName is always wrong there).
const EXPRESSION_GLOBALS = new Set(["pd", "np", "df"]);

// ── Expression syntax validation ──
// The production pipeline (to_vds_polars.py) executes pandas/numpy expressions.
// LLMs sometimes emit SQL or BigQuery syntax which will fail at runtime.

interface InvalidExpressionPattern {
  /** Regex to detect the invalid pattern */
  pattern: RegExp;
  /** Short code for the issue */
  code: string;
  /** What was detected */
  label: string;
  /** What the correct pandas equivalent is */
  suggestion: string;
}

const INVALID_EXPRESSION_PATTERNS: InvalidExpressionPattern[] = [
  {
    pattern: /\bCAST\s*\(/i,
    code: "SQL_CAST",
    label: "CAST(...)",
    suggestion: "Use .astype(...) for type casting",
  },
  {
    pattern: /\bSAFE_CAST\s*\(/i,
    code: "SQL_SAFE_CAST",
    label: "SAFE_CAST(...)",
    suggestion: "Use pd.to_numeric(..., errors='coerce') or .astype(...) for type casting",
  },
  {
    pattern: /\bCASE\s+WHEN\b/i,
    code: "SQL_CASE_WHEN",
    label: "CASE WHEN ... THEN ... END",
    suggestion: "Use np.select(condlist=[...], choicelist=[...], default=...) or np.where(...)",
  },
  {
    pattern: /\bPARSE_DATE\s*\(/i,
    code: "SQL_PARSE_DATE",
    label: "PARSE_DATE(...)",
    suggestion: "Use pd.to_datetime(...) or identity transform for date fields",
  },
  {
    pattern: /\bCOALESCE\s*\(/i,
    code: "SQL_COALESCE",
    label: "COALESCE(...)",
    suggestion: "Use .fillna(...) for null coalescing",
  },
  {
    pattern: /(?<!\w)IF\s*\(/i,
    code: "SQL_IF",
    label: "IF(...)",
    suggestion: "Use np.where(condition, true_val, false_val) for conditional logic",
  },
  {
    pattern: /\bCAST\s*\(.*?\bAS\b/i,
    code: "SQL_CAST_AS",
    label: "CAST(... AS ...)",
    suggestion: "Use .astype(...) for type casting",
  },
];

/**
 * Validate expression text for patterns that the production pipeline cannot execute.
 * Returns warnings (not errors) since expressions may be partially valid or ambiguous.
 */
export function validateExpressionSyntax(
  expression: string,
  targetColumn: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const invalid of INVALID_EXPRESSION_PATTERNS) {
    if (invalid.pattern.test(expression)) {
      issues.push({
        field: targetColumn,
        severity: "warning",
        code: "INVALID_EXPRESSION",
        message: `Expression uses ${invalid.label} which is SQL syntax — the production pipeline expects pandas/numpy. ${invalid.suggestion}`,
        detail: invalid.code,
      });
    }
  }

  return issues;
}

// ── Main validator ──

export function validateYamlOutput(
  parsed: YamlParseResult,
  requestedFields: TargetFieldMeta[],
  entityMeta?: { isAssembly?: boolean },
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // If YAML didn't parse at all, return immediately
  if (!parsed.yamlParsed) {
    issues.push({
      field: "_structure",
      severity: "error",
      code: "PARSE_FAILED",
      message: "YAML failed to parse — no structural validation possible",
    });
    return { valid: false, issues, score: 0 };
  }

  const yamlDoc = parsed.yamlParsed;

  // Build lookup sets
  const definedAliases = new Set(yamlDoc.sources.map((s) => s.alias));
  const columnNames = new Set(yamlDoc.columns.map((c) => c.target_column.toLowerCase()));
  const requestedFieldNames = new Set(requestedFields.map((f) => f.name.toLowerCase()));
  const requestedFieldMap = new Map(requestedFields.map((f) => [f.name.toLowerCase(), f]));

  // Check: MISSING_FIELD — target field has no column entry
  for (const rf of requestedFields) {
    if (!columnNames.has(rf.name.toLowerCase())) {
      issues.push({
        field: rf.name,
        severity: "error",
        code: "MISSING_FIELD",
        message: `Target field "${rf.name}" has no column entry in the YAML output`,
      });
    }
  }

  // Per-column checks
  for (const col of yamlDoc.columns) {
    const transform = col.transform?.toLowerCase() ?? null;
    const fieldMeta = requestedFieldMap.get(col.target_column.toLowerCase());

    // INVALID_TRANSFORM
    if (transform && !["identity", "expression", "literal", "hash_id", "null"].includes(transform)) {
      issues.push({
        field: col.target_column,
        severity: "error",
        code: "INVALID_TRANSFORM",
        message: `Transform "${col.transform}" is not valid. Must be one of: identity, expression, literal, hash_id, null`,
      });
    }

    // MISSING_TRANSFORM — transform is required on every non-null column
    if (!transform && !(Array.isArray(col.source) && (col.source as unknown[]).length === 0)) {
      issues.push({
        field: col.target_column,
        severity: "error",
        code: "MISSING_TRANSFORM",
        message: `Column "${col.target_column}" is missing transform — must be one of: identity, expression, literal, hash_id, null`,
      });
    }

    // Skip further checks for null/unmapped columns
    const isNull = transform === "null" || (Array.isArray(col.source) && (col.source as unknown[]).length === 0);
    if (isNull) continue;

    // IDENTITY_NO_SOURCE
    if (transform === "identity" && !col.source) {
      issues.push({
        field: col.target_column,
        severity: "error",
        code: "IDENTITY_NO_SOURCE",
        message: `Identity column "${col.target_column}" is missing a source field`,
      });
    }

    // EXPRESSION_NO_EXPR
    if (transform === "expression" && !col.expression) {
      issues.push({
        field: col.target_column,
        severity: "error",
        code: "EXPRESSION_NO_EXPR",
        message: `Expression column "${col.target_column}" is missing an expression`,
      });
    }

    // HASHID_NO_COLUMNS
    if (transform === "hash_id" && (!col.hash_columns || col.hash_columns.length === 0)) {
      issues.push({
        field: col.target_column,
        severity: "error",
        code: "HASHID_NO_COLUMNS",
        message: `hash_id column "${col.target_column}" is missing hash_columns`,
      });
    }

    // HASHID_NO_PREFIX — check for entity prefix literal (bare string without '.' — last element convention)
    if (transform === "hash_id" && col.hash_columns?.length) {
      const hasPrefix = col.hash_columns.some((c: string) => !c.includes("."));
      if (!hasPrefix) {
        issues.push({
          field: col.target_column,
          severity: "warning",
          code: "HASHID_NO_PREFIX",
          message: `hash_id "${col.target_column}" is missing entity prefix literal in hash_columns — last element should be a bare string like "ENTITY_NAME"`,
        });
      }
    }

    // HASHID_UNDEFINED_SOURCE — check that aliased hash_columns reference defined source aliases
    if (transform === "hash_id" && col.hash_columns?.length) {
      for (const hc of col.hash_columns) {
        if (hc.includes(".")) {
          const alias = hc.split(".")[0];
          if (!definedAliases.has(alias)) {
            issues.push({
              field: col.target_column,
              severity: "error",
              code: "HASHID_UNDEFINED_SOURCE",
              message: `hash_id "${col.target_column}" references alias "${alias}" not defined in sources`,
              detail: alias,
            });
            break;
          }
        }
      }
    }

    // LITERAL_MALFORMED
    if (transform === "literal") {
      const isLiteralObj = typeof col.source === "object" && col.source !== null && !Array.isArray(col.source) && "literal" in (col.source as Record<string, unknown>);
      if (!isLiteralObj) {
        issues.push({
          field: col.target_column,
          severity: "error",
          code: "LITERAL_MALFORMED",
          message: `Literal column "${col.target_column}" must have source: {literal: "value"}`,
        });
      }
    }

    // UNDEFINED_ALIAS — column references alias not in sources
    if (typeof col.source === "string" && col.source.includes(".")) {
      const alias = col.source.split(".")[0];
      if (!definedAliases.has(alias)) {
        issues.push({
          field: col.target_column,
          severity: "error",
          code: "UNDEFINED_ALIAS",
          message: `Source alias "${alias}" is not defined in the sources section`,
          detail: alias,
        });
      }
    }

    // Check expression for alias references too (skip known globals like pd, np, df)
    if (col.expression) {
      const aliasRefs = col.expression.match(/\b([a-z_][a-z0-9_]*)\.[A-Z]/g);
      if (aliasRefs) {
        for (const ref of aliasRefs) {
          const alias = ref.split(".")[0];
          if (!definedAliases.has(alias) && !EXPRESSION_GLOBALS.has(alias)) {
            issues.push({
              field: col.target_column,
              severity: "error",
              code: "UNDEFINED_ALIAS",
              message: `Expression references alias "${alias}" not defined in sources`,
              detail: alias,
            });
            break; // One error per column is enough
          }
        }
      }

      // INVALID_EXPRESSION — check for SQL/BigQuery syntax the pipeline can't execute
      issues.push(...validateExpressionSyntax(col.expression, col.target_column));
    }

    // MISSING_DTYPE (error — renderer requires dtype on every column)
    if (!col.dtype) {
      issues.push({
        field: col.target_column,
        severity: "error",
        code: "MISSING_DTYPE",
        message: `Column "${col.target_column}" is missing dtype — the renderer requires dtype on every column`,
      });
    }

    // INVALID_DTYPE — must be in the allowed set
    const VALID_DTYPES = ["string", "int", "float", "date", "datetime", "boolean"];
    if (col.dtype && !VALID_DTYPES.includes(col.dtype.toLowerCase())) {
      issues.push({
        field: col.target_column,
        severity: "error",
        code: "INVALID_DTYPE",
        message: `dtype "${col.dtype}" is not valid. Must be one of: ${VALID_DTYPES.join(", ")}`,
      });
    }

    // INCOMPLETE_ENUM (warning) — enum mapping covers fewer values than target expects
    if (fieldMeta?.enumValues?.length && col.expression) {
      const expr = col.expression;
      // Count how many target enum values appear in the expression
      let coveredCount = 0;
      for (const val of fieldMeta.enumValues) {
        if (expr.includes(`"${val}"`) || expr.includes(`'${val}'`)) {
          coveredCount++;
        }
      }
      if (coveredCount < fieldMeta.enumValues.length) {
        issues.push({
          field: col.target_column,
          severity: "warning",
          code: "INCOMPLETE_ENUM",
          message: `Enum mapping covers ${coveredCount} of ${fieldMeta.enumValues.length} target values`,
          detail: `missing: ${fieldMeta.enumValues.filter((v) => !expr.includes(`"${v}"`) && !expr.includes(`'${v}'`)).join(", ")}`,
        });
      }
    }

    // ASSEMBLY_RAW_SOURCE (warning) — assembly entity references pipe_file
    if (entityMeta?.isAssembly) {
      const hasPipeFile = yamlDoc.sources.some((s) => s.pipe_file);
      if (hasPipeFile) {
        issues.push({
          field: col.target_column,
          severity: "warning",
          code: "ASSEMBLY_RAW_SOURCE",
          message: `Assembly entity "${col.target_column}" references raw ACDC source via pipe_file — should use staging pass-throughs`,
        });
      }
    }
  }

  // ── Source-level checks ──

  for (const src of yamlDoc.sources) {
    // SOURCE_NO_TYPE — each source must specify pipe_file or staging
    if (!src.pipe_file && !src.staging) {
      issues.push({
        field: "_structure",
        severity: "error",
        code: "SOURCE_NO_TYPE",
        message: `Source "${src.alias}" has neither pipe_file nor staging — each source must specify one`,
        detail: src.alias,
      });
    }
  }

  // ── Join-level checks ──

  if (yamlDoc.joins) {
    for (const join of yamlDoc.joins) {
      const left = join.left as Record<string, unknown> | undefined;
      const right = join.right as Record<string, unknown> | undefined;
      const on = join.on as string[] | undefined;
      const how = join.how as string | undefined;

      // JOIN_MALFORMED — missing required fields
      if (!left?.source || !right?.source || !on || !how) {
        const missing: string[] = [];
        if (!left?.source) missing.push("left.source");
        if (!right?.source) missing.push("right.source");
        if (!on) missing.push("on");
        if (!how) missing.push("how");
        issues.push({
          field: "_structure",
          severity: "error",
          code: "JOIN_MALFORMED",
          message: `Join definition is incomplete — missing: ${missing.join(", ")}`,
        });
        continue;
      }

      // JOIN_ALIAS_MISMATCH — aliases must be defined in sources
      const leftAlias = left.source as string;
      const rightAlias = right.source as string;
      if (!definedAliases.has(leftAlias)) {
        issues.push({
          field: "_structure",
          severity: "error",
          code: "JOIN_ALIAS_MISMATCH",
          message: `Join left source alias "${leftAlias}" is not defined in sources`,
          detail: leftAlias,
        });
      }
      if (!definedAliases.has(rightAlias)) {
        issues.push({
          field: "_structure",
          severity: "error",
          code: "JOIN_ALIAS_MISMATCH",
          message: `Join right source alias "${rightAlias}" is not defined in sources`,
          detail: rightAlias,
        });
      }

      // JOIN_INVALID_ON — each on entry should match "alias.col == alias.col"
      if (Array.isArray(on)) {
        for (const cond of on) {
          if (typeof cond === "string" && !/^\w+\.\w+\s*==\s*\w+\.\w+$/.test(cond)) {
            issues.push({
              field: "_structure",
              severity: "warning",
              code: "JOIN_INVALID_ON",
              message: `Join condition "${cond}" does not match expected format "alias.col == alias.col"`,
            });
          }
        }
      }
    }
  }

  // ── Concat-level checks ──

  if (yamlDoc.concat) {
    const concat = yamlDoc.concat as Record<string, unknown>;
    const concatSources = concat.sources as string[] | undefined;

    // CONCAT_MALFORMED — must have sources array
    if (!concatSources || !Array.isArray(concatSources)) {
      issues.push({
        field: "_structure",
        severity: "error",
        code: "CONCAT_MALFORMED",
        message: `Concat is present but missing sources array`,
      });
    } else {
      // CONCAT_ALIAS_MISMATCH — each concat source must reference a defined alias
      for (const alias of concatSources) {
        if (!definedAliases.has(alias)) {
          issues.push({
            field: "_structure",
            severity: "error",
            code: "CONCAT_ALIAS_MISMATCH",
            message: `Concat references alias "${alias}" not defined in sources`,
            detail: alias,
          });
        }
      }
    }
  }

  // Deduplicate ASSEMBLY_RAW_SOURCE to one per entity
  const seen = new Set<string>();
  const dedupedIssues = issues.filter((i) => {
    if (i.code === "ASSEMBLY_RAW_SOURCE") {
      if (seen.has("ASSEMBLY_RAW_SOURCE")) return false;
      seen.add("ASSEMBLY_RAW_SOURCE");
    }
    return true;
  });

  // Score calculation
  const errorCount = dedupedIssues.filter((i) => i.severity === "error").length;
  const warningCount = dedupedIssues.filter((i) => i.severity === "warning").length;
  const score = Math.max(0, Math.min(100, 100 - errorCount * 10 - warningCount * 3));

  return {
    valid: errorCount === 0,
    issues: dedupedIssues,
    score,
  };
}

// ── Feedback formatter for correction loop ──

export function formatValidationFeedback(issues: ValidationIssue[]): string {
  const errorLines = issues
    .filter((i) => i.severity === "error")
    .map((i) => `- ${i.field}: ${i.message}`);
  const warnLines = issues
    .filter((i) => i.severity === "warning")
    .map((i) => `- ${i.field}: ${i.message}`);

  const parts: string[] = [
    "YOUR PREVIOUS OUTPUT HAD STRUCTURAL ISSUES. Fix these and regenerate the COMPLETE YAML:",
  ];

  if (errorLines.length > 0) {
    parts.push(`\nERRORS (must fix):\n${errorLines.join("\n")}`);
  }
  if (warnLines.length > 0) {
    parts.push(`\nWARNINGS (should fix):\n${warnLines.join("\n")}`);
  }

  return parts.join("\n");
}

// ── Question generator from validation issues ──

export function issueToQuestion(issue: ValidationIssue): string {
  switch (issue.code) {
    case "MISSING_FIELD":
      return `No mapping was generated for "${issue.field}". What is the correct source and transform?`;
    case "HALLUCINATED_SOURCE":
      return `Source "${issue.detail}" doesn't exist in the schema. What is the correct source for "${issue.field}"?`;
    case "INCOMPLETE_ENUM":
      return `"${issue.field}" enum mapping is incomplete (${issue.detail}). What source codes correspond to the missing values?`;
    case "REQUIRED_NO_NULL_HANDLING":
      return `"${issue.field}" is required but can produce NULL. What default value should be used?`;
    case "ASSEMBLY_RAW_SOURCE":
      return `"${issue.field}" references raw ACDC in an assembly entity. Should this be a staging pass-through instead?`;
    case "HASHID_NO_COLUMNS":
      return `"${issue.field}" needs hash_id transform. What are the natural key columns?`;
    case "HASHID_NO_PREFIX":
      return `"${issue.field}" hash_id is missing an entity prefix in hash_columns. What string should be used to prevent cross-entity collisions?`;
    case "HASHID_UNDEFINED_SOURCE":
      return `"${issue.field}" hash_id references alias "${issue.detail}" not defined in sources. What is the correct source alias?`;
    case "UNDEFINED_ALIAS":
      return `"${issue.field}" references alias "${issue.detail}" not defined in sources. What is the correct source alias?`;
    case "MISSING_TRANSFORM":
      return `"${issue.field}" is missing a transform type. What should it be: identity, expression, literal, hash_id, or null?`;
    case "MISSING_DTYPE":
      return `"${issue.field}" is missing dtype. What data type should this column be: string, int, float, date, datetime, or boolean?`;
    case "INVALID_DTYPE":
      return `"${issue.field}" has an invalid dtype. What should it be: string, int, float, date, datetime, or boolean?`;
    case "JOIN_MALFORMED":
      return `A join definition is incomplete. What are the correct left/right sources, join condition, and join type?`;
    case "JOIN_INVALID_ON":
      return `A join condition has unexpected format. Should it be "alias.column == alias.column"?`;
    case "JOIN_ALIAS_MISMATCH":
      return `Join references alias "${issue.detail}" not defined in sources. What is the correct source alias?`;
    case "CONCAT_MALFORMED":
      return `Concat section is missing its sources array. Which source aliases should be concatenated?`;
    case "CONCAT_ALIAS_MISMATCH":
      return `Concat references alias "${issue.detail}" not defined in sources. What is the correct source alias?`;
    case "SOURCE_NO_TYPE":
      return `Source "${issue.detail}" has neither pipe_file nor staging. Is this a raw ACDC source (pipe_file) or a staging dependency (staging)?`;
    case "INVALID_EXPRESSION":
      return `"${issue.field}" expression uses SQL syntax (${issue.detail}) that the production pipeline cannot execute. Rewrite using pandas/numpy equivalents (np.select, np.where, .map, .fillna, .astype, etc.)`;
    default:
      return `Validation issue with "${issue.field}": ${issue.message}`;
  }
}
