"""Experimental causal multi-representative context proposals, not room truth."""


def propose_multi_contexts(ticks,tick_ms,confidence):
    events=[];diagnostics=[];archive=[];recent_context=None;pending=None;pending_cohorts=[]
    def relation(old,new):
        values=[confidence(a,b) for a in old for b in new]
        if any(v is None for v in values):return 'unknown',values
        if all(v<=.1 for v in values):return 'departure',values
        if all(v>.1 for v in values) and max(values[0],values[2])>=.4 and max(values[1],values[3])>=.4:return 'consistent',values
        return 'ambiguous',values
    for i in range(1,len(ticks)):
        if ticks[i]!=ticks[i-1]+1 or tick_ms>4000:
            archive=[];recent_context=None;pending=None;pending_cohorts=[];continue
        support=confidence(i-1,i)
        if support is None or support<.4:
            if pending is not None:
                diagnostics.append({'atTick':ticks[i],'kind':'pending-insufficient-evidence'})
                # Consecutive support is required; never accumulate across weak frames.
                pending=None;pending_cohorts=[]
            continue
        candidate=(i-1,i)
        if not archive:
            archive=[candidate];recent_context=candidate;continue
        if recent_context[1]>=candidate[0]:
            agreement=confidence(recent_context[0],i)
            if agreement is not None and agreement>=.4:
                recent_context=candidate
                if archive[-1][1]<candidate[0]:archive.append(candidate)
            continue
        # Stable first, middle and latest views plus the recent context.
        representatives=list(dict.fromkeys([archive[0],archive[len(archive)//2],archive[-1],recent_context]))
        relations=[relation(old,candidate) for old in representatives]
        if any(kind=='consistent' for kind,_ in relations) and not any(kind=='departure' for kind,_ in relations):
            if pending is not None:diagnostics.append({'atTick':ticks[i],'kind':'candidate-cancelled'})
            pending=None;pending_cohorts=[];recent_context=candidate;archive.append(candidate);continue
        # Conflicting/low evidence invokes every committed cohort. No label input.
        expanded=[relation(old,candidate) for old in dict.fromkeys([*archive,recent_context]) if old[1]<candidate[0]]
        if not expanded or any(kind!='departure' for kind,_ in expanded):
            diagnostics.append({'atTick':ticks[i],'kind':'unresolved-expanded-review','committedCohorts':len(archive)})
            pending=None;pending_cohorts=[];continue
        if pending is None:
            pending=i-1;pending_cohorts=[candidate]
            diagnostics.append({'atTick':ticks[i],'kind':'candidate-started','beforeTick':ticks[pending]});continue
        # Third frame must also agree with the first candidate frame, rather
        # than chaining through a single shared frame across a doorway.
        agreement=confidence(pending,i)
        if agreement is None or agreement<.4:
            diagnostics.append({'atTick':ticks[i],'kind':'candidate-not-internally-confirmed'})
            pending=i-1;pending_cohorts=[candidate];continue
        old=archive[0]
        events.append({'beforeTick':ticks[pending],'confirmedTick':ticks[i],'oldTicks':[ticks[a] for a in old],'newTicks':[ticks[pending],ticks[i]],'oldSupport':confidence(*old),'newSupport':agreement,'crossSupport':[v for _,values in expanded for v in values],'reviewedCohorts':len(expanded)})
        diagnostics.append({'atTick':ticks[i],'kind':'candidate-confirmed','beforeTick':ticks[pending]})
        archive=[pending_cohorts[0],candidate];recent_context=candidate;pending=None;pending_cohorts=[]
    return events,diagnostics
