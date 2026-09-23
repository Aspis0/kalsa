let mockHookValues: unknown[] = [];
let mockHookCursor = 0;
const mockStateWrites: Array<[number, unknown]> = [];
const mockAlert = jest.fn();
const mockGetDocumentAsync = jest.fn();
const mockReadAsStringAsync = jest.fn();
const mockCopyToOwnedStorage = jest.fn();
const mockDeleteOwnedFile = jest.fn();
const mockResolveAssetSizeBytes = jest.fn();
const mockSizeWithinLimits = jest.fn();
const mockWriteOwnedText = jest.fn();
const mockEstimateTokens = jest.fn();
const mockAddDocument = jest.fn();
const mockHasNulInPrefix = jest.fn();

jest.mock("react", () => {
  const actual = jest.requireActual("react");
  return {
    ...actual,
    useCallback: (callback: unknown) => callback,
    useState: (initial: unknown) => {
      const index = mockHookCursor++;
      if (!Object.prototype.hasOwnProperty.call(mockHookValues, index)) mockHookValues[index] = initial;
      return [mockHookValues[index], (value: unknown) => {
        mockHookValues[index] = value;
        mockStateWrites.push([index, value]);
      }];
    },
  };
});
jest.mock("react-native", () => ({ Alert: { alert: (...args: unknown[]) => mockAlert(...args) } }));
jest.mock("expo-document-picker", () => ({ getDocumentAsync: (...args: unknown[]) => mockGetDocumentAsync(...args) }));
jest.mock("expo-file-system/legacy", () => ({ readAsStringAsync: (...args: unknown[]) => mockReadAsStringAsync(...args) }));
jest.mock("../../documents/DocumentLibrary", () => ({
  estimateTokensForDoc: (...args: unknown[]) => mockEstimateTokens(...args),
  formatBytesLocalized: (bytes: number) => `${bytes} bytes`,
}));
jest.mock("../../documents/documentStorage", () => ({
  MAX_DOCUMENT_BYTES: 1024,
  MAX_TEXT_BYTES: 512,
  copyToOwnedStorage: (...args: unknown[]) => mockCopyToOwnedStorage(...args),
  deleteOwnedFile: (...args: unknown[]) => mockDeleteOwnedFile(...args),
  peekFileHead: jest.fn(),
  resolveAssetSizeBytes: (...args: unknown[]) => mockResolveAssetSizeBytes(...args),
  sizeWithinLimits: (...args: unknown[]) => mockSizeWithinLimits(...args),
  writeOwnedText: (...args: unknown[]) => mockWriteOwnedText(...args),
}));
jest.mock("../../documents/documentKinds", () => ({
  DOCUMENTS_PICKER_TYPES: ["text/plain"],
  pickKind: jest.fn(() => "txt"),
  shouldSniffPickedKind: jest.fn(() => false),
  sniffDocxOrLegacy: jest.fn(),
}));
jest.mock("../../documents/docxToText", () => ({
  DocxExtractError: class DocxExtractError extends Error { code = "DOCX_FAILED"; },
  extractDocxTextFromFile: jest.fn(),
}));
jest.mock("../../documents/documentCover", () => ({ generateCoverForDoc: jest.fn() }));
jest.mock("../../documents/documentChatTool", () => ({ isDocumentOpInFlight: () => false }));
jest.mock("../../pdf/pdfTextService", () => ({ isPdfTextExtractionBusy: () => false, requestPdfText: jest.fn() }));
jest.mock("../../i18n", () => ({ useLocale: () => ({ t: (key: string) => key, locale: "en" }) }));
jest.mock("../../documents/extractionScope", () => ({ summarizePdfExtraction: jest.fn() }));
jest.mock("../../util/htmlToText", () => ({ htmlToText: jest.fn((value: string) => ({ text: value })) }));
jest.mock("./documentImportUtils", () => ({
  hasNulInPrefix: (...args: unknown[]) => mockHasNulInPrefix(...args),
  nextDocId: () => "doc-test",
}));

import { useDocumentImport } from "./useDocumentImport";

function makeHook(isDocumentDeleteInFlight = () => false) {
  mockHookValues = [];
  mockHookCursor = 0;
  mockStateWrites.length = 0;
  mockAddDocument.mockReset().mockReturnValue(true);
  return useDocumentImport({
    onAddDocument: (...args: unknown[]) => mockAddDocument(...args),
    isDocumentDeleteInFlight,
  });
}

beforeEach(() => {
  mockAlert.mockReset();
  mockGetDocumentAsync.mockReset().mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///picked/note.txt", name: "note.txt", mimeType: "text/plain" }],
  });
  mockReadAsStringAsync.mockReset().mockResolvedValue("Useful note text");
  mockCopyToOwnedStorage.mockReset().mockResolvedValue("file:///owned/doc-test.txt");
  mockDeleteOwnedFile.mockReset().mockResolvedValue(undefined);
  mockResolveAssetSizeBytes.mockReset().mockResolvedValue(16);
  mockSizeWithinLimits.mockReset().mockReturnValue({ ok: true, sizeBytes: 16 });
  mockWriteOwnedText.mockReset().mockResolvedValue("file:///owned/doc-test.txt");
  mockEstimateTokens.mockReset().mockReturnValue(4);
  mockHasNulInPrefix.mockReset().mockResolvedValue(false);
});

describe("useDocumentImport", () => {
  it("commits a picked text file and restores transient progress state", async () => {
    const startedAt = Date.now();
    const hook = makeHook();

    await hook.importDocument();

    expect(mockAddDocument).toHaveBeenCalledWith(expect.objectContaining({
      id: "doc-test",
      sourceId: "doc-test",
      name: "note.txt",
      kind: "txt",
      fileUri: "file:///owned/doc-test.txt",
      sizeBytes: 16,
      docCount: 1,
      estimatedTokens: 4,
      extractionStatus: "ok",
    }));
    const [entry] = mockAddDocument.mock.calls[0] as [{ addedAt: number }];
    expect(entry.addedAt).toBeGreaterThanOrEqual(startedAt);
    expect(entry.addedAt).toBeLessThanOrEqual(Date.now());
    expect(mockStateWrites).toEqual([[0, true], [1, "note.txt"], [0, false], [1, null]]);
  });

  it.each([
    ["a canceled picker result with a selected asset", {
      canceled: true,
      assets: [{ uri: "file:///picked/note.txt", name: "note.txt", mimeType: "text/plain" }],
    }],
    ["a picker result with no asset", { canceled: false, assets: [] }],
  ])("leaves no progress or writes after %s", async (_name, result) => {
    mockGetDocumentAsync.mockResolvedValueOnce(result);
    const hook = makeHook();

    await hook.importDocument();

    expect(mockGetDocumentAsync).toHaveBeenCalledTimes(1);
    expect(mockResolveAssetSizeBytes).not.toHaveBeenCalled();
    expect(mockCopyToOwnedStorage).not.toHaveBeenCalled();
    expect(mockWriteOwnedText).not.toHaveBeenCalled();
    expect(mockAddDocument).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
    expect(mockStateWrites).toEqual([[0, false], [1, null]]);
    expect(mockHookValues.slice(0, 2)).toEqual([false, null]);
  });

  it("rechecks a delete started while the picker was open and clears import progress", async () => {
    const deleteInFlight = jest.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const hook = makeHook(deleteInFlight);

    await hook.importDocument();

    expect(mockGetDocumentAsync).toHaveBeenCalledTimes(1);
    expect(mockResolveAssetSizeBytes).toHaveBeenCalledWith("file:///picked/note.txt");
    expect(deleteInFlight).toHaveBeenCalledTimes(2);
    expect(mockAlert).toHaveBeenCalledWith("documents.title", "documents.errorBusy");
    expect(mockCopyToOwnedStorage).not.toHaveBeenCalled();
    expect(mockWriteOwnedText).not.toHaveBeenCalled();
    expect(mockAddDocument).not.toHaveBeenCalled();
    expect(mockStateWrites).toEqual([[0, false], [1, null]]);
    expect(mockHookValues.slice(0, 2)).toEqual([false, null]);
  });

  it("alerts on an owned-storage failure, adds nothing, and clears progress", async () => {
    mockCopyToOwnedStorage.mockRejectedValueOnce(new Error("NO_DOCUMENT_DIRECTORY"));
    const hook = makeHook();

    await hook.importDocument();

    expect(mockAlert).toHaveBeenCalledWith("documents.title", "documents.errorStorage");
    expect(mockAddDocument).not.toHaveBeenCalled();
    expect(mockStateWrites).toEqual([[0, true], [1, "note.txt"], [0, false], [1, null]]);
  });

  it("refuses to open the picker while a delete is in flight", async () => {
    const hook = makeHook(() => true);

    await hook.importDocument();

    expect(mockAlert).toHaveBeenCalledWith("documents.title", "documents.errorBusy");
    expect(mockGetDocumentAsync).not.toHaveBeenCalled();
    expect(mockAddDocument).not.toHaveBeenCalled();
  });
});
