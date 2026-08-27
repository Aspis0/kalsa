/**
 * Local typings for @fugood/react-native-audio-pcm-stream.
 * The package ships types under the old name "react-native-live-audio-stream".
 *
 * Platform note (Android): `stop()` is NOT fully synchronous. The native
 * AudioRecord may still deliver a trailing `data` event after stop() returns /
 * the Promise resolves. Callers must ignore chunks after leaving the
 * "recording" state (VoiceCapture filters on state + limitFired).
 */
declare module "@fugood/react-native-audio-pcm-stream" {
  export interface Options {
    sampleRate: number;
    /** 1 | 2 */
    channels: number;
    /** 8 | 16 */
    bitsPerSample: number;
    /** Android MediaRecorder.AudioSource (default 6 = VOICE_RECOGNITION). */
    audioSource?: number;
    /** Optional WAV path; empty string when streaming only. */
    wavFile: string;
    bufferSize?: number;
  }

  export interface IAudioRecord {
    init: (options: Options) => void | Promise<void>;
    start: () => void;
    /**
     * Stop capture.
     * Android: asynchronous under the hood — a late `data` callback can still
     * arrive after this returns. Treat as best-effort completion, not a hard
     * barrier on the native recorder thread.
     */
    stop: () => void | Promise<string | void>;
    on: (
      event: "data",
      callback: (data: string) => void,
    ) => { remove: () => void } | void;
  }

  const AudioRecord: IAudioRecord;
  export default AudioRecord;
}
