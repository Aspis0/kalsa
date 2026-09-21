/**
 * The answer's blocks for the new shell: paragraphs, headings, lists,
 * blockquotes, rules, GFM pipe tables and fenced code.
 *
 * It exists because the old renderer cannot be reused as-is: `MarkdownText.tsx`
 * takes the old `ThemeColors` and `useTypography()` through the lab theme, and the
 * new shell mounts no theme provider — its colours come from `design.ts`. So the
 * adapter §1.5 asks for is a renderer. The parsing is NOT re-implemented: the
 * block and inline shapes come from `parseMarkdownDocument`, which sits on the old
 * pure parser.
 *
 * Two things this file must not do.
 *
 * **It must not shrink a table cell.** `tableScrollDecision` is the only thing
 * that decides whether a table scrolls, and it is a pure function with its own
 * tests; when it says the table does not fit, the scroll view appears and the
 * table is pinned to the decision's own `requiredWidth`, so the cells keep the
 * readable minimum instead of being squeezed. That is why the layout has to hand
 * the answer a width (`readingMeasure`) rather than the renderer guessing one.
 *
 * **It must not label a container.** A table or a code block is a scrollable box
 * of text, not a control: an accessibility label on it becomes a
 * `contentDescription` on Android, which collapses the box into one announced
 * node and hides the cells or the code from a screen reader. The only interactive
 * node in this subtree is an inline link, and that one carries both a `testID` and
 * a name (`TranscriptInline.tsx`).
 */
import React, { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";

import type { MdBlock } from "../../chat/markdown";
import {
  parseMarkdownDocument,
  type DocBlock,
  type TableAlign,
  type TableRow,
} from "../../chat/markdownDocument";
import { useLocale, type TranslateFn } from "../../i18n";
import { spacing, type DesignColors } from "../../theme/design";
import { renderInline, type InlineContext } from "./TranscriptInline";
import type { TranscriptStyles } from "./TranscriptParts";
import { tableScrollDecision } from "./transcriptLayout";
import type { TranscriptSource } from "./transcriptTypes";

type MarkdownBlocksProps = {
  colors: DesignColors;
  /** The message id the testIDs hang off. */
  id: string;
  /** The width the answer really got, which is what the table decides on. */
  readingMeasure: number;
  sources?: readonly TranscriptSource[];
  styles: TranscriptStyles;
  text: string;
};

/** What every block below needs that is not the block itself. */
type BlockContext = MarkdownBlocksProps & { t: TranslateFn };

export function MarkdownBlocks({
  colors,
  id,
  readingMeasure,
  sources,
  styles,
  text,
}: MarkdownBlocksProps) {
  const { t } = useLocale();
  const document = useMemo(() => parseMarkdownDocument(text), [text]);
  const prefix = `transcript.answer.${id}`;
  const context: BlockContext = { colors, id, readingMeasure, sources, styles, t, text };

  return (
    <>
      {document.map((block, index) => {
        // The document's own rhythm: everything the answer stacks as a block — a
        // paragraph run, a table, a fence — is separated by the same 12–16 dp the
        // paragraphs get (DESIGN.md §2.2). Inside one run the old parser's blocks
        // keep their own, smaller gaps.
        const separated = index > 0;
        if (block.type === "code") {
          return (
            <CodeBlock
              block={block}
              key={index}
              separated={separated}
              styles={styles}
              testID={`${prefix}.code.${index}`}
            />
          );
        }
        if (block.type === "table") {
          return (
            <TableBlock
              align={block.align}
              context={context}
              header={block.header}
              key={index}
              rows={block.rows}
              separated={separated}
              testID={`${prefix}.table.${index}`}
            />
          );
        }
        return block.blocks.map((mdBlock, row) => (
          <MdBlockView
            block={mdBlock}
            context={context}
            key={`${index}.${row}`}
            separated={row === 0 && separated}
            testID={`${prefix}.b${index}.${row}`}
          />
        ));
      })}
    </>
  );
}

function inline(context: BlockContext, testID: string, color: string): InlineContext {
  return {
    color,
    idPrefix: testID,
    sources: context.sources,
    styles: context.styles,
    t: context.t,
  };
}

/** One block of a prose run. `separated` is the document gap; a block kind that
 *  carries its own spacing keeps it whenever it is not the run's first. */
function MdBlockView({
  block,
  context,
  separated,
  testID,
}: {
  block: MdBlock;
  context: BlockContext;
  separated: boolean;
  testID: string;
}) {
  const { colors, styles } = context;
  const gap = separated ? styles.paragraphGap : null;
  const spans = inline(context, testID, colors.ink);

  if (block.type === "rule") {
    return <View style={[styles.rule, gap]} testID={testID} />;
  }

  if (block.type === "heading") {
    // One step per level, all in the reading face: the design layer has no
    // heading role, so the steps reuse type's own metrics with the display
    // family rather than inventing sizes or weights.
    const scale =
      block.level === 1 ? styles.heading1 : block.level === 2 ? styles.heading2 : styles.heading3;
    return (
      <Text style={[scale, styles.headingSpacing, gap]} testID={testID}>
        {renderInline(block.inline, spans)}
      </Text>
    );
  }

  if (block.type === "quote") {
    return (
      <View style={[styles.quote, gap]} testID={testID}>
        <Text style={styles.quoteText}>
          {renderInline(block.inline, inline(context, testID, colors.silence))}
        </Text>
      </View>
    );
  }

  if (block.type === "listItem") {
    // Hanging indent: the marker column is as wide as the marker, so a three-digit
    // "100." does not overrun the text it belongs to.
    const markerWidth = block.ordered
      ? Math.max(spacing.xl + spacing.xxs, block.marker.length * spacing.sm)
      : spacing.md;
    return (
      <View
        style={[styles.listRow, { paddingLeft: block.depth * spacing.md }, gap]}
        testID={testID}
      >
        <Text style={[styles.listMarker, { width: markerWidth }]}>
          {block.ordered ? block.marker : "•"}
        </Text>
        <Text style={[styles.answer, { flex: 1 }]}>
          {renderInline(block.inline, spans)}
        </Text>
      </View>
    );
  }

  // A paragraph — the only member left, and the shape a partial table falls back
  // to while its separator row is still arriving.
  return (
    <Text style={[styles.answer, gap]} testID={testID}>
      {renderInline(block.inline, spans)}
    </Text>
  );
}

function CodeBlock({
  block,
  separated,
  styles,
  testID,
}: {
  block: Extract<DocBlock, { type: "code" }>;
  separated: boolean;
  styles: TranscriptStyles;
  testID: string;
}) {
  return (
    <View style={[styles.codeBlock, separated ? styles.paragraphGap : null]} testID={testID}>
      {block.lang === null ? null : (
        <View style={styles.codeHeader}>
          {/* The fence's own first word, verbatim: it is the answer's text, not
              interface copy, so it does not go through `t()`. No syntax
              highlighting and no copy control — both are the owner's decisions. */}
          <Text numberOfLines={1} style={styles.codeLang}>
            {block.lang}
          </Text>
        </View>
      )}
      <ScrollView horizontal nestedScrollEnabled>
        <Text style={styles.codeText}>{block.code}</Text>
      </ScrollView>
    </View>
  );
}

function TableBlock({
  align,
  context,
  header,
  rows,
  separated,
  testID,
}: {
  align: readonly (TableAlign | null)[];
  context: BlockContext;
  header: TableRow;
  rows: readonly TableRow[];
  separated: boolean;
  testID: string;
}) {
  const { styles } = context;
  const decision = tableScrollDecision(header.length, context.readingMeasure);
  const table = (
    <View style={decision.scrolls ? { minWidth: decision.requiredWidth } : null}>
      <TableRowView
        align={align}
        cells={header}
        context={context}
        header
        testID={`${testID}.h`}
      />
      {rows.map((row, index) => (
        <TableRowView
          align={align}
          cells={row}
          context={context}
          divider={index > 0}
          key={index}
          testID={`${testID}.r${index}`}
        />
      ))}
    </View>
  );

  // What the decision says, and only that. A table that fits is left in the flow
  // and its cells share the width; one that does not is scrolled, never cut.
  if (!decision.scrolls) {
    return (
      <View style={separated ? styles.paragraphGap : null} testID={testID}>
        {table}
      </View>
    );
  }
  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      style={separated ? styles.paragraphGap : undefined}
      testID={testID}
    >
      {table}
    </ScrollView>
  );
}

/** One row, header or body. `divider` draws the hairline above a body row; the
 *  first body row has none because the header already carries one, and two
 *  hairlines on one boundary read as a heavier rule. */
function TableRowView({
  align,
  cells,
  context,
  divider = false,
  header = false,
  testID,
}: {
  align: readonly (TableAlign | null)[];
  cells: TableRow;
  context: BlockContext;
  divider?: boolean;
  header?: boolean;
  testID: string;
}) {
  const { colors, styles } = context;
  return (
    <View
      style={[
        styles.tableRow,
        header ? styles.tableHeaderRow : null,
        divider ? styles.tableRowDivider : null,
      ]}
      testID={testID}
    >
      {cells.map((cell, index) => {
        // GFM align defaults to none, and an explicit `left` and no alignment
        // are the same thing on screen — so `null` is left alone rather than
        // rewritten into a value the delimiter row never stated.
        const column = align[index] ?? undefined;
        return (
          <View key={index} style={styles.tableCell}>
            <Text
              style={[
                header ? styles.tableHeaderText : styles.tableCellText,
                { textAlign: column },
              ]}
            >
              {/* The cell index is in the prefix: every cell's inline run starts
                  at 0, and two links in two columns must not share a testID. */}
              {renderInline(cell, inline(context, `${testID}.c${index}`, colors.ink))}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
