"use client";
import type { NodeProps } from "@xyflow/react";
import type { NodeData } from "@/types/flow";
import { BaseNode } from "./BaseNode";
import { MessageSquare } from "lucide-react";

export function ChatInputNode(props: NodeProps) {
  return (
    <BaseNode {...props} data={props.data as NodeData} hasInput={false}>
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <MessageSquare className="w-3.5 h-3.5" />
        <span>Sends user message into flow</span>
      </div>
    </BaseNode>
  );
}
