# Inbox Navigation Organization Design

## Product Decision

FlowDesk should separate mail filtering from app navigation. The inbox header should show only the destinations a user needs every day, while secondary operational tools move behind a compact menu. Personal accounts should not be shown business-only workflows.

## Account-Type Rules

- Personal accounts show primary navigation for Digest, Tasks, and Settings.
- Business accounts show primary navigation for Digest and Tasks.
- Business accounts get a secondary More menu containing Leads, Approvals, Reports, Audit, and Settings.
- Approvals remain available to personal accounts by direct URL because personal draft review can still be valid, but it is not part of the personal account's primary navigation.
- Leads, Reports, and Audit are business-only surfaces and should redirect personal users back to Inbox.

## Inbox Layout

The top header keeps the page title, caught-up summary, primary app navigation, and sign out control. Mail status filters stay in their own row beneath the header with labels All, Needs Reply, In Progress, and Closed. This makes the distinction clear: the top row changes areas of the product; the lower row filters the current inbox.

On mobile, the same organization applies with a horizontally scrollable row for primary navigation and a native details menu for More. The design avoids adding a client-side menu dependency.

## Implementation Shape

Add a small pure helper in `lib/app-navigation.ts` that returns primary and secondary navigation items by account type. The inbox page consumes that helper after reading the tenant account type. Business-only pages check the same account type server-side before loading their data.

## Testing

Unit tests cover the navigation helper for personal and business tenants. Existing route behavior remains server-rendered, so business-only page guards are verified through type-checking and the relevant test suite.
