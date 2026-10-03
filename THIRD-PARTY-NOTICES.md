THIRD-PARTY NOTICES
===================

What the desktop chat (`chat/`) carries from elsewhere, beyond the npm
dependencies that `package.json` records. The repository's `NOTICE` file is the
other half of this record: it covers code derived from Jan and from gitleaks,
most of it in the Rust crates and `chat/src/lib/webgate/secretRules.ts`.

Nothing here ships inside the built application. The Tauri bundle copies
`chat/dist` and the icons, and copies no licence file: Vite emits none for the
dependencies it bundles, and the repository's `NOTICE` is not a bundle
resource either. This file is the attribution.

Streamdown
----------

    package:   streamdown v2.7.0 (npm, `chat/package.json`)
    licence:   Apache-2.0
    copyright: Copyright 2023 Vercel, Inc.
    url:       https://github.com/vercel/streamdown
    used by:   chat/src/components/Markdown.tsx renders the assistant's answer
               with it, while the answer streams.

The installed package's `LICENSE`, in full (it carries the Apache-2.0 header
and no copy of the licence body):

    Copyright 2023 Vercel, Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

assistant-ui, the stick-to-bottom hook
--------------------------------------

    package:   @assistant-ui/react and @assistant-ui/store (not installed)
    licence:   MIT
    copyright: Copyright (c) 2025 AgentbaseAI Inc.
    url:       https://github.com/assistant-ui/assistant-ui
    commit:    16ef5b3e1f982a392c00a9a90b291c02e6c6fc5c (2026-09-22)

Lifted as logic, not installed as a dependency. One file in this repository is
a translation of two upstream ones — chat/src/lib/stickToBottom.ts, from
`packages/react/src/primitives/thread/useThreadViewportAutoScroll.ts` and
`packages/store/src/utils/viewport-scroll.ts` — and its header states what was
kept, what was left out, and where it came from. Everything the hook drives
(the thread's viewport, the way back) is this app's own.
