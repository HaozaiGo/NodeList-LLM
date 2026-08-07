"use client";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import type { NodeData } from "@/types/flow";
import { useFlowStore } from "@/stores/flowStore";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

export function UrlNode({ id, data, selected }: NodeProps) {
  const updateNodeConfig = useFlowStore((s) => s.updateNodeConfig);
  const nodeData = data as NodeData;
  const depth = (nodeData.config.depth as number) ?? 1;

  return (
    <div
      className={cn(
        "rounded-xl border shadow-sm w-64 text-sm bg-white",
        selected ? "border-blue-500 shadow-blue-200 shadow-md" : "border-zinc-200"
      )}
    >
      <div className="px-3 py-2 border-b border-zinc-100 font-semibold text-zinc-800">URL</div>
      <p className="px-3 pt-2 text-xs text-zinc-400 leading-snug">{nodeData.description}</p>
      <div className="px-3 py-3 space-y-3">
        <div>
          <div className="flex justify-between text-xs text-zinc-500 mb-1">
            <span>Depth</span>
            <span>{depth.toFixed(2)}</span>
          </div>
          <Slider
            min={1}
            max={5}
            step={1}
            value={[depth]}
            onValueChange={(val) => {
              const v = Array.isArray(val) ? (val as number[])[0] : (val as number);
              updateNodeConfig(id, { depth: v });
            }}
            className="w-full"
          />
        </div>
        <div className="bg-zinc-900 text-zinc-300 text-xs rounded px-2 py-1 font-mono">
          FETCH_CONTENT
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
