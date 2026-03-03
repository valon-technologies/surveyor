"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DocsPage() {
  return (
    <div className="max-w-3xl mx-auto px-8 py-12">
      <div className="mb-8">
        <Link href="/">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back to Dashboard
          </Button>
        </Link>
      </div>

      <article className="prose prose-neutral dark:prose-invert max-w-none">
        <h1>Reviewer Onboarding Guide</h1>
        <p className="text-muted-foreground text-lg">
          How to review AI-generated field mappings in Surveyor.
        </p>

        <hr />

        <h2>What You're Doing</h2>
        <p>
          Surveyor generates field-level mappings from ServiceMac's ACDC source system to Valon's VDS target schema using Claude.
          Your job is to review each mapping and tell the system whether it's correct. Your corrections feed back into the AI —
          each review cycle makes future mappings better.
        </p>

        <h2>The Review Flow</h2>
        <ol>
          <li>Open <strong>Mapping</strong> in the sidebar</li>
          <li>Pick an entity to review (entities with the most unreviewed fields are at the top)</li>
          <li>Click <strong>Discuss</strong> on any field to open the review page</li>
          <li>Review the three sections: Source, Transform, and Question</li>
          <li>Click <strong>Submit Review & Next</strong> to move to the next field</li>
        </ol>

        <h2>The Discuss Page</h2>
        <p>The discuss page has several sections, top to bottom:</p>

        <h3>Current Mapping</h3>
        <p>
          Shows what the AI generated: source table and field, transform logic, confidence level, and reasoning.
          This is what you're evaluating.
        </p>

        <h3>Context Used</h3>
        <p>
          Collapsible panel showing which reference documents the AI read when generating this mapping.
          Click any doc to expand it inline, or click the external link to view it in the Context Library.
          Use this to verify the AI's reasoning — if it says "per Entity Knowledge corrections," you can click through and check.
        </p>

        <h3>Source Verdict</h3>
        <p>Is the AI pointing at the right source table and field? Your options:</p>
        <ul>
          <li><strong>correct</strong> — the source table and field are right</li>
          <li><strong>wrong_table</strong> — the data comes from a different ACDC table entirely</li>
          <li><strong>wrong_field</strong> — right table, wrong column</li>
          <li><strong>should_be_unmapped</strong> — this field has no ACDC source</li>
          <li><strong>missing_source</strong> — the source exists but the AI couldn't find it</li>
        </ul>
        <p>
          For any non-correct verdict, add a note explaining the correction.
          Example: <em>"Should be EventDates.ActualFirstLegalActionDate, not DefaultWorkstations.FcStartDate"</em>
        </p>

        <h3>Transform Verdict</h3>
        <p>Is the transform logic correct? Your options:</p>
        <ul>
          <li><strong>correct</strong> — the transform is right (or identity is appropriate)</li>
          <li><strong>not_needed</strong> — the AI added unnecessary transform logic, should be identity</li>
          <li><strong>needed_but_missing</strong> — needs a transform but the AI mapped as identity</li>
          <li><strong>wrong_enum</strong> — enum/code mapping is incorrect</li>
          <li><strong>wrong_logic</strong> — the SQL/expression logic is wrong</li>
        </ul>

        <h3>Question</h3>
        <p>
          The AI may have generated a question about this field (e.g., "Which FcStopCode value represents judgement entered?").
          You can mark the question as acceptable, suggest a better question, or create your own.
          All three sections must be resolved before you can submit.
        </p>

        <h3>AI Assistant</h3>
        <p>
          Below the verdict sections is a chat interface. If the AI pre-generated a review, it appears instantly.
          You can chat with the AI to ask follow-up questions, request BigQuery queries, or discuss alternative mappings.
          The AI can propose changes — you decide whether to accept them.
        </p>

        <h2>What Happens After You Submit</h2>
        <p>
          When you give a non-correct verdict, the system automatically:
        </p>
        <ol>
          <li>Creates a <strong>learning record</strong> from your correction</li>
          <li>An admin validates the correction</li>
          <li>Once validated, the entity's <strong>Entity Knowledge</strong> doc is rebuilt with your correction</li>
          <li>The next time mappings are generated for this entity, the AI reads your correction and avoids the same mistake</li>
        </ol>
        <p>
          This is the feedback loop — your corrections compound. Each review cycle makes the AI more accurate.
        </p>

        <h2>Tips</h2>
        <ul>
          <li>
            <strong>Check SOT Mappings</strong> — the SOT Mappings page in the sidebar shows production mappings.
            If you're unsure about a field, check what the production YAML says.
          </li>
          <li>
            <strong>Use citation links</strong> — when the AI mentions a document, it includes a clickable reference.
            Click it to verify the claim against the source material.
          </li>
          <li>
            <strong>Be specific in notes</strong> — "wrong" is less useful than "Should be EventDates.FcRemovalDate because
            the removal date comes from the event history table, not the workstation snapshot."
          </li>
          <li>
            <strong>Don't worry about SUBSET fields</strong> — fields that need multiple source tables (e.g., both
            mortgagor and co-mortgagor) are a known limitation. If the primary source is correct but incomplete,
            mark source as correct and note the missing secondary source.
          </li>
          <li>
            <strong>Confidence is a signal, not a guarantee</strong> — high confidence mappings can still be wrong.
            Low confidence mappings sometimes just need the AI to see more context.
          </li>
        </ul>

        <h2>Sidebar Navigation</h2>
        <table>
          <thead>
            <tr>
              <th>Page</th>
              <th>What it does</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Dashboard</strong></td>
              <td>Progress overview — entity completion, status distribution, your assigned work</td>
            </tr>
            <tr>
              <td><strong>Mapping</strong></td>
              <td>Review queue — pick entities and fields to review</td>
            </tr>
            <tr>
              <td><strong>Questions</strong></td>
              <td>AI-generated and reviewer questions awaiting answers</td>
            </tr>
            <tr>
              <td><strong>SOT Mappings</strong></td>
              <td>Browse production mappings — see what's already implemented</td>
            </tr>
            <tr>
              <td><strong>SOT Accuracy</strong></td>
              <td>Accuracy dashboard — how well do our generated mappings match production</td>
            </tr>
            <tr>
              <td><strong>Context</strong></td>
              <td>Reference document library — domain knowledge, schemas, Entity Knowledge</td>
            </tr>
            <tr>
              <td><strong>Data Preview</strong></td>
              <td>BigQuery sample data for any entity — see what the source data looks like</td>
            </tr>
          </tbody>
        </table>

        <h2>Getting Help</h2>
        <p>
          If something looks wrong or confusing, ask in the AI Assistant chat on the discuss page —
          it can query BigQuery, look up reference docs, and explain its reasoning.
          For tool issues, reach out to Rob.
        </p>
      </article>
    </div>
  );
}
