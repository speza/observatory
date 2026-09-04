import { highlighter } from "@git-diff-view/react";
import type { WebWorkspaceReviewFileResponse } from "../../../src/web/protocol.ts";

const MAX_HIGHLIGHT_CHARACTERS = 100_000;
const MAX_HIGHLIGHT_LINES = 3_000;
const MAX_RENDERED_SOURCE_LINES = 5_000;

interface SyntaxSourceViewProps {
  readonly snapshot: WebWorkspaceReviewFileResponse;
  readonly theme: "light" | "dark";
}

export const SyntaxSourceView = ({ snapshot, theme }: SyntaxSourceViewProps): React.JSX.Element => {
  if (snapshot.status !== "available" || snapshot.content === undefined)
    return (
      <div className="review-workspace__empty">
        <strong>{snapshot.status}</strong>
        <span>{snapshot.message ?? "File content is unavailable."}</span>
      </div>
    );

  const lines = snapshot.content.split("\n");
  const renderedLines = lines.slice(0, MAX_RENDERED_SOURCE_LINES);
  const renderingTruncated = lines.length > renderedLines.length;
  const syntaxLines =
    snapshot.content.length <= MAX_HIGHLIGHT_CHARACTERS && lines.length <= MAX_HIGHLIGHT_LINES
      ? highlighter.processAST(
          highlighter.getAST(snapshot.content, snapshot.displayPath, snapshot.language, theme),
        ).syntaxFileObject
      : undefined;

  return (
    <div className="review-source" aria-label={`${snapshot.displayPath} source`} role="region">
      <pre>
        {renderedLines.map((line, index) => (
          <span className="review-source__line" key={`${index}:${line}`}>
            <i aria-hidden="true">{index + 1}</i>
            <code>
              {syntaxLines?.[index + 1]?.nodeList.map(({ node, wrapper }, tokenIndex) => (
                <span
                  className={wrapper?.properties?.className?.join(" ")}
                  key={`${tokenIndex}:${node.startIndex}`}
                >
                  {node.value}
                </span>
              )) ??
                (line || " ")}
            </code>
          </span>
        ))}
      </pre>
      {renderingTruncated ? (
        <p className="review-source__limit" role="status">
          Rendering limited to the first {MAX_RENDERED_SOURCE_LINES.toLocaleString()} lines.
        </p>
      ) : null}
    </div>
  );
};
