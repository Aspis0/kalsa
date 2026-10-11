// The sampling panel's own words: its heading, its one line per read state,
// and its save button. The knob words live in `knobs`.

export const SAMPLING = {
  title: "Sampling",
  note: "Saved choices change the next message you send. Nothing restarts, and the assistant keeps running.",
  saveButton: "Save sampling",
  count: (count: string) => `${count} settings`,
};
