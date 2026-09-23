import {
  isRemoteEngineBackend,
  streamAssistantTurn,
} from "../engine/engineBackend";

type StreamArgs = Parameters<typeof streamAssistantTurn>;

/** The host's sole stream entry: remote requests carry no tool schema or executor. */
export function streamHostTurn(...args: StreamArgs): ReturnType<typeof streamAssistantTurn> {
  const [messages, callbacks, signal, options] = args;
  const streamOptions = isRemoteEngineBackend()
    ? { ...options, tools: undefined, executeTool: undefined }
    : options;
  return streamAssistantTurn(messages, callbacks, signal, streamOptions);
}
