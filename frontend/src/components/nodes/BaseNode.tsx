"use client";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { NodeData } from "@/types/flow";
import { cn } from "@/lib/utils";

interface BaseNodeProps extends NodeProps {
  data: NodeData;
  children?: React.ReactNode;
  hasInput?: boolean;
  hasOutput?: boolean;
  accent?: string;
}

export function BaseNode({
  data,
  children,
  hasInput = true,
  hasOutput = true,
  selected,
  accent = "bg-white",
}: BaseNodeProps) {
  return (
    <div
      className={cn(
        "rounded-xl border shadow-sm w-64 text-sm",
        selected ? "border-blue-500 shadow-blue-200 shadow-md" : "border-zinc-200",
        accent
      )}
    >
      <div className="px-3 py-2 border-b border-zinc-100 flex items-center gap-2">
        <span className="font-semibold text-zinc-800 truncate">{data.label}</span>
      </div>
      {data.description && (
        <p className="px-3 pt-2 text-xs text-zinc-400 leading-snug">{data.description}</p>
      )}
      <div className="px-3 py-3 space-y-2">{children}</div>
      {hasInput && (
        <Handle
          type="target"
          position={Position.Left}
          className="!w-3 !h-3 !bg-blue-500 !border-2 !border-white"
        />
      )}
      {hasOutput && (
        <Handle
          type="source"
          position={Position.Right}
          className="!w-3 !h-3 !bg-blue-500 !border-2 !border-white"
        />
      )}
    </div>
  );
}
