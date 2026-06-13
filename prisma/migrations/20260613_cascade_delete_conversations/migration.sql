-- Cascade-delete conversations and their children when a channel is disconnected.

-- Conversation → Channel
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_channelId_fkey";
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Message → Conversation
ALTER TABLE "Message" DROP CONSTRAINT "Message_conversationId_fkey";
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Draft → Conversation
ALTER TABLE "Draft" DROP CONSTRAINT "Draft_conversationId_fkey";
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ApprovalRequest → Conversation
ALTER TABLE "ApprovalRequest" DROP CONSTRAINT "ApprovalRequest_conversationId_fkey";
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AgentJob → Conversation
ALTER TABLE "AgentJob" DROP CONSTRAINT "AgentJob_conversationId_fkey";
ALTER TABLE "AgentJob" ADD CONSTRAINT "AgentJob_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CalendarHold → Conversation
ALTER TABLE "CalendarHold" DROP CONSTRAINT "CalendarHold_conversationId_fkey";
ALTER TABLE "CalendarHold" ADD CONSTRAINT "CalendarHold_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
