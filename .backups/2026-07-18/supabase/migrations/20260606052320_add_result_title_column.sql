-- Add title column to scan_results for short, readable violation names
ALTER TABLE scan_results ADD COLUMN IF NOT EXISTS title text;

-- Update existing records to have titles based on rule_id (for backwards compatibility)
UPDATE scan_results SET title = CASE rule_id
  WHEN 'image-alt' THEN 'Missing alt text'
  WHEN 'html-lang-valid' THEN 'No page language'
  WHEN 'document-title' THEN 'Missing page title'
  WHEN 'link-name' THEN 'Empty link text'
  WHEN 'label' THEN 'Missing form label'
  WHEN 'heading-order' THEN 'Heading order issue'
  WHEN 'button-name' THEN 'Empty button'
  WHEN 'aria-hidden-focus' THEN 'Hidden but focusable'
  WHEN 'frame-title' THEN 'Untitled iframe'
  WHEN 'landmark-main' THEN 'Missing main landmark'
  WHEN 'duplicate-id' THEN 'Duplicate ID'
  WHEN 'video-autoplay' THEN 'Video autoplay'
  WHEN 'audio-autoplay' THEN 'Audio autoplay'
  WHEN 'table-fake' THEN 'Table missing headers'
  WHEN 'meta-viewport' THEN 'Zoom disabled'
  WHEN 'listitem' THEN 'Orphan list item'
  ELSE 'Accessibility issue'
END WHERE title IS NULL;