/** Rotation-tolerant surface evidence; never an identity acceptance rule. */
export interface MatchView { view: "front" | "left" | "right"; path: string }
export function matchViews(frame: { path: string; visualMatchViews?: MatchView[]; matchViews?: MatchView[]; visualMatchPath?: string; matchPath?: string }): MatchView[] {
	return frame.visualMatchViews?.length ? frame.visualMatchViews : frame.matchViews?.length ? frame.matchViews : [{ view: "front", path: frame.visualMatchPath ?? frame.matchPath ?? frame.path }];
}

export interface CandidateScore { id: string; visual: number; inliers: number; path: number; supportedViews: number }
export function selectCandidates<T extends CandidateScore>(scores: T[], previousId: string | null, algorithmAvailable: boolean): T[] {
	const visual = scores.filter(item => item.inliers >= 15 || item.visual >= 0.5).sort((a, b) => b.inliers - a.inliers || b.supportedViews - a.supportedViews || b.visual - a.visual).slice(0, 3);
	const path = scores.filter(item => item.path >= 0.4).sort((a, b) => b.path - a.path).slice(0, 2);
	const previous = scores.filter(item => item.id === previousId);
	// Failed algorithms mean unknown, not candidate rejection.
	const fallback = algorithmAvailable ? [] : scores.slice(-2);
	return [...new Map([...previous, ...visual, ...path, ...fallback].map(item => [item.id, item])).values()];
}
