// ═══════════════════════════════════════════════════════════════
// JANUS IA — Neo4j schema
//
// Node labels and their key property (unique id):
//   (:Project      {id})  — slug, e.g. "lool-ai"
//   (:Concept      {id})  — slug, e.g. "dashboard-shell"
//   (:Learning     {id})  — memory uuid or file slug
//   (:Pattern      {id})  — memory uuid or file slug
//   (:Session      {id})  — memory uuid
//   (:Correction   {id})  — memory uuid
//   (:Feedback     {id})  — memory uuid
//   (:Decision     {id})  — memory uuid
//   (:Agent        {id})  — slug, e.g. "developer"
//   (:Module       {id})  — slug, e.g. "validation"
//   (:Tag          {name})
//
// Relationship types (untyped baseline = REFERENCES; others added
// later by explicit typing or LLM extraction pass):
//   -[:REFERENCES]->       generic wikilink
//   -[:USES]->             project uses concept/module/pattern
//   -[:BLOCKED_BY]->       active blocker
//   -[:BLOCKS]->           inverse
//   -[:CONTRADICTS]->      learning vs learning
//   -[:EMERGED_FROM]->     pattern from sessions / concept from learnings
//   -[:PROMOTED_FROM]->    concept promoted from pattern
//   -[:MENTIONS]->         memory mentions project/concept
//   -[:BELONGS_TO]->       agent to project, memory to workspace
//   -[:SUPERSEDES]->       new memory supersedes old
//   -[:TAGGED]->           node has tag
// ═══════════════════════════════════════════════════════════════

// Unique constraints (create indexes automatically)
CREATE CONSTRAINT project_id       IF NOT EXISTS FOR (n:Project)    REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT concept_id       IF NOT EXISTS FOR (n:Concept)    REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT learning_id      IF NOT EXISTS FOR (n:Learning)   REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT pattern_id       IF NOT EXISTS FOR (n:Pattern)    REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT session_id       IF NOT EXISTS FOR (n:Session)    REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT correction_id    IF NOT EXISTS FOR (n:Correction) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT feedback_id      IF NOT EXISTS FOR (n:Feedback)   REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT decision_id      IF NOT EXISTS FOR (n:Decision)   REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT agent_id         IF NOT EXISTS FOR (n:Agent)      REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT module_id        IF NOT EXISTS FOR (n:Module)     REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT tag_name         IF NOT EXISTS FOR (n:Tag)        REQUIRE n.name IS UNIQUE;

// Search indexes (non-key)
CREATE INDEX project_name   IF NOT EXISTS FOR (n:Project)  ON (n.name);
CREATE INDEX concept_name   IF NOT EXISTS FOR (n:Concept)  ON (n.name);
CREATE INDEX session_date   IF NOT EXISTS FOR (n:Session)  ON (n.date);
