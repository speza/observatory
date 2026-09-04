import { useMemo, useState } from "react";
import { DiffFile, DiffModeEnum, DiffView } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view-pure.css";
import type { WorkspaceDiffFile } from "../../../src/workspaces/types.ts";
import { ReviewFileStatus } from "./ReviewFileStatus.tsx";

type Theme = "light" | "dark";
type DiffMode = "split" | "unified";

const MAX_HIGHLIGHT_DIFF_CHARACTERS = 100_000;
const MAX_HIGHLIGHT_DIFF_LINES = 3_000;
const MAX_RENDERED_DIFF_LINES = 5_000;

const fileIdentity = (path: string): { readonly name: string; readonly directory?: string } => {
  const separator = path.lastIndexOf("/");
  return separator < 0
    ? { name: path }
    : { name: path.slice(separator + 1), directory: path.slice(0, separator) };
};

interface FileDiffProps {
  readonly file: WorkspaceDiffFile;
  readonly mode: DiffMode;
  readonly theme: Theme;
}

export const FileDiff = ({ file, mode, theme }: FileDiffProps): React.JSX.Element => {
  const diffCharacters = file.hunks.reduce((total, hunk) => total + hunk.length, 0);
  const diffLines = file.hunks.reduce((total, hunk) => total + hunk.split("\n").length, 0);
  const renderingTruncated = diffLines > MAX_RENDERED_DIFF_LINES;
  const highlight =
    diffCharacters <= MAX_HIGHLIGHT_DIFF_CHARACTERS && diffLines <= MAX_HIGHLIGHT_DIFF_LINES;
  const diffFile = useMemo(() => {
    if (renderingTruncated) return undefined;
    const prepared = DiffFile.createInstance({
      oldFile: file.oldFile,
      newFile: file.newFile,
      hunks: [...file.hunks],
    });
    // Initialize before paint so expanding a file does not change its height a
    // second time. Build only the active layout; changing mode creates a fresh
    // prepared view.
    prepared.initTheme(theme);
    prepared.init();
    if (mode === "split") prepared.buildSplitDiffLines();
    else prepared.buildUnifiedDiffLines();
    return prepared;
  }, [file, mode, renderingTruncated, theme]);

  return diffFile ? (
    <DiffView
      diffFile={diffFile}
      diffViewFontSize={12}
      diffViewHighlight={highlight}
      diffViewMode={mode === "split" ? DiffModeEnum.Split : DiffModeEnum.Unified}
      diffViewTheme={theme}
      diffViewWrap={false}
    />
  ) : (
    <p className="diff-review__limit" role="status">
      Diff rendering is limited to {MAX_RENDERED_DIFF_LINES.toLocaleString()} lines.
    </p>
  );
};

interface ChangedFileListProps {
  readonly files: readonly WorkspaceDiffFile[];
  readonly generatedAt: number;
  readonly mode: DiffMode;
  readonly theme: Theme;
}

const ChangedFile = ({
  file,
  mode,
  theme,
}: {
  readonly file: WorkspaceDiffFile;
  readonly mode: DiffMode;
  readonly theme: Theme;
}): React.JSX.Element => {
  const [expanded, setExpanded] = useState(false);
  const identity = fileIdentity(file.path);
  const status = file.binary ? "binary" : file.status;
  return (
    <details
      className="diff-review__file"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary aria-label={`${file.path}, ${status}`} className="diff-review__file-header">
        <span className="diff-review__file-chevron" aria-hidden="true" />
        <span className="diff-review__file-identity" title={file.path}>
          <strong className="diff-review__file-name">{identity.name}</strong>
          {identity.directory ? (
            <span className="diff-review__file-directory">{identity.directory}</span>
          ) : null}
        </span>
        <span className="diff-review__file-counts">
          {file.additions ? <em>+{file.additions}</em> : null}
          {file.deletions ? <i>−{file.deletions}</i> : null}
        </span>
        <ReviewFileStatus binary={file.binary} status={file.status} />
      </summary>
      {expanded ? (
        file.binary ? (
          <div className="diff-review__binary">Binary or oversized file · content omitted</div>
        ) : file.hunks.length > 0 ? (
          <div className="diff-review__renderer">
            <FileDiff file={file} mode={mode} theme={theme} />
          </div>
        ) : (
          <pre className="diff-review__raw">
            {file.newFile?.content ?? file.oldFile?.content ?? "No textual hunk available."}
          </pre>
        )
      ) : null}
    </details>
  );
};

export const ChangedFileList = ({
  files,
  generatedAt: _generatedAt,
  mode,
  theme,
}: ChangedFileListProps): React.JSX.Element => (
  <div aria-label="Changed files" className="diff-review__body" role="region">
    {files.map((file) => (
      <ChangedFile file={file} key={file.path} mode={mode} theme={theme} />
    ))}
  </div>
);
