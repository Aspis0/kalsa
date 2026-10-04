// The one media viewer, shared by the chat's message pictures and the
// room's media: the words of the full-view lightbox.

export const VIEWER = {
  viewerAria: "Media viewer",
  close: "Close",
  previous: "Previous",
  next: "Next",
  goTo: (index: number) => `Show item ${index}`,
  enlarge: "View full size",
  videoUnsupported: "Your browser does not support the video element.",
};
