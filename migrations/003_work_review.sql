CREATE TABLE work_submissions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agreement_version integer NOT NULL,
  sequence integer NOT NULL CHECK(sequence > 0),
  author_id uuid NOT NULL REFERENCES users(id),
  notes text NOT NULL,
  links jsonb NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  review_due_at timestamptz NOT NULL,
  UNIQUE(project_id, sequence),
  FOREIGN KEY(project_id,agreement_version) REFERENCES agreement_versions(project_id,version)
);
CREATE TABLE work_reviews (
  submission_id uuid PRIMARY KEY REFERENCES work_submissions(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES users(id),
  decision text NOT NULL CHECK(decision IN ('approved','revision_requested')),
  feedback text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
