# Flow Servicing Transfer Mapping Principles

Distilled from reviewer feedback on Stockton portfolio mapping. These principles apply
to ALL flow servicing transfers of newly originated loans, not just Stockton.

## 1. Accounting Balance Fields (loan_accounting_balance)

For flow servicing transfers of newly originated loans, ALL balance fields that represent
running totals, arrearages, or accrued amounts should be set to **0.00** at boarding.
This includes:
- All bankruptcy pre/post petition balances and deltas
- All fee balances (late, NSF, other) and deltas
- Deferred principal, suspense, loss draft, and their deltas
- Escrow system advance, client advance, interest accrued, and their deltas
- GSE servicing strip, guaranty fee, master servicing fee, and their deltas
- Non-recoverable advance, recoverable servicing advance, and their deltas
- Third-party advance and delta

Exception: **escrow_holding_balance** should map to the initial escrow deposit from the source file.

The `action_datetime` and `date_effective` should be set to the loan's closing/origination date.
The `servicing_activity_id` should be "Loan Boarding".

## 2. Loan ID / Primary Key Fields

The loan_id FK that connects all entities (loan_to_property, loan_to_portfolio,
loan_document, loan_at_origination_info, etc.) must be the **Valon loan number**,
which may NOT be available in the source file for flow transfers. During boarding,
the loan number may be created from scratch. Determine with each client whether
the loan number comes from the incoming file or is generated during the transfer process.

## 3. Conditional Entity Creation

Several entities should only be created when specific conditions are met:
- **ARM entities** (arm_loan_info, arm_rate_period, index_rate): only create if the loan IS an ARM
- **HELOC entities**: only create if the loan IS a HELOC
- **Mortgage insurance entities**: only create if PMI/MIP is present on the loan
- **Autopay entities** (loan_payment_auto_pay_schedule): only create if autopay/ACH is present
- **Interest rate buydown entities** (loan_payment_deduction_schedule): only create if IRB is active
- **Credit reporting entities**: do NOT build at boarding; the system will generate these automatically

## 4. Default Constants for Flow Transfers

These fields have standard values for all flow servicing transfers:
- `borrower_credit_score.source_type` → "ORIGINATION"
- `borrower_credit_score.retrieved_date` → origination date
- `borrower_to_loan.loan_user_type` → "BORROWER" (unless co-borrower data present)
- `escrow_schedule.creation_source` → "INITIAL"
- `loan_payment_auto_pay_schedule.schedule_source` → "SERVICING_TRANSFER"
- `loan_payment_auto_pay_schedule.schedule_status` → "INITIATED"
- `loan_payment_billing_schedule.version` → 1
- `loan_payment_deduction_schedule.version` → 1
- `loan_tax_info.provider_reporting_status` → "NOT_REPORTED"
- `mortgage_insurance.certificate_status` → "NOT_REPORTED_TO_CARRIER"
- `property_valuation.valuation_purpose` → "LOAN_ORIGINATION"
- `property_valuation.valuation_status` → "COMPLETED"
- `loan.is_actively_serviced` → true
- `loan.hamp_step_rate` → false
- `loan.has_additional_collateral` → false

## 5. Derived Mappings

Some fields require multi-step derivation:
- `loan.investor_type`: parse "Loan Program" — FNMA→FANNIE, FHLMC→FREDDIE, FHA/VA/USDA/RHS/PIH/GNMA→GINNIE, else→PRIVATE_ASSET
- `loan.fannie_loan_number` / `loan.freddie_loan_number`: conditionally set to "Investor Loan Number" based on Loan Program value
- `loan_at_origination_info.original_product_type`: derive from ARM Plan ID + Interest Only Flag + ELOC Plan Code
- `mortgage_insurance.payment_source`: derive from PMI/MIP monthly payment field
- `mortgage_insurance.premium_plan_type`: derive from monthly vs upfront MI amounts
- `loan.government_insuring_agency`: use "Lo Type" field (NOT "Hi Type" — Hi Type is lien position)
- `loan_to_property.lien_position`: from Hi Type field — 0=construction/first, 1=FIRST_LIEN, 3=SECOND_LIEN

## 6. Prior Servicer Fields

For flow transfers, prior_servicer_id, prior_servicer_name, and portfolio_id cannot
easily be mapped from the source file. These require client-specific configuration
("tokens") determined during each new partnership setup. Leave blank until tokens are available.

## 7. Multi-Borrower Handling

Each borrower field set (DOB, SSN, name, email, phone) must be associated to the correct
borrower record. Fields like "DOB 1", "DOB 2" map to borrower #1, #2 respectively.
The borrower_to_loan relationship must be created for each borrower.

## 8. Payment Schedule Derivation

- `loan_payment_auto_pay_schedule.next_payment_date`: derive from requested_payment_date
- `loan_payment_auto_pay_schedule.next_actual_draft_date`: derive from next_payment_date minus lead days
- `loan_payment_interest_schedule.grouping_entity_type`: "HELOC_DRAW" for HELOCs, "LOAN" for others
- `loan_payment_interest_schedule.accrual_calculation`: default "MONTHLY" for standard loans
