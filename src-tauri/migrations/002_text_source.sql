-- Where a document's searchable text came from: 'native' (its own text layer),
-- 'ocr' (recognised from page images) or 'none' (indexed, but no text found,
-- e.g. a scanned PDF or a comic). NULL while text has not been indexed yet.
ALTER TABLE documents ADD COLUMN text_source TEXT CHECK (text_source IN ('native', 'ocr', 'none'));

UPDATE documents
SET text_source = CASE WHEN EXISTS (SELECT 1 FROM doc_text t WHERE t.document_id = documents.id) THEN 'native' ELSE 'none' END
WHERE text_indexed = 1;
