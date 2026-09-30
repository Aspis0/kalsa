// The invitation half of the Devices page: one quiet button, the rows of
// what is out, and the three things worth saying about them.

export const INVITE = {
  inviteByLink: "Invite by link",
  invitationLinkAria: "Invitation link",
  copyLink: "Copy link",
  cancelInvite: "Cancel invite",
  expires: (time: string) => `Expires ${time}`,
  tomorrowAt: (time: string) => `tomorrow at ${time}`,
  slowCreate: "This is taking longer than usual. If the invitation appears below, copy its link from there.",
  discarded: "Earlier invitations could not be read, so they were cancelled for safety.",
  copiedUntil: (time: string) => `Link copied. It works once, until ${time}. Send it only to the person you want to add.`,
  copiedOneDay: "Link copied. It works once, for one day. Send it only to the person you want to add.",
};
