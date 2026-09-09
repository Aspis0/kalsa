import type {
  PdfRetrievalDoc,
  PdfRetrievalDocsResult,
} from "../util/pdfText";

export type PdfExtractionScope = {
  docs: PdfRetrievalDoc[];
  skippedPages: number[];
  docCount: number;
  fullText: string;
  pageCount?: number;
  processedPageCount: number;
  truncated: boolean;
};

type PdfExtractionMetadata = {
  documentPageCount?: number | null;
  processedPageCount?: number | null;
  truncated?: boolean;
};

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const n = nonNegativeInteger(value);
  return n !== undefined && n > 0 ? n : undefined;
}

export function summarizePdfExtraction(
  result: PdfRetrievalDocsResult | null | undefined,
): PdfExtractionScope {
  const docs = Array.isArray(result?.docs) ? result.docs : [];
  const skippedPages = Array.isArray(result?.skippedPages)
    ? result.skippedPages.filter((page) => positiveInteger(page) !== undefined)
    : [];
  const processedPageCount =
    nonNegativeInteger(result?.processedPageCount) ??
    docs.length + skippedPages.length;
  const pageCount =
    positiveInteger(result?.documentPageCount) ??
    (processedPageCount > 0 ? processedPageCount : undefined);
  const textDocs = docs.filter(
    (doc) => doc && typeof doc.text === "string" && doc.text.trim().length > 0,
  );
  return {
    docs,
    skippedPages,
    docCount: textDocs.length,
    fullText: textDocs.map((doc) => doc.text).join("\n\n"),
    pageCount,
    processedPageCount,
    truncated:
      result?.truncated === true ||
      (pageCount !== undefined && processedPageCount < pageCount),
  };
}

export function addPdfExtractionMetadata(
  result: PdfRetrievalDocsResult,
  metadata: PdfExtractionMetadata,
): PdfRetrievalDocsResult {
  const fallback = summarizePdfExtraction(result);
  const processedPageCount =
    nonNegativeInteger(metadata.processedPageCount) ?? fallback.processedPageCount;
  const documentPageCount =
    positiveInteger(metadata.documentPageCount) ??
    positiveInteger(result.documentPageCount);
  const truncated =
    result.truncated === true ||
    metadata.truncated === true ||
    (documentPageCount !== undefined && processedPageCount < documentPageCount);
  return {
    ...result,
    processedPageCount,
    ...(documentPageCount !== undefined ? { documentPageCount } : {}),
    ...(truncated ? { truncated: true } : {}),
  };
}
