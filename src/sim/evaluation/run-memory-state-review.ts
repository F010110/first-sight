import {prepareMemoryReview,judgeMemoryReview} from './memory-state-review.js';
const [mode,...args]=process.argv.slice(2);
if(mode==='prepare'&&args.length===3)console.log(await prepareMemoryReview(args[0]!,args[1]!,args[2]!));
else if(mode==='judge'&&args.length===2&&args[1]==='--confirm-paid')console.log(JSON.stringify(await judgeMemoryReview(args[0]!)));
else throw Error('Usage: run-memory-state-review prepare STANDARD RUN NEW-BUNDLE | judge BUNDLE --confirm-paid');
