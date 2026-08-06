/**
 * Mount-once host that drives PdfToImages in text mode for requestPdfText().
 * Renders nothing visible; unmounts the WebView as soon as text docs arrive
 * (image fallback is not consumed by the tool path).
 */

import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { PdfToImages } from "../components/PdfToImages";
import {
  registerPdfTextHost,
  rejectPdfTextRequest,
  resolvePdfTextRequest,
  type PdfTextHostRequest,
} from "./pdfTextService";

export function PdfTextExtractorHost() {
  const [request, setRequest] = useState<PdfTextHostRequest | null>(null);

  useEffect(() => {
    return registerPdfTextHost({ setRequest });
  }, []);

  if (!request) return null;

  return (
    <View
      style={styles.hidden}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <PdfToImages
        key={request.id}
        pdfUri={request.fileUri}
        mode="textWithImageFallback"
        sourceId={request.sourceId}
        title={request.title}
        onPage={() => {
          /* Tool path ignores JPEG fallback pages. */
        }}
        onDone={() => {
          /* resolve/reject already handled via onTextDocs / onError. */
        }}
        onError={(error) => {
          rejectPdfTextRequest(request.id, error);
        }}
        onTextDocs={(result) => {
          resolvePdfTextRequest(request.id, result);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    overflow: "hidden",
  },
});
