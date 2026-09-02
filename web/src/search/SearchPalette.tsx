import { useEffect, useRef, useState } from "react";
import type { SearchResult, UniverseMapProjection } from "../../../src/projection/types.ts";
import { ModalDialog } from "../shared/ModalDialog.tsx";

interface SearchPaletteProps {
  readonly error?: string;
  readonly loading: boolean;
  readonly onActivate: (result: SearchResult) => void;
  readonly onClose: () => void;
  readonly onQueryChange: (query: string) => void;
  readonly query: string;
  readonly projection: UniverseMapProjection;
  readonly results: readonly SearchResult[];
}

export type SearchPaletteKeyAction =
  | { readonly type: "none" }
  | { readonly type: "close" }
  | { readonly type: "activate"; readonly index: number }
  | { readonly type: "select"; readonly index: number };

export type SearchResultAction = "focus" | "inbox" | "inspect";

export const searchResultAction = (
  result: SearchResult,
  projection: UniverseMapProjection,
): SearchResultAction => {
  if (result.type === "goal")
    return projection.goals.some((goal) => goal.id === result.id) ? "focus" : "inspect";
  if (projection.goals.some((goal) => goal.agents.some((agent) => agent.id === result.id)))
    return "focus";
  return projection.unassigned.some((agent) => agent.id === result.id) ? "inbox" : "inspect";
};

export const searchPaletteKeyAction = (
  key: string,
  selectedIndex: number,
  resultCount: number,
): SearchPaletteKeyAction => {
  if (key === "Escape") return { type: "close" };
  if (resultCount === 0) return { type: "none" };
  if (key === "ArrowDown") return { type: "select", index: (selectedIndex + 1) % resultCount };
  if (key === "ArrowUp")
    return { type: "select", index: (selectedIndex - 1 + resultCount) % resultCount };
  if (key === "Home") return { type: "select", index: 0 };
  if (key === "End") return { type: "select", index: resultCount - 1 };
  if (key === "Enter") return { type: "activate", index: selectedIndex };
  return { type: "none" };
};

const actionLabel = (action: SearchResultAction | undefined): string => {
  if (!action) return "↵ activate";
  if (action === "inspect") return "↵ open in Inspector";
  if (action === "inbox") return "↵ open in Inbox";
  return "↵ focus in Atlas";
};

export const SearchPalette = ({
  error,
  loading,
  onActivate,
  onClose,
  onQueryChange,
  query,
  projection,
  results,
}: SearchPaletteProps): React.JSX.Element => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedResultRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setSelectedIndex(0), [query]);
  useEffect(() => {
    selectedResultRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const selected = results[selectedIndex] ?? results[0];
  const selectedAction = selected ? searchResultAction(selected, projection) : undefined;

  return (
    <ModalDialog
      ariaLabelledBy="search-palette-title"
      className="modal-backdrop search-palette-backdrop"
      onClose={onClose}
    >
      <section
        className="search-palette"
        onKeyDown={(event) => {
          const action = searchPaletteKeyAction(event.key, selectedIndex, results.length);
          if (action.type === "none") return;
          event.preventDefault();
          event.stopPropagation();
          if (action.type === "close") onClose();
          else if (action.type === "select") setSelectedIndex(action.index);
          else {
            const result = results[action.index];
            if (result) onActivate(result);
          }
        }}
      >
        <header>
          <label htmlFor="search-palette-query" id="search-palette-title">
            Find a Goal or Agent
          </label>
          <kbd>Esc</kbd>
        </header>
        <input
          aria-activedescendant={
            selected ? `search-result-${selected.type}-${selected.id}` : undefined
          }
          aria-autocomplete="list"
          aria-controls="search-palette-results"
          aria-expanded="true"
          autoComplete="off"
          data-autofocus
          id="search-palette-query"
          maxLength={200}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          placeholder="Type to find metadata…"
          role="combobox"
          spellCheck={false}
          value={query}
        />
        <div aria-live="polite" className="search-palette__status">
          {error
            ? error
            : loading
              ? "Searching…"
              : query.trim()
                ? `${results.length} result${results.length === 1 ? "" : "s"}`
                : "Search names, descriptions, repositories and status"}
        </div>
        <div className="search-palette__results" id="search-palette-results" role="listbox">
          {results.map((result, index) => (
            <button
              aria-selected={index === selectedIndex}
              className={index === selectedIndex ? "is-selected" : undefined}
              id={`search-result-${result.type}-${result.id}`}
              key={`${result.type}:${result.id}`}
              onClick={() => onActivate(result)}
              onMouseEnter={() => setSelectedIndex(index)}
              ref={index === selectedIndex ? selectedResultRef : undefined}
              role="option"
              type="button"
            >
              <i aria-hidden="true" />
              <span>
                <strong>{result.label}</strong>
                <small>{result.context}</small>
              </span>
              <em>{result.status}</em>
              <b>{result.type}</b>
            </button>
          ))}
          {!loading && query.trim() && results.length === 0 && !error ? (
            <p>No matching Goals or Agents.</p>
          ) : null}
        </div>
        <footer>
          <span>↑↓ / Home End navigate</span>
          <span>{actionLabel(selectedAction)}</span>
        </footer>
      </section>
    </ModalDialog>
  );
};
