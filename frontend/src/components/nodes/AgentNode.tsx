"use client";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import type { NodeData } from "@/types/flow";
import { useFlowStore } from "@/stores/flowStore";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

export function AgentNode({ id, data, selected }: NodeProps) {
  const updateNodeConfig = useFlowStore((s) => s.updateNodeConfig);
  const nodeData = data as NodeData;
  const model = (nodeData.config.model as string) ?? "";
  const instructions = (nodeData.config.instructions as string) ?? "";

  return (
    <div
      className={cn(
        "rounded-xl border shadow-sm w-72 text-sm bg-white",
        selected ? "border-blue-500 shadow-blue-200 shadow-md" : "border-zinc-200"
      )}
    >
      <div className="px-3 py-2 border-b border-zinc-100 flex items-center gap-2">
        <Bot className="w-4 h-4 text-zinc-500" />
        <span className="font-semibold text-zinc-800">Agent</span>
      </div>
      <p className="px-3 pt-2 text-xs text-zinc-400 leading-snug">{nodeData.description}</p>
      <div className="px-3 py-3 space-y-3">
        <div className="space-y-1">
          <Label className="text-xs text-zinc-500">Language Model</Label>
          <Input
            placeholder="Setup Provider"
            value={model}
            onChange={(e) => updateNodeConfig(id, { model: e.target.value })}
            className="h-7 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-zinc-500">Agent Instructions</Label>
          <Textarea
            placeholder="You are a helpful assistant that can use tools."
            value={instructions}
            onChange={(e) => updateNodeConfig(id, { instructions: e.target.value })}
            className="text-xs min-h-[64px] resize-none"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-zinc-500">Tools</Label>
          <Handle
            type="target"
            id="tools"
            position={Position.Left}
            style={{ top: "auto" }}
            className="!relative !transform-none !w-3 !h-3 !bg-blue-500 !border-2 !border-white"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-zinc-500">Input</Label>
          <div className="border border-dashed border-zinc-200 rounded px-2 py-1 text-xs text-zinc-400">
            Receiving input
          </div>
        </div>
      </div>
      <div className="px-3 pb-3 flex items-center justify-between">
        <span className="text-xs text-zinc-500">Response</span>
        <Handle
          type="source"
          position={Position.Right}
          className="!relative !transform-none !w-3 !h-3 !bg-blue-500 !border-2 !border-white"
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
