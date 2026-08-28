# Open-source generative UI for Kalsa

Research date: 2026-08-25. GitHub star counts are approximate snapshots observed on or near this date; activity means the repository had recent commits/releases or substantial current development. “Small-model-safe” means the model emits a short, typed call or constrained declarative payload—not arbitrary HTML/React/code.

## Comparison at a glance

| Project | Stars / activity / license | Invocation and rendering architecture | RN / WebView fit | Local model + small-model fit | Adaptation to Kalsa |
|---|---|---|---|---|---|
| [CopilotKit](https://github.com/CopilotKit/CopilotKit) + [generative-ui](https://github.com/CopilotKit/generative-ui) | ~36.5k; very active; MIT | Agent/runtime events, frontend tools, named component renderers; also A2UI, Open-JSON-UI, MCP Apps, and raw HTML iframe modes | Official RN package and `useComponent`; native RN components are feasible; HTML mode is sandboxed iframe | Good when using RN frontend tools + Zod schemas; weaker if using open-ended HTML; runtime usually expects an agent endpoint | Medium: excellent concepts/API, but runtime/AG-UI is more machinery than Kalsa needs |
| [Vercel AI SDK](https://github.com/vercel/ai) UI/Core | ~25k; very active; Apache-2.0 | Tool calls + typed tool results mapped to React UI; `streamUI` is the older RSC path | Core is JS-runtime friendly; UI is web/React-oriented; no first-party native RN renderer | Strongest as a tool/schema transport (`strict`, validation, repair); `streamUI`/RSC is poor for RN and small local models | Low–medium: use Core ideas/protocol, not the web UI layer |
| [assistant-ui](https://github.com/assistant-ui/assistant-ui) + [tool-ui](https://github.com/assistant-ui/tool-ui) | ~10k / ~700; active; MIT | Toolkits declare schema, executor, and renderer; Tool UI maps validated tool results to cards, tables, charts, approvals | assistant-ui has an RN distribution; Tool UI components are web/shadcn/Radix and need native rewrites | Excellent for known tool calls and result schemas; does not require model-written apps | Medium for assistant-ui; high for Tool UI unless Kalsa ports only schemas/patterns |
| [json-render](https://github.com/vercel-labs/json-render) | ~16k; very active/new; Apache-2.0 | Catalog + Zod props + declarative JSON tree; stream and render progressively; actions/data binding | Explicit `@json-render/react-native`; same catalog/spec concept across web and mobile | Excellent guardrails and native target; still asks model for a UI tree, so use a narrow catalog or wrap calls as tools | Low–medium: closest off-the-shelf architecture to Kalsa’s registry |
| [Google A2UI](https://github.com/a2ui-project/a2ui) | ~15k; very active but public-preview/spec evolving; Apache-2.0 | Flat, incrementally updatable declarative JSON surfaces, data model, events, trusted client catalog | Native-by-design; official renderers are evolving, but community RN renderer exists; no WebView required | Very good: small flat messages and catalog allow grammar/schema constraints; not inherently native tool-call transport | Medium: adopt the wire concepts or a subset; avoid taking the changing full spec wholesale |
| [OpenUI](https://github.com/thesysdev/openui) | ~6.5k; active; MIT | Model emits compact streaming OpenUI Lang; prompt generated from a component library; renderer parses progressively | Has an Expo example rendering real `Text`, `View`, SVG charts; native renderer is proven in example | Token-efficient and catalog-driven, but it is a freeform DSL stream rather than a native function call; weaker than JSON grammar for 2B | Medium: useful if token pressure dominates; parser/DSL is another runtime to own |
| [MCP-UI / MCP Apps](https://github.com/MCP-UI-Org/mcp-ui) | ~4.5–5k; active and standardizing; Apache-2.0 | MCP tool links to a UI resource; host loads HTML and communicates through a bridge; standardized MCP Apps pattern | Web-first; sandboxed iframe is the normal runtime; RN would need WebView or a new native host/renderer | Model only needs to select a tool, but UI payload/resource is usually web HTML; remote/server-oriented | High for native Kalsa; useful interoperability reference, not the rendering substrate |
| [OpenAI Apps SDK examples](https://github.com/openai/openai-apps-sdk-examples) | ~2.3k; active; MIT examples | MCP tool + `_meta.ui.resourceUri` + HTML/React widget in a sandboxed iframe; `window.openai` bridge | WebView/iframe pattern; not RN-native | Tool selection is small-model-friendly; widget delivery is cloud/host-centric and HTML-heavy | High: copy the tool/resource contract only if Kalsa wants MCP interoperability |
| [E2B Fragments](https://github.com/e2b-dev/fragments) | ~6.4k; active; Apache-2.0 | Model generates code/apps; E2B sandbox executes them; streamed artifact preview | Next.js/web; RN would need WebView or remote artifact hosting | Poor for 2B: code generation, package installation, execution, and repair are expensive | Very high; architectural inspiration only |
| [LangChain Open Canvas](https://github.com/langchain-ai/open-canvas) | ~5.5k; **archived Feb 2026**; MIT | LangGraph agents generate/edit Markdown/code artifacts with versioning and memory | Web editor; no native RN path | Poor–medium: artifact editing is useful, but not a small schema-constrained miniapp protocol | Very high; do not adopt |
| [Open-claude](https://github.com/Damienchakma/Open-claude) | ~109; active but small; MIT | Vite web chat, local-provider connectors, artifact parser/panel for HTML/React/SVG | Browser-only; RN would require a port and likely WebView | Local model support is useful, but artifact parsing/code generation is not small-model-safe | Very high; reference UX only |
| [React Native AI](https://github.com/callstackincubator/ai) | ~1.4k; active; MIT | On-device RN model providers with Vercel AI SDK compatibility; not a generative-UI renderer | Native RN/Expo; llama.rn supports GGUF and streaming | Excellent enabling layer for local inference; tool-call reliability still depends on the model/kernel/schema | Low as a renderer; potentially useful transport/provider layer |

## Project notes

### CopilotKit and OpenGenerativeUI

[CopilotKit’s RN docs](https://docs.copilotkit.ai/react-native) explicitly support frontend tools, Standard Schema/Zod parameters, self-hosted/OpenAI-compatible endpoints, and `useComponent`, which renders the parameters of a named tool as an RN component. That is almost exactly the “model calls a whitelisted miniapp, registry renders it” boundary Kalsa wants. The repo is MIT and highly active; its README describes chat, tool calls, backend tool rendering, generative UI, shared state, and HITL.

The important separation is architectural. Use the RN/headless frontend-tool surface and a minimal local adapter; do not import the whole Copilot Runtime/AG-UI/cloud persistence stack unless Kalsa later needs multi-agent workflows. CopilotKit’s [generative-ui repo](https://github.com/CopilotKit/generative-ui) also documents three tiers: static event-driven UI, declarative A2UI/Open-JSON-UI, and open-ended MCP Apps. Its `useComponent` HTML example passes generated HTML into a sandboxed iframe—powerful, but the wrong default for a 2B model and native-first app.

**Verdict:** best ready-made RN precedent; medium integration cost because the useful renderer is small but the surrounding product is large.

### Vercel AI SDK: Core, UI, and `streamUI`

[AI SDK Core tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling) gives a clean model-independent abstraction: named tools, JSON/Zod `inputSchema`, optional execution, `strict`, validation, active-tool filtering, and tool-call repair. This is valuable even if Kalsa never ships the SDK. It maps well to a native llama.cpp call envelope: `tool_name`, validated arguments, tool result, and renderer lookup.

[AI SDK UI generative UI](https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces) maps tool results to React components. However, the older [`streamUI`](https://ai-sdk.dev/docs/reference/ai-sdk-rsc) API is AI SDK RSC, and the current docs call RSC experimental and recommend AI SDK UI for production. RSC also assumes React Server Components/Next.js, not Expo. AI SDK Core can run in any JS environment and supports custom providers, but Kalsa would still need its own native tool-call bridge and renderer.

**Verdict:** borrow the tool/schema semantics; do not make AI SDK UI or RSC the mobile rendering dependency.

### assistant-ui and Tool UI

[assistant-ui](https://www.assistant-ui.com/docs/tools) treats a toolkit as the contract between model and UI: tool name, schema, executor, and renderer. Its repository has a dedicated `@assistant-ui/react-native` distribution and a framework-agnostic core. That makes it more relevant to Kalsa than a web-only chat component library.

[Tool UI](https://www.tool-ui.com/docs/overview) is unusually aligned with the transition problem: tool results are parsed against Zod schemas and rendered as interactive cards, tables, charts, option lists, approval flows, and artifacts. But its actual components are built on Tailwind, Radix, and shadcn for the web. Porting the schema contracts and interaction model is reasonable; porting the component implementations is not a drop-in RN job.

**Verdict:** good if Kalsa wants a polished tool-result UX catalogue; use assistant-ui concepts and schemas, not the web component code.

### json-render

[json-render](https://json-render.dev/docs) is the closest complete OSS match to Kalsa’s existing miniapp registry. Developers define a catalog of allowed components, Zod prop schemas, actions, bindings, and a registry; the model emits only a catalog-shaped JSON spec; a renderer progressively materializes it. The repo ships `@json-render/react-native`, explicitly advertises native mobile rendering, and is Apache-2.0.

The main caveat is granularity. Its normal input is a whole UI tree, not necessarily a native tool call. For Kalsa, the safest adaptation is to keep each miniapp as a named native tool and use json-render only inside selected tools—or expose a very small catalog (`Card`, `Text`, `Table`, `Chart`, `Calculator`, `Tabs`, `Quiz`) with a grammar-constrained spec. That avoids asking a 2B model to compose an unconstrained dashboard.

**Verdict:** strongest off-the-shelf renderer candidate; validate bundle size, Expo compatibility, and schema/grammar behavior before adopting the full runtime.

### Google A2UI

[A2UI](https://a2ui.org/) is a protocol/spec rather than a chat product. Agents send declarative JSON describing component surfaces and a data model; the client owns the trusted catalog and maps abstract types to native widgets. Its flat ID-referenced representation is designed for incremental updates and progressive rendering, and the v1 protocol says payloads can travel in MCP tool calls or tool outputs.

A2UI is explicitly public preview and still evolving. The official repo lists native renderers as a roadmap area, while its [renderer ecosystem](https://github.com/a2ui-project/a2ui/blob/main/docs/public/ecosystem/renderers.md) lists a community React Native renderer supporting v0.8. This is a good conceptual fit for a portable future protocol, but Kalsa already has a narrower, more reliable protocol: native function calls plus a registry. A Kalsa subset could borrow A2UI’s flat updates, stable IDs, data bindings, and event model without inheriting spec churn.

**Verdict:** best standards/reference architecture for future interoperability; not yet the lowest-risk direct dependency.

### OpenUI

[OpenUI](https://github.com/thesysdev/openui) uses OpenUI Lang, a compact streaming DSL generated from a developer-defined component library. Its claim is substantially fewer tokens than equivalent JSON, and the library generates prompt instructions from allowed components. The [Expo example](https://www.openui.com/docs/openui-lang/examples/react-native) renders native `Text`, `View`, and SVG charts without a WebView.

The trade-off is reliability. The model emits a custom textual language, not a JSON-schema-validated native tool call. The Expo example uses a backend to generate a system prompt and stream raw text; it is therefore not an offline-first reference implementation. A compact DSL may help 2B latency/token pressure, but it introduces parser recovery and syntax-failure modes that llama.cpp grammar-constrained JSON avoids.

**Verdict:** interesting benchmark candidate if output-token budget is the bottleneck; second choice after native tool calls/JSON.

### MCP-UI, MCP Apps, and the OpenAI Apps SDK pattern

[MCP-UI](https://github.com/MCP-UI-Org/mcp-ui) pioneered UI over MCP and now implements the MCP Apps pattern. A tool advertises a UI resource through metadata; the host fetches an HTML resource and renders it in a sandboxed iframe, with a bidirectional bridge. The [MCP Apps overview](https://apps.extensions.modelcontextprotocol.io/api/documents/Overview.html) describes the same server–host–iframe split. The [OpenAI Apps SDK examples](https://github.com/openai/openai-apps-sdk-examples) show `_meta.ui.resourceUri`, tool results, widget state, and `window.openai`; OpenAI’s [Apps SDK guide](https://help.openai.com/en/articles/12515353-build-with-the-apps-sdk) says the SDK is open source and built on MCP.

This pattern is excellent for portable web widgets and host-mediated security. It is not a native RN renderer: the standard runtime is a sandboxed iframe, so an Expo implementation would either use WebView or write a native MCP Apps host and replace HTML widgets with native components. It also presumes a server/resource boundary more than Kalsa does. The model-side tool selection is small-model-friendly, but the UI artifact itself is not.

**Verdict:** retain as an interoperability/export option, not Kalsa’s primary miniapp format.

### E2B Fragments

[Fragments](https://github.com/e2b-dev/fragments) is an Apache-2.0 Next.js template inspired by Claude Artifacts and v0. It asks an LLM to generate code, runs that code in E2B sandboxes, installs packages, and streams a web preview. It supports Ollama among many providers, but still requires an E2B API key and a server/cloud execution environment in its documented setup.

This is the open-ended end of the spectrum: model-generated code offers maximum flexibility and maximum failure surface. A 2B Q4 model is a poor fit for multi-file code, package selection, sandbox repair, and visual iteration. It has no useful direct RN-native path.

**Verdict:** reject for Kalsa; useful only as a contrast with registry-driven miniapps.

### LangChain Open Canvas

[Open Canvas](https://github.com/langchain-ai/open-canvas) is a web application for collaborative writing/coding with artifact versioning, reflection memory, quick actions, and Markdown/code editing. It is MIT, but GitHub marked the repository archived on 2026-02-26. Its setup requires LangGraph, Supabase authentication, LangSmith, and model/API services.

It is an artifact-workbench UX, not a compact component-as-tool protocol. The code/Markdown artifact model and versioning are interesting for a future Kalsa document surface, but the project is inactive, web-centric, backend-heavy, and not appropriate as the miniapp transition layer.

**Verdict:** do not adopt.

### Open-claude

[Open-claude](https://github.com/Damienchakma/Open-claude) is a small MIT Vite/React Claude-like UI. It supports Ollama and LM Studio, stores chats/artifacts in browser local storage, and has an artifact panel/parser for HTML, React, and SVG. It is useful evidence that local-provider UX and artifact preview can coexist.

Its artifact path is still code extraction and browser preview, not schema-constrained tool calls or native RN rendering. The project is far smaller and less battle-tested than the protocol/framework candidates.

**Verdict:** inspect for UX ideas only; no reusable core for Kalsa.

### React Native AI (enabling layer)

[React Native AI](https://github.com/callstackincubator/ai) is not generative UI, but it is relevant to Kalsa’s offline constraint. It supplies on-device providers with Vercel AI SDK compatibility; its Llama provider runs GGUF models through `llama.rn`, supports streaming, and documents 1.5B–3B-class examples. It is MIT and native RN/Expo-oriented.

It could provide an adapter if Kalsa wanted AI SDK-compatible tool messages, but Kalsa already has a llama.cpp-based kernel. The project does not solve tool grammar, component catalogs, or rendering policy.

**Verdict:** optional transport/provider reference, not a miniapp framework.

## Recommendation for Kalsa

### Recommended architecture

Keep Kalsa’s native tool-call boundary as the product protocol:

```text
local 2B model
  -> llama.cpp grammar-constrained native tool call
  -> { name, version, args } validation
  -> whitelisted RN registry
  -> native miniapp + typed interaction events
```

Use the following ideas selectively:

1. **Primary renderer:** evaluate [json-render’s RN package](https://github.com/vercel-labs/json-render) first. If it is too broad or adds too much runtime, copy its catalog/registry/schema ideas into Kalsa rather than adopting it wholesale.
2. **Tool-call API:** borrow [AI SDK Core’s tool contract](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling): short names, descriptions, JSON Schema/Zod-like arguments, strict validation, active-tool filtering, and deterministic repair/fallback. Kalsa’s llama.cpp grammar should be the enforcement layer, not a prompt-only “please emit JSON” instruction.
3. **RN wiring precedent:** use [CopilotKit’s `useComponent`](https://docs.copilotkit.ai/reference/react-native/hooks/useComponent) and frontend-tool semantics as a reference for named tool → native component registration. Avoid its runtime/cloud layer unless needed.
4. **Protocol evolution:** borrow A2UI’s stable IDs, flat incremental updates, data binding, and event semantics if miniapps grow beyond one call. Consider an optional A2UI export/import layer later.
5. **UX catalogue:** borrow Tool UI’s schema-first result patterns (table, chart, choice list, approval, receipt), but implement them with Kalsa’s existing RN components.

### Scores (1 = poor, 5 = strong)

| Candidate | Offline-first | RN-native | Small-model-safe | Permissive license | Minimal backend | Overall for Kalsa |
|---|---:|---:|---:|---:|---:|---:|
| Kalsa-native tool calls + registry | 5 | 5 | 5 | 5 | 5 | **5.0** |
| json-render (narrow catalog) | 4 | 5 | 4 | 5 | 4 | **4.4** |
| CopilotKit RN/headless subset | 3 | 5 | 4 | 5 | 2 | **3.8** |
| A2UI subset/adapter | 4 | 4 | 4 | 5 | 4 | **4.2** |
| OpenUI Lang | 3 | 5 | 3 | 5 | 3 | **3.8** |
| assistant-ui concepts | 4 | 4 | 4 | 5 | 3 | **4.0** |
| MCP Apps / Apps SDK | 2 | 1 | 3 | 4 | 2 | **2.4** |
| E2B Fragments / code artifacts | 1 | 1 | 1 | 5 | 1 | **1.8** |

**Bottom line:** Kalsa should not migrate from JSON-in-prose to another freeform artifact language. Migrate to native tool calls, keep each miniapp schema small and independently grammar-constrained, and use `json-render`/A2UI/CopilotKit as design references or narrowly scoped components. The highest-value experiment is a three-way reliability benchmark on the actual LFM2.5/2.6B Q4 models: (a) one native call per miniapp, (b) a narrow json-render tree, and (c) an A2UI-like flat update stream. Measure valid-call rate, repair rate, output tokens, first-render latency, and RN frame/render cost.

