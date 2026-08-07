"use client";
import { ReactFlowProvider } from "@xyflow/react";

export function FlowProvider({ children }: { children: React.ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
}
