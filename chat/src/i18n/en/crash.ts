// The last resort: the fallback that can never crash itself, with its two
// ways out.

export const CRASH = {
  title: "Something went wrong.",
  body: "The conversation view could not be drawn — usually this means the saved data is damaged. Your settings are untouched.",
  reload: "Reload the app",
  erase: "Erase local data and start fresh",
};
