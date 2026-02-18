-- Add validation score and issues columns to generation table
ALTER TABLE generation ADD COLUMN validation_score INTEGER;
ALTER TABLE generation ADD COLUMN validation_issues TEXT;
