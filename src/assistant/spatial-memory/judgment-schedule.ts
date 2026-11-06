/** Deterministic judgment scheduling for 8-second window memory.
 *
 * The architecture's normal mode judges every sealed window. This module exists for
 * the event/stride experiments: it decouples "a window was sealed" from "run a full
 * spatial judgment" by carrying some windows as evidence for the next judgment.
 *
 * The rule deliberately uses no detectors. The offline counterfactual on the 813
 * trajectory showed that cheap causal signals (facts text, tail-image layout/histogram,
 * SIFT inliers, transition words) separate a real place change from a normal same-place
 * window only weakly (AUC 0.59-0.70). A stride is therefore the only rule that bounds
 * staleness by construction instead of by detection accuracy.
 *
 * `sinceJudged` counts sealed windows that have not started a judgment, including
 * windows that were skipped for being busy or for exhausting the judgment budget.
 * A null value means "no judgment has happened yet".
 */
export type JudgmentSchedule={judge:boolean;reason:'first-window'|'stride-due'|'scheduled-decimation'};

export function judgmentSchedule(input:{sinceJudged:number|null;stride:number}):JudgmentSchedule{
  const {sinceJudged,stride}=input;
  if(!Number.isInteger(stride)||stride<1||stride>8)throw Error('judgment stride must be an integer in 1..8');
  if(sinceJudged!==null&&(!Number.isInteger(sinceJudged)||sinceJudged<0))throw Error('sinceJudged must be a non-negative integer or null');
  if(stride===1)return {judge:true,reason:'first-window'};
  if(sinceJudged===null)return {judge:true,reason:'first-window'};
  return sinceJudged>=stride?{judge:true,reason:'stride-due'}:{judge:false,reason:'scheduled-decimation'};
}
