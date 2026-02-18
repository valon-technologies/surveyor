"use client";

import React from "react";

interface SqlCodeBlockProps {
  sql: string;
}

export function SqlCodeBlock({ sql }: SqlCodeBlockProps) {
  return (
    <pre className="rounded-lg border bg-muted/30 p-4 overflow-x-auto text-xs font-mono leading-relaxed max-h-[500px] overflow-y-auto">
      {highlightSql(sql)}
    </pre>
  );
}

const SQL_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER",
  "FULL", "CROSS", "ON", "AND", "OR", "NOT", "IN", "AS", "IS", "NULL",
  "CASE", "WHEN", "THEN", "ELSE", "END", "IF", "UNION", "ALL", "WITH",
  "COALESCE", "CAST", "TRUE", "FALSE", "BETWEEN", "LIKE", "EXISTS",
  "GROUP", "BY", "ORDER", "HAVING", "LIMIT", "OFFSET", "DISTINCT",
]);

function highlightSql(text: string): React.ReactNode[] {
  return text.split("\n").map((line, lineIdx) => {
    // Full-line comment (-- ...)
    if (line.trimStart().startsWith("--")) {
      return (
        <span key={lineIdx}>
          <span className="text-gray-400 dark:text-gray-500">{line}</span>
          {"\n"}
        </span>
      );
    }

    return (
      <span key={lineIdx}>
        {tokenizeLine(line)}
        {"\n"}
      </span>
    );
  });
}

function tokenizeLine(line: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < line.length) {
    // Block comment /* ... */
    if (line[i] === "/" && line[i + 1] === "*") {
      const end = line.indexOf("*/", i + 2);
      const commentEnd = end === -1 ? line.length : end + 2;
      nodes.push(
        <span key={key++} className="text-gray-400 dark:text-gray-500">
          {line.slice(i, commentEnd)}
        </span>
      );
      i = commentEnd;
      continue;
    }

    // Single-quoted string
    if (line[i] === "'") {
      let j = i + 1;
      while (j < line.length && line[j] !== "'") j++;
      j++; // include closing quote
      nodes.push(
        <span key={key++} className="text-emerald-600 dark:text-emerald-400">
          {line.slice(i, j)}
        </span>
      );
      i = j;
      continue;
    }

    // Number (standalone)
    if (/\d/.test(line[i]) && (i === 0 || /[\s,(=]/.test(line[i - 1]))) {
      let j = i;
      while (j < line.length && /[\d.]/.test(line[j])) j++;
      // Only highlight if followed by non-word char
      if (j === line.length || /[\s,)]/.test(line[j])) {
        nodes.push(
          <span key={key++} className="text-amber-600 dark:text-amber-400">
            {line.slice(i, j)}
          </span>
        );
        i = j;
        continue;
      }
    }

    // Word (keyword, function, or identifier)
    if (/[a-zA-Z_]/.test(line[i])) {
      let j = i;
      while (j < line.length && /[a-zA-Z0-9_]/.test(line[j])) j++;
      const word = line.slice(i, j);
      const upper = word.toUpperCase();

      // Function: word followed by (
      const nextNonSpace = line.slice(j).match(/^\s*\(/);
      if (nextNonSpace && !SQL_KEYWORDS.has(upper)) {
        nodes.push(
          <span key={key++} className="text-violet-600 dark:text-violet-400">
            {word}
          </span>
        );
        i = j;
        continue;
      }

      // SQL keyword
      if (SQL_KEYWORDS.has(upper)) {
        nodes.push(
          <span key={key++} className="text-blue-600 dark:text-blue-400 font-semibold">
            {word}
          </span>
        );
        i = j;
        continue;
      }

      // Regular identifier
      nodes.push(<span key={key++}>{word}</span>);
      i = j;
      continue;
    }

    // Whitespace and operators — passthrough
    nodes.push(<span key={key++}>{line[i]}</span>);
    i++;
  }

  return nodes;
}
