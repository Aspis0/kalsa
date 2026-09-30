// The Advanced panel's own words: the development knobs' labels live in
// knobs/, this record is the sentences and the model-name field.

export const ADVANCED = {
  modelName: "Model name",
  modelNamePlaceholder: "my-model",
  modelNameError: "Enter the model's name.",
  // The first page's arm when no name is stored. The words live here, not on
  // the first page, because the button opens this panel.
  noModelYet: "This computer has no model name yet.",
  addModelName: "Add the model name",
  // The info popover beside a knob's label. The knob's own words (label,
  // what it is, what it's for) come with the knob, not from here.
  whatItDoes: (label: string) => `What ${label} does`,
  explanationAria: (label: string) => `${label} explanation`,
  whatItIs: "What it is",
  whatItsFor: "What it’s for",
  usualValues: "Usual values",
  noUsualValue: "There is no widely agreed value for this one.",
};
