// The decline a blocked send gets in place of the model's answer.

export const CONTENT_FILTER = {
  selfHarm:
    "I can't help with self-harm instructions. If this is urgent, contact local emergency services or a crisis support line now.",
  sexualAbuse: "I can't help with sexual abuse or exploitation content.",
  unsafeScience: "I can't help with unsafe biological or chemical instructions.",
  privacy: "I can't help extract or expose secrets, credentials, or personal data.",
  promptInjection: "I can't help bypass app, model, or safety instructions.",
  illegalActivity: "I can't help with instructions for illegal or harmful activity.",
  generic: "I can't help with that. Please keep the chat focused on safe, everyday topics.",
};

export type ContentFilterCopy = typeof CONTENT_FILTER;
