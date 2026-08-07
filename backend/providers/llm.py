"""
LiteLLM-backed LangChain chat model.

Model name examples:
  openai/gpt-4o
  anthropic/claude-3-5-sonnet-20241022
  ollama/llama3
  gemini/gemini-1.5-pro

If model is empty, falls back to NODELIST_DEFAULT_MODEL env var,
then "openai/gpt-4o-mini".
"""

import os

try:
    from langchain_litellm import ChatLiteLLM
except ImportError:  # Backward compatibility for older LangChain installs.
    from langchain_community.chat_models import ChatLiteLLM

DEFAULT_MODEL = os.getenv("NODELIST_DEFAULT_MODEL", "openai/gpt-4o-mini")


def get_llm(model: str = "") -> ChatLiteLLM:
    resolved = model.strip() or DEFAULT_MODEL
    return ChatLiteLLM(model=resolved)
