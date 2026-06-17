-- Add tsvector column to Message
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "searchVector" TSVECTOR;

-- Create GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS "Message_searchVector_idx"
  ON "Message" USING GIN ("searchVector");

-- Create trigger to auto-update searchVector on insert/update
CREATE OR REPLACE FUNCTION message_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('english', coalesce(NEW.body, '')), 'A');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER message_search_vector_trigger
  BEFORE INSERT OR UPDATE OF body ON "Message"
  FOR EACH ROW EXECUTE FUNCTION message_search_vector_update();

-- Backfill existing rows
UPDATE "Message"
SET "searchVector" = setweight(to_tsvector('english', coalesce(body, '')), 'A')
WHERE "searchVector" IS NULL;
