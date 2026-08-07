"use client";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import type { NodeData } from "@/types/flow";
import { cn } from "@/lib/utils";

export function CalculatorNode({ data, selected }: NodeProps) {
  const nodeData = data as NodeData;
  return (
    <div
      className={cn(
        "rounded-xl border shadow-sm w-64 text-sm bg-white",
        selected ? "border-blue-500 shadow-blue-200 shadow-md" : "border-zinc-200"
      )}
    >
      <div className="px-3 py-2 border-b border-zinc-100 font-semibold text-zinc-800">Calculator</div>
      <p className="px-3 pt-2 text-xs text-zinc-400 leading-snug">{nodeData.description}</p>
      <div className="px-3 py-3">
        <div className="bg-zinc-900 text-zinc-300 text-xs rounded px-2 py-1 font-mono">
          EVALUATE_EXPRESSION
        </div>
      </div>
      <div className="bg-zinc-900 rounded-b-xl px-3 py-1.5 flex items-center justify-between">
        <span className="text-zinc-300 text-xs font-medium">Toolset</span>
        <Handle
          type="source"
          position={Position.Right}
          className="!relative !transform-none !w-3 !h-3 !bg-blue-400 !border-2 !border-zinc-900"
          style={{ top: "auto", right: "auto" }}
        />
      </div>
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-blue-500 !border-2 !border-white"
      />
    </div>
  );
}
