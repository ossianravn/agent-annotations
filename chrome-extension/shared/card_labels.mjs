// Words for card states, shared by the side panel and the board.

export const STATUS_LABELS = {
  draft: "Draft",
  ready: "Ready for agent",
  in_progress: "In progress",
  waiting: "Waiting on you",
  done: "Done",
  wont_do: "Won't do"
};

export const ACTIVITY_LABELS = { review: "Ready for review", question: "Question", comment: "Note" };

export function typeLabel(severity) {
  if (severity === "bug") return "Bug";
  if (severity === "feature") return "Feature";
  return "Request";
}

export function statusLabel(card) {
  if (card.status === "waiting") return `Waiting on you: ${card.waitingReason === "question" ? "question" : "review"}`;
  if (card.status === "in_progress" && card.claimedBy) return `In progress · ${card.claimedBy}`;
  return STATUS_LABELS[card.status] || STATUS_LABELS.ready;
}

export function relativeTime(iso) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes)) return "at an unknown time";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString();
}

// Ranks are numbers since 0.6; 0.5 cards have ISO-date ranks.
export function rankValue(card) {
  if (Number.isFinite(card.rank)) return card.rank;
  return Date.parse(card.rank || card.createdAt) || 0;
}
