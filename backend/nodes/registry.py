from typing import Any, Optional
from langchain_core.tools import BaseTool
from nodes.url_node import make_url_tool
from nodes.calculator_node import make_calculator_tool


def build_tool_from_node(node: dict[str, Any]) -> Optional[BaseTool]:
    node_type = node.get("type")
    config = node.get("data", {}).get("config", {})

    if node_type == "url":
        urls = config.get("urls", [])
        depth = int(config.get("depth", 1))
        return make_url_tool(urls, depth)

    if node_type == "calculator":
        return make_calculator_tool()

    return None
