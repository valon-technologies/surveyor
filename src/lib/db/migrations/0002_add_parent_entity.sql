ALTER TABLE entity ADD COLUMN parent_entity_id TEXT REFERENCES entity(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS entity_parent_idx ON entity(parent_entity_id);
