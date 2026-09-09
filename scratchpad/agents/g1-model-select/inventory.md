# GGUF inventory
## LFM2.5-2.6B-QAD-Q4_0.gguf

- File: /Users/marco/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf
- Tensor count: 266

### Tensor counts by ggml type

| ggml type | tensors |
|---|---:|
| F32 | 99 |
| Q4_0 | 166 |
| Q6_K | 1 |

### Tokenizer and control tokens

| field | value |
|---|---|
| tokenizer.ggml.model | gpt2 |
| tokenizer.ggml.pre | lfm2 |
| tokenizer.ggml.bos_token_id | 124894 \| '<\|startoftext\|>' |
| tokenizer.ggml.eos_token_id | 124900 \| '<\|im_end\|>' |
| tokenizer.ggml.eot_token_id | missing |
| tokenizer.ggml.padding_token_id | 124893 \| '<\|pad\|>' |

#### Quoted GGUF metadata lines used for token claims

> tokenizer.ggml.eos_token_id = 124900; token[124900] = '<|im_end|>'
> tokenizer.ggml.eot_token_id = missing
> tokenizer.chat_template contains '<|im_end|>'; token[124900] = '<|im_end|>'
> Stop set used for inspection: token[124900] '<|im_end|>'

### Thinking/reasoning and tool-call markers in the template

| class | markers found |
|---|---|
| thinking/reasoning | '<think>', '</think>', '/think', 'reasoning_content' |
| tool-call | '<\|tool_call_start\|>', '<\|tool_call_end\|>' |

### Chat template

```jinja
{{- bos_token -}}
{%- set preserve_thinking = preserve_thinking | default(false) -%}

{%- macro format_arg_value(arg_value) -%}
    {%- if arg_value is string -%}
        {{- "'" + (arg_value | replace("\\", "\\\\") | replace("'", "\\'") | replace("\n", "\\n") | replace("\r", "\\r")) + "'" -}}
    {%- elif arg_value is mapping or arg_value is iterable -%}
        {{- arg_value | tojson -}}
    {%- else -%}
        {{- arg_value | string -}}
    {%- endif -%}
{%- endmacro -%}

{%- macro parse_content(content) -%}
    {%- if content is string -%}
        {{- content -}}
    {%- elif content is mapping -%}
        {{- content | tojson -}}
    {%- elif content is iterable -%}
        {%- set _ns = namespace(result="") -%}
        {%- for item in content -%}
            {%- if item is string -%}
                {%- set _ns.result = _ns.result + item -%}
            {%- elif item is mapping and item.get("type") == "image" -%}
                {%- set _ns.result = _ns.result + "<image>" -%}
            {%- elif item is mapping and item.get("type") == "text" -%}
                {%- set _ns.result = _ns.result + ((item.get("text") or "") | string) -%}
            {%- else -%}
                {%- set _ns.result = _ns.result + (item | tojson) -%}
            {%- endif -%}
        {%- endfor -%}
        {{- _ns.result -}}
    {%- endif -%}
{%- endmacro -%}

{%- macro render_tool_calls(tool_calls) -%}
    {%- set tool_calls_ns = namespace(tool_calls=[]) -%}
    {%- for tool_call in tool_calls -%}
        {%- set func = tool_call["function"] if "function" in tool_call else tool_call -%}
        {%- set func_name = func["name"] -%}
        {%- set func_args = func.get("arguments") -%}
        {%- set args_ns = namespace(arg_strings=[]) -%}
        {%- if func_args is mapping -%}
            {%- for arg_name, arg_value in func_args.items() -%}
                {%- set args_ns.arg_strings = args_ns.arg_strings + [arg_name + "=" + format_arg_value(arg_value)] -%}
            {%- endfor -%}
        {%- elif func_args is string and (func_args | trim) not in ["", "{}", "null"] -%}
            {{- raise_exception("Tool call arguments must be a mapping, got a JSON-encoded string: parse arguments with json.loads() before applying the chat template") -}}
        {%- endif -%}
        {%- set tool_calls_ns.tool_calls = tool_calls_ns.tool_calls + [func_name + "(" + (args_ns.arg_strings | join(", ")) + ")"] -%}
    {%- endfor -%}
    {{- "<|tool_call_start|>[" + (tool_calls_ns.tool_calls | join(", ")) + "]<|tool_call_end|>" -}}
{%- endmacro -%}

{%- set ns = namespace(system_prompt="", last_user_index=-1) -%}
{%- if messages and messages[0]["role"] == "system" -%}
    {%- if messages[0].get("content") -%}
        {%- set ns.system_prompt = parse_content(messages[0]["content"]) -%}
    {%- endif -%}
    {%- set messages = messages[1:] -%}
{%- endif -%}
{%- if tools -%}
    {%- set ns.system_prompt = ns.system_prompt + ("\n" if ns.system_prompt else "") + "List of tools: [" -%}
    {%- for tool in tools -%}
        {%- if tool is not string -%}
            {%- set tool = tool | tojson -%}
        {%- endif -%}
        {%- set ns.system_prompt = ns.system_prompt + tool -%}
        {%- if not loop.last -%}
            {%- set ns.system_prompt = ns.system_prompt + ", " -%}
        {%- endif -%}
    {%- endfor -%}
    {%- set ns.system_prompt = ns.system_prompt + "]" -%}
{%- endif -%}
{%- if ns.system_prompt -%}
    {{- "<|im_start|>system\n" + ns.system_prompt + "<|im_end|>\n" -}}
{%- endif -%}
{%- for message in messages -%}
    {%- if message["role"] == "user" -%}
        {%- set ns.last_user_index = loop.index0 -%}
    {%- endif -%}
{%- endfor -%}
{%- for message in messages -%}
    {{- "<|im_start|>" + message.role + "\n" -}}
    {%- if message.role == "assistant" -%}
        {%- generation -%}
        {%- set keep_thinking = preserve_thinking or loop.index0 > ns.last_user_index -%}
        {%- set thinking = message.thinking or message.reasoning or message.reasoning_content -%}
        {%- set thinking = thinking if thinking is string else "" -%}
        {%- if thinking and keep_thinking -%}
            {{- "<think>" + thinking + "</think>" -}}
        {%- endif -%}
        {%- set _cfm_tag = "CONTINUE_FINAL_MESSAGE_TAG " -%}
        {%- set _has_cfm = false -%}
        {%- set content = "" -%}
        {%- if message.get("content") -%}
            {%- set content = parse_content(message.content) -%}
        {%- endif -%}
        {%- if not keep_thinking and "</think>" in content -%}
            {%- set content = content.split("</think>")[-1] | trim -%}
        {%- endif -%}
        {%- if content.endswith(_cfm_tag) -%}
            {%- set _has_cfm = true -%}
            {%- set _trunc_len = (content | length) - (_cfm_tag | length) -%}
            {%- set content = content[:_trunc_len] -%}
        {%- endif -%}
        {{- content -}}
        {%- if message.tool_calls -%}
            {{- render_tool_calls(message.tool_calls) -}}
        {%- endif -%}
        {%- if _has_cfm -%}
            {{- _cfm_tag -}}
        {%- endif -%}
        {{- "<|im_end|>\n" -}}
        {%- endgeneration -%}
    {%- else %}
        {%- if message.get("content") -%}
            {{- parse_content(message["content"]) -}}
        {%- endif -%}
        {{- "<|im_end|>\n" -}}
    {%- endif %}
{%- endfor -%}
{%- if add_generation_prompt -%}
    {{- "<|im_start|>assistant\n<think>" -}}
{%- endif -%}

```

## LFM2.5-2.6B-Q4_K_M.gguf

- File: /Users/marco/kalsa-qdc/models/LFM2.5-2.6B-Q4_K_M.gguf
- Tensor count: 266

### Tensor counts by ggml type

| ggml type | tensors |
|---|---:|
| F32 | 99 |
| Q4_K | 148 |
| Q6_K | 19 |

### Tokenizer and control tokens

| field | value |
|---|---|
| tokenizer.ggml.model | gpt2 |
| tokenizer.ggml.pre | lfm2 |
| tokenizer.ggml.bos_token_id | 124894 \| '<\|startoftext\|>' |
| tokenizer.ggml.eos_token_id | 124900 \| '<\|im_end\|>' |
| tokenizer.ggml.eot_token_id | missing |
| tokenizer.ggml.padding_token_id | 124893 \| '<\|pad\|>' |

#### Quoted GGUF metadata lines used for token claims

> tokenizer.ggml.eos_token_id = 124900; token[124900] = '<|im_end|>'
> tokenizer.ggml.eot_token_id = missing
> tokenizer.chat_template contains '<|im_end|>'; token[124900] = '<|im_end|>'
> Stop set used for inspection: token[124900] '<|im_end|>'

### Thinking/reasoning and tool-call markers in the template

| class | markers found |
|---|---|
| thinking/reasoning | '<think>', '</think>', '/think', 'reasoning_content' |
| tool-call | '<\|tool_call_start\|>', '<\|tool_call_end\|>' |

### Chat template

```jinja
{{- bos_token -}}
{%- set preserve_thinking = preserve_thinking | default(false) -%}

{%- macro format_arg_value(arg_value) -%}
    {%- if arg_value is string -%}
        {{- "'" + (arg_value | replace("\\", "\\\\") | replace("'", "\\'") | replace("\n", "\\n") | replace("\r", "\\r")) + "'" -}}
    {%- elif arg_value is mapping or arg_value is iterable -%}
        {{- arg_value | tojson -}}
    {%- else -%}
        {{- arg_value | string -}}
    {%- endif -%}
{%- endmacro -%}

{%- macro parse_content(content) -%}
    {%- if content is string -%}
        {{- content -}}
    {%- elif content is mapping -%}
        {{- content | tojson -}}
    {%- elif content is iterable -%}
        {%- set _ns = namespace(result="") -%}
        {%- for item in content -%}
            {%- if item is string -%}
                {%- set _ns.result = _ns.result + item -%}
            {%- elif item is mapping and item.get("type") == "image" -%}
                {%- set _ns.result = _ns.result + "<image>" -%}
            {%- elif item is mapping and item.get("type") == "text" -%}
                {%- set _ns.result = _ns.result + ((item.get("text") or "") | string) -%}
            {%- else -%}
                {%- set _ns.result = _ns.result + (item | tojson) -%}
            {%- endif -%}
        {%- endfor -%}
        {{- _ns.result -}}
    {%- endif -%}
{%- endmacro -%}

{%- macro render_tool_calls(tool_calls) -%}
    {%- set tool_calls_ns = namespace(tool_calls=[]) -%}
    {%- for tool_call in tool_calls -%}
        {%- set func = tool_call["function"] if "function" in tool_call else tool_call -%}
        {%- set func_name = func["name"] -%}
        {%- set func_args = func.get("arguments") -%}
        {%- set args_ns = namespace(arg_strings=[]) -%}
        {%- if func_args is mapping -%}
            {%- for arg_name, arg_value in func_args.items() -%}
                {%- set args_ns.arg_strings = args_ns.arg_strings + [arg_name + "=" + format_arg_value(arg_value)] -%}
            {%- endfor -%}
        {%- elif func_args is string and (func_args | trim) not in ["", "{}", "null"] -%}
            {{- raise_exception("Tool call arguments must be a mapping, got a JSON-encoded string: parse arguments with json.loads() before applying the chat template") -}}
        {%- endif -%}
        {%- set tool_calls_ns.tool_calls = tool_calls_ns.tool_calls + [func_name + "(" + (args_ns.arg_strings | join(", ")) + ")"] -%}
    {%- endfor -%}
    {{- "<|tool_call_start|>[" + (tool_calls_ns.tool_calls | join(", ")) + "]<|tool_call_end|>" -}}
{%- endmacro -%}

{%- set ns = namespace(system_prompt="", last_user_index=-1) -%}
{%- if messages and messages[0]["role"] == "system" -%}
    {%- if messages[0].get("content") -%}
        {%- set ns.system_prompt = parse_content(messages[0]["content"]) -%}
    {%- endif -%}
    {%- set messages = messages[1:] -%}
{%- endif -%}
{%- if tools -%}
    {%- set ns.system_prompt = ns.system_prompt + ("\n" if ns.system_prompt else "") + "List of tools: [" -%}
    {%- for tool in tools -%}
        {%- if tool is not string -%}
            {%- set tool = tool | tojson -%}
        {%- endif -%}
        {%- set ns.system_prompt = ns.system_prompt + tool -%}
        {%- if not loop.last -%}
            {%- set ns.system_prompt = ns.system_prompt + ", " -%}
        {%- endif -%}
    {%- endfor -%}
    {%- set ns.system_prompt = ns.system_prompt + "]" -%}
{%- endif -%}
{%- if ns.system_prompt -%}
    {{- "<|im_start|>system\n" + ns.system_prompt + "<|im_end|>\n" -}}
{%- endif -%}
{%- for message in messages -%}
    {%- if message["role"] == "user" -%}
        {%- set ns.last_user_index = loop.index0 -%}
    {%- endif -%}
{%- endfor -%}
{%- for message in messages -%}
    {{- "<|im_start|>" + message.role + "\n" -}}
    {%- if message.role == "assistant" -%}
        {%- generation -%}
        {%- set keep_thinking = preserve_thinking or loop.index0 > ns.last_user_index -%}
        {%- set thinking = message.thinking or message.reasoning or message.reasoning_content -%}
        {%- set thinking = thinking if thinking is string else "" -%}
        {%- if thinking and keep_thinking -%}
            {{- "<think>" + thinking + "</think>" -}}
        {%- endif -%}
        {%- set _cfm_tag = "CONTINUE_FINAL_MESSAGE_TAG " -%}
        {%- set _has_cfm = false -%}
        {%- set content = "" -%}
        {%- if message.get("content") -%}
            {%- set content = parse_content(message.content) -%}
        {%- endif -%}
        {%- if not keep_thinking and "</think>" in content -%}
            {%- set content = content.split("</think>")[-1] | trim -%}
        {%- endif -%}
        {%- if content.endswith(_cfm_tag) -%}
            {%- set _has_cfm = true -%}
            {%- set _trunc_len = (content | length) - (_cfm_tag | length) -%}
            {%- set content = content[:_trunc_len] -%}
        {%- endif -%}
        {{- content -}}
        {%- if message.tool_calls -%}
            {{- render_tool_calls(message.tool_calls) -}}
        {%- endif -%}
        {%- if _has_cfm -%}
            {{- _cfm_tag -}}
        {%- endif -%}
        {{- "<|im_end|>\n" -}}
        {%- endgeneration -%}
    {%- else %}
        {%- if message.get("content") -%}
            {{- parse_content(message["content"]) -}}
        {%- endif -%}
        {{- "<|im_end|>\n" -}}
    {%- endif %}
{%- endfor -%}
{%- if add_generation_prompt -%}
    {{- "<|im_start|>assistant\n<think>" -}}
{%- endif -%}

```

## Qwen3.5-4B-Q4_K_M.gguf

- File: /Users/marco/kalsa-qdc/models/Qwen3.5-4B-Q4_K_M.gguf
- Tensor count: 441

### Tensor counts by ggml type

| ggml type | tensors |
|---|---:|
| F32 | 232 |
| Q4_K | 149 |
| Q5_K | 24 |
| Q6_K | 35 |
| Q8_0 | 1 |

### Tokenizer and control tokens

| field | value |
|---|---|
| tokenizer.ggml.model | gpt2 |
| tokenizer.ggml.pre | qwen35 |
| tokenizer.ggml.bos_token_id | missing |
| tokenizer.ggml.eos_token_id | 248046 \| '<\|im_end\|>' |
| tokenizer.ggml.eot_token_id | missing |
| tokenizer.ggml.padding_token_id | 248055 \| '<\|vision_pad\|>' |

#### Quoted GGUF metadata lines used for token claims

> tokenizer.ggml.eos_token_id = 248046; token[248046] = '<|im_end|>'
> tokenizer.ggml.eot_token_id = missing
> tokenizer.chat_template contains '<|im_end|>'; token[248046] = '<|im_end|>'
> Stop set used for inspection: token[248046] '<|im_end|>'

### Thinking/reasoning and tool-call markers in the template

| class | markers found |
|---|---|
| thinking/reasoning | '<think>', '</think>', '/think', 'reasoning_content', 'enable_thinking' |
| tool-call | '<tools>', '</tools>', '<function', '</function>', '<param', '<tool_response>', '</tool_response>', '<tool_call>', '</tool_call>' |

### Chat template

```jinja
{%- set image_count = namespace(value=0) %}
{%- set video_count = namespace(value=0) %}
{%- macro render_content(content, do_vision_count, is_system_content=false) %}
    {%- if content is string %}
        {{- content }}
    {%- elif content is iterable and content is not mapping %}
        {%- for item in content %}
            {%- if 'image' in item or 'image_url' in item or item.type == 'image' %}
                {%- if is_system_content %}
                    {{- raise_exception('System message cannot contain images.') }}
                {%- endif %}
                {%- if do_vision_count %}
                    {%- set image_count.value = image_count.value + 1 %}
                {%- endif %}
                {%- if add_vision_id %}
                    {{- 'Picture ' ~ image_count.value ~ ': ' }}
                {%- endif %}
                {{- '<|vision_start|><|image_pad|><|vision_end|>' }}
            {%- elif 'video' in item or item.type == 'video' %}
                {%- if is_system_content %}
                    {{- raise_exception('System message cannot contain videos.') }}
                {%- endif %}
                {%- if do_vision_count %}
                    {%- set video_count.value = video_count.value + 1 %}
                {%- endif %}
                {%- if add_vision_id %}
                    {{- 'Video ' ~ video_count.value ~ ': ' }}
                {%- endif %}
                {{- '<|vision_start|><|video_pad|><|vision_end|>' }}
            {%- elif 'text' in item %}
                {{- item.text }}
            {%- else %}
                {{- raise_exception('Unexpected item type in content.') }}
            {%- endif %}
        {%- endfor %}
    {%- elif content is none or content is undefined %}
        {{- '' }}
    {%- else %}
        {{- raise_exception('Unexpected content type.') }}
    {%- endif %}
{%- endmacro %}
{%- if not messages %}
    {{- raise_exception('No messages provided.') }}
{%- endif %}
{%- set num_sys = 0 %}
{%- set merged_system = '' %}
{%- if messages[0].role == 'system' or messages[0].role == 'developer' %}
    {%- set first = render_content(messages[0].content, false, true)|trim %}
    {%- if messages|length > 1 and (messages[1].role == 'system' or messages[1].role == 'developer') %}
        {%- set second = render_content(messages[1].content, false, true)|trim %}
        {%- set merged_system = first + '\n' + second %}
        {%- set num_sys = 2 %}
    {%- else %}
        {%- set merged_system = first %}
        {%- set num_sys = 1 %}
    {%- endif %}
{%- endif %}
{%- if tools and tools is iterable and tools is not mapping %}
    {{- '<|im_start|>system\n' }}
    {{- "# Tools\n\nYou have access to the following functions:\n\n<tools>" }}
    {%- for tool in tools %}
        {{- "\n" }}
        {{- tool | tojson }}
    {%- endfor %}
    {{- "\n</tools>" }}
    {{- '\n\nIf you choose to call a function ONLY reply in the following format with NO suffix:\n\n<tool_call>\n<function=example_function_name>\n<parameter=example_parameter_1>\nvalue_1\n</parameter>\n<parameter=example_parameter_2>\nThis is the value for the second parameter\nthat can span\nmultiple lines\n</parameter>\n</function>\n</tool_call>\n\n<IMPORTANT>\nReminder:\n- Function calls MUST follow the specified format: an inner <function=...></function> block must be nested within <tool_call></tool_call> XML tags\n- Required parameters MUST be specified\n- You may provide optional reasoning for your function call in natural language BEFORE the function call, but NOT after\n- If there is no function call available, answer the question like normal with your current knowledge and do not tell the user about function calls\n</IMPORTANT>' }}
    {%- if merged_system %}
        {{- '\n\n' + merged_system }}
    {%- endif %}
    {{- '<|im_end|>\n' }}
{%- else %}
    {%- if merged_system %}
        {{- '<|im_start|>system\n' + merged_system + '<|im_end|>\n' }}
    {%- endif %}
{%- endif %}
{%- set ns = namespace(multi_step_tool=true, last_query_index=messages|length - 1) %}
{%- for message in messages[::-1] %}
    {%- set index = (messages|length - 1) - loop.index0 %}
    {%- if ns.multi_step_tool and message.role == "user" %}
        {%- set content = render_content(message.content, false)|trim %}
        {%- if not(content.startswith('<tool_response>') and content.endswith('</tool_response>')) %}
            {%- set ns.multi_step_tool = false %}
            {%- set ns.last_query_index = index %}
        {%- endif %}
    {%- endif %}
{%- endfor %}
{%- for message in messages %}
    {%- if loop.index0 >= num_sys and message.role != "system" and message.role != "developer" %}
    {%- set content = render_content(message.content, true)|trim %}
    {%- if message.role == "user" %}
        {{- '<|im_start|>' + message.role + '\n' + content + '<|im_end|>' + '\n' }}
    {%- elif message.role == "assistant" %}
        {%- set reasoning_content = '' %}
        {%- if message.reasoning_content is string %}
            {%- set reasoning_content = message.reasoning_content %}
        {%- else %}
            {%- if '</think>' in content %}
                {%- set reasoning_content = content.split('</think>')[0].rstrip('\n').split('<think>')[-1].lstrip('\n') %}
                {%- set content = content.split('</think>')[-1].lstrip('\n') %}
            {%- endif %}
        {%- endif %}
        {%- set reasoning_content = reasoning_content|trim %}
        {%- if loop.index0 > ns.last_query_index %}
            {{- '<|im_start|>' + message.role + '\n<think>\n' + reasoning_content + '\n</think>\n\n' + content }}
        {%- else %}
            {{- '<|im_start|>' + message.role + '\n' + content }}
        {%- endif %}
        {%- if message.tool_calls and message.tool_calls is iterable and message.tool_calls is not mapping %}
            {%- for tool_call in message.tool_calls %}
                {%- if tool_call.function is defined %}
                    {%- set tool_call = tool_call.function %}
                {%- endif %}
                {%- if loop.first %}
                    {%- if content|trim %}
                        {{- '\n\n<tool_call>\n<function=' + tool_call.name + '>\n' }}
                    {%- else %}
                        {{- '<tool_call>\n<function=' + tool_call.name + '>\n' }}
                    {%- endif %}
                {%- else %}
                    {{- '\n<tool_call>\n<function=' + tool_call.name + '>\n' }}
                {%- endif %}
                {%- if tool_call.arguments is mapping %}
                    {%- for args_name in tool_call.arguments %}
                        {%- set args_value = tool_call.arguments[args_name] %}
                        {{- '<parameter=' + args_name + '>\n' }}
                        {%- set args_value = args_value | tojson | safe if args_value is mapping or (args_value is sequence and args_value is not string) else args_value | string %}
                        {{- args_value }}
                        {{- '\n</parameter>\n' }}
                    {%- endfor %}
                {%- endif %}
                {{- '</function>\n</tool_call>' }}
            {%- endfor %}
        {%- endif %}
        {{- '<|im_end|>\n' }}
    {%- elif message.role == "tool" %}
        {%- if loop.previtem and loop.previtem.role != "tool" %}
            {{- '<|im_start|>user' }}
        {%- endif %}
        {{- '\n<tool_response>\n' }}
        {{- content }}
        {{- '\n</tool_response>' }}
        {%- if not loop.last and loop.nextitem.role != "tool" %}
            {{- '<|im_end|>\n' }}
        {%- elif loop.last %}
            {{- '<|im_end|>\n' }}
        {%- endif %}
    {%- endif %}
    {%- endif %}
{%- endfor %}
{%- if add_generation_prompt %}
    {{- '<|im_start|>assistant\n' }}
    {%- if enable_thinking is defined and enable_thinking is false %}
        {{- '<think>\n\n</think>\n\n' }}
    {%- else %}
        {{- '<think>\n' }}
    {%- endif %}
{%- endif %}
{#- Unsloth fixes - developer role, tool calling #}

```

## MiniCPM5-2B-Q4_K_M.gguf

- File: /Users/marco/kalsa-qdc/models/MiniCPM5-2B-Q4_K_M.gguf
- Tensor count: 381

### Tensor counts by ggml type

| ggml type | tensors |
|---|---:|
| F32 | 85 |
| Q4_K | 253 |
| Q6_K | 43 |

### Tokenizer and control tokens

| field | value |
|---|---|
| tokenizer.ggml.model | gpt2 |
| tokenizer.ggml.pre | minicpm5 |
| tokenizer.ggml.bos_token_id | 0 \| '<s>' |
| tokenizer.ggml.eos_token_id | 1 \| '</s>' |
| tokenizer.ggml.eot_token_id | missing |
| tokenizer.ggml.padding_token_id | 1 \| '</s>' |

#### Quoted GGUF metadata lines used for token claims

> tokenizer.ggml.eos_token_id = 1; token[1] = '</s>'
> tokenizer.ggml.eot_token_id = missing
> tokenizer.chat_template contains '<|im_end|>'; token[130073] = '<|im_end|>'
> Stop set used for inspection: token[1] '</s>', token[130073] '<|im_end|>'

### Thinking/reasoning and tool-call markers in the template

| class | markers found |
|---|---|
| thinking/reasoning | '<think>', '</think>', '/think', 'reasoning_content', 'enable_thinking' |
| tool-call | '<tools>', '</tools>', '<function', '</function>', '<param', '</param>', '<tool_response>', '</tool_response>', '<tool_sep>' |

### Chat template

```jinja
{{- bos_token }}{%- if tools %}
    {%- set tool_definitions %}
        {{- "# Tools\n\nYou are provided with function signatures within <tools></tools> XML tags:\n<tools>" }}
        {%- for tool in tools %}
            {{- "\n" }}
            {{- tool | tojson(ensure_ascii=False) }}
        {%- endfor %}
        {{- '\n</tools>\n\nTool usage guidelines:\n- You may call zero or more functions. If no function calls are needed, just answer normally and do not include any <function ... </function>.\n- When calling a function, return an XML object within <function ... </function> using:\n<function name="function-name"><param name="param-name">param-value</param></function>\n- param-value may be multi-line. If it contains <, & or newline characters, wrap it in a CDATA block: <param name="param-name"><![CDATA[...multi-line value...]]></param>' }}
    {%- endset %}
    
    {{- '<|im_start|>system\n' }}
    {%- if messages[0].role == 'system' %}
        {%- if '<tool_def_sep>' in messages[0].content %}
            {{- messages[0].content.replace('<tool_def_sep>', tool_definitions) }}
        {%- else %}
            {{- messages[0].content + '\n\n' + tool_definitions }}
        {%- endif %}
    {%- else %}
        {{- tool_definitions.lstrip() }}
    {%- endif %}
    {{- '<|im_end|>\n' }}
{%- else %}
    {%- if messages[0].role == 'system' %}
        {{- '<|im_start|>system\n' + messages[0].content + '<|im_end|>\n' }}
    {%- endif %}
{%- endif %}
{%- set ns = namespace(multi_step_tool=true, last_query_index=messages|length - 1) %}
{%- for message in messages[::-1] %}
    {%- set index = (messages|length - 1) - loop.index0 %}
    {%- if ns.multi_step_tool and message.role == "user" and message.content is string and not(message.content.startswith('<tool_response>') and message.content.endswith('</tool_response>')) %}
        {%- set ns.multi_step_tool = false %}
        {%- set ns.last_query_index = index %}
    {%- endif %}
{%- endfor %}
{%- for message in messages %}
    {%- if message.content is string %}
        {%- set content = message.content %}
    {%- else %}
        {%- set content = '' %}
    {%- endif %}
    {%- if (message.role == "user") or (message.role == "system" and not loop.first) %}
        {{- '<|im_start|>' + message.role + '\n' + content + '<|im_end|>' + '\n' }}
    {%- elif message.role == "assistant" %}
        {%- set reasoning_content = '' %}
        {%- if message.reasoning_content is string %}
            {%- set reasoning_content = message.reasoning_content %}
        {%- else %}
            {%- if '</think>' in content %}
                {%- set reasoning_content = content.split('</think>')[0].rstrip('\n').split('<think>')[-1].lstrip('\n') %}
                {%- set content = content.split('</think>')[-1].lstrip('\n') %}
            {%- endif %}
        {%- endif %}
        
        {%- if message.tool_calls %}
            {%- set content_parts = content.split('<tool_sep>') %}
            {%- set processed_content = content_parts[0] %}
            {%- set tool_calls_count = message.tool_calls|length %}
            {%- set tool_sep_count = content_parts|length - 1 %}
            {%- set min_count = [tool_calls_count, tool_sep_count]|min %}
            
            {%- for i in range(1, content_parts|length) %}
                {%- set tool_index = i - 1 %}
                {%- if tool_index < tool_calls_count %}
                    {%- set tool_call = message.tool_calls[tool_index] %}
                    {%- if tool_call.function %}
                        {%- set tool_call = tool_call.function %}
                    {%- endif %}
                    {%- set single_tool_xml %}
                        {{- '<function name="' ~ tool_call.name ~ '">' }}
                        {%- if tool_call.arguments %}
                            {%- set args_dict = tool_call.arguments %}
                            {%- for param_name, param_value in args_dict.items() %}
                                {{- '<param name="' ~ param_name ~ '">' }}
                                {%- if param_value is string and ('<' in param_value or '&' in param_value or '\n' in param_value) %}
                                    {{- '<![CDATA[' + param_value + ']]>' }}
                                {%- else %}
                                    {{- param_value }}
                                {%- endif %}
                                {{- '</param>' }}
                            {%- endfor %}
                        {%- endif %}
                        {{- '</function>' }}
                    {%- endset %}
                    {%- set processed_content = processed_content + single_tool_xml + content_parts[i] %}
                {%- else %}
                    {%- set processed_content = processed_content + content_parts[i] %}
                {%- endif %}
            {%- endfor %}
            
            {%- if tool_calls_count > tool_sep_count %}
                {%- for remaining_index in range(tool_sep_count, tool_calls_count) %}
                    {%- set tool_call = message.tool_calls[remaining_index] %}
                    {%- if tool_call.function %}
                        {%- set tool_call = tool_call.function %}
                    {%- endif %}
                    {%- set remaining_tool_xml %}
                        {{- '<function name="' ~ tool_call.name ~ '">' }}
                        {%- if tool_call.arguments %}
                            {%- set args_dict = tool_call.arguments %}
                            {%- for param_name, param_value in args_dict.items() %}
                                {{- '<param name="' ~ param_name ~ '">' }}
                                {%- if param_value is string and ('<' in param_value or '&' in param_value or '\n' in param_value) %}
                                    {{- '<![CDATA[' + param_value + ']]>' }}
                                {%- else %}
                                    {{- param_value }}
                                {%- endif %}
                                {{- '</param>' }}
                            {%- endfor %}
                        {%- endif %}
                        {{- '</function>' }}
                    {%- endset %}
                    {%- set processed_content = processed_content + remaining_tool_xml %}
                {%- endfor %}
            {%- endif %}
            
            {%- set content = processed_content %}
        {%- endif %}
        
        {%- if reasoning_content %}
            {{- '<|im_start|>' + message.role + '\n<think>\n' + reasoning_content.strip('\n') + '\n</think>\n\n' + content.lstrip('\n') }}
        {%- elif '<think>' not in content and '</think>' not in content %}
            {{- '<|im_start|>' + message.role + '\n<think>\n\n</think>\n\n' + content.lstrip('\n') }}
        {%- else %}
            {{- '<|im_start|>' + message.role + '\n' + content }}
        {%- endif %}
        
        {%- if message.tool_calls and not has_tool_sep %}
            {%- for tool_call in message.tool_calls %}
                {%- if (loop.first and content) or (not loop.first) %}
                    {{- '\n' }}
                {%- endif %}
                {%- if tool_call.function %}
                    {%- set tool_call = tool_call.function %}
                {%- endif %}
                {{- '<function name="' ~ tool_call.name ~ '">' }}
                {%- if tool_call.arguments %}
                    {%- set args_dict = tool_call.arguments %}
                    {%- for param_name, param_value in args_dict.items() %}
                        {{- '<param name="' ~ param_name ~ '">' }}
                        {%- if param_value is string and ('<' in param_value or '&' in param_value or '\n' in param_value) %}
                            {{- '<![CDATA[' + param_value + ']]>' }}
                        {%- else %}
                            {{- param_value }}
                        {%- endif %}
                        {{- '</param>' }}
                    {%- endfor %}
                {%- endif %}
                {{- '</function>' }}
            {%- endfor %}
        {%- endif %}
        {{- '<|im_end|>\n' }}
    {%- elif message.role == "tool" %}
        {%- if loop.first or (messages[loop.index0 - 1].role != "tool") %}
            {{- '<|im_start|>user' }}
        {%- endif %}
        {{- '\n<tool_response>\n' }}
        {%- if message.content is string %}
            {{- content }}
        {%- else %}
            {{- message.content | tojson(ensure_ascii=False) }}
        {%- endif %}
        {{- '\n</tool_response>' }}
        {%- if loop.last or (messages[loop.index0 + 1].role != "tool") %}
            {{- '<|im_end|>\n' }}
        {%- endif %}
    {%- endif %}
{%- endfor %}
{%- if add_generation_prompt %}
    {{- '<|im_start|>assistant\n' }}
    {%- if enable_thinking is defined %}
        {%- if enable_thinking is false %}
            {{- '<think>\n\n</think>\n\n' }}
        {%- elif enable_thinking is true %}
            {{- '<think>\n' }}
        {%- endif %}
    {%- endif %}
{%- endif %}

```

## MiniCPM5 model-card settings

Source: https://huggingface.co/openbmb/MiniCPM5-2B

Quoted lines read from the official model card:

~~~python
inputs = tokenizer.apply_chat_template(
    messages,
    tokenize=True,
    add_generation_prompt=True,
    enable_thinking=True,
    return_dict=True,
    return_tensors="pt",
)
~~~

> Recommended sampling params: temperature=1.0, top_p=0.95

The card also states that MiniCPM5-2B emits XML-style tool calls and identifies
SGLang's built-in minicpm5 parser as the recommended tool-calling backend.
