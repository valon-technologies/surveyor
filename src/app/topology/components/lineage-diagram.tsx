"use client";

import { useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
  ConnectionLineType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  nodeTypes,
  type EntityFieldNodeData,
  type DefaultNodeData,
  type UnresolvedNodeData,
} from "./diagram-nodes";
import { MAPPING_TYPE_LABELS, type MappingType } from "@/lib/constants";
import type { MappingWithContext } from "@/types/mapping";

interface DiagramData {
  nodes: Node[];
  edges: Edge[];
}

function buildDiagramData(mapping: MappingWithContext): DiagramData {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const targetEntityName = mapping.targetField.entityName;
  const targetFieldName = mapping.targetField.name;
  const targetFieldId = mapping.targetField.id;
  const targetDataType = mapping.targetField.dataType;

  // Target node (right side)
  const targetNodeId = `target-${mapping.targetField.entityId}`;
  nodes.push({
    id: targetNodeId,
    type: "entityField",
    position: { x: 600, y: 0 },
    data: {
      entityName: targetEntityName,
      fields: [
        {
          id: targetFieldId,
          name: targetFieldName,
          dataType: targetDataType,
          isHighlighted: true,
        },
      ],
      side: "target",
    } satisfies EntityFieldNodeData,
  });

  const hasSource = mapping.sourceField;
  const hasDefault = mapping.defaultValue;
  const mappingTypeLabel = mapping.mappingType
    ? MAPPING_TYPE_LABELS[mapping.mappingType as MappingType] || mapping.mappingType
    : "Mapped";

  if (hasSource) {
    const sourceEntityName = mapping.sourceField!.entityName;
    const sourceFieldName = mapping.sourceField!.name;
    const sourceFieldId = mapping.sourceField!.id;

    // Primary source node
    const primarySourceNodeId = `source-${mapping.sourceField!.entityId}`;
    const primaryFields: EntityFieldNodeData["fields"] = [
      {
        id: sourceFieldId,
        name: sourceFieldName,
        isHighlighted: true,
      },
    ];

    // Parse transform for additional field references from the same entity
    const additionalSources = new Map<
      string,
      { entityName: string; fields: Set<string> }
    >();

    if (mapping.transform) {
      const refPattern = /(\w+)\.(\w+)/g;
      let match;
      while ((match = refPattern.exec(mapping.transform)) !== null) {
        const [, entity, field] = match;
        // Skip if it's the primary source
        if (
          entity === sourceEntityName &&
          field === sourceFieldName
        ) {
          continue;
        }
        // If same entity as primary, add field to primary node
        if (entity === sourceEntityName) {
          if (!primaryFields.find((f) => f.name === field)) {
            primaryFields.push({
              id: `ref-${entity}-${field}`,
              name: field,
              isHighlighted: false,
            });
          }
          continue;
        }
        // Different entity — group
        if (!additionalSources.has(entity)) {
          additionalSources.set(entity, {
            entityName: entity,
            fields: new Set(),
          });
        }
        additionalSources.get(entity)!.fields.add(field);
      }
    }

    nodes.push({
      id: primarySourceNodeId,
      type: "entityField",
      position: { x: 0, y: 0 },
      data: {
        entityName: sourceEntityName,
        fields: primaryFields,
        side: "source",
      } satisfies EntityFieldNodeData,
    });

    // Primary edge
    edges.push({
      id: `edge-primary`,
      source: primarySourceNodeId,
      target: targetNodeId,
      sourceHandle: sourceFieldId,
      targetHandle: targetFieldId,
      label: mappingTypeLabel,
      type: "smoothstep",
      animated: true,
      style: { strokeWidth: 2 },
      labelStyle: { fontSize: 10, fontWeight: 500 },
    });

    // Additional source nodes
    let yOffset = 1;
    additionalSources.forEach((src, entityKey) => {
      const nodeId = `source-ref-${entityKey}`;
      const fields = Array.from(src.fields).map((f) => ({
        id: `ref-${entityKey}-${f}`,
        name: f,
        isHighlighted: false,
      }));

      nodes.push({
        id: nodeId,
        type: "entityField",
        position: { x: 0, y: yOffset * 150 },
        data: {
          entityName: src.entityName,
          fields,
          side: "source",
        } satisfies EntityFieldNodeData,
      });

      edges.push({
        id: `edge-ref-${entityKey}`,
        source: nodeId,
        target: targetNodeId,
        sourceHandle: fields[0]?.id,
        targetHandle: targetFieldId,
        label: "referenced",
        type: "smoothstep",
        animated: false,
        style: { strokeWidth: 1, strokeDasharray: "6 3" },
        labelStyle: { fontSize: 9, fill: "#9ca3af" },
      });

      yOffset++;
    });

    // Vertically center all source nodes
    const totalSourceNodes = 1 + additionalSources.size;
    if (totalSourceNodes > 1) {
      const totalHeight = (totalSourceNodes - 1) * 150;
      const startY = -totalHeight / 2;
      let idx = 0;
      for (const node of nodes) {
        if (node.id.startsWith("source-")) {
          node.position.y = startY + idx * 150;
          idx++;
        }
      }
    }
  } else {
    // No resolved sourceField — try to infer from transform/reasoning, or show placeholder

    // Try to extract entity.field references from transform and reasoning
    const inferText = [mapping.transform, mapping.reasoning].filter(Boolean).join(" ");
    const inferredSources = new Map<string, Set<string>>();
    const refPattern = /\b(\w{2,})\.(\w{2,})\b/g;
    let refMatch;
    while ((refMatch = refPattern.exec(inferText)) !== null) {
      const [, entity, field] = refMatch;
      // Skip target self-references
      if (entity === targetEntityName && field === targetFieldName) continue;
      // Skip common non-entity patterns
      if (["mapping", "e", "f", "eg", "i"].includes(entity.toLowerCase())) continue;
      if (!inferredSources.has(entity)) {
        inferredSources.set(entity, new Set());
      }
      inferredSources.get(entity)!.add(field);
    }

    if (inferredSources.size > 0) {
      // Build inferred source nodes from parsed references
      let yOffset = 0;
      inferredSources.forEach((fieldSet, entityKey) => {
        const nodeId = `source-inferred-${entityKey}`;
        const fields = Array.from(fieldSet).map((f) => ({
          id: `inferred-${entityKey}-${f}`,
          name: f,
          isHighlighted: fieldSet.size === 1,
        }));

        nodes.push({
          id: nodeId,
          type: "entityField",
          position: { x: 0, y: yOffset * 150 },
          data: {
            entityName: entityKey,
            fields,
            side: "source",
          } satisfies EntityFieldNodeData,
        });

        edges.push({
          id: `edge-inferred-${entityKey}`,
          source: nodeId,
          target: targetNodeId,
          sourceHandle: fields[0]?.id,
          targetHandle: targetFieldId,
          label: mappingTypeLabel,
          type: "smoothstep",
          animated: true,
          style: { strokeWidth: 2, strokeDasharray: "6 3" },
          labelStyle: { fontSize: 10, fontWeight: 500 },
        });

        yOffset++;
      });

      // Vertically center inferred source nodes
      if (inferredSources.size > 1) {
        const totalHeight = (inferredSources.size - 1) * 150;
        const startY = -totalHeight / 2;
        let idx = 0;
        for (const node of nodes) {
          if (node.id.startsWith("source-inferred-")) {
            node.position.y = startY + idx * 150;
            idx++;
          }
        }
      }
    } else if (hasDefault) {
      // Default-only node
      const defaultNodeId = "default-node";
      nodes.push({
        id: defaultNodeId,
        type: "defaultValue",
        position: { x: 0, y: 0 },
        data: {
          value: mapping.defaultValue!,
        } satisfies DefaultNodeData,
      });

      edges.push({
        id: "edge-default",
        source: defaultNodeId,
        target: targetNodeId,
        targetHandle: targetFieldId,
        label: "Default Value",
        type: "smoothstep",
        animated: true,
        style: { strokeWidth: 2, strokeDasharray: "4 4" },
        labelStyle: { fontSize: 10 },
      });
    } else {
      // Truly unresolved — show placeholder so the target isn't stranded
      const unresolvedNodeId = "unresolved-source";
      nodes.push({
        id: unresolvedNodeId,
        type: "unresolved",
        position: { x: 0, y: 0 },
        data: {
          label: "Source not resolved",
          detail: mapping.mappingType
            ? `Type: ${MAPPING_TYPE_LABELS[mapping.mappingType as MappingType] || mapping.mappingType}`
            : null,
        } satisfies UnresolvedNodeData,
      });

      edges.push({
        id: "edge-unresolved",
        source: unresolvedNodeId,
        target: targetNodeId,
        targetHandle: targetFieldId,
        label: mappingTypeLabel,
        type: "smoothstep",
        animated: false,
        style: { strokeWidth: 1.5, strokeDasharray: "4 4", stroke: "#f59e0b" },
        labelStyle: { fontSize: 10, fill: "#d97706" },
      });
    }
  }

  return { nodes, edges };
}

export function LineageDiagram({
  mapping,
}: {
  mapping: MappingWithContext;
}) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildDiagramData(mapping),
    [mapping]
  );

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        connectionLineType={ConnectionLineType.SmoothStep}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.3}
        maxZoom={2}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
