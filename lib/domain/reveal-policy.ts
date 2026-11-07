export type RevealState = { status?: string | null; revealedAt?: Date | string | null; content?: string | null };

export function isRevealPublished(state: RevealState | null | undefined): boolean {
  return state?.status === "PUBLISHED" && Boolean(state.revealedAt) && Boolean(state.content?.trim());
}

export function publicRevealProjection(state: RevealState | null | undefined) {
  if (!isRevealPublished(state)) return null;
  return { content: state!.content!, publishedAt: state!.revealedAt! };
}

export function validateRevealReadiness(input: { enabled: boolean; eventCompleted: boolean; completedClueMatches: number; activeAwardedClues: number }) {
  const errors = [
    !input.enabled ? "Final clue reveal is disabled in event settings." : "",
    !input.eventCompleted ? "The event must be completed before publication." : "",
    input.completedClueMatches === 0 ? "No clue-awarding matches are complete." : "",
    input.completedClueMatches !== input.activeAwardedClues ? "Some completed clue-awarding matches have no matching awarded clue." : "",
  ].filter(Boolean);
  return { allowed: errors.length === 0, errors };
}
