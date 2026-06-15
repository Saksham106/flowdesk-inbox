export type ConciergeTemplate = {
  name: string
  category: "pricing" | "scheduling" | "faq" | "complaint" | "onboarding" | "follow_up"
  content: string
}

export const DEFAULT_CONCIERGE_TEMPLATES: ConciergeTemplate[] = [
  {
    name: "Pricing Inquiry",
    category: "pricing",
    content: `Thank you for reaching out! Our pricing depends on your specific needs and situation.

To give you an accurate quote, could you share:
1. What service or package you're interested in?
2. How many people or sessions you're looking for?

I'll put together a customized proposal for you right away.`,
  },
  {
    name: "Availability Check",
    category: "scheduling",
    content: `Thanks for getting in touch! I'd love to help you find a time that works.

Let me check our current availability and send you a few options. Do you have a preferred day or time of day that works best for you? We're typically available Monday–Saturday.`,
  },
  {
    name: "Reschedule Request",
    category: "scheduling",
    content: `Of course — no problem at all! I've noted your current appointment and will look for the next available slot that fits.

Could you let me know your preferred days and times? I'll get back to you shortly with a new option.`,
  },
  {
    name: "New Client Welcome",
    category: "onboarding",
    content: `Welcome! We're so glad you've decided to get started with us.

Here's what happens next:
1. You'll receive a confirmation with all the details.
2. Please arrive 5–10 minutes early for your first session.
3. If you have any questions before then, reply to this email and I'll be happy to help.

Looking forward to seeing you soon!`,
  },
  {
    name: "Complaint — Calm Acknowledgment",
    category: "complaint",
    content: `Thank you for taking the time to share this with us. I'm sorry to hear your experience didn't meet your expectations — that's not the standard we hold ourselves to.

I want to make this right for you. Could you give me a bit more detail about what happened? I'll look into it personally and follow up with a resolution as quickly as possible.`,
  },
  {
    name: "FAQ — General Services",
    category: "faq",
    content: `Great question! Here's a quick overview of what we offer:

[Service 1]: Brief description.
[Service 2]: Brief description.
[Service 3]: Brief description.

Sessions are typically [duration] long and are available [days/times]. To get started, you can reply here or book directly at [booking link].

Is there a specific service you'd like to know more about?`,
  },
  {
    name: "Lead Follow-Up (Warm)",
    category: "follow_up",
    content: `Just wanted to follow up on my previous message — I'd love to help you get started and wanted to make sure this didn't get lost in your inbox.

If you have any questions about what we offer or what the next step looks like, I'm happy to chat. Would [day] or [day] work for a quick call?`,
  },
  {
    name: "Missed Appointment",
    category: "scheduling",
    content: `Hi — I noticed we missed you for today's appointment. No worries at all! These things happen.

Whenever you're ready, I'd love to get you rescheduled. Just reply here with a day that works for you and I'll take care of it.`,
  },
]

export type TemplateDocument = {
  tenantId: string
  title: string
  content: string
  sourceType: string
}

export function buildTemplateDocument(template: ConciergeTemplate, tenantId: string): TemplateDocument {
  return {
    tenantId,
    title: `[Template] ${template.name}`,
    content: template.content,
    sourceType: "concierge_template",
  }
}
