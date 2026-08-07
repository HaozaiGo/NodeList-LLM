import type { ComponentDef } from "@/types/flow";

export const COMPONENT_DEFS: ComponentDef[] = [
  {
    type: "chatInput",
    label: "Chat Input",
    description: "Receives user chat messages as flow input.",
    category: "Input & Output",
    icon: "MessageSquare",
    defaultConfig: {},
  },
  {
    type: "chatOutput",
    label: "Chat Output",
    description: "Displays the final response to the user.",
    category: "Input & Output",
    icon: "MessageSquareText",
    defaultConfig: {},
  },
  {
    type: "textInput",
    label: "Text Input",
    description: "Static text passed into the flow.",
    category: "Input & Output",
    icon: "Type",
    defaultConfig: { text: "" },
  },
  {
    type: "textOutput",
    label: "Text Output",
    description: "Renders plain text output.",
    category: "Input & Output",
    icon: "AlignLeft",
    defaultConfig: {},
  },
  {
    type: "url",
    label: "URL",
    description: "Fetch content from one or more web pages, following links recursively.",
    category: "Data Sources",
    icon: "Globe",
    defaultConfig: { urls: [], depth: 1 },
  },
  {
    type: "calculator",
    label: "Calculator",
    description: "Perform basic arithmetic operations on a given expression.",
    category: "Utilities",
    icon: "Calculator",
    defaultConfig: { expression: "" },
  },
  {
    type: "agent",
    label: "Agent",
    description: "Define the agent's instructions, then enter a task to complete using tools.",
    category: "Models & Agents",
    icon: "Bot",
    defaultConfig: {
      model: "",
      instructions: "You are a helpful assistant that can use tools.",
    },
  },
  {
    type: "toolset",
    label: "Toolset",
    description: "Bundle tools to pass to an Agent.",
    category: "Models & Agents",
    icon: "Wrench",
    defaultConfig: {},
  },
  {
    type: "videoStitcher",
    label: "视频拼接器",
    description: "收集多个视频节点，调整顺序并预览连续播放结果。",
    category: "Video",
    icon: "Film",
    defaultConfig: { clipOrder: [] },
  },
];

export const CATEGORIES = [...new Set(COMPONENT_DEFS.map((d) => d.category))];
