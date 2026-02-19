/**
 * Renderer expression context and filter reference.
 * Teaches the LLM about the runtime environment available when
 * the Python renderer evaluates YAML mapping expressions.
 */

export const RENDERER_EXPRESSION_CONTEXT = `
EXPRESSION RUNTIME ENVIRONMENT:
When transform is "expression", the expression is evaluated as Python/pandas code with these
variables available:

ALIAS DATAFRAMES:
  Each source alias (e.g., "li", "ed", "pf") is available as a pandas DataFrame with
  the original unsuffixed column names. Write: li.LoanNumber, ed.FpLastPaymentDueDate, etc.

GLOBAL VARIABLES (available ONLY inside expression: fields — these are NOT source aliases):
  - df: The full joined DataFrame (all sources merged)
  - pd: pandas library (use pd.NA, pd.to_numeric, etc. — NEVER use "pd" as a source alias prefix)
  - np: numpy library (use np.where, np.select, etc. — NEVER use "np" as a source alias prefix)
  IMPORTANT: pd, np, and df are Python runtime globals. They must ONLY appear inside expression:
  fields. Never write "source: pd.FieldName" or "source: np.FieldName" — those are not data sources.

AVAILABLE FUNCTIONS:
  - date_add(start, n, unit): Add time units to a date. unit = "day", "month", "year"
  - date_diff(later, earlier, unit): Difference between dates. unit = "day", "month", "year"
  - row_number(df, partition_by, order_by): SQL-style ROW_NUMBER() window function
  - hash_id(df, PROJECT_NAME, entity, hash_columns): Generate deterministic hash IDs
  - hash_borrower_id(PROJECT_NAME, ssn, first_name, last_name): Borrower-specific hash
  - hash_address_id(PROJECT_NAME, addr1, addr2, city, state, zip): Address-specific hash

COMMON EXPRESSION PATTERNS:
  Boolean:       fi.FieldCode.eq("Y")  or  fi.FieldCode.isin(["A","B"])
  Conditional:   np.where(condition, true_val, false_val)
  Multi-branch:  np.select(condlist=[...], choicelist=[...], default=pd.NA)
  Enum mapping:  src.Code.map({"A": "Active", "I": "Inactive"}).fillna(pd.NA)
  Filter:        src.Value.where(src.Flag == "Y", pd.NA)
  Date math:     date_diff(ed.EndDate, ed.StartDate, "month")
  Null handling: src.Field.fillna(0)  or  src.Field.fillna(pd.NA)
  Type cast:     pd.to_numeric(src.Field, errors="coerce")
  String ops:    src.Field.str.replace(r"^0", "", regex=True)
  Rounding:      (expression).round(2)
`;

export const RENDERER_FILTER_REFERENCE = `
FILTER OPERATORS (use in sources.filters):
  eq, neq:            Equality/inequality — value: scalar
  gt, gte, lt, lte:   Numeric comparisons — value: number
  in, not_in:         Membership — value: [list]
  contains, not_contains:  String contains — value: string
  starts_with, ends_with:  String prefix/suffix — value: string
  is_null, is_not_null:    Null checks — no value needed
  between:             Range — value: [min, max]
  dedup:               Deduplicate — column: string or [list], keep: "first"|"last"
  not_null_and_dedup:  Filter nulls then dedup — column: string or [list], keep: "first"|"last"
  expression:          Custom pandas boolean expression — expression: "pandas_expr"
`;
