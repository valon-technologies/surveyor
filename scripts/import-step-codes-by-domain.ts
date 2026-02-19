/**
 * Import Step Codes By Domain — split into individual context documents.
 *
 * Creates:
 *   1. ServiceMac > Step Codes Overview  (TOC + query patterns)
 *   2. ServiceMac > Step Codes > Bankruptcy
 *   3. ServiceMac > Step Codes > Foreclosure
 *   4. ServiceMac > Step Codes > Loss Mitigation
 *   5. ServiceMac > Step Codes > Eviction
 *   6. ServiceMac > Step Codes > Claims
 *   7. ServiceMac > Step Codes > REO
 *   8. ServiceMac > Step Codes > Property Preservation
 *   9. ServiceMac > Step Codes > Balloon and Other
 *
 * Also removes the old monolithic "ServiceMac > Step Codes By Domain" if present.
 *
 * Usage:
 *   npx tsx scripts/import-step-codes-by-domain.ts
 */

import Database from "better-sqlite3";
import { createHash } from "crypto";
import path from "path";

const DB_PATH = path.join(process.cwd(), "surveyor.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

function deterministicId(input: string): string {
  return createHash("md5").update(input).digest("hex").replace(
    /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
    "$1-$2-$3-$4-$5"
  );
}

const WORKSPACE_ID = (
  db.prepare("SELECT id FROM workspace LIMIT 1").get() as { id: string }
).id;

if (!WORKSPACE_ID) {
  console.error("No workspace found in DB");
  process.exit(1);
}

// ─── Content for each document ──────────────────────────────────

const DOCS: { name: string; tags: string[]; content: string }[] = [
  // ── 1. Overview / TOC ─────────────────────────────────────────
  {
    name: "ServiceMac > Step Codes Overview",
    tags: ["servicemac", "step-codes", "overview", "index"],
    content: `# ServiceMac Step Codes — Overview

> Index document for the step code system. Individual domain docs contain full code listings and VDS field mappings.

## Step Code System Summary

The Step table is an **append-only event log** — each row records a workflow milestone for a loan. There are **1,283 step codes** across all workstations.

### How to Map Step Codes to VDS Fields

1. **Filter by workstation** (FORE, BANK, LSMT, REO) — not by letter prefix
2. **Filter by StepCode** to isolate the specific event
3. **Use \`ActualCompletionDate\`** as the date value
4. **Aggregate with \`MIN()\`** for "first occurrence" or \`MAX()\` for "latest occurrence"

### Workstation ↔ Template Source Mapping

| Workstation | Template | Domain | Step Code Doc |
|-------------|----------|--------|---------------|
| FORE | FOR | Foreclosure | \`ServiceMac > Step Codes > Foreclosure\` |
| BANK | BNK | Bankruptcy | \`ServiceMac > Step Codes > Bankruptcy\` |
| LSMT | LMT | Loss Mitigation | \`ServiceMac > Step Codes > Loss Mitigation\` |
| REO | REO | Real Estate Owned | \`ServiceMac > Step Codes > REO\` |
| — | BLN | Balloon | \`ServiceMac > Step Codes > Balloon and Other\` |

> **Critical**: Never assume workstation from letter prefix. Code B01 ("CHAPTER 7 BK WS OPEN") runs on BANK workstation, but numeric codes like 289 ("HOLD PLACED 1ST BK") run on FORE workstation.

### Related Documents

- \`ServiceMac > STEP CODE SYSTEM GUIDE\` — mechanics of the step table, query patterns
- \`ServiceMac > Tables > Step\` — full table schema and field definitions
- \`ServiceMac > Enums > STEP ENUMS\` — raw enum reference (1,283 values)

### Domain-Specific Step Code Docs

| Doc | Codes | VDS Entities |
|-----|-------|-------------|
| \`Step Codes > Bankruptcy\` | B01–B63 + 200 numeric | bankruptcy_case, bankruptcy_case_filing |
| \`Step Codes > Foreclosure\` | F01–F99 + 100 numeric | foreclosure, foreclosure_sale, foreclosure_hold |
| \`Step Codes > Loss Mitigation\` | L01–L99, M01–M99, N01–N52 | loss_mitigation_application, _forbearance, _loan_modification, _partial_claim, _payment_deferral |
| \`Step Codes > Eviction\` | E01–E71 | property_preservation_case (post-sale) |
| \`Step Codes > Claims\` | Q01–Q99 | agency_claim, agency_claim_line_item |
| \`Step Codes > REO\` | R01–R99, Z01–Z99 | post-foreclosure disposition |
| \`Step Codes > Property Preservation\` | P01–P55 | property_preservation_case, _work_order |
| \`Step Codes > Balloon and Other\` | S01–S06, T01–T48, misc | balloon_loan_info |
`,
  },

  // ── 2. Bankruptcy ─────────────────────────────────────────────
  {
    name: "ServiceMac > Step Codes > Bankruptcy",
    tags: ["servicemac", "step-codes", "bankruptcy", "BANK"],
    content: `# Step Codes — Bankruptcy Domain

> Workstation: **BANK** (template source: BNK)
> VDS entities: \`bankruptcy_case\`, \`bankruptcy_case_debtor\`, \`bankruptcy_case_filing\`, \`bankruptcy_case_loan_details\`

## Key VDS Field Mappings

| VDS Field | Step Code | Description | Aggregation |
|-----------|-----------|-------------|-------------|
| \`bankruptcy_case.filing_date\` | B04 or B01 | BK WORKSTATION OPENED / CH7 WS OPEN | MIN() |
| \`bankruptcy_case.discharge_date\` | B14 | DT DISCHRG ORD ENT W CRT | MIN() |
| \`bankruptcy_case.dismissal_date\` | B15 | DT DISMISL ORD ENT W CRT | MIN() |
| \`bankruptcy_case.closure_date\` | B13 | CLOSING REASON EFF DATE | MIN() |
| \`bankruptcy_case.plan_confirmation_date\` | B11 | PLAN CONFIRMED | MIN() |
| \`bankruptcy_case.plan_filed_date\` | B08 | PLAN FILED W COURT | MIN() |
| \`bankruptcy_case.poc_filed_date\` | 220 | ACTUAL DT POC FILED W CRT | MIN() |
| \`bankruptcy_case.mfr_filed_date\` | 150 | MFR FILED DATE | MIN() |
| \`bankruptcy_case.mfr_hearing_date\` | 151 | MFR HEARING/OBJ DATE | MIN() |
| \`bankruptcy_case.relief_effective_date\` | 049/054 | RELIEF EFFECTIVE DATE | MIN() |
| \`bankruptcy_case.stay_lifted_date\` | 050/055 | STAY LIFTD/MFR PROC COMPL | MIN() |

> **Gotcha**: \`BankruptcyCompletionDate\` in LoanInfo is workstation deactivation, NOT discharge. Always use step B14 for actual discharge order date.

## B-Prefixed Codes (63 codes)

| Code | Description |
|------|-------------|
| B01 | CHAPTER 7 BK WS OPEN |
| B02 | CHAPTER 7 CLOSE REASON |
| B03 | CH7 CLOSE REASON EFF DATE |
| B04 | BK WORKSTATION OPENED |
| B05 | POC SCREEN SU IN SERV SYS |
| B06 | PLAN REV REF TO ATTY |
| B07 | PLAN REV RECD BY ATTY |
| B08 | PLAN FILED W COURT |
| B09 | PLAN REVIEW COMPLETE |
| B10 | PLAN CONFIRMATION HR DT |
| B11 | PLAN CONFIRMED |
| B12 | CLOSING REASON |
| B13 | CLOSING REASON EFF DATE |
| B14 | DT DISCHRG ORD ENT W CRT |
| B15 | DT DISMISL ORD ENT W CRT |
| B16 | BK CLIENT MONITOR OPENED |
| B17 | BK CHPT 11-13 WS OPENED |
| B18 | PCN REQUESTED |
| B19 | PCN FILED |
| B20 | MOTION REQUESTED |
| B21 | CASE REINSTATEMENT |
| B22 | MOTION APPRVL DENIED |
| B23 | BLOCK CCN ACCESS |
| B24 | REQEUST ESC ANALYSIS |
| B25 | LM APPROVAL REFERRAL |
| B26 | MOTION TO ALLOW FILED |
| B27 | MOD APPRVL ORDER TO LMT |
| B28 | AMENDED POC REFERRED |
| B29 | AMENDED POC FILED |
| B30 | FINAL CURE NOTICE RCVD |
| B31 | FINAL CURE RESPONSE FILED |
| B32 | FINAL CURE HEARING HELD |
| B33 | SEND REAFF TO ATTORNEY |
| B34 | REAFF INTENT RECV |
| B35 | REAFF PROCESS CLOSED |
| B36 | REAFF DRAFT APRV TO ATTY |
| B37 | ATTY UPLOADED PPFN DRAFT |
| B38 | APPR PPFN DRAFT |
| B39 | PCN NOT NEEDED |
| B40 | CLAIM ALLOWED |
| B41 | CLAIM DISALLOWED |
| B42 | MOTION TO VALUE RFRD |
| B43 | MOTION TO VALUE RCVD |
| B44 | MTV VALUATION REQUIRED |
| B45 | MTV OBJ FILED |
| B46 | MTV RESOLVED |
| B47 | MTV SYSTEM CHNGS NEEDED |
| B48 | MTV CLIENT NOTIFIED |
| B49 | MTV CHANGES COMPLETE |
| B50 | BK RECONSILED |
| B51 | MULTI FILER REVIEW |
| B52 | ATTY RVW OF MULTI FILER |
| B53 | LM MEDIATION SCH |
| B54 | LM MEDIATION HELD |
| B55 | REAFFIRMATION RESCINDED |
| B56 | BORROWER OPT-OUT STTMTS |
| B58 | BK CONTESTED DELAY BEGIN |
| B59 | BK CONTESTED DELAY END |
| B60 | BK LITIGATION DELAY BEGIN |
| B61 | BK LITIGATION DELAY END |
| B62 | BK CASE CONVERSION |
| B63 | BK CONCURRENT CASE FILED |

## Bankruptcy-Related Numeric Codes (on FORE workstation)

These track bankruptcy interactions during active foreclosure:

| Code | Description | Category |
|------|-------------|----------|
| 001 | PRELIM OBJECTION FILED | BK objection in FC |
| 012–015 | APO FILED / HEARING / ENTERED / RECONCILED | Adequate Protection Order |
| 016–022 | ADVERSARY proceedings (referred, received, filed, hearing, results, entered, notified) | Adversary complaint |
| 023–036 | AGREED ORDER workflow (payments cured, expired, amended, terms, submitted, filed, default) | Agreed order |
| 037–044 | AMENDED PLAN/POC review (referred, received, completed, validated, filed, reconciled) | Plan amendments |
| 045–056 | AGREED ORDER DEFAULT relief (cured, hearing, results, order entered, effective, stay lifted, closing) | Relief from stay |
| 057–061 | CH7 ASSET/CLOSING/TERMINATION (review, requirement, trustee notice, terminated, abandonment) | Ch7 disposition |
| 062–068 | CRAMDOWN proceedings (referred, received, valuation, objection, hearing, results, notified) | Cramdown |
| 069 | DEBTOR INTENT RECEIVED | Statement of intent |
| 070–090 | MOTIONS: deem current (070–076), extend stay (077–083), impose stay (084–090) | BK motions |
| 091–097 | DEFENSE OF POC (referred, received, review, filed, hearing, results, notified) | POC defense |
| 098–099 | TRUSTEE SALE (terms, results) | BK trustee sale |
| 100–102 | BK ESCROW ANALYSIS (requested, completed, review) | Escrow in BK |
| 103–113 | FINAL CURE (confirmation referred/received/filed, notice filed/received, objection cycle, review) | Final cure |
| 114–120 | LIENHOLDER MFR (referred, received, filed, hearing, entered, effective, BK hold removal) | Motion for relief |
| 121–144 | LM CONTACT ORDER (request filed, obj needed, entered, scheduled, termination, results, referred) | LM contact orders |
| 145–163 | MFR process (referred, received, uploaded, QA, approved, filed, hearing, results, revision, in rem) | Motion for relief |
| 164–169 | MTN TO DISMISS (referred, received, filed, hearing, results, entered) | Dismiss motion |
| 170–176 | MTN TO SELL (objection referred, received, filed, hearing, results, terms updated, entered) | Sell motion |
| 177–182 | MTN TO VACATE (objection referred, received, filed, hearing, results, entered) | Vacate motion |
| 183–188 | MTN TO VALIDATE SALE (referred, received, filed, hearing, results, entered) | Sale validation |
| 189–191 | NO STAY ORDER (referred, received, entered) | No stay |
| 192 | SALE RESCN/BEING RESC 2 BK SU | Sale rescission |
| 193–207 | PAYMENT CHANGE/PPFN defense (client notice, review, filed, hearing, results, referred, filed) | Payment notices |
| 208–213 | PLAN OBJECTION (referred, received, filed, hearing, results, complete) | Plan objection |
| 214–224 | POC workflow (referred, received, bar date, creditors, uploaded, QA, filed, claim#, reconciled, revision, revised) | Proof of Claim |
| 225–228 | REINSTATEMENT/PPFN (figures, received, referred, filed) | Reinstatement |
| 229–233 | REAFFIRMATION (referred, received, mailed, signed, filed) | Reaffirmation |
| 234–238 | SUPPLEMENTAL POC (referred, received, reviewed, uploaded, filed) | Supplemental POC |
| 239–242 | TOC (referred, received, sent, entered) | Transfer of Claim |
| 243–246 | TDP (POC screen modified, terms outlined, mailed, filed) | Trial Disbursement |
| 251–254 | WITNESS REQUEST (received, acknowledged, contacted, decision) | Witness |
| 271 | BK COURT CLEARANCE OBTN | BK clearance for FC |
| 289–296 | HOLD/RESUME FC for 1st–4th BK (289/290, 291/292, 293/294, 295/296) | FC holds for BK |
| 373–374 | IN PERSON HEARING (scheduled, held) | BK hearings |
`,
  },

  // ── 3. Foreclosure ────────────────────────────────────────────
  {
    name: "ServiceMac > Step Codes > Foreclosure",
    tags: ["servicemac", "step-codes", "foreclosure", "FORE"],
    content: `# Step Codes — Foreclosure Domain

> Workstation: **FORE** (template source: FOR)
> VDS entities: \`foreclosure\`, \`foreclosure_bid\`, \`foreclosure_hold\`, \`foreclosure_payoff\`, \`foreclosure_reinstatement\`, \`foreclosure_sale\`, \`pre_foreclosure_state_process\`, \`preforeclosure_referral_review\`

## Key VDS Field Mappings

| VDS Field | Step Code | Description | Aggregation |
|-----------|-----------|-------------|-------------|
| \`foreclosure.referral_date\` | F01 | FORECLOSURE WS ACTIVATED | MIN() |
| \`foreclosure.attorney_referral_date\` | F02 | REFERRED TO ATTY | MIN() |
| \`foreclosure.attorney_receipt_date\` | F03 | RECEIVED BY ATTY | MIN() |
| \`foreclosure.first_legal_action_date\` | F04 | 1ST LEGAL COMPLETED | MIN() |
| \`foreclosure.service_complete_date\` | F09 | SERVICE COMPLETE | MIN() |
| \`foreclosure.complaint_filed_date\` | F10 | COMPLAINT/PETITION FILED | MIN() |
| \`foreclosure.judgement_date\` | F11 | JUDGEMENT ENTERED | MIN() |
| \`foreclosure.title_received_date\` | F08 | TITLE RECEIVED | MIN() |
| \`foreclosure.transfer_to_reo_date\` | 288 | TRANSFER TO REO | MIN() |
| \`foreclosure.transfer_to_claims_date\` | 297 | TRANSFER TO CLAIMS | MIN() |
| \`foreclosure_sale.sale_scheduled_date\` | F05 | SALE SCHEDULED DATE | MAX() |
| \`foreclosure_sale.sale_held_date\` | F06 | SALE HELD | MIN() |
| \`foreclosure_sale.sale_results_date\` | F07 | SALE RESULTS REPORTED | MIN() |
| \`foreclosure_hold.fema_hold_start\` | 272 | FEMA HOLD BEGIN | MIN() |
| \`foreclosure_hold.fema_hold_end\` | 308 | FEMA HOLD END | MIN() |
| \`foreclosure_hold.state_delay_start\` | 273 | STATE MANTD DELAY/MEDIATN | MIN() |
| \`foreclosure_hold.state_delay_end\` | 284 | STATE MANDATE DELAY END | MIN() |
| \`foreclosure_hold.gov_moratorium_start\` | 279 | GOV MORATORIUM HOLD START | MIN() |
| \`foreclosure_hold.gov_moratorium_end\` | 285 | GOV MORATORIUM HOLD END | MIN() |
| \`foreclosure_hold.lm_hold_start\` | 310 | HOLD PLACED - 1ST LM | MIN() |
| \`foreclosure_hold.lm_hold_end\` | 311 | RESUME FC - 1ST LM DISM | MIN() |
| \`foreclosure_hold.bk_hold_start\` | 289 | HOLD PLACED 1ST BK | MIN() |
| \`foreclosure_hold.bk_hold_end\` | 290 | FC RESUME - 1ST BK DIS | MIN() |

> **FcRemovalCode** (LoanInfo): 1=Cured, 2=PIF, 3=Loss Mit, 4=REO, 5=Third Party Sale, 6=DIL, 7=Bankruptcy. See \`ServiceMac > Enums > LOANINFO ENUMS\`.

## F-Prefixed Codes (99 codes)

| Code | Description |
|------|-------------|
| F01 | FORECLOSURE WS ACTIVATED |
| F02 | REFERRED TO ATTY |
| F03 | RECEIVED BY ATTY |
| F04 | 1ST LEGAL COMPLETED |
| F05 | SALE SCHEDULED DATE |
| F06 | SALE HELD |
| F07 | SALE RESULTS REPORTED |
| F08 | TITLE RECEIVED |
| F09 | SERVICE COMPLETE |
| F10 | COMPLAINT/PETITION FILED |
| F11 | JUDGEMENT ENTERED |
| F12 | SALE/VESTING SCHED DATE |
| F13 | SALE/VESTING HELD |
| F14 | RESULTS OF SALE CONFIRMED |
| F15 | 1099A/C COMPLETE |
| F16 | 14-45 DAY NOI LTR SENT |
| F17 | 237.1 DEFAULT LTRS SENT |
| F18 | 30 DAY NOTICE SENT TO BWR |
| F19 | ANSWER PERIOD EXPIRATION |
| F20 | ATY ADVSD OF 1ST LEGALACT |
| F21 | ATTY READY FOR NOD FILING |
| F22 | ATTY READY FOR NOS FILING |
| F23 | CASE DOCKETED/PUB COMENCD |
| F24 | CERT OF FC RECORDED |
| F25 | DEFAULT ENTERED |
| F26 | DEFAULT SENT FOR FILING |
| F27 | FINAL TITLE CLEAR |
| F28 | HEARING COMPLETE |
| F29 | HOME EQUITY APPLICATION |
| F30 | HOMESTD STATUS DETERMTN |
| F31 | HUD 1ST LEGAL ACT EXPIRES |
| F32 | HUD OCCUPANCY LTR SENT |
| F33 | JUDGE DECISION OF FC TYPE |
| F34 | JUDGEMENT FILED |
| F35 | JDGMNT HRNG SCHDLD FOR |
| F36 | JUDGEMENT REQUESTED |
| F37 | MTN FOR WRIT OF EXECUTION |
| F38 | ORDR APPROVNG APPLICATION |
| F39 | ORDR OF NOTICE FILED |
| F40 | ORDR OF REFERENCE REC'D |
| F41 | ORDER OF REFERENCE REC'D |
| F42 | PRAECIPE FILED |
| F43 | PRELIMINARY TITLE CLEAR |
| F44 | PRELIM TITLE REVIEWED |
| F45 | PRESALE REDMPTION EXPIRES |
| F46 | REFEREE APPOINTED |
| F47 | REFEREE'S OATH RECEIVED |
| F48 | REFND CK REC'D BY CLIENT |
| F49 | REFUND CK RETD TO CLIENT |
| F50 | REQ FOR INTERVENTION |
| F51 | SALE DT REQD FRM MARSHALL |
| F52 | SALE DPSIT CK RECD BY ATY |
| F53 | SALE DEPOSIT CK SNT 2 ATY |
| F54 | SALE DEPST RQ RCD FRM ATY |
| F55 | SALE DEP REQ SUBMITTED |
| F56 | SERVICE SENT (1ST ACTION) |
| F57 | SERVCR APRVL OF NOD FILNG |
| F58 | SRVCR APPRVL OF NOS FILNG |
| F59 | SETTLEMENT CONFERNC SCHLD |
| F60 | TITLE ORDERED |
| F61 | TITLE REPORT RECEIVED |
| F62 | TSG REPORT RECEIVED |
| F63 | WRIT OF EXECUTION ENTERED |
| F64 | TITLE ISSUE IDENTIFIED |
| F65 | TITLE ISSUE RESOLVED |
| F66 | 3RD PTY $ RCD/SNT 2 CLNT |
| F67 | 3RD PTY$ RCD&APLD BY CLNT |
| F68 | POST SALE REDMPTN EXPIRES |
| F69 | OBJCTN PERIOD EXPIRATN DT |
| F70 | CONFIRMATION DATE |
| F71 | SALE RATIFICATION CMPL DT |
| F72 | UPSET BID EXPIRES |
| F73 | FHLMC NOTFD OF REO ROLLBK |
| F74 | PLEADING(S) FILED DATE |
| F75 | HEARING DATE |
| F76 | DATE ANSWER FILED |
| F77 | MSJ FILED |
| F78 | ATTESTATION PREPARED |
| F79 | ATTY REC'D ATTESTATION |
| F80 | DIL REFERRED TO ATTY |
| F81 | DIL RECORDED DATE |
| F82 | FILE CONTESTED |
| F83 | CNTSTD HOLD/ISSUE CLOSED |
| F84 | PLEADING FILED DATE |
| F85 | CONTESTED MATTER RESOLVED |
| F86 | CONSTESTED MATTR RESOLVED |
| F87 | NOTFD OF SALE 2 B RESCIND |
| F88 | SALE RESCISSION COMPLETED |
| F89 | SERVICE RELEASE EFF DATE |
| F90 | SRVCE RELS'D NOTIFICTN DT |
| F91 | LM RQ REC&UPLODED 2 LENDR |
| F92 | LNDR RSP2 LM RQ&UPLOD2ATY |
| F93 | COURT RULING FILED |
| F94 | INJNCTN GRNTD FILE MNTNC |
| F95 | INF NED 2SND NOI SNT 2ATY |
| F96 | NOI SENT TO BORROWER |
| F97 | MEDIATION HEARING DATE |
| F98 | MEDIATION HEARING COMPLTD |
| F99 | BORRWR HAS REQD MEDIATION |

## Foreclosure-Related Numeric Codes

### Sale & Resolution (248–337)

| Code | Description |
|------|-------------|
| 248 | PROPERTY VACANT |
| 249 | VALUATION ORDERED |
| 250 | VALUATION RECEIVED |
| 255 | SERV DIRECTION REC BY ATY |
| 256 | MARKETABLE TITLE |
| 257 | SOLD CWCOT |
| 258 | SOLD 2ND CHANCE CWCOT |
| 259 | REINSTATED |
| 260 | PAID IN FULL |
| 261 | BIDDING INSTRUCTIONS SENT |
| 262 | FC DEED SENT TO RECORD |
| 263 | FC DEED RECORDED |
| 264 | CONVEYED TO HUD |
| 265 | GOVERNMENT SEIZURE |
| 266 | PROP SOLD2 3RD PRT<TD |
| 267 | SECOND LIEN CONSIDERATION |
| 268 | NO UPSET BID FROM VET ADM |
| 269 | VET ADM POSSIBLE REFUND |
| 270 | VA BUYDOWN |
| 272 | FEMA HOLD BEGIN |
| 273 | STATE MANTD DELAY/MEDIATN |
| 274 | 3RD PTY SALE=/> TOTALDEBT |
| 275 | POST SALE REDEMPT EXPIRED |
| 276 | PROP SURRENDERED THRU BK |
| 277 | VA CONF SALE NO TOC |
| 278 | ELECTION TO CONVEY (TOC) |
| 279 | GOV MORATORIUM HOLD START |
| 280 | 1ST LEGAL EXT REQ SUBMIT |
| 281 | 1ST LEGAL EXT GRANTED |
| 282 | 1ST LEGAL EXT DENIED |
| 283 | APPR TO PURSUE DEF JUDGEM |
| 284 | STATE MANDATE DELAY END |
| 285 | GOV MORATORIUM HOLD END |
| 286 | HUD APPROVED OCC. CONVEY |
| 287 | HUD DENIED OCC CONVEY |
| 288 | TRANSFER TO REO |
| 297 | TRANSFER TO CLAIMS |
| 298 | MOBILE HOME DETITLE COMP |
| 299 | FC BPO ORDERED |
| 300 | FC BPO RECEIVED |
| 301 | FC APPRAISAL ORDERED |
| 302 | FC APPRAISAL RECEIVED |
| 303 | PROPERTY REDEEMED |
| 304 | FHLMC ROLLBACK REQ SUBMIT |
| 305 | FNMA ELIMINATION REQUEST |
| 306 | VA RETURN OF CUSTODY SBMT |
| 307 | SEEK DEFICIENCY JUDGMENT |
| 308 | FEMA HOLD END |
| 309 | LITIGATION HOLD END |

### FC Holds for Loss Mitigation (310–317)

| Code | Description |
|------|-------------|
| 310 | HOLD PLACED - 1ST LM |
| 311 | RESUME FC - 1ST LM DISM |
| 312 | HOLD PLACED - 2ND LM |
| 313 | RESUME FC - 2ND LM DISM |
| 314 | HOLD PLACED - 3RD LM |
| 315 | RESUME FC - 3RD LM DISM |
| 316 | HOLD PLACED - 4TH LM |
| 317 | RESUME FC - 4TH LM DISM |

### Post-Sale Processing (318–374)

| Code | Description |
|------|-------------|
| 318 | BRRW REINSTATEMENT REQD |
| 319 | BRRW PAYOFF REQUESTED |
| 320 | DEED TO HUD RECORDED |
| 321 | RECONVEY DUE TO TITLE |
| 322 | RECONVEY DUE TO PROP ISS. |
| 323 | HOA SEARCH COMPLETE |
| 324 | PROPERTY SUBJECT TO HOA |
| 325 | READY TO CONVEY |
| 326 | UTIL. VALIDATION IN P260 |
| 327 | CREDIT BID REQUESTED |
| 328 | CREDIT BID RECEIVED |
| 329 | RI FUNDS SENT TO CLIENT |
| 330 | PO FUNDS SENT TO CLIENT |
| 331 | VA REJECTED TITLE |
| 332 | CORRECTED TITLE PKGE SUB |
| 333 | POST CLAIM CLEAR BALANCES |
| 334 | 2ND CHANCE CWCOT LISTED |
| 335 | 2ND CHANCE EXT PERIOD |
| 336 | ATTY NTFY TO USE AUCTION |
| 337 | FINAL TITLE CLEARED |
| 338 | FIRST LEGAL DEADLINE |
| 339 | FHA 1ST LEGAL EXT APPVD 1 |
| 340 | TITLE REPORT ORDERED |
| 341 | AOM SENT FOR RECORDING |
| 342 | AOM RECORDED |
| 343 | ORIGINAL NOTE REQUESTED |
| 344 | ORIGINIAL NOTE RECEIVED |
| 345 | ORIGINAL MORTGAGE REQUEST |
| 346 | ORIGINAL MORTGAGE RECD |
| 347–350 | SALE PP1–PP4 (postponements) |
| 351–354 | VENDOR BILLBACK 1–4 PENDING |
| 355 | VNDR BILLBACK NOT NEEDED |
| 356 | VNDR BILLBACKS COMPLETED |
| 357 | INTERNAL BILLBACK PENDING |
| 358 | EXTERNAL BILLBACK PENDING |
| 359 | BASIC VA CLAIM CERT DATE |
| 360 | VA/USDA CLM APPEL NT NEED |
| 361 | VA/USDA CLM APPEAL FILED |
| 362 | SUP VA/USDA APL CERT DATE |
| 363 | SUP VA/USDA APPEAL N/A |
| 364 | SUP VA/USDA CLM APL FILED |
| 365 | CWCOT 2ND FUNDS REC'D |
| 366 | REV FOR CWCOT 2ND CHANCE |
| 367 | REF FOR CWCOT 2ND CHANCE |
| 368 | CWCOT 2ND CLOSING DATE |
| 369 | RECEIVED IN POST SALE |
| 370 | RRC EXPIRATION DATE |
| 371 | REVIEW FOR BILLBACKS |
| 372 | CWCOT2 OFFER/RESERVE MET |

### Bid & Pre-Sale (400–431)

| Code | Description |
|------|-------------|
| 400 | BID PREPARED |
| 401 | BID APPROVED |
| 402 | NOV ORDERED |
| 403 | NOV EXPIRES |
| 405 | PRESALE CHECKLIST CMPLTD |
| 406 | REBREACH HOLD START |
| 407 | REBREACH HOLD END |
| 408 | FC BID TO INV |
| 409 | FC BID FROM INV |
| 410 | CA NOI TO BID RCVD |
| 411 | CA INTENT TO BID RCVD |
| 412 | ORI DOCS RTND SERVICEMAC |
| 413 | ORIG DOCS TO CUSTODIAN |
| 414 | FC BID TO CLIENT |
| 415 | BID RCVD FROM CLIENT |
| 416 | NY EXPEDITED FORECLOSURE |
| 420 | 5 DAY POST NOD SENT |
| 421 | CONTESTED - TRID VIOLATIO |
| 422 | DEED TO HUD SENT TO RECOR |
| 423 | PREP HUD FTP |
| 424 | FINAL TITLE PKG PREPARED |
| 425 | MERS AOM RECORDED |
| 426 | SALE CONFIRMATION EXPIRES |
| 427 | SALE RATIFICATION EXPIRES |
| 428 | SALE REDEMPTION EXPIRES |
| 429 | THIRD PARTY SALE HELD |
| 430 | INITIAL PRE-SALE CERT |
| 431 | FINAL PRE-SALE CERT |
`,
  },

  // ── 4. Loss Mitigation ────────────────────────────────────────
  {
    name: "ServiceMac > Step Codes > Loss Mitigation",
    tags: ["servicemac", "step-codes", "loss-mitigation", "LSMT"],
    content: `# Step Codes — Loss Mitigation Domain

> Workstation: **LSMT** (template source: LMT)
> VDS entities: \`loss_mitigation_application\`, \`loss_mitigation_forbearance\`, \`loss_mitigation_loan_modification\`, \`loss_mitigation_partial_claim\`, \`loss_mitigation_payment_deferral\`, \`loss_mitigation_repayment_plan\`, \`loss_mitigation_plan\`, \`loss_mitigation_plan_evaluation\`, \`loss_mitigation_plan_payment\`, \`loss_mitigation_denial\`, \`loss_mitigation_appeal\`

## Key VDS Field Mappings

| VDS Field | Step Code | Description | Aggregation |
|-----------|-----------|-------------|-------------|
| \`loss_mitigation_application.received_date\` | L01 | WORKOUT PCKG RCVD | MIN() |
| \`loss_mitigation_application.facially_complete_date\` | L14 | PCKG FACIALLY COMPLTE | MIN() |
| \`loss_mitigation_forbearance.approved_date\` | L89 | FORBEARANCE APPROVED | MIN() |
| \`loss_mitigation_forbearance.complete_date\` | L88 | FORBEARANCE COMPLETE | MIN() |
| \`loss_mitigation_loan_modification.approved_date\` | L93 | MOD APPROVED | MIN() |
| \`loss_mitigation_loan_modification.complete_date\` | L94 | MOD COMPLETE | MIN() |
| \`loss_mitigation_loan_modification.docs_ordered_date\` | L85 | FINAL MOD DOCS ORDERED | MIN() |
| \`loss_mitigation_loan_modification.docs_received_date\` | L87 | FINAL MOD RECEIVED | MIN() |
| \`loss_mitigation_loan_modification.docs_qc_date\` | L86 | FINAL MOD QC'D | MIN() |
| \`loss_mitigation_plan.booked_date\` | L66 | CFM COMPLETED | MIN() |
| \`loss_mitigation_plan_payment.trial_1_date\` | M35 | TRIAL #1 RECEIVED | MIN() |
| \`loss_mitigation_plan_payment.trial_2_date\` | M37/M38 | TRIAL #2 / RECEIVED | MIN() |
| \`loss_mitigation_plan_payment.trial_3_date\` | M39/M40 | TRIAL #3 / RECEIVED | MIN() |
| \`loss_mitigation_plan_payment.trial_4_date\` | M41 | TRIAL #4 RECEIVED | MIN() |
| \`loss_mitigation_partial_claim.approved_date\` | L27 | PC APPROVED | MIN() |
| \`loss_mitigation_partial_claim.complete_date\` | L28 | PC COMPLETE | MIN() |
| \`loss_mitigation_denial.denial_date\` | N13 | UNDERWRITING DENIAL | MIN() |
| \`loss_mitigation_appeal.received_date\` | M99 | APPEAL RECEIVED | MIN() |
| \`loss_mitigation_appeal.approved_date\` | M97 | APPEAL OVERTURNED | MIN() |
| \`loss_mitigation_appeal.denied_date\` | M98 | APPEAL DENIED | MIN() |
| \`loss_mitigation_payment_deferral.approved_date\` | N15 | DEFERRAL APPROVED | MIN() |
| \`loss_mitigation_payment_deferral.complete_date\` | N17 | DEFERRAL COMPLETE | MIN() |
| \`loss_mitigation_repayment_plan.approved_date\` | M11 | REPAY/PP APPROVED | MIN() |
| \`loss_mitigation_repayment_plan.complete_date\` | M12 | REPAY/PP COMPLETE | MIN() |

> **Dual source rule**: Step codes track workflow dates; the LossMitigation table has case-level dates. Consult both when mapping.
> **HAMP identification**: Requires BOTH \`ModInterestRateStepFlag = 'Y'\` AND \`LoanModProgramType\` in HAMP codes.

## L-Prefixed Codes — Intake & Processing (99 codes)

| Code | Description |
|------|-------------|
| L01 | WORKOUT PCKG RCVD |
| L02 | ORDER VALUATION |
| L03 | RECEIVE VALUATION |
| L04 | VALUATION CPY TO MTGR |
| L05 | ORDER CBR |
| L06 | RECEIVE CBR |
| L07 | ORDER TITLE |
| L08 | RECEIVE TITLE |
| L09 | RVWD TITLE=CLEAR |
| L10 | RVWD TITLE=NOT CLEAR |
| L11 | INCOMPLETE PCKG-LTR SENT |
| L12 | ADDTL INFO RCVD |
| L13 | CHECK AGENCY ELIG LIST |
| L14 | PCKG FACIALLY COMPLTE |
| L15 | ORDER PROP INSP TO CONVEY |
| L16 | PASS TO UW |
| L17–L26 | PAYMENT #1 through #10 |
| L27 | PC APPROVED |
| L28 | PC COMPLETE |
| L29 | PC DENIED |
| L30 | PC ORDERED |
| L31 | PC QC'D |
| L32 | PC SENT TO MTGR |
| L33 | PFS CALCULATION |
| L34 | PFS COMPLETE |
| L35 | APPRVD PFS-PREPARE ATP |
| L36 | NET PROCEEDS RECVD |
| L37 | UNABLE TO CONVEY |
| L38 | PROP OK TO CONVEY |
| L39 | QC EXECUTED DIL |
| L40 | QC EXECUTED MOD |
| L41 | QC EXECUTED PC |
| L42 | QC FILE TO ATTORNEY |
| L43 | QC PREPARED DIL |
| L44 | RECEIVED BPO |
| L45 | RECEIVED CBR |
| L46 | RECEIVED APP HUD-1 |
| L47 | RECEIVED APPRAISAL |
| L48 | RECVD ARMS LNGTH AFFIDAV |
| L49 | RECEIVED ATP |
| L50 | RECEIVED CBR |
| L51 | RECEIVED SALES CONTRACT |
| L52 | RECEIVED ENDORSEMENT |
| L53 | RECEIVED EXECUTED DIL |
| L54 | RECEIVED FC FEES/COSTS |
| L55 | RECEIVED HUD-1 |
| L56 | OFC RCVD SENT CPY 2 BRW |
| L57 | RECEIVED POOL BUYOUT |
| L58 | RECEIVED SIGNED TRIAL |
| L59 | APPRAISAL CHK COMP |
| L60 | DIL COMPLETE |
| L61 | APPROVED DIL |
| L62 | APPROVED PFS |
| L63 | FINAL MOD CALC |
| L64 | CALCULATE PC |
| L65 | CANCEL PMI/HAX/TAX |
| L66 | CFM COMPLETED |
| L67 | CHNG MAN CODE T0 C |
| L68 | CHECK DOD WEBSITE |
| L69 | DENIED DIL |
| L70 | DENIED PFS |
| L71 | DOC VALIDATE |
| L72 | DOCS TO CUSTODIAN |
| L73 | DOCS TO IMAGING |
| L74 | EXECUTED PC RECEIVED |
| L75–L81 | FORB #1 through #7 |
| L82 | FC CLOSE AND BILL |
| L83 | FC HOLD PLACED |
| L84 | FILE HUD EXT IN EVARS |
| L85 | FINAL MOD DOCS ORDERED |
| L86 | FINAL MOD QC'D |
| L87 | FINAL MOD RECEIVED |
| L88 | FORBEARANCE COMPLETE |
| L89 | FORBEARANCE APPROVED |
| L90 | INCMPLT PKG RECEIVED |
| L91 | INV DECISION RECEIVED |
| L92 | LISTING AGR RECVD |
| L93 | MOD APPROVED |
| L94 | MOD COMPLETE |
| L95 | MOD APR BELOW PAR |
| L96 | MOD SENT TO MGR |
| L97 | ORDER BPO |
| L98 | ORDER AVM |
| L99 | ORDER FC FEES/COSTS |

## M-Prefixed Codes — Modification & Documents (99 codes)

| Code | Description |
|------|-------------|
| M01 | RECEIVED PREPARED DIL |
| M02 | RECEIVED RECORDED DIL |
| M03 | RECEIVED SCRA WAIVER |
| M04 | RECEIVED TITLE |
| M05 | RECEIVED UPDTD TITLE |
| M06 | VA REFUND APPROVED |
| M07 | VA REFUND DENIED |
| M08 | RECONCILE NET PROCEEDS |
| M09 | RECORDED MOD REC'VD |
| M10 | RECEIVED OFFCR SIGNATURE |
| M11 | REPAY/PP APPROVED |
| M12 | REPAY/PP COMPLETE |
| M13 | REQ DIL PREP |
| M14 | REQUEST CFM |
| M15 | REQUEST OFFCR SIGNATURE |
| M16 | REQUEST ORIGINAL NOTE |
| M17 | REQUEST POOL BUYOUT |
| M18 | REQUEST UPDATED TITLE |
| M19 | SHORT SALE HELD |
| M20 | SHORT SALE SCHEDULED |
| M21 | SCRA LETTER |
| M22 | SECOND LOOK |
| M23 | SEND DIL FOR RECORDING |
| M24 | SEND DIL TO MORTGAGOR |
| M25 | SEND DOCS FOR ENDORSEMENT |
| M26 | SEND EXECUTED DOCS ATTY |
| M27 | SEND FOR VA REFUND |
| M28 | SEND MOD FOR RECORDING |
| M29 | SEND NEW PACKAGE |
| M30 | SEND PC FOR RECORDING |
| M31 | RECORDED PC TO FHA VENDOR |
| M32 | SET UP PRINCIPAL FORB |
| M33 | SUB AGREEMENT RECEIVED |
| M34 | SUBMIT FOR INV APPROVAL |
| M35 | TRIAL #1 RECEIVED |
| M36 | USDA MRA APPROVED |
| M37 | TRIAL #2 |
| M38 | TRIAL #2 RECEIVED |
| M39 | TRIAL #3 |
| M40 | TRIAL #3 RECEIVED |
| M41 | TRIAL #4 RECEIVED |
| M42 | UPDATE 1099C |
| M43 | UPDATE CBR |
| M44 | UPDATE HSSN PAYMENT 1 |
| M45 | UPDATE HSSN PAYMENT 2 |
| M46 | AGENCY SYSTEM UPDATED |
| M47 | UPDATE MAS1/COL1 |
| M48 | UW DEEMS INCOMPLETE |
| M49 | VERBAL APPLICATION REC'VD |
| M50 | ORDER TITLE |
| M51 | RECEIVED TITLE |
| M52 | COMPLETE PACKAGE |
| M53 | RECEIVED POOL BUYOUT |
| M54 | COMBO APPROVED |
| M55 | COMBO DENIED |
| M56 | FINAL COMBO DOCS ORDERED |
| M57 | FINAL COMBO QC |
| M58 | COMBO SENT TO MORTGAGOR |
| M59 | QC EXECUTED COMBO |
| M60–M63 | FB #7 through #10 |
| M64 | ORDER APPRAISAL |
| M65 | UPDATE 1099C |
| M66 | UPDATE CBR |
| M67 | DIL COMPLETE |
| M68 | RECEIVED BPO |
| M69 | MOD APPRVD BELOW PAR |
| M70 | RECEIVED AVM |
| M71 | RECORDED PC RECEIVED |
| M72 | FANNIE MAE DISASTER |
| M73 | FREDDIE MAC DISASTER |
| M74 | FHA DISASTER |
| M75 | VA DISASTER |
| M76 | CALCULATE TRIAL |
| M77 | MOD APPRVD BELOW PAR |
| M78 | CALCULATE COMBO |
| M79 | FINAL COMBO RECEIVED |
| M80 | FORBEARANCE 2 APPROVED |
| M81 | CALCULATE DIL |
| M82 | STREAMLINE SHORT SALE |
| M83–M93 | FB #4–#12, exclusion list checks |
| M94 | CHECK LDP EXCLUSION LIST |
| M95 | MOD TITLE POLICY RECEIVED |
| M96 | FIRST LEVEL REVIEW |
| M97 | APPEAL OVERTURNED |
| M98 | APPEAL DENIED |
| M99 | APPEAL RECEIVED |

## N-Prefixed Codes — Negotiations & Closure (52 codes)

| Code | Description |
|------|-------------|
| N01 | RCVD EXECUTD AGREEMENT |
| N02 | SECOND LOOK OVERTURNED |
| N03 | VA ESTIMATED CURE DATE |
| N04 | APPROVED FINAL HUD1 |
| N05 | LMTMOD-NO DOC PERM SOLUTI |
| N06 | DEFERRAL CLAIM FILED |
| N07 | DEFERRAL CLAIM PAID |
| N08 | DEFERRAL CLAIM DENIED |
| N09 | LM CLAIM NOT NEEDED |
| N10 | ATP EXTENSION 30 DAYS |
| N11 | SUBMIT FOR MI APPROVAL |
| N12 | RECEIVED MI APPVL |
| N13 | UNDERWRITING DENIAL |
| N14 | VA DIL SENT TO VALERI |
| N15 | DEFERRAL APPROVED |
| N16 | DEFERRAL SENT TO MTGR |
| N17 | DEFERRAL COMPLETE |
| N18 | RECORDED PC SENT TO NOVAD |
| N19 | DATE DOCS SIGNED BY MTGR |
| N20 | RHS LM CLAIM |
| N21 | FNMA/FHLMC LM CLAIM |
| N22 | PC PROM NOTE TO HUD |
| N23 | FINAL PC CALC POST TRIAL |
| N24 | BLIND FLEX-ACCEPTED |
| N25 | CLAIM PREPPED IN CATALYST |
| N26 | UW RE-RUN |
| N27 | CALCULATE DEFERRAL |
| N28 | ALM ELIGIBLE |
| N29 | PC PROM NOTE TO VA/USDA |
| N30 | RECORDED PC TO VA |
| N31 | PC PROM NOTE TO USDA |
| N32 | RECORDED PC TO USDA |
| N33 | A RECORD RECEIVED |
| N34 | O RECORD SENT |
| N35 | V RECORD SENT |
| N36 | P RECORD SENT |
| N37 | W RECORD SENT |
| N38 | REINSTATEMENT PROGRAM APP |
| N39 | UNEMPLOYMENT PROGRAM APP |
| N40 | MOD PROGRAM APPROVED |
| N41 | D RECORD RECEIVED |
| N42 | CWCOT OWNER-OCCUPANT |
| N43 | CWCOT NON PROFIT |
| N44 | CWCOT GOV ENTITY |
| N45 | RECAST PROGRAM |
| N46 | PARTIAL PAYMENT PROGRAM |
| N47 | EXECUTED DOCS=FAIL |
| N48 | REDRAWN DOCS ORDERED |
| N49 | REDRAWN DOCS QC'D |
| N50 | REDRAWN DOCS SENT TO MTGR |
| N51 | REDRAWN DOCS RECEIVED |
| N52 | QC REDRAWN DOCS |
`,
  },

  // ── 5. Eviction ───────────────────────────────────────────────
  {
    name: "ServiceMac > Step Codes > Eviction",
    tags: ["servicemac", "step-codes", "eviction"],
    content: `# Step Codes — Eviction Domain

> Workstation: typically **FORE** or **REO** (post-sale)
> VDS entities: Related to \`property_preservation_case\` post-sale processing

## E-Prefixed Codes (71 codes)

| Code | Description |
|------|-------------|
| E01 | EVICTION REF SENT TO ATTY |
| E02 | OCCUPANT OFFERED CFK |
| E03 | REF REVIEWED & LS UPDATED |
| E04 | ATTY TO CLOSE & BILL EVIC |
| E05 | 90 DAY TENANT NOTICE SENT |
| E06 | EVIC REF RECD BY ATTY |
| E07 | CASH FOR KEYS ACCEPTED |
| E08 | ATTY CONFIRMED FILE CLOSE |
| E09 | TENANT LEASE |
| E10 | EVIC STARTED/DEMAND SENT |
| E11 | 3 DAY NOTICE SERVED |
| E12 | EXEC. OF EJECTMENT SENT |
| E13 | NOTICE TO QUIT SERV/POST |
| E14 | RULE TO SHOW CAUSE ISSUED |
| E15 | MOT FOR WRIT OF ASST SENT |
| E16 | NOTICE TO QUIT SENT |
| E17 | MOTION FOR JUDGMENT FILED |
| E18 | ORDER WRIT |
| E19 | UNLAWFUL DETAINER FILED |
| E20 | 10 DAY NOTICE SENT |
| E21 | 30DAY NOTICE TO QUIT SENT |
| E22 | LEASE EXPIRATION DATE |
| E23 | FORCIBLE DETAINER SENT |
| E24 | WRIT OF POSSESSION REQ'D |
| E25 | EVIC COMPLAINT FILED |
| E26 | WRIT OF POSSESSION ENT'D |
| E27 | EVIC HEARING SCHEDULED |
| E28 | 30 DAY NOTICE SERVED |
| E29 | EXEC OF EJECTMENT ISSUED |
| E30 | WRIT OF POSSESSION POSTED |
| E31 | DISP WARRANT FILED |
| E32 | WRIT OF ASSISTANCE ISSUED |
| E33 | EVIC JUDGEMENT TO SHERIFF |
| E34 | SHOW CAUSE ORDER EXPIRES |
| E35 | COMPLAINT PKG COMPLETED |
| E36 | 3DAY NOTICE TO QUIT SENT |
| E37 | EVIC PET WRIT & ORDER FLD |
| E38 | OCCUPANCY INSP ORDERED |
| E39 | EVIC SERVICE COMPLETE |
| E40 | WRIT OF POSSESSION ISSUED |
| E41 | FORCIBLE ENTRY&DETAIN FLD |
| E42 | WRIT OF ASSISTANCE SERVED |
| E43 | EVIC SUMMONS/COMP SERVED |
| E44 | COMPLAINT SENT FOR FILING |
| E45 | MOT FOR WRIT OF POSS FLD |
| E46 | EVICTION SERVICE SENT |
| E47 | OCCUPANCY INSP RECEIVED |
| E48 | UNLAWFUL DETAINER SERVED |
| E49 | EVICTION HEARING COMPLETE |
| E50 | EVIC JUDGMENT GRANTED |
| E51 | ANSWER PERIOD EXPIRES |
| E52 | JUDGMT OF POSS. GRANTED |
| E53 | UNLAWFUL DETAINER HEARING |
| E54 | EVICTION ORDERED ISSUED |
| E55 | MOVE OUT SCHEDULED DATE |
| E56 | WRIT OF EXECUTION ISSUED |
| E57 | WRIT OF RESTITUTION ISS'D |
| E58 | WRIT OF POSS. SERVED |
| E59 | PREP FOR UNLAWFUL DET HEA |
| E60 | INSPECTION ORDERED |
| E61 | MOVEOUT/LOCKOUT COMPLETE |
| E62 | WRIT OBTAINED |
| E63 | FHA EVIC PACKAGE UPLOADED |
| E64 | EVIC EXT REQ TO HUD |
| E65 | EVIC EXT APPROVED |
| E66 | EVIC EXT DENIED |
| E67 | EVICTION CANCELLED |
| E68 | PERSONAL PROP EVICTION |
| E69 | EVICTION COMPLETE |
| E70 | EVICTION NEEDED |
| E71 | EVICTION NOT NEEDED |
`,
  },

  // ── 6. Claims ─────────────────────────────────────────────────
  {
    name: "ServiceMac > Step Codes > Claims",
    tags: ["servicemac", "step-codes", "claims"],
    content: `# Step Codes — Claims Domain

> Workstation: post-sale/disposition processing
> VDS entities: \`agency_claim\`, \`agency_claim_line_item\`, \`loss_draft_claim\`

## Q-Prefixed Codes (99 codes)

| Code | Description |
|------|-------------|
| Q01 | REFER TO CLAIM VENDOR |
| Q02 | PROPERTY IN ICC |
| Q03 | UTILITY VALIDATION COMP |
| Q04 | HAZARD CLAIM REVIEW |
| Q05 | USDA LOSS CLAIM SUBM |
| Q06 | HAZARD CLAIM NEEDED |
| Q07 | HAZARD CLAIM FILED |
| Q08 | FHA PART A FILED |
| Q09 | FHA PART A FUNDS REC'D |
| Q10 | FHA PART B-E FILED |
| Q11 | FHA PART B-E PAID |
| Q12 | MI CLAIM FILED |
| Q13 | MI CLAIM FUNDS REC'D |
| Q14 | MI CLAIM DENIED |
| Q15 | CONVEY EXT REQUESTED |
| Q16 | CONVEYANCE EXT APPROVED |
| Q17 | CONVEY EXT DENIED |
| Q18 | HAZ CLAIM FUNDS REC'D |
| Q19 | SUPPLEMENTAL FILED |
| Q20 | SUPPLEMENTAL FUNDS REC'D |
| Q21 | 1ST SUPPLEMENTAL DENIED |
| Q22 | 2ND SUPPLEMENTAL FILED |
| Q23 | 2ND SUPP. FUNDS REC'D |
| Q24 | 2ND SUPPLEMENTAL DENIED |
| Q25 | TITLE PACKAGE SUBMITTED |
| Q26 | USDA CLAIM FUNDS REC'D |
| Q27 | USDA CLAIM FUNDS APPLIED |
| Q28 | FINAL CLAIM SENT |
| Q29 | FINAL CLAIM FUNDS REC'D |
| Q30 | VERIFY HOA PD CURRENT |
| Q31 | SUB. TITLE EVIDENCE VA |
| Q32 | FHLMC HOA UPDATE |
| Q33 | FHLMC TAX UPDATE |
| Q34 | CANCEL FC HAZ INSURANCE |
| Q35 | STOP WORK P&P |
| Q36 | LOSS ANALYSIS COMPLETE |
| Q37 | APPROVAL TO CONVEY DAMAGE |
| Q38 | HUD NOTI. OF TITLE DEFECT |
| Q39 | BRRW REQ OCC CONVEY |
| Q40 | HUD APPROVED OCC CONVEY |
| Q41 | HUD DENIED OCC CONVEY |
| Q42 | HUD TITLE DEFECT CLEAR |
| Q43 | VERIFY TAXES PD CURRENT |
| Q44 | SUPP. HAZ CLAIM FILED |
| Q45 | SUPP HAZ CLAIM FUNDS RECD |
| Q46 | SUPP HAZ CLAIM DENIED |
| Q47 | TITLE PKGE EXT REQUESTED |
| Q48 | TITLE PKGE EXT APPROVED |
| Q49 | TITLE PKGE EXT DENIED |
| Q50 | HUD CLAIM NOT FILED |
| Q51 | CONVEY/CLAIM DUE DATE |
| Q52 | DATE LAST OCCUPIED |
| Q53 | CLAIM SUBMITTED TO QA |
| Q54 | CLAIM APPROVED BY QA |
| Q55 | HUD OFFSET NOTICE RECD |
| Q56 | OFFSET APPROVED BY HUD |
| Q57 | OFFSET OCCURRED |
| Q58 | PNOIR RECEIVED |
| Q59 | PNIOR APPEALED |
| Q60 | PNOIR RESOLVED |
| Q61 | PROPERTY RECONVEYED |
| Q62 | RECONV FUNDS REMIT TO HUD |
| Q63 | PART A AOP SETTLED |
| Q64 | INITIAL 571 FILED |
| Q65 | INITIAL 571 FUNDS RECD |
| Q66 | FINAL 571 FILED |
| Q67 | FINAL 571 FUNDS RECD |
| Q68 | FHLMC 104 INITIAL FILED |
| Q69 | 104 INITIAL FUNDS RECD |
| Q70 | FHLMC 104 FINAL FILED |
| Q71 | 104 FINAL FUNDS RECD |
| Q72 | SUPP MI CLAIM FILED |
| Q73 | SUPP MI FUNDS RECD |
| Q74 | SUPP CLAIM NOT NEEDED |
| Q75 | MI SUPP DENIED |
| Q76 | DATE SUPP CLAIM DELETED |
| Q77 | SUPP CLAIM FUUNDS RECD |
| Q78 | SS CLAIM FILED |
| Q79 | SS CLAIM PAID |
| Q80 | SS CLAIM FUNDS RECD |
| Q81 | VA EXPENSE CLAIM FILED |
| Q82 | VA MAX GUARANTEE PD |
| Q83 | VA TERMINATION DATE |
| Q84 | VA DEFICIENCY WAIVER SENT |
| Q85 | TOC ACCEPTED IN VALERI |
| Q86 | TITLE PCKG SUB TO HUD |
| Q87 | TITLE APPROVAL RECD |
| Q88 | CLAIM CURTAIL 1ST LEGAL |
| Q89 | RECONVEY LETTER RECD |
| Q90 | ACQUISITION PYMT RECD |
| Q91 | RECD IN CLAIMS |
| Q92 | MIP/PMI TERMINATED |
| Q93 | RETURN FUNDS TO INVESTOR |
| Q94 | WRITE OFF PROCESSED |
| Q95 | LM INCENTIVE CLM FILED |
| Q96 | LM INCENTIVE CLM APPROVED |
| Q97 | LM INCENTIVE CLM DENIED |
| Q98 | LM INCENTIVE FUNDS RECD |
| Q99 | CLAIM PROCESS COMPLETE |
`,
  },

  // ── 7. REO ────────────────────────────────────────────────────
  {
    name: "ServiceMac > Step Codes > REO",
    tags: ["servicemac", "step-codes", "reo", "REO"],
    content: `# Step Codes — REO Domain

> Workstation: **REO** (template source: REO)
> VDS entities: Post-foreclosure property disposition (no dedicated VDS REO entity currently)

## R-Prefixed Codes — REO/Realtor (82 codes)

| Code | Description |
|------|-------------|
| R01 | ASSIGN TO REALTOR |
| R02 | SET UP HAZARD LINE |
| R03 | ESTABLISH TAX LINE |
| R04 | VERIFY OCCUPANCY |
| R05 | RECEIVE OCCUPANCY RESULTS |
| R06 | EVICTION REFERRAL |
| R07 | WRIT ISSUED |
| R08 | LOCK OUT DATE |
| R09 | LOCK OUT COMPLETE |
| R10 | CASH FOR KEYS OFFERED |
| R11 | CASH FOR KEYS ACCEPTED |
| R12 | CASH FOR KEYS REJECTED |
| R13 | INITIAL SECURING ORDERED |
| R14 | RECEIVE MGMT ADDENDUM |
| R15 | MARKET PLAN REC'D |
| R16 | MARKET PLAN APPROVED |
| R17 | LISTING AGMT RECEIVED |
| R18 | OFFER RECEIVED |
| R19 | OFFER ACCEPTED |
| R20 | OFFER DECLINED |
| R25 | REO SALE CLOSED |
| R26 | REO DEED RECEIVED |
| R27 | LIST PRICE REDUCTION 1 |
| R28 | LIST PRICE REDUCTION 2 |
| R29 | LIST PRICE REDUCTION 3 |
| R30 | PRE-MARKET DELAY START |
| R31 | PRE-MARKET DELAY END |
| R32 | HUD1 TO CLIENT |
| R33 | HUD1 REC'D FROM CLIENT |
| R34 | HUD1 SENT TO REO VENDOR |
| R35 | REO DEED TO CLIENT |
| R36 | EXEC REO DEED TO VENDOR |
| R37 | CONTRACT RECD FROM VENDOR |
| R38 | CONTRACT TO CLIENT |
| R39 | CONTRACT RECD FROM CLIENT |
| R40 | CLOSING COMPLETE |
| R41 | RECEIVED IN REO |
| R42 | INV APPROVED LIST PRICE |
| R43 | INVESTOR APPROVED OFFER |
| R44 | SALE PROCEEDS RECEIVED |
| R45 | REFER TO REO VENDOR |
| R46 | REO VENDOR RECD FILE |
| R47 | CONTRACT SUBMIT FOR SIGN |
| R48 | CONTRACT RETURN TO VENDOR |
| R49 | FINAL HUD1 SIGNED |
| R50 | REQ'D LIST APPV FROM INV |
| R51 | LIST APPRVD BY INV/CLIENT |
| R52 | APPRVD LISTING TO VENDOR |
| R53 | SIGNED CONTRACTS RETURNED |
| R54 | REO CLOSING SCHEDULED |
| R55 | REO BPO ORDERED |
| R56 | REO BPO RECEIVED |
| R57 | REO BPO2 ORDERED |
| R58 | REO BPO2 RECEIVED |
| R59 | REO APPRAISAL ORDERED |
| R60 | REO APPRAISAL RECEIVED |
| R61 | REO APPRAISAL2 ORDERED |
| R62 | REO APPRAISAL2 RECEIVED |
| R63 | OFFER TO INV FOR APPROVAL |
| R64 | INV APPROVED OFFER |
| R65 | INV COUNTER OFFER SENT |
| R66 | COUNTER OFFER ACCEPTED |
| R67 | COUNTER OFFER DECLINED |
| R68 | APPROVED OFFER TO VENDOR |
| R69 | REO PROCEEDS APPLIED |
| R70 | PDP SUBMITTED TO CLIENT |
| R71 | MA FIRE INSP COMPLETE |
| R72 | MARKET PERIOD EXPIRATION |
| R73 | OFFER WITHDRAWN |
| R74 | 2ND OFFER RECEIVED |
| R75 | 2ND OFFER SENT FOR APPR |
| R76 | 2ND COUNTER OFFER |
| R77 | 2ND COUNTER ACCEPTED |
| R78 | 2ND COUNTER DECLINED |
| R79 | 2ND OFFER ACCEPTED |
| R80 | FNMA POST SALE INSP REQ |
| R81 | FNMA POST SALE INSP COMP |
| R82 | PROPERTY LISTED |
| R99 | REO COMP/FILED CLOSED |

## Z-Prefixed Codes — REO Disposition & Post-Sale Claims (99 codes)

| Code | Description |
|------|-------------|
| Z01 | ACQUIRED/UNDEFINED |
| Z02 | PREP LA PRELIM |
| Z03 | GSE INITIAL CLAIM REVIEW |
| Z04 | GSE FINAL CLAIM REVIEW |
| Z05 | FNMA CLAIM DENIED |
| Z06 | FHLMC CLAIM DENIED |
| Z07 | RECONVEY BACK TO HUD |
| Z08 | MI DENIED APPEAL |
| Z09 | MI FINAL DENIAL |
| Z10 | ATTY REQ ORIGINAL DOCS |
| Z11 | LM INCENTIVE CLAIM FILED |
| Z12 | LM INCENTIVE CLAIM PAID |
| Z13 | LM INCENTIVE CLAIM DENIED |
| Z14 | HUD PC CLAIM FILED |
| Z15 | HUD PC CLAIM PAID |
| Z16 | HUD PC CLAIM DENIED |
| Z17 | VA BASIC CLM FUNDS RECD |
| Z18 | PART B-E UPLOADED TO P260 |
| Z19 | VA POST CLAIM DEFICIENCY |
| Z20 | POOL BUYOUT REQUESTED |
| Z21 | CWCOT/PFS CLM FLD (A-E) |
| Z22 | CWCOT/PFS CLM FUNDS RECD |
| Z23 | HUD CURTAILMENT DATE |
| Z24 | TERM. USDA ANNUAL DUES |
| Z25 | REVIEW FOR SUPP CLAIM |
| Z26 | RECONCILE INITIAL CLAIM |
| Z27 | RECONCILE FINAL CLAIM |
| Z28 | PART B-E SUBMITTED TO QA |
| Z29 | PART B-E APPROVED BY QA |
| Z30 | PART A UPLOADED TO P260 |
| Z31 | VA CLAIM OFFSET |
| Z32 | FHA CLAIM OFFSET |
| Z33 | FHLMC GA DATE |
| Z34 | MI CLAIM PD TO INVESTOR |
| Z35 | MI EOB REVIEWED |
| Z36 | SUPP RESOLVED & RETURNED |
| Z37 | FNMA/FHLMC REO SOLD DATE |
| Z38 | CLAIM PREPPED IN CATALYST |
| Z39 | CONFIRM CLAIM FUNDS APPLY |
| Z40 | LM CLAIM DEADLINE MISSED |
| Z41 | CWCOT CLOSING PKGE SENT |
| Z42 | CLM DENIED-NEG. CLAIM |
| Z43 | PST-SALE CLM NOT NEEDED |
| Z44 | PREMARKETING |
| Z45 | PREP GSE/MI CLAIM |
| Z46 | REFERRED FOR SUPP CLM |
| Z47 | DENIED FOR CWCOT 2 |
| Z48 | CLAIM SUSP. REVIEW REQ |
| Z49 | CLM DENY RECOURSE |
| Z50 | CLM REJ PEND ADD'L DOCS |
| Z51 | CLM DENY ORIGINATION |
| Z52 | VA PC CLAIM FILED |
| Z53 | VA PC CLAIM CERTIFIED |
| Z54 | VA PC CLAIM DENIED |
| Z55 | FINAL LA REVIEW |
| Z56 | CLOSE W/O IN AGENCY SYSTM |
| Z57 | BOC RECEIVED |
| Z58 | BOC RESOLVED |
| Z59 | REMITTANCE IDENTIFIED |
| Z60 | REMITTED TO INVESTOR |
| Z61 | UW PASS FILE BACK TO SPOC |
| Z62 | VA PC EVENT REJECTED |
| Z63 | VA PC EVENT ACCEPTED |
| Z64 | TITLE DELAY FIRST LEGAL |
| Z65 | FILE CONTESTED 2 |
| Z66 | CONTESTED MATTER RSLVD 2 |
| Z67 | PARTIAL PAYMENT APPROVED |
| Z68 | PARTIAL PAYMENT COMPLETED |
| Z69 | RUN WATERFALL FOR RPP OPT |
| Z70 | BORROWER ACCEPT DEFERRAL |
| Z71 | BORROWER ATTY REP ADDED |
| Z72 | BORROWER ATTY REP COMPLTD |
| Z73 | 2ND CHANCE CONTRACT EXE |
| Z74 | 2ND CHANCE CLOSING COMPL |
| Z75 | RECD INST SENT TO ATTY |
| Z76 | RECORDING LETTER RECD |
| Z77 | TITLE CLEAR TO CONVEY |
| Z78 | DEED TO HUD EXECUTED |
| Z79 | FNMA CLM CURTAILED |
| Z80 | FHLMC CLM CURTAILED |
| Z81 | VA BASIC CLM CURTAILED |
| Z82 | FHA CLM CURTAILED |
| Z83 | CWCOT CLM CURTAILED |
| Z84 | USDA CLM CURTAILED |
| Z85 | MI CLM CURTAILED |
| Z86 | FNMA CLAIM RESUBMIT |
| Z87 | FHLMC CLAIM RESUBMIT |
| Z88 | MISSING DOCUMENT EXPIRAT |
| Z89 | CLM DOC PREP START |
| Z90 | CLM DOC PREP CMPL |
| Z91 | NEGATIVE CLAIM |
| Z92 | REINTSATE + FWD PAYMENTS |
| Z93 | FORWARD PAYMENTS ONLY |
| Z94 | Q RECORD RECEIVED |
| Z95 | Y RECORD SENT |
| Z96 | LOSS ANALYSIS IMAGED |
| Z97 | LA COMPLETE W/EXCEPTION |
| Z98 | PRELIM LA UPLOADED |
| Z99 | FINAL LA RECEIVED |
`,
  },

  // ── 8. Property Preservation ──────────────────────────────────
  {
    name: "ServiceMac > Step Codes > Property Preservation",
    tags: ["servicemac", "step-codes", "property-preservation"],
    content: `# Step Codes — Property Preservation Domain

> VDS entities: \`property_preservation_case\`, \`property_preservation_work_order\`, \`property_preservation_work_order_item\`

## P-Prefixed Codes (55 codes)

| Code | Description |
|------|-------------|
| P01 | ORDER ICC |
| P02 | ORDER INITIAL SECURE |
| P03 | PROP NO LONGER ICC |
| P04 | FTV DATE |
| P05 | O/A REQUESTED |
| P06 | O/A APPROVED |
| P07 | O/A DENIED |
| P08 | 2ND O/A REQUESTED |
| P09 | 2ND O/A APPROVED |
| P10 | 2ND O/A DENIED |
| P11 | 3RD O/A REQUESTED |
| P12 | 3RD O/A APPROVED |
| P13 | 3RD O/A DENIED |
| P14 | VPR REQUESTED |
| P15 | VPR COMPLETED |
| P16 | VPR NOT NEEDED |
| P17 | CODE VIOLATION RECD |
| P18 | CODE VIOLATION TO PPV |
| P19 | CODE VIO HEARING DATE |
| P20 | CV HEARING RESULTS RECD |
| P21 | CODE VIOLATION RESOLVED |
| P22 | CFK CHECK DELIVERED |
| P23 | 2ND CONVEY EXT REQ |
| P24 | 2ND CONVEY EXT APPROVED |
| P25 | 2ND CONVEY EXT DENIED |
| P26 | 3RD CONVEY EXT REQ |
| P27 | 3RD CONVEY EXT APPROVED |
| P28 | 3RD CONVEY EXT DENIED |
| P29 | CONVEYANCE DUE DATE |
| P30 | PROPERTY CONVEYED DAMAGED |
| P31 | REQ TO HUD TO CONVEY DMGD |
| P32 | HUD DENIED DAMAGED CONVEY |
| P33 | PROP. REG. REQ AT VAC |
| P34 | PROP REG REQ @ 1ST LEG |
| P35 | PROP REG NOT REQ. |
| P36 | PROP REG COMPLETE |
| P37 | PROP RE-REG COMPLETE |
| P38 | PROPERTY DE-REGISTERED |
| P39 | MH VERIFICATION - YES |
| P40 | MH VERIFICATION - NO |
| P41 | CLM CURTAILED NO EXT REQ |
| P42 | CFK FAILED INSPECTION |
| P43 | PNOIR APP SUBMT IN YARDI |
| P44 | VIN VERIFIED |
| P45 | PNOIR APPEAL DENIED |
| P46 | IBTS REPORT NEEDED |
| P47 | PROP REHAB APPROVED |
| P48 | PROP REHAB STARTED |
| P49 | PROP REHAB COMPLETED |
| P50 | HUD DEMAND RECEIVED |
| P51 | HUD DEMAND RESOLVED |
| P52 | PROP REG NEEDED POST SALE |
| P53 | POOL B/O COMP/NOT NEEDED |
| P54 | PB REM. REQ DUE TO LIQ |
| P55 | VA PC CLAIM PAID |
`,
  },

  // ── 9. Balloon & Other ────────────────────────────────────────
  {
    name: "ServiceMac > Step Codes > Balloon and Other",
    tags: ["servicemac", "step-codes", "balloon", "title", "miscellaneous"],
    content: `# Step Codes — Balloon, Title & Miscellaneous

## S-Prefixed Codes — Balloon (6 codes)

> Template source: BLN
> VDS entity: \`balloon_loan_info\`

| Code | Description |
|------|-------------|
| S01 | BLN WRKSTATION SETUP |
| S02 | 180 DAY BLN NOTICE |
| S03 | 120 DAY BLN NOTICE |
| S04 | 90 DAY BLN NOTICE |
| S05 | 60 DAY BLN NOTICE |
| S06 | 30 DAY BLN NOTICE |

## T-Prefixed Codes — Title & Documentation (48 codes)

| Code | Description |
|------|-------------|
| T01 | WELCOME LETTER UPLOADED |
| T02 | FINAL TITLE PKG DEADLINE |
| T03 | LMTMOD-RED DOC PERM SOL |
| T04 | REQ REQUIRED DOCS |
| T05 | REQUIRED DOCS RECEIVED |
| T06 | VA TITLE PCKG SUB TO VA |
| T07 | VA TITLE PCKG APPROVED |
| T08 | I RECORD RECEIVED |
| T09 | APPRVD BY PREV SERV |
| T10 | B RECORD RECEIVED |
| T11 | T RECORD RECEIVED |
| T12 | SERVICE XFER MID STREAM |
| T13 | DLQ2 SET UP |
| T14 | NO DOC LIQ REQUEST |
| T15 | RECORDED DIL TO HUD |
| T16 | QC BID POST SALE |
| T17 | MH TITLE ISSUE IDENTIFIED |
| T18 | MH TITLE ISSUE CLEARED |
| T19 | TITLE ISSUE FC HOLD |
| T20 | TITLE ISSUE FC HOLD RMVD |
| T21 | LM APPEAL RECEIVED |
| T22 | LM APPEAL APPROVED |
| T23 | LM APPEAL DENIED |
| T24 | LM APPEAL REVIEW COMPLETE |
| T25 | VA TITLE DUE DATE |
| T26 | WECOME LETTER RCVD |
| T27 | VA TITLE ISSUE RESOLVED |
| T28 | FB END DATE |
| T29–T48 | STATE PAYMNT #1 through #19 + REC FB APPR |

## Other Codes

| Code | Description |
|------|-------------|
| G17 | DENIAL |
| J01 | JUDGEMENT HEARING SCH |
| V01 | VA FTP DUE DATE |
| 002 | PROBATE STARTED |
| 003 | PROBATE COMPLETE |
| 004 | NOTIFIED OF PROP REDEEMED |
| 005 | RDMPTN $ REC & APL BY CLT |
| 006 | RESPA ISSUE OPENED |
| 007 | RESPA ISSUE RESOLVED |
| 008 | ATTY CONFIRMED FILE CLOSE |
| 009 | SERVICER REVIEW |
| 010 | L93 PROTECTION ATTY REF |
| 011 | ADQ PROTECTION ATTY RECVD |
| 247 | CLNT NOTFD 2STOP ESC DISB |
| 901 | 311 |
| 991–999 | GENERIC TEST STEPS 1–9 |
`,
  },
];

// ─── Upsert logic ───────────────────────────────────────────────

const now = new Date().toISOString();
let inserted = 0;
let updated = 0;

for (const doc of DOCS) {
  const id = deterministicId(`context:${doc.name}`);
  const tokenCount = Math.ceil(doc.content.length / 4);

  const existing = db
    .prepare("SELECT id FROM context WHERE id = ?")
    .get(id) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE context SET content = ?, token_count = ?, tags = ?, updated_at = ? WHERE id = ?`
    ).run(doc.content, tokenCount, JSON.stringify(doc.tags), now, id);
    updated++;
  } else {
    db.prepare(
      `INSERT INTO context (id, workspace_id, name, category, subcategory, content, token_count, is_active, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, WORKSPACE_ID, doc.name, "schema", "data_dictionary", doc.content, tokenCount, 1, JSON.stringify(doc.tags), now, now);
    inserted++;
  }

  // FTS5
  try {
    db.prepare("DELETE FROM context_fts WHERE context_id = ?").run(id);
    db.prepare(
      `INSERT INTO context_fts (context_id, workspace_id, name, content, tags)
       SELECT id, workspace_id, name, content,
         (SELECT GROUP_CONCAT(value, ' ') FROM json_each(tags))
       FROM context WHERE id = ?`
    ).run(id);
  } catch {
    // FTS5 may not exist
  }

  console.log(`  ${existing ? "Updated" : "Created"}: ${doc.name} (${tokenCount} tokens)`);
}

// ── Remove old monolithic doc ───────────────────────────────────

const oldId = deterministicId("context:ServiceMac > Step Codes By Domain");
const oldDoc = db.prepare("SELECT id FROM context WHERE id = ?").get(oldId) as { id: string } | undefined;
if (oldDoc) {
  db.prepare("UPDATE context SET is_active = 0 WHERE id = ?").run(oldId);
  try {
    db.prepare("DELETE FROM context_fts WHERE context_id = ?").run(oldId);
  } catch { /* ok */ }
  console.log(`\n  Deactivated old monolithic doc: ServiceMac > Step Codes By Domain`);
}

console.log(`\nDone: ${inserted} created, ${updated} updated`);
db.close();
