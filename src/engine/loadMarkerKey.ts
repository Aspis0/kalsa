/**
 * The AsyncStorage key of a model's load marker. Its own module, with no
 * native imports, so the model downloader can clear a marker without pulling
 * the exit-record logic into its build graph.
 */
export const loadMarkerKey = (modelId: string): string => `kalsa.load.dead.${modelId}`;
