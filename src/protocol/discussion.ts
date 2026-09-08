import { z } from 'zod';
import { PROVIDERS } from './provider.js';

export const DiscussionParticipant = z.object({
  provider: z.enum(PROVIDERS),
  role: z.string().trim().min(1).max(120),
  model: z.string().trim().min(1).max(200).optional(),
});
export type DiscussionParticipant = z.infer<typeof DiscussionParticipant>;

export const DiscussionSpec = z.object({
  topic: z.string().trim().min(1).max(4_000),
  participants: z.array(DiscussionParticipant).min(2).max(8),
  turns: z.number().int().min(10).max(20),
  scribe: z.object({
    provider: z.enum(PROVIDERS),
    model: z.string().trim().min(1).max(200).optional(),
  }),
  summaryInstructions: z.string().trim().max(4_000).optional(),
});

export type DiscussionSpec = z.infer<typeof DiscussionSpec>;
