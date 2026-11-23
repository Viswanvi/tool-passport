import evalSet from '../../test/eval/questions.json';
import type { EvalQuestion } from './summary';

/** The 40-question set, bundled with the app so a Jira administrator can run it (spec P0-7). */
export const EVAL_QUESTIONS = evalSet.questions as EvalQuestion[];
