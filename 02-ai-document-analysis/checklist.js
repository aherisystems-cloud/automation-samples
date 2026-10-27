// AI checklist for one tender: Claude Opus 5.5 reads the full bid document (and any
// addenda), then a second pass re-checks every item against the document.
// Output is a reading aid; the site tells buyers to verify against the official PDF.

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const MODEL = 'claude-opus-5-5';
const Page = z.string().describe('Page number(s) in the PDF where this is stated, e.g. "22" or "22-23". "unknown" if not found.');

export const Checklist = z.object({
  overview: z.object({
    title: z.string(),
    reference: z.string(),
    procuring_entity: z.string(),
    closing: z.string().describe('Closing date and time exactly as the document states it, after any addenda'),
    submission_place: z.string(),
    submission_method: z.string().describe('Physical hard copy, e-GP online, email... and how many copies'),
    bid_validity: z.string(),
    tender_fee: z.string(),
    plain_summary: z.string().describe('2-3 plain-English sentences: what is being bought and who can bid'),
  }),
  key_dates: z.array(z.object({ label: z.string(), when: z.string(), page: Page })),
  eligibility: z.array(z.object({ requirement: z.string(), page: Page }))
    .describe('Who may bid: AGPO reservation, NCA/other registration grade, local content, JV rules'),
  bid_security: z.object({
    required: z.boolean(),
    amount: z.string(),
    form_and_validity: z.string(),
    agpo_alternative: z.string().describe('What AGPO groups submit instead, or "none stated"'),
    page: Page,
  }),
  mandatory_requirements: z.array(z.object({
    code: z.string().describe('The document\'s own label, e.g. "MR4", or "" if unlabelled'),
    requirement: z.string().describe('Short, exact wording of what must be submitted'),
    detail: z.string().describe('Conditions: certified?, age limit, validity, who signs, original vs copy'),
    page: Page,
  })).describe('EVERY item checked at the preliminary/mandatory stage. Missing one disqualifies the bid.'),
  forms_to_fill: z.array(z.object({
    name: z.string(),
    sign_and_stamp: z.boolean(),
    page: Page,
  })).describe('Every form, schedule, declaration or price schedule the bidder must complete'),
  disqualification_traps: z.array(z.object({ rule: z.string(), page: Page }))
    .describe('Easily-missed formatting/submission rules that cause automatic disqualification (binding, pagination, sealing, labelling, copies, ink, signatures)'),
  evaluation: z.object({
    technical: z.string().describe('Criteria and weights'),
    pass_mark: z.string(),
    financial: z.string(),
    award_basis: z.string(),
  }),
  document_map: z.array(z.object({ pages: z.string(), section: z.string(), what_it_covers: z.string() })),
  page_summaries: z.array(z.object({ page: z.string(), summary: z.string() }))
    .describe('One short line per page or per run of identical pages (e.g. "61-210": bill of quantities)'),
  qualification_questions: z.array(z.object({
    question: z.string().describe('Yes/no question to the bidder, e.g. "Is your company registered with NCA in category 8 or higher?"'),
    category: z.enum(['eligibility', 'mandatory_document', 'financial', 'experience', 'capacity', 'timing']),
    disqualifies_if_no: z.boolean().describe('true if a "no" means the bid will fail; false if it only weakens the score'),
    evidence_quote: z.string().describe('Exact short quote from the document that creates this requirement'),
    page: Page,
  })).describe('Bid/no-bid questionnaire: one question per eligibility rule, mandatory requirement and scored criterion, so a bidder can decide whether to attempt the tender. Base every question on the document only.'),
  could_not_confirm: z.array(z.string())
    .describe('Anything unclear, contradictory, unreadable or missing in the document that the bidder must check with the procuring entity'),
});

const SYSTEM = `You prepare tender checklists for Kenyan businesses bidding on public tenders.
A bidder who misses one mandatory requirement is disqualified, so completeness and accuracy matter more than brevity.
Rules:
- Use only what the document states. Never invent requirements, amounts or dates.
- Quote requirement wording closely and give the PDF page number for every item.
- Where an addendum changes something (e.g. the closing date), use the addendum's value and say so.
- Put anything ambiguous, contradictory or unreadable in could_not_confirm.
- Plain English, short sentences. No em dashes.`;

const docBlocks = (docs) => docs.map((d, i) => ({
  type: 'document',
  source: { type: 'url', url: d.url },
  title: d.title,
  // Cache the documents so the verification pass re-reads them cheaply.
  ...(i === docs.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
}));

async function run(client, docs, instruction) {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'high', format: zodOutputFormat(Checklist) },
    system: SYSTEM,
    messages: [{ role: 'user', content: [...docBlocks(docs), { type: 'text', text: instruction }] }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('Model declined the document');
  if (msg.stop_reason === 'max_tokens') throw new Error('Checklist too long (max_tokens)');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { checklist: Checklist.parse(JSON.parse(text)), usage: msg.usage };
}

export async function generateChecklist(env, tender) {
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    // Org-level (unscoped) keys must name the workspace to bill.
    ...(env.ANTHROPIC_WORKSPACE_ID ? { defaultHeaders: { 'anthropic-workspace-id': env.ANTHROPIC_WORKSPACE_ID } } : {}),
  });
  const docs = [{ url: tender.doc_url, title: 'Tender document' }];
  for (const a of JSON.parse(tender.addenda || '[]')) {
    if (a.doc_url) docs.push({ url: a.doc_url, title: `Addendum: ${a.title || ''}`.trim() });
  }

  const draft = await run(client, docs,
    'Read the whole tender document and every addendum, then produce the checklist.');
  const final = await run(client, docs,
    `Here is a draft checklist for this tender. Check every item against the documents: fix wrong wording,
amounts, dates or page numbers, add ANY mandatory requirement, form or disqualification rule the draft missed,
and remove anything the documents do not support. Return the corrected, complete checklist.

DRAFT:
${JSON.stringify(draft.checklist)}`);

  return { checklist: final.checklist, model: MODEL, usage: [draft.usage, final.usage] };
}
