// A full reference must match exactly so pasting an unavailable model cannot select a similar one.
export function huggingFaceModelID(input: string): string | undefined {
  const query = input.trim()
  if (!query.includes("/")) return undefined
  const match = /^(?:https:\/\/(?:huggingface\.co|hf\.co)\/)?([\w.-]+\/[\w.-]+)\/?(?:[?#].*)?$/i.exec(query)
  return match?.[1].toLowerCase() ?? ""
}
