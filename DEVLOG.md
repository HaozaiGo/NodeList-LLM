# Dev Log

## Step 1 — 前端脚手架 + 画布基础 ✅

**完成内容**
- Next.js 16 + TypeScript + Tailwind + shadcn/ui
- @xyflow/react 画布（拖拽、连线、MiniMap、Controls）
- Zustand 全局 flow 状态（nodes / edges / addNode / updateNodeConfig）
- 左侧组件面板（分类折叠 + 搜索 + 拖拽到画布）
- 节点组件：ChatInput / ChatOutput / URL / Calculator / Agent

**遇到的问题**

| 问题 | 原因 | 解决 |
|------|------|------|
| `create-next-app` 报 EPERM | sandbox 限制写 `~/Library/Preferences` | 用 `required_permissions: all` 运行 |
| `@xyflow/react` 无 `OnDrop` / `OnDragOver` 类型 | v12 移除了这两个类型导出 | 改用 `React.DragEvent` 手动标注 |
| `NodeData` 不满足 `Record<string, unknown>` 约束 | ReactFlow Node 泛型要求 index signature | 让 `NodeData` extends `Record<string, unknown>` |
| `Slider.onValueChange` 类型为 `number \| readonly number[]` | shadcn 用 `@base-ui/react/slider`，签名与 Radix 不同 | 运行时判断 `Array.isArray` 取值 |

---

---

## Step 4 — FastAPI 后端 + Flow CRUD API ✅

**完成内容**
- FastAPI + SQLAlchemy (SQLite) + Alembic 结构
- Flow 数据模型（id / name / nodes JSON / edges JSON）
- REST API：GET /api/flows / POST / GET /{id} / PUT /{id} / DELETE /{id}
- CORS 允许 localhost:3000
- `/health` 健康检查

**遇到的问题**

| 问题 | 原因 | 解决 |
|------|------|------|
| `str \| None` TypeError | 系统 Python 3.9，不支持 PEP 604 union 语法 | 改用 `Optional[str]` |

---

---

## Step 5 — 节点执行器 ✅

**完成内容**
- `url_node.py`：httpx 异步抓取，BeautifulSoup 提取正文，支持递归 depth，封装为 LangChain `@tool`
- `calculator_node.py`：asteval 安全表达式求值（屏蔽 `__import__` 等危险调用），封装为 LangChain `@tool`
- `registry.py`：`build_tool_from_node(node)` 统一工厂，根据节点类型返回 Tool 实例

**遇到的问题**

| 问题 | 原因 | 解决 |
|------|------|------|
| `BaseTool \| None` TypeError | Python 3.9 不支持 PEP 604 | 改用 `Optional[BaseTool]` |
| urllib3 LibreSSL 警告 | macOS 系统 Python SSL 版本旧 | 仅 warning 不影响功能，忽略 |

---

---

## Step 6+7+8 — LangGraph 执行引擎 + LiteLLM + SSE Playground ✅

**完成内容**
- `executor/graph.py`：Flow JSON → LangGraph `create_react_agent`，自动遍历 toolset 边收集工具，`run_flow_stream` 异步 token 流
- `providers/llm.py`：LiteLLM 路由，支持 `openai/gpt-4o`、`anthropic/claude-*`、`ollama/*` 等，env `NODELIST_DEFAULT_MODEL` 覆盖默认值
- `api/routers/playground.py`：`POST /api/playground/{flow_id}/run`，SSE `text/event-stream` 推送 token，`[DONE]` 结束标记

**验证**
- 工具收集逻辑（URL + Calculator → Toolset → Agent）断言通过
- 无 agent 节点时抛出 ValueError 保护
- 所有模块 import 无错误

**遇到的问题**

| 问题 | 原因 | 解决 |
|------|------|------|
| langgraph 安装超时 | 依赖树较大 | 后台等待完成 |
| LangChainPendingDeprecationWarning | langgraph checkpoint serde 默认值将变更 | warning 不影响功能，忽略 |

---

## Step 9 — 前端 API 接入 + Playground 面板 ✅

**完成内容**
- `lib/api.ts`：Flow CRUD 客户端 + `streamRun`（fetch SSE，AbortController 支持停止）
- `flowStore.ts`：加入 `flowId / flowName / saving`，1.5s debounce 自动保存到后端
- `PlaygroundPanel.tsx`：右侧聊天面板，流式 token 逐字渲染，支持 Stop、Enter 发送
- `page.tsx`：Header 内联名称编辑、Saving 指示器、Playground 开关按钮、手动 Save 按钮
- `.env.local`：`NEXT_PUBLIC_API_URL=http://localhost:8000`

**遇到的问题**
无新问题，build 一次通过。

---

## Step 10 — 用户认证（邮箱 + 密码） ✅

**完成内容**

后端：
- `models/flow.py`：新增 `User` 表（id / email / hashed_password），`Flow` 加 `user_id` 外键
- `auth.py`：bcrypt 密码哈希、JWT 签发（72h）、`get_current_user` FastAPI 依赖
- `api/routers/auth.py`：`POST /api/auth/register` + `/api/auth/login`，返回 `access_token`
- flows / playground 路由全部加 `get_current_user` 保护，只能访问自己的 flow

前端：
- `stores/authStore.ts`：Zustand store，token 存 localStorage，hydrate on mount
- `lib/api.ts`：所有请求自动附加 `Authorization: Bearer <token>`
- `components/auth/AuthForm.tsx`：统一登录/注册表单组件
- `/login` `/register` 页面
- 主页：未登录自动跳转 `/login`，Header 显示邮箱 + 退出按钮

**遇到的问题**

| 问题 | 原因 | 解决 |
|------|------|------|
| `bcrypt 5.x` 与 passlib 不兼容 | passlib 1.7.4 检测 bcrypt 版本时崩溃 | 降到 `bcrypt==4.0.1` |
| `EmailStr` 报错 `email-validator not installed` | pydantic EmailStr 需要额外包 | `pip install email-validator` |
