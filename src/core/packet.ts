import type { ContextRef } from "./submission";

// The generic opening boundary (spec §9.3). Sent regardless of producer wording.
export const OPENING_BOUNDARY = [
  "Read the retained handoff and the supplied instruction. Use this turn only to receive context and give a brief",
  "orientation. Treat any proposed execution as work to discuss after I respond. Do not modify project files, run the",
  "proposed work, create background jobs, or interpret opening this session as approval. If context is missing or",
  "unreadable, report that and do not acknowledge successful handoff. After the orientation and receipt, wait for my",
  "direction.",
].join(" ");

export const READY_MARKER = "INBOX_READY_V1";

export interface PacketInput {
  attemptId: string;
  itemId: string;
  contentRevision: number;
  title: string;
  producerId: string;
  profileId: string;
  cwd: string;
  instruction: string;
  handoffText: string;
  handoffSha256: string;
  capturedAt: string;
  refs: ContextRef[];
  challenge: string;
}

// Immutable per-attempt packet. Its bytes and hash are stored before the file is written.
// The receiving session must echo `challenge`, which appears only here, never in the prompt.
export function buildPacket(p: PacketInput): string {
  const refs = p.refs.length
    ? p.refs.map((r) => `- ${r.label ? `${r.label}: ` : ""}${r.uri}${r.sha256 ? ` (sha256 ${r.sha256})` : ""}`).join("\n")
    : "- none";
  return `# Agent inbox handoff packet

attempt_id: ${p.attemptId}
item_id: ${p.itemId}
content_revision: ${p.contentRevision}
producer: ${p.producerId}
profile: ${p.profileId}
working_directory: ${p.cwd}
handoff_sha256: ${p.handoffSha256}
handoff_captured_at: ${p.capturedAt}

## How to handle this opening turn

${OPENING_BOUNDARY}

Supporting references below are references only. Do not claim to have read them unless you actually open them.

When you have read this whole packet, end your reply with this exact line (one line, valid JSON after the marker):

${READY_MARKER} {"attempt_id":"${p.attemptId}","item_id":"${p.itemId}","content_revision":${p.contentRevision},"packet_sha256":"<the packet_sha256 from the opening prompt>","challenge":"${p.challenge}"}

If the handoff below is missing, cut off or unreadable, say so and do not print the marker.

## Title

${p.title}

## Instruction from the producer

${p.instruction}

## Supporting references

${refs}

## Retained handoff

<<<HANDOFF
${p.handoffText}
HANDOFF>>>
`;
}

// The short prompt submitted through Herdr: packet path, hash and attempt only (spec §9.2 step 5).
export function buildOpeningPrompt(attemptId: string, packetPath: string, packetSha256: string): string {
  return (
    `[agent-inbox ${attemptId}] Read the handoff packet at ${packetPath} (packet_sha256 ${packetSha256}) completely, ` +
    `then follow its opening-turn instructions: give a brief orientation, end with the ${READY_MARKER} line it describes, and wait for me.`
  );
}
