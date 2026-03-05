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

        <h3>Source, Transform, and Question (Three-Column Verdicts)</h3>
        <p>
          Below the mapping summary is a three-column verdict area. All three must be resolved before you can submit.
        </p>

        <h4>Source</h4>
        <p>Is the AI pointing at the right source table and field? You have three choices:</p>
        <ul>
          <li><strong>Current</strong> — the existing source table and field are correct (may show "AI Review confirms" if the AI agrees)</li>
          <li><strong>AI Suggestion</strong> — if the AI's review proposes a different source, it appears as a blue option. Select it to accept.</li>
          <li><strong>Custom</strong> — type the correct source yourself (e.g., "EventDates.ActualFirstLegalActionDate")</li>
        </ul>
        <p>
          When you select AI Suggestion or Custom (i.e., the current mapping is wrong), a{" "}
          <strong>"Why was the AI wrong?"</strong> box appears. Use this to explain the reasoning behind
          the correction — for example, "AI confused this with a similarly-named field in another table"
          or "This data comes from the event history table, not the workstation snapshot." These explanations
          feed directly into the AI's Entity Knowledge so it avoids repeating the same mistake.
        </p>

        <h4>Transform</h4>
        <p>Is the transform logic correct? Same three choices: Current, AI Suggestion, or Custom.</p>
        <p>
          When the AI is wrong, the <strong>"Why was the AI wrong?"</strong> box appears here too.
          Be specific — e.g., "AI used a direct copy but this field needs a COALESCE across two sources"
          or "Enum mapping is missing the UNKNOWN default case."
        </p>

        <h4>Question</h4>
        <p>
          The AI may have generated a question about this field (e.g., "Which FcStopCode value represents judgement entered?").
          Mark it as acceptable (Yes) or not helpful (No). If not helpful, select a reason and optionally suggest a better question.
          If there's no linked question, you can create one.
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
          <li>Creates a <strong>learning record</strong> from your correction and "why wrong" explanation</li>
          <li>An admin validates the correction</li>
          <li>Once validated, the entity's <strong>Entity Knowledge</strong> doc is rebuilt — your correction becomes a mandatory instruction the AI must follow</li>
          <li>The next time mappings are generated for this entity, the AI reads your correction (including why it was wrong) and avoids the same mistake</li>
        </ol>
        <p>
          This is the feedback loop — your corrections compound. Each review cycle makes the AI more accurate.
          The "Why was the AI wrong?" explanations are especially valuable because they teach the AI the reasoning
          behind corrections, not just the answers.
        </p>

        <h2>Tips</h2>
        <ul>
          <li>
            <strong>Explain why, not just what</strong> — when correcting the AI, use the "Why was the AI wrong?" box.
            "AI confused foreclosure_sale dates with foreclosure dates — sale data comes from the FcSaleWorkstation table"
            is far more useful than just typing "FcSaleWorkstation.SaleDate."
          </li>
          <li>
            <strong>Check SOT Mappings</strong> — the SOT Mappings page in the sidebar shows production mappings.
            If you're unsure about a field, check what the production YAML says.
          </li>
          <li>
            <strong>Use citation links</strong> — when the AI mentions a document, it includes a clickable reference.
            Click it to verify the claim against the source material.
          </li>
          <li>
            <strong>Use the milestone filter</strong> — the review queue can be filtered by milestone (M1, M2, M2.5, M3, etc.)
            to focus on the fields that matter now. The VDS Fields by Milestone page in the sidebar gives a full tabular view.
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
          <li>
            <strong>Promote chat answers to questions</strong> — if there's an open question for the field
            you're reviewing and the AI gives a useful answer in the chat, you'll see a
            "Use as answer to: '...'" link below the AI's message. Click it to resolve the question
            directly with that answer — no need to copy-paste to the Questions page.
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
              <td>Progress overview — entity completion, milestone coverage, status distribution</td>
            </tr>
            <tr>
              <td><strong>Human Review UI</strong></td>
              <td>Review queue — pick entities and fields to review, filterable by milestone</td>
            </tr>
            <tr>
              <td><strong>VDS Fields by Milestone</strong></td>
              <td>Tabular view of all target fields — type, definition, mapping status, source, transform, Linear issue</td>
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
              <td>Accuracy dashboard — how well do generated mappings match production</td>
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
