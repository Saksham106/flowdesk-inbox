// Content-type filter pills shown in the app's own inbox UI, mirroring the
// Gmail-native content labels in lib/gmail-labels.ts (Newsletter, Marketing,
// Notification, Calendar) so the app's categorization never lags behind what
// shows up in Gmail. "Notification" matches both the classifier's
// "notification" and "fyi" emailType values, same as EMAIL_TYPE_CONTENT_LABEL
// in lib/gmail-labels.ts.
export const CONTENT_TYPE_FILTERS: { label: string; value: string; emailTypes: string[] }[] = [
  { label: "Newsletter", value: "newsletter", emailTypes: ["newsletter"] },
  { label: "Marketing", value: "marketing", emailTypes: ["marketing"] },
  { label: "Notification", value: "notification", emailTypes: ["notification", "fyi"] },
  { label: "Calendar", value: "calendar", emailTypes: ["calendar"] },
]

export function emailTypesForContentFilter(value: string | null | undefined): string[] | null {
  const filter = CONTENT_TYPE_FILTERS.find((f) => f.value === value)
  return filter ? filter.emailTypes : null
}
