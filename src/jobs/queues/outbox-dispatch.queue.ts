// src/jobs/queues/outbox-dispatch.queue.ts
export const OUTBOX_DISPATCH_QUEUE = 'outbox-dispatch';
export const OUTBOX_DISPATCH_JOB = 'poll-and-dispatch';

// Fixed jobId for the repeatable job — BullMQ dedupes on this, so restarting
// the app (hot-reload in dev, redeploy in prod) never creates a second
// overlapping repeat schedule for the same logical job.
export const OUTBOX_DISPATCH_REPEAT_JOB_ID = 'outbox-dispatch-repeat';
