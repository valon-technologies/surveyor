/**
 * Gold format reference examples and common pitfalls for YAML mapping generation.
 * Injected into the YAML system prompt to improve structural compliance.
 *
 * All examples are GENERIC/SYNTHETIC — no real gold field names or expressions.
 */

// ── Annotated examples per transform type ──

export const GOLD_FORMAT_EXAMPLES = `
=== IDENTITY (direct 1:1 field mapping) ===
  - target_column: account_number
    source: acdc.AccountNumber
    transform: identity
    dtype: string

=== EXPRESSION (complex transform with pandas) ===
  - target_column: is_active
    expression: |
      acdc.StatusCode.eq("A")
    transform: expression
    dtype: boolean

=== EXPRESSION + ENUM (.map() for code-to-value translation) ===
  - target_column: loan_type
    expression: |
      acdc.LoanTypeCode.map({"C": "Conventional", "F": "FHA", "V": "VA", "U": "USDA"}).fillna(pd.NA)
    transform: expression
    dtype: string
  # NOTE: Every target enum value MUST appear in the .map() dict. Count them.

=== HASH_ID (deterministic primary key) ===
  - target_column: child_entity_id
    hash_columns: [parent.parent_id, src.NaturalKey1, src.NaturalKey2, "CHILD_ENTITY"]
    transform: hash_id
    dtype: string
  # hash_columns must include:
  #   1. Parent entity FK(s) from staging (e.g., parent.parent_id)
  #   2. ACDC natural key field(s) that uniquely identify this row
  #   3. Entity name literal as LAST element (e.g., "CHILD_ENTITY")
  # Renders as: SHA256(sorted values joined with '_'), prefixed with PROJECT_entity_

=== LITERAL (static constant value) ===
  - target_column: data_source
    source: {literal: "ACDC"}
    transform: literal
    dtype: string

=== NULL (intentionally unmapped) ===
  - target_column: deprecated_field
    source: []
    transform: null
    dtype: string

=== ASSEMBLY STRUCTURE (component-assembly pattern) ===
An assembly entity UNIONs multiple component staging tables. The assembly YAML
does NOT reference raw ACDC tables — it reads from staging components:

  sources:
    - name: entity_primary
      alias: primary
      staging:
        table: "entity_primary"
    - name: entity_secondary
      alias: secondary
      staging:
        table: "entity_secondary"

  concat:
    sources: [primary, secondary]

  columns:
    - target_column: some_field
      source: some_field          # no alias prefix — identity pass-through from staging
      transform: identity
      dtype: string

COMPONENT STRUCTURE (feeds into assembly):
A component entity maps raw ACDC fields for a specific variant:

  sources:
    - name: raw_table
      alias: rt
      pipe_file:
        table: "RawSourceTable"

  columns:
    - target_column: some_field
      source: rt.VariantSpecificField
      transform: identity
      dtype: string
`;

// ── Common pitfalls checklist ──

export const GOLD_FORMAT_PITFALLS = `
1. ASSEMBLY vs COMPONENT CONFUSION: Assembly entities use \`staging:\` sources and identity pass-throughs.
   Component entities use \`pipe_file:\` sources with actual field mappings. Never put ACDC pipe_file
   references in an assembly YAML.

2. MISSING ENUM VALUES: If target field has 5 allowed values, your .map() MUST produce all 5.
   Always add .fillna(pd.NA) for unknown source codes.

3. BOOLEAN TRAPS: Source booleans are stored as 'Y'/'N' or '1'/'0' codes, NOT native booleans.
   Use .eq("Y") or .isin(["A","H"]), NEVER use .astype(bool) or CAST.

4. HASH_ID MISSING COLUMNS: Primary key fields MUST use hash_id transform with hash_columns listing
   the natural key fields. Don't use expression for PKs.

5. FOREIGN KEY PASS-THROUGHS: FK fields like loan_id in a child entity come from staging dependencies
   as identity pass-throughs. Don't re-derive them with hash_id.

6. SOURCE ALIAS MISMATCH: Every alias.FieldName in columns MUST reference an alias defined in sources.
   E.g., if you use "pf.LoanNumber", there must be a source with alias "pf".

7. INVENTING FIELDS: Only use field names from the "Available Source Schema" section. If you're not
   sure a field exists, use transform: null instead of guessing.

8. MISSING dtype: Every column entry should have a dtype (string, int, float, date, datetime, boolean).

9. HASH_COLUMNS SELECTION: hash_id columns must include parent FKs + ACDC natural keys +
   entity name literal. Don't include timestamps unless they're part of the natural key.
   Don't include derived fields. The entity name literal (last element) MUST be a bare
   string without a dot (e.g., "BANK_ACCOUNT", not an alias.field reference).
`;
