"use client";
import { useState } from "react";
import { CATEGORIES, COMPONENT_DEFS } from "@/lib/componentDefs";
import { Input } from "@/components/ui/input";
import { Search, ChevronDown, ChevronRight } from "lucide-react";
import type { ComponentDef } from "@/types/flow";

function DraggableItem({ def }: { def: ComponentDef }) {
  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("application/nodelist-type", def.type);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-100 cursor-grab active:cursor-grabbing select-none"
    >
      <span className="text-xs text-zinc-700">{def.label}</span>
    </div>
  );
}

function CategoryGroup({ category, defs }: { category: string; defs: ComponentDef[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full px-2 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50 rounded"
      >
        <span>{category}</span>
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>
      {open && (
        <div className="ml-1">
          {defs.map((d) => (
            <DraggableItem key={d.type} def={d} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ComponentPanel() {
  const [query, setQuery] = useState("");

  const filtered = query
    ? COMPONENT_DEFS.filter((d) => d.label.toLowerCase().includes(query.toLowerCase()))
    : null;

  return (
    <aside className="w-52 border-r border-zinc-200 bg-white flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 border-b border-zinc-100">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
          <Input
            className="pl-7 h-7 text-xs"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        <p className="px-2 py-1 text-[11px] font-bold text-zinc-400 uppercase tracking-wide">
          Components
        </p>
        {filtered ? (
          filtered.map((d) => <DraggableItem key={d.type} def={d} />)
        ) : (
          CATEGORIES.map((cat) => (
            <CategoryGroup
              key={cat}
              category={cat}
              defs={COMPONENT_DEFS.filter((d) => d.category === cat)}
            />
          ))
        )}
      </div>
    </aside>
  );
}
