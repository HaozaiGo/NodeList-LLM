"use client";
import type { NodeProps } from "@xyflow/react";
import type { NodeData } from "@/types/flow";
import { BaseNode } from "./BaseNode";
import { MessageSquareText } from "lucide-react";

export function ChatOutputNode(props: NodeProps) {
  return (
    <BaseNode {...props} data={props.data as NodeData} hasOutput={false}>
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <MessageSquareText className="w-3.5 h-3.5" />
        <span>Displays final response</span>
      </div>
    </BaseNode>
  );
}
