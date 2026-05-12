"""
Flow JSON  →  LangGraph ReAct agent graph

Flow structure expected:
  nodes: [ {id, type, data: {label, config: {...}}} ]
  edges: [ {source, target, sourceHandle?, targetHandle?} ]

Supported node types:
  chatInput   – provides the initial user message
  chatOutput  – marks the final output sink
  url         – becomes a LangChain Tool
  calculator  – becomes a LangChain Tool
  toolset     – groups tools; connected to agent via 'tools' handle
  agent       – runs as a ReAct agent with attached tools
"""

from typing import Any, AsyncIterator
from langchain_core.messages import HumanMessage
from langgraph.prebuilt import create_react_agent
from nodes.registry import build_tool_from_node
from providers.llm import get_llm


def _adjacency(edges: list[dict]) -> dict[str, list[str]]:
    adj: dict[str, list[str]] = {}
    for e in edges:
        adj.setdefault(e["source"], []).append(e["target"])
    return adj


def _find_node(nodes: list[dict], node_id: str) -> dict:
    for n in nodes:
        if n["id"] == node_id:
            return n
    raise ValueError(f"Node {node_id!r} not found")


def _collect_tools_for_agent(
    agent_node: dict,
    nodes: list[dict],
    edges: list[dict],
) -> list:
    """Walk upstream: find toolset nodes wired into this agent, then their tool nodes."""
    agent_id = agent_node["id"]
    tools = []

    # nodes whose target is agent (via tools handle)
    tool_sources = [
        e["source"]
        for e in edges
        if e["target"] == agent_id and e.get("targetHandle") in (None, "tools", "target")
    ]

    for src_id in tool_sources:
        src = _find_node(nodes, src_id)
        if src["type"] == "toolset":
            # find what feeds into this toolset
            toolset_sources = [
                e["source"] for e in edges if e["target"] == src_id
            ]
            for ts_id in toolset_sources:
                ts_node = _find_node(nodes, ts_id)
                t = build_tool_from_node(ts_node)
                if t:
                    tools.append(t)
        else:
            t = build_tool_from_node(src)
            if t:
                tools.append(t)

    return tools


def build_agent_graph(flow: dict[str, Any]):
    """Build and return a compiled LangGraph ReAct agent from a Flow dict."""
    nodes: list[dict] = flow.get("nodes", [])
    edges: list[dict] = flow.get("edges", [])

    agent_node = next((n for n in nodes if n["type"] == "agent"), None)
    if agent_node is None:
        raise ValueError("Flow has no agent node")

    config = agent_node.get("data", {}).get("config", {})
    model_name: str = config.get("model", "")
    instructions: str = config.get(
        "instructions", "You are a helpful assistant that can use tools."
    )

    tools = _collect_tools_for_agent(agent_node, nodes, edges)
    llm = get_llm(model_name)

    graph = create_react_agent(
        model=llm,
        tools=tools,
        prompt=instructions,
    )
    return graph


async def run_flow_stream(
    flow: dict[str, Any], user_message: str
) -> AsyncIterator[str]:
    """Stream token output from the flow's agent."""
    graph = build_agent_graph(flow)

    async for event in graph.astream_events(
        {"messages": [HumanMessage(content=user_message)]},
        version="v2",
    ):
        kind = event.get("event")
        if kind == "on_chat_model_stream":
            chunk = event.get("data", {}).get("chunk")
            if chunk and hasattr(chunk, "content") and chunk.content:
                yield chunk.content
