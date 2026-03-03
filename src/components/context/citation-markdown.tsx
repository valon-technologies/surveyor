"use client";

import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ContextLink } from "./context-link";

const REF_PATTERN = /\[ref:ctx_([a-f0-9-]+)\]/g;

/** Check whether text contains any citation markers */
export function hasCitations(text: string): boolean {
  return /\[ref:ctx_([a-f0-9-]+)\]/.test(text);
}

/**
 * Split text around [ref:ctx_ID] markers, rendering each ref as a ContextLink.
 * Non-ref text segments are rendered as ReactMarkdown.
 */
export function CitationMarkdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const parts = useMemo(() => {
    const segments: { type: "text" | "ref"; value: string }[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    // Reset lastIndex since we reuse the global regex
    REF_PATTERN.lastIndex = 0;

    while ((match = REF_PATTERN.exec(children)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: "text", value: children.slice(lastIndex, match.index) });
      }
      segments.push({ type: "ref", value: match[1] });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < children.length) {
      segments.push({ type: "text", value: children.slice(lastIndex) });
    }

    return segments;
  }, [children]);

  // Fast path: no citations found
  if (parts.length === 1 && parts[0].type === "text") {
    return (
      <article className={className ?? "prose prose-sm prose-neutral text-xs max-w-none"}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {children}
        </ReactMarkdown>
      </article>
    );
  }

  return (
    <article className={className ?? "prose prose-sm prose-neutral text-xs max-w-none"}>
      {parts.map((part, i) =>
        part.type === "ref" ? (
          <ContextLink key={`ref-${i}`} contextId={part.value} />
        ) : (
          <ReactMarkdown key={`text-${i}`} remarkPlugins={[remarkGfm]}>
            {part.value}
          </ReactMarkdown>
        )
      )}
    </article>
  );
}
