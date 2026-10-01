type Attachment = { type: string; url: string; transcript?: string };

/** Merge against the latest row so transcription never overwrites a user's edits. */
export function mergeRecordingTranscript<T extends Attachment>(
  content: string, attachments: T[], url: string, text: string, expectedContent?: string,
) {
  return {
    content: expectedContent !== undefined && content === expectedContent ? text : content,
    attachments: attachments.map(item => item.type === "audio" && item.url === url
      ? { ...item, transcript: item.transcript || text } : item),
  };
}
