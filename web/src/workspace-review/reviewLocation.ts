export type ReviewLocation =
  | { readonly surface: "changes"; readonly fileId?: string }
  | {
      readonly surface: "files";
      readonly file?: { readonly id: string; readonly view: "source" | "baseline" };
    }
  | { readonly surface: "evidence" };

export type ReviewLocationAction =
  | { readonly type: "show"; readonly surface: ReviewLocation["surface"] }
  | {
      readonly type: "open-file";
      readonly fileId: string;
      readonly view: "source" | "baseline";
    }
  | { readonly type: "view-change"; readonly fileId: string }
  | { readonly type: "back" }
  | { readonly type: "retain-file"; readonly fileId?: string };

export const reduceReviewLocation = (
  current: ReviewLocation,
  action: ReviewLocationAction,
): ReviewLocation => {
  switch (action.type) {
    case "show":
      return { surface: action.surface };
    case "open-file":
      return {
        surface: "files",
        file: { id: action.fileId, view: action.view },
      };
    case "view-change":
      return { surface: "changes", fileId: action.fileId };
    case "back":
      return { surface: current.surface };
    case "retain-file":
      if (current.surface === "evidence" || !action.fileId) return { surface: current.surface };
      if (current.surface === "changes") return { surface: "changes", fileId: action.fileId };
      return current.file
        ? { surface: "files", file: { ...current.file, id: action.fileId } }
        : current;
  }
};
