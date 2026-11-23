/**
 * GitHub refuses an issue whose body is longer than this many characters ("Body is too long (maximum is
 * 65536 characters)"). `sf feedback` measures every body against it before it calls `gh`, so the refusal
 * is ours, readable and free of the body, not GitHub's after a failed round trip (#972).
 */
export const GITHUB_ISSUE_BODY_LIMIT = 65_536

/** The length GitHub counts: Unicode code points, not UTF-16 units (an emoji is one character). */
export function countCharacters(text: string): number {
  return Array.from(text).length
}

/** An issue body that GitHub would refuse for its length. Nothing was sent when this is thrown. */
export class IssueBodyTooLargeError extends Error {
  constructor(
    message: string,
    readonly length: number,
    readonly limit: number = GITHUB_ISSUE_BODY_LIMIT
  ) {
    super(message)
    this.name = 'IssueBodyTooLargeError'
  }
}

/** Generic guard for any caller that hands a body to GitHub; the bug report words its own, more helpful, message. */
export function assertIssueBodyFits(body: string): void {
  const length = countCharacters(body)
  if (length > GITHUB_ISSUE_BODY_LIMIT) {
    throw new IssueBodyTooLargeError(
      `The issue body is ${length} characters long, above the ${GITHUB_ISSUE_BODY_LIMIT} GitHub accepts (over by ${length - GITHUB_ISSUE_BODY_LIMIT}). Nothing was sent to GitHub; shorten the text and retry.`,
      length
    )
  }
}
