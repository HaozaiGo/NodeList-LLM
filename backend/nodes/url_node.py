from typing import Optional
import httpx
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
from langchain_core.tools import tool


async def _fetch_page(client: httpx.AsyncClient, url: str) -> str:
    try:
        r = await client.get(url, follow_redirects=True, timeout=10)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer"]):
            tag.decompose()
        return soup.get_text(separator="\n", strip=True)
    except Exception as e:
        return f"[Error fetching {url}: {e}]"


async def fetch_urls(urls: list[str], depth: int = 1) -> dict[str, str]:
    visited: dict[str, str] = {}
    queue = list(urls)

    async with httpx.AsyncClient(headers={"User-Agent": "NodeListBot/1.0"}) as client:
        for _ in range(depth):
            next_queue: list[str] = []
            for url in queue:
                if url in visited:
                    continue
                content = await _fetch_page(client, url)
                visited[url] = content
                if depth > 1:
                    try:
                        r = await client.get(url, follow_redirects=True, timeout=10)
                        soup = BeautifulSoup(r.text, "html.parser")
                        base = urlparse(url)
                        for a in soup.find_all("a", href=True):
                            href = urljoin(url, a["href"])
                            p = urlparse(href)
                            if p.netloc == base.netloc and href not in visited:
                                next_queue.append(href)
                    except Exception:
                        pass
            queue = next_queue

    return visited


def make_url_tool(urls: list[str], depth: int = 1):
    @tool
    async def fetch_content(query: Optional[str] = None) -> str:
        """Fetch and return text content from the configured web pages."""
        result = await fetch_urls(urls, depth)
        return "\n\n---\n\n".join(
            f"URL: {u}\n{c}" for u, c in result.items()
        )

    return fetch_content
