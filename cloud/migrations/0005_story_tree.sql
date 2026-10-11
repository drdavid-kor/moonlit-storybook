-- Preserve existing six-page images while adding the four prepared branch nodes.
CREATE TABLE illustrations_tree (
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  page_index INTEGER NOT NULL CHECK(page_index BETWEEN 0 AND 9),
  status TEXT NOT NULL CHECK(status IN ('pending', 'completed', 'failed')),
  started_at INTEGER,
  object_key TEXT,
  model TEXT NOT NULL,
  metadata TEXT,
  PRIMARY KEY(job_id, page_index)
);
INSERT INTO illustrations_tree SELECT * FROM illustrations;
DROP TABLE illustrations;
ALTER TABLE illustrations_tree RENAME TO illustrations;
